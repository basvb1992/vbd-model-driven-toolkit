import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import * as Core from "../src/index.js";

// Small DOM contract fixture for the compiled bundle, not rendered-browser evidence.
// No Xrm, parent frames, authentication or business-record endpoints.
async function fixture(core: unknown = Core) {
  let active: Node | undefined;
  const activate = (node: Node) => { active = node; };
  class Node {
    id = "";
    value = "";
    disabled = false;
    hidden = false;
    checked = false;
    readOnly = false;
    type = "";
    dataset: Record<string, string> = {};
    children: Node[] = [];
    attrs: Record<string, string> = {};
    listeners = new Map<string, (() => void)[]>();
    ownText = "";
    constructor(readonly tag: string) {}
    get textContent(): string { return this.ownText + this.children.map(node => node.textContent).join(""); }
    set textContent(text: string) { this.ownText = text; this.children = []; }
    set innerHTML(_text: string) { throw new Error("HTML injection is forbidden."); }
    append(...children: Node[]) {
      this.children.push(...children);
      if (this.tag === "select" && !this.value) this.value = this.children[0]?.value ?? "";
    }
    replaceChildren(...children: Node[]) { this.ownText = ""; this.children = []; this.append(...children); }
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
      if (name === "id") this.id = value;
    }
    getAttribute(name: string) { return this.attrs[name]; }
    addEventListener(name: string, listener: () => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
    fire(name: string) { for (const listener of this.listeners.get(name) ?? []) listener(); }
    click() { if (!this.disabled) this.fire("click"); }
    focus() { activate(this); }
    select() { activate(this); }
    querySelectorAll(selector: string): Node[] {
      return this.children.flatMap(child => [
        ...(selector.split(",").includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    }
  }
  class Input extends Node { constructor() { super("input"); } }
  class Select extends Node { constructor() { super("select"); } }
  class Textarea extends Node { constructor() { super("textarea"); } }
  class Button extends Node { constructor() { super("button"); } }
  class Pre extends Node { constructor() { super("pre"); } }
  class Paragraph extends Node { constructor() { super("p"); } }
  class Span extends Node { constructor() { super("span"); } }
  class Div extends Node { constructor() { super("div"); } }
  class List extends Node { constructor() { super("ul"); } }
  class Heading extends Node { constructor() { super("h2"); } }
  const constructors: Record<string, new () => Node> = {
    input: Input, select: Select, textarea: Textarea, button: Button, pre: Pre, p: Paragraph,
    span: Span, div: Div, ul: List, h2: Heading
  };
  const make = (tag: string) => constructors[tag] ? new constructors[tag]() : new Node(tag);
  const root = new Node("body"), stack = [root];
  const html = (await readFile("playground/index.html", "utf8")).split("<body>")[1] ?? "";
  for (const match of html.matchAll(/<\/?([a-z][\w-]*)([^>]*)>|([^<]+)/gi)) {
    const tag = match[1]?.toLowerCase(), parent = stack.at(-1)!;
    if (!tag) {
      parent.ownText += match[3] ?? "";
      if (parent.tag === "textarea") parent.value = parent.ownText;
    } else if (match[0].startsWith("</")) { if (stack.length > 1) stack.pop(); }
    else {
      const node = make(tag);
      for (const attr of (match[2] ?? "").matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        const name = attr[1]!, value = attr[2] ?? "";
        node.setAttribute(name, value);
        if (name === "value") node.value = value;
        if (name === "hidden") node.hidden = true;
        if (name === "disabled") node.disabled = true;
        if (name === "checked") node.checked = true;
      }
      parent.append(node);
      if (!["input", "meta", "link", "br", "hr", "img"].includes(tag)) stack.push(node);
    }
  }
  const all = (): Node[] => root.querySelectorAll(Object.keys(constructors).concat(["section", "li", "option", "label", "main", "header", "small", "strong", "code", "a", "h3"]).join(","));
  const get = (id: string) => {
    const node = all().find(node => node.id === id);
    if (!node) throw new Error(`Missing fixture node ${id}`);
    return node;
  };
  const read = vi.fn(() => { throw new Error("Unexpected automatic read"); });
  const clipboard = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const sandbox = createContext({
    VBD: core, HTMLElement: Node, HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea,
    HTMLButtonElement: Button, HTMLPreElement: Pre, HTMLParagraphElement: Paragraph, HTMLSpanElement: Span,
    HTMLDivElement: Div, HTMLUListElement: List, HTMLHeadingElement: Heading,
    document: { getElementById: get, createElement: make, querySelectorAll: (selector: string) => root.querySelectorAll(selector) },
    navigator: { clipboard: { writeText: clipboard } }, fetch: read, URL, AbortSignal, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, location: { origin: "https://playground.example" },
    GetGlobalContext: () => ({
      getClientUrl: () => "https://playground.example", userSettings: { userId: "11111111-2222-3333-4444-555555555555", languageId: 1033 },
      client: { getClientState: () => "Online" }, getCurrentAppProperties: async () => ({ appId: "11111111-2222-3333-4444-555555555555" })
    })
  });
  runInContext(await readFile("dist/playground/vbd.playground.js", "utf8"), sandbox);
  const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
  const edit = (id: string, value: string) => { get(id).value = value; get(id).fire("input"); };
  const choose = (id: string) => get(`example-${id}`).click();
  return { get, read, clipboard, edit, choose, settle, active: () => active, sandbox };
}
describe("compiled Playground UI contract (non-rendered fixture)", () => {
  it("loads without automatic reads; filters, empty state and selection are accessible", async () => {
    const ui = await fixture();
    expect(ui.read).not.toHaveBeenCalled();
    expect(ui.get("catalog-count").textContent).toBe("17 of 17 examples");
    ui.edit("category-filter", "Localization");
    expect(ui.get("catalog-count").textContent).toBe("2 of 17 examples");
    expect(ui.get("example-details").dataset.exampleId).toBe("format-number");
    ui.edit("example-search", "no matches");
    expect(ui.get("catalog-empty").hidden).toBe(false);
    expect(ui.get("example-details").hidden).toBe(true);
    ui.edit("example-search", "");
    expect(ui.get("catalog-empty").hidden).toBe(true);
    ui.choose("translate");
    expect(ui.active()?.id).toBe("example-heading");
    expect(ui.get("example-translate").getAttribute("aria-current")).toBe("true");
    expect(ui.read).not.toHaveBeenCalled();
  });
  it("handles absent/older Core per example, while inspect and copy-only guidance survive", async () => {
    const ui = await fixture({ Diagnostics: { getVersion: () => "0.5.0" }, Config: Core.Config, Links: Core.Links });
    expect(ui.get("version").textContent).toBe("Core 0.5.0");
    expect(ui.get("inspect").disabled).toBe(false);
    expect(ui.get("local").disabled).toBe(true);
    ui.choose("format-number");
    expect(ui.get("run-example").disabled).toBe(true);
    expect(ui.get("availability").textContent).toContain("Core 0.7.0");
    expect(ui.get("availability").textContent).toContain("I18n.formatNumber");
    ui.choose("read-batch");
    expect(ui.get("run-example").disabled).toBe(true);
    expect(ui.get("availability").textContent).toContain("Batch.execute");
    ui.choose("preflight");
    expect(ui.get("run-example").disabled).toBe(true);
    expect(ui.get("availability").textContent).toContain("Execution.preflight");
    ui.choose("validate-config");
    expect(ui.get("validate").disabled).toBe(false);
    const absent = await fixture(null);
    expect(absent.get("version").textContent).toBe("Core version unavailable");
    absent.get("inspect").click(); await absent.settle();
    expect(absent.get("result").textContent).toContain('"installed": "Core version unavailable"');
    expect(absent.get("status").dataset.kind).toBe("success");
  });
  it("keeps native examples copy-only with no native calls", async () => {
    const ui = await fixture();
    for (const id of ["form-onload", "form-command", "grid-command", "lookup-filter", "choice-restore", "prepared-command"]) {
      ui.choose(id);
      expect(ui.get("run-example").hidden).toBe(true);
      expect(ui.get("example-description").textContent).toContain("not runnable in sitemap HTML");
    }
    expect(ui.read).not.toHaveBeenCalled();
    expect(ui.sandbox.Xrm).toBeUndefined();
  });
  it("copies current escaped inputs as text and visibly recovers from clipboard denial", async () => {
    const ui = await fixture();
    ui.choose("translate");
    const person = 'A "quote"\n</script><img src=x onerror=alert(1)>';
    ui.edit("input-person", person);
    expect(ui.get("example-code").textContent).toContain(JSON.stringify(person));
    ui.get("copy-typescript").click(); await ui.settle();
    expect(ui.clipboard).toHaveBeenLastCalledWith(ui.get("example-code").textContent);
    expect(ui.get("copy-status").textContent).toContain("copied");
    ui.clipboard.mockRejectedValueOnce(new Error("denied"));
    ui.get("copy-typescript").click(); await ui.settle();
    expect(ui.get("copy-status").textContent).toContain("copy manually");
    expect(ui.active()?.id).toBe("example-code");
    ui.get("input-person").value = "Changed without an input event";
    ui.get("copy-typescript").click(); await ui.settle();
    expect(ui.clipboard).toHaveBeenLastCalledWith(expect.stringContaining('name: "Changed without an input event"'));
    ui.edit("input-person", "");
    expect(ui.get("example-code").textContent).toBe("");
    expect(ui.get("copy-typescript").disabled).toBe(true);
    expect(ui.get("run-example").disabled).toBe(true);
  });
  it("locks selection and editable inputs while running and clears stale results after edits", async () => {
    let finish!: (value: Core.ReadBatchResult<number>) => void;
    const execute = vi.fn(() => new Promise<Core.ReadBatchResult<number>>(resolve => { finish = resolve; }));
    const ui = await fixture({ ...Core, Batch: { execute } });
    ui.choose("read-batch"); ui.get("run-example").click(); await ui.settle();
    expect(ui.get("result").getAttribute("aria-busy")).toBe("true");
    expect(ui.get("input-count").disabled).toBe(true);
    expect(ui.get("example-translate").disabled).toBe(true);
    ui.choose("translate");
    expect(ui.get("example-details").dataset.exampleId).toBe("read-batch");
    finish({ status: "succeeded", stopReason: "none", items: [], counts: { total: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, resultBytes: 0 }); await ui.settle();
    expect(ui.get("result").textContent).toContain('"status": "succeeded"');
    expect(ui.get("input-count").disabled).toBe(false);
    ui.edit("input-count", "NaN");
    expect(ui.get("result").textContent).toContain("No result");
    expect(ui.get("example-code").textContent).toBe("");
  });
  it("shows failed/partial/incomplete results honestly and safely, and recovers controls", async () => {
    const ui = await fixture();
    ui.choose("read-batch"); ui.edit("input-outcome", "reject");
    ui.get("run-example").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("error");
    expect(ui.get("result").textContent).toContain('"status": "partial"');
    expect(ui.get("result").textContent).not.toMatch(/cause|diagnostic|value|stack/);
    ui.choose("preflight"); ui.get("run-example").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("error");
    expect(ui.get("result").textContent).toContain('"status": "incomplete"');
    ui.edit("input-observation", "pass"); ui.get("run-example").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("success");
    ui.choose("retry-read"); ui.edit("input-attempts", "1"); ui.get("run-example").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("error");
    expect(ui.get("result").textContent).not.toMatch(/Local transient|429|"cause"|"stack"/);
    expect(ui.get("run-example").disabled).toBe(false);
  });
  it("preserves explicit same-origin masked environment reads and never exposes raw failures", async () => {
    const getVariable = vi.fn(async () => ({
      schemaName: "vbd_Test", type: "text", source: "current", cached: false, value: "private-value"
    }));
    const ui = await fixture({ ...Core, Environment: { get: getVariable } });
    ui.choose("environment-read"); ui.edit("schema-name", "vbd_Test");
    expect(getVariable).not.toHaveBeenCalled();
    ui.get("read-variable").click(); await ui.settle();
    expect(ui.get("result").textContent).toContain("[hidden");
    expect(ui.get("result").textContent).not.toContain("private-value");
    expect(ui.get("example-code").textContent).toContain('value: "[hidden]"');
    expect(getVariable.mock.calls[0]).toHaveLength(2);
    ui.get("reveal").checked = true; ui.get("reveal").fire("input");
    expect(ui.get("example-code").textContent).toContain("value: resolved.value");
    ui.get("read-variable").click(); await ui.settle();
    expect(ui.get("result").textContent).toContain("private-value");
    ui.get("reveal").checked = false; ui.get("reveal").fire("input");
    expect(ui.get("result").textContent).not.toContain("private-value");
    expect(ui.get("example-code").textContent).toContain('value: "[hidden]"');
    getVariable.mockRejectedValueOnce(Object.assign(new Error("TOKEN=private-value"), { cause: "server dump" }));
    ui.get("read-variable").click(); await ui.settle();
    expect(ui.get("status").textContent).not.toMatch(/TOKEN|private-value|server dump/);
    expect(ui.get("result").textContent).not.toMatch(/TOKEN|private-value|server dump/);
    expect(ui.get("read-variable").disabled).toBe(false);
  });
  it("builds/copies links from current validated inputs without records/network/navigation", async () => {
    const ui = await fixture();
    ui.choose("record-link");
    expect(ui.get("copy-typescript").disabled).toBe(true);
    ui.get("current-app").click(); await ui.settle();
    ui.edit("record-id", "22222222-2222-3333-4444-555555555555");
    expect(ui.get("example-code").textContent).toContain('"allowedOrigins": [\n    "https://playground.example"');
    ui.get("build-link").click(); await ui.settle();
    expect(ui.get("generated-link").value).toContain("etn=account");
    ui.edit("table", "contact");
    expect(ui.get("generated-link").value).toBe("");
    expect(ui.get("copy-link").disabled).toBe(true);
    expect(ui.get("example-code").textContent).toContain('"entityType":"contact"');
    ui.get("build-link").click(); await ui.settle();
    ui.clipboard.mockRejectedValueOnce(new Error("clipboard"));
    ui.get("copy-link").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("error");
    expect(ui.get("result").textContent).toContain("copy manually");
    expect(ui.active()?.id).toBe("generated-link");
    expect(ui.read).not.toHaveBeenCalled();
  });
  it("keeps inspect/local/JSON validation explicit and invalidates obsolete declaration code", async () => {
    const ui = await fixture();
    ui.get("inspect").click(); await ui.settle();
    expect(ui.get("result").textContent).toContain('"installed": "Core 0.7.0"');
    expect(ui.get("result").textContent).toContain('"compiledMethods"');
    ui.get("local").click(); await ui.settle();
    expect(ui.get("result").textContent).toContain('"enabled": false');
    expect(ui.get("result").textContent).toContain('"count": 0');
    ui.choose("validate-config");
    const json = JSON.stringify({ text: 'a"quote\n</script><script>doNotExecute()</script>' });
    ui.edit("config-json", json);
    expect(ui.get("example-code").textContent).toContain(`JSON.parse(${JSON.stringify(json)})`);
    ui.get("validate").click(); await ui.settle();
    expect(ui.get("status").dataset.kind).toBe("error"); // Portable schema is intentionally absent.
    ui.edit("config-json", "{bad");
    expect(ui.get("example-code").textContent).toBe("");
    expect(ui.get("copy-typescript").disabled).toBe(true);
    expect(ui.get("result").textContent).toContain("No result");
    expect(ui.read).not.toHaveBeenCalled();
  });
});
