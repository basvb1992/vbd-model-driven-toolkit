import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadContext, currentApp, globalContext } from "../playground/platform.js";
import { Environment } from "../src/environment.js";

const userId = "11111111-2222-3333-4444-555555555555";
const definitionId = "22222222-2222-3333-4444-555555555555";
afterEach(() => vi.unstubAllGlobals());
function context() {
  const current = {
    getClientUrl: () => "https://playground.example",
    userSettings: { userId, languageId: 1033 },
    client: { getClientState: () => "Online" },
    getCurrentAppProperties: async () => ({ appId: userId })
  };
  vi.stubGlobal("location", { origin: "https://playground.example" });
  return current;
}
describe("Playground supported context and read-only adapter", () => {
  it("uses ClientGlobalContext rather than fabricating Xrm or reading a parent frame", async () => {
    const current = context(), get = vi.fn(() => current);
    vi.stubGlobal("GetGlobalContext", get);
    vi.stubGlobal("Xrm", undefined);
    expect(globalContext()).toBe(current);
    expect(await currentApp()).toEqual({ environmentUrl: "https://playground.example", appId: userId });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("fails explicitly outside the supported webresource context", () => {
    vi.stubGlobal("GetGlobalContext", undefined);
    expect(globalContext).toThrow("Open this page");
  });
  it("returns current environment/user/language scope without a network request", () => {
    const get = context(), request = vi.fn<typeof fetch>();
    expect(createReadContext(() => get, request).getScope()).toEqual({
      environmentUrl: "https://playground.example", userId, languageId: 1033, online: true
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("uses only bounded same-origin GET requests and current browser credentials", async () => {
    const get = context(), request = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ value: [{ type: 100000000 }], "@odata.nextLink": "opaque" })));
    const adapter = createReadContext(() => get, request);
    expect(await adapter.retrieveMultipleRecords("environmentvariabledefinition", "?$select=type&$top=2", 2))
      .toEqual({ entities: [{ type: 100000000 }], nextLink: "opaque" });
    const [url, options] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://playground.example/api/data/v9.2/environmentvariabledefinitions?$select=type&$top=2");
    expect(options).toMatchObject({ method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).not.toHaveProperty("Authorization");
  });
  it.each([
    ["account", "?$select=name&$top=2", 2],
    ["environmentvariablevalue", "?$select=value&$top=100", 2],
    ["environmentvariablevalue", "?$select=value&$top=2", 100],
    ["environmentvariablevalue", "https://elsewhere.example?$select=value&$top=2", 2],
    ["environmentvariablevalue", "?$select=value#bad&$top=2", 2]
  ] as const)("rejects an unsupported read before networking", async (table, query, size) => {
    const get = context(), request = vi.fn<typeof fetch>();
    await expect(createReadContext(() => get, request).retrieveMultipleRecords(table, query, size)).rejects.toThrow("bounded");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["https://elsewhere.example", "https://playground.example/path", "http://playground.example"])(
    "rejects current-origin mismatch or non-root URL %s", async environment => {
      const get = { ...context(), getClientUrl: () => environment }, request = vi.fn<typeof fetch>();
      await expect(createReadContext(() => get, request).retrieveMultipleRecords(
        "environmentvariabledefinition", "?$select=type&$top=2", 2
      )).rejects.toThrow("current Dataverse origin");
      expect(request).not.toHaveBeenCalled();
    });
  it("preserves denied-read classification through the toolkit", async () => {
    const get = context(), request = vi.fn<typeof fetch>(async () => new Response("", { status: 403 }));
    await expect(Environment.getDefinition("vbd_ReadDenied", {
      context: createReadContext(() => get, request)
    })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("never fetches a Secret current/default value through its approved adapter", async () => {
    const get = context(), request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      value: [{ environmentvariabledefinitionid: definitionId, schemaname: "vbd_Secret", type: 100000005 }]
    })));
    await expect(Environment.getText("vbd_Secret", {
      context: createReadContext(() => get, request)
    })).rejects.toMatchObject({ code: "SECRET_NOT_SUPPORTED" });
    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0]?.[0])).not.toContain("defaultvalue");
  });
  it.each([
    new Response("x".repeat(2_097_153)),
    new Response(Uint8Array.from([255])),
    new Response("not JSON")
  ])("rejects oversized or malformed streamed responses", async response => {
    const get = context(), request = vi.fn<typeof fetch>(async () => response);
    await expect(createReadContext(() => get, request).retrieveMultipleRecords(
      "environmentvariabledefinition", "?$select=type&$top=2", 2
    )).rejects.toThrow();
  });
});
describe("optional companion resource boundaries", () => {
  it("references separately installed Core and relative ClientGlobalContext, with no arbitrary execution surface", async () => {
    const html = await readFile("playground/index.html", "utf8");
    expect(html).toContain('../../ClientGlobalContext.js.aspx');
    expect(html).toContain('../toolkit/vbd.toolkit.js');
    expect(html).toContain('id="reveal" type="checkbox"');
    expect(html).not.toMatch(/id="reveal"[^>]+checked/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(":focus-visible");
    expect(html).toContain("@media(max-width:850px)");
    const bundle = await readFile("dist/playground/vbd.playground.js", "utf8");
    expect(bundle).not.toContain("DUPLICATE_INITIALIZATION");
    expect(bundle).not.toMatch(/parent\.Xrm|parent\.document|innerHTML|eval\(/);
    expect(bundle).not.toContain('method: "POST"');
    expect(bundle).toContain('method: "GET"');
  });
  it("includes a separate app/sitemap without tables or core resource duplication", async () => {
    const solution = await readFile("playground/solution/Other/Solution.xml", "utf8");
    expect(solution).toContain("<UniqueName>VBDToolkitPlayground</UniqueName>");
    expect(solution).toContain('type="80" schemaName="vbd_ToolkitPlayground"');
    expect(solution).toContain('solution="VBDModelDrivenToolkit (0.5.0.0)"');
    expect(solution).not.toContain('<RootComponent type="1"');
    expect(solution).not.toContain('<RootComponent type="61" schemaName="vbd_/toolkit/');
    const sitemap = await readFile("playground/solution/AppModuleSiteMaps/vbd_ToolkitPlayground/AppModuleSiteMap.xml", "utf8");
    expect(sitemap).toContain('Url="$webresource:vbd_/playground/vbd.playground.html"');
    expect(sitemap).not.toContain("https://");
    const app = await readFile("playground/solution/AppModules/vbd_ToolkitPlayground/AppModule.xml", "utf8");
    expect(app).toContain('<AppModuleComponent type="62" schemaName="vbd_ToolkitPlayground"');
    expect(app).not.toContain('<AppModuleComponent type="61"');
  });
});
