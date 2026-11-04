import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n.js";
import type { TranslationResources } from "../src/i18n.js";

const resources: TranslationResources = {
  "en-US": { greeting: "Hello {name}", empty: "", values: "{empty}/{enabled}/{count}", repeated: "{x}:{x}", "exact.key": "exact" },
  "nl-NL": { greeting: "Hallo {name}", empty: "" }
};
const strict = { resources, onMissing: "error" as const };

describe("bounded plain-text exact-key translation", () => {
  it("renders requested languages, exact keys and repeated scalar placeholders", () => {
    expect(I18n.translate("greeting", "nl-NL", { ...strict, values: { name: "Ada" } })).toBe("Hallo Ada");
    expect(I18n.translate("exact.key", "en-US", strict)).toBe("exact");
    expect(I18n.translate("repeated", "en-US", { ...strict, values: { x: 0 } })).toBe("0:0");
    expect(I18n.translate("values", "en-US", { ...strict, values: { empty: "", enabled: false, count: 0 } }))
      .toBe("/false/0");
    expect(I18n.translate("empty", "nl-NL", { ...strict, onMissing: "fallback", fallbackLocale: "en-US" })).toBe("");
    expect(() => I18n.translate("toString", "en-US", strict)).toThrow();
    expect(I18n.translate("toString", "en-US", {
      resources: { "en-US": { toString: "{valueOf}" } }, values: { valueOf: false }, onMissing: "error"
    })).toBe("false");
  });
  it("returns literal plain text, never interpreting inserted braces or HTML", () => {
    const value = '<img src=x onerror="bad()">{other}';
    expect(I18n.translate("greeting", "en-US", { ...strict, values: { name: value } })).toBe(`Hello ${value}`);
    expect(I18n.translate("markup", "en-US", { resources: { "en-US": { markup: "<b>literal</b>" } }, onMissing: "error" }))
      .toBe("<b>literal</b>");
  });
  it("has explicit missing language/key/error/key/one-hop fallback behavior", () => {
    expect(() => I18n.translate("unknown", "en-US", strict))
      .toThrow(expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }));
    expect(() => I18n.translate("greeting", "de-DE", { ...strict, values: { name: "Ada" } })).toThrow();
    expect(I18n.translate("missing", "de-DE", { ...strict, onMissing: "key" })).toBe("missing");
    expect(I18n.translate("greeting", "de-DE",
      { ...strict, onMissing: "fallback", fallbackLocale: "nl-NL", values: { name: "Ada" } })).toBe("Hallo Ada");
    expect(I18n.translate("exact.key", "nl-NL", { ...strict, onMissing: "fallback", fallbackLocale: "en-US" })).toBe("exact");
    expect(() => I18n.translate("unknown", "nl-NL", { ...strict, onMissing: "fallback", fallbackLocale: "en-US" })).toThrow();
    expect(() => I18n.translate("missing", "en-US", { ...strict, onMissing: "key", values: { unused: 0 } })).toThrow();
  });
  it.each([
    { onMissing: undefined }, { onMissing: "auto" }, { onMissing: "fallback" },
    { onMissing: "fallback", fallbackLocale: "en-US" },
    { onMissing: "fallback", fallbackLocale: "en-XX" },
    { onMissing: "fallback", fallbackLocale: "de-DE" },
    { onMissing: "key", fallbackLocale: "nl-NL" }
  ])("validates the entire explicit fallback policy: %j", policy => {
    expect(() => I18n.translate("empty", "en-US", { resources, ...policy } as never)).toThrow();
  });
  it.each(["{", "}", "{{x}}", "{a.b}", "{x y}", "{0}", "{constructor}", "{__proto__}", "{x", "x}"])(
    "rejects malformed or unsafe placeholder grammar: %s", template => {
      expect(() => I18n.translate("key", "en-US", {
        resources: { "en-US": { key: template } }, onMissing: "error", values: { x: "x" }
      })).toThrow();
    });
  it("rejects missing/extra/non-scalar/non-finite interpolation without coercion or accessor execution", () => {
    const getter = vi.fn(() => "Ada");
    for (const values of [{}, { name: "Ada", extra: 0 }, { name: null }, { name: {} }, { name: [] },
      { name: Infinity }, { name: NaN }, { name: undefined },
      Object.defineProperty({}, "name", { get: getter, enumerable: true })]) {
      expect(() => I18n.translate("greeting", "en-US", { ...strict, values } as never)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("defends dictionaries against prototypes, accessors, cycles, symbols, hidden fields and toJSON", () => {
    const getter = vi.fn(() => "executed"), toJSON = vi.fn(() => ({}));
    const cycle: Record<string, unknown> = {};
    cycle.key = cycle;
    for (const dictionary of [
      Object.create({ key: "inherited" }) as unknown,
      Object.defineProperty({}, "key", { get: getter, enumerable: true }),
      Object.defineProperty({}, "then", { get: getter, enumerable: true }),
      Object.defineProperty({}, "key", { value: "hidden" }),
      { key: "valid", [Symbol("hidden")]: "hidden" }, { key: "valid", toJSON }, cycle,
      JSON.parse('{"__proto__":"bad"}') as unknown, { constructor: "bad" }, { prototype: "bad" },
      ["not a dictionary"], new Date()
    ]) expect(() => I18n.translate("key", "en-US", { resources: { "en-US": dictionary }, onMissing: "error" } as never)).toThrow();
    const outer = Object.defineProperty({}, "en-US", { get: getter, enumerable: true });
    expect(() => I18n.translate("key", "en-US", { resources: outer, onMissing: "error" } as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });
  it("accepts null-prototype/foreign-realm plain JSON and never registers mutable resources", () => {
    const dictionaries: TranslationResources = runInNewContext('({"en-US":{"key":"foreign"}})') as TranslationResources;
    expect(I18n.translate("key", "en-US", { resources: dictionaries, onMissing: "error" })).toBe("foreign");
    const mutable = { "en-US": Object.assign(Object.create(null) as Record<string, string>, { key: "first" }) };
    expect(I18n.translate("key", "en-US", { resources: mutable, onMissing: "error" })).toBe("first");
    mutable["en-US"].key = "next";
    expect(I18n.translate("key", "en-US", { resources: mutable, onMissing: "error" })).toBe("next");
    expect(Object.keys(I18n).sort()).toEqual(["formatDate", "formatNumber", "getLanguage", "translate"]);
  });
  it("bounds dictionaries, templates, nodes, UTF-8 bytes, interpolation and final output", () => {
    const translate = (input: unknown) => I18n.translate("key", "en-US", { resources: input, onMissing: "error" } as never);
    expect(translate({ "en-US": { key: "x".repeat(4096) } })).toHaveLength(4096);
    expect(() => translate({ "en-US": { key: "x".repeat(4097) } })).toThrow();
    const entries = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`key${i}`, ""]));
    entries.key0 = "zero";
    expect(I18n.translate("key0", "en-US", { resources: { "en-US": entries }, onMissing: "error" })).toBe("zero");
    expect(() => translate({ "en-US": { ...entries, overflow: "" } })).toThrow();
    const tags = ["en-US", "nl-NL", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ja-JP",
      "ko-KR", "zh-CN", "ru-RU", "pl-PL", "sv-SE", "da-DK", "fi-FI", "cs-CZ", "tr-TR"];
    const many = Object.fromEntries(tags.map(tag => [tag, { key: "" }]));
    expect(() => translate(many)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    delete many["tr-TR"];
    expect(translate(many)).toBe("");
    const nodeEntries = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`k${i}`, ""]));
    const nodes = Object.fromEntries(tags.slice(0, 8).map(tag => [tag, { ...nodeEntries }]));
    delete nodes["en-US"]?.k254; // 1 + 8 + (8*255 - 1) = 2048 nodes
    expect(I18n.translate("k0", "en-US", { resources: nodes, onMissing: "error" })).toBe("");
    const first = nodes["en-US"];
    if (!first) throw new Error("fixture");
    first.k254 = "";
    expect(() => translate(nodes)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    const byteEntries = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, "é".repeat(2048)]));
    expect(() => translate({ "en-US": byteEntries })).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    const values = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`v${i}`, 0]));
    const template = Object.keys(values).map(name => `{${name}}`).join("");
    expect(I18n.translate("key", "en-US", { resources: { "en-US": { key: template } }, onMissing: "error", values }))
      .toBe("0".repeat(64));
    expect(() => I18n.translate("key", "en-US", {
      resources: { "en-US": { key: template + "{overflow}" } }, onMissing: "error", values: { ...values, overflow: 0 }
    })).toThrow();
    expect(() => I18n.translate("key", "en-US", { resources: { "en-US": { key: "{x}".repeat(5) } },
      onMissing: "error", values: { x: "x".repeat(4096) } })).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() => I18n.translate("key", "en-US", { resources: { "en-US": { key: template } },
      onMissing: "error", values: Object.fromEntries(Object.keys(values).map(name => [name, "é".repeat(1024)])) }))
      .toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
  it("rejects malformed keys, noncanonical resource locales and any invalid unused dictionary", () => {
    for (const key of ["constructor", "__proto__", "prototype", "../key", "", "k".repeat(129)]) {
      expect(() => I18n.translate(key, "en-US", strict)).toThrow();
    }
    for (const dictionaries of [{ "en-us": { key: "x" } }, { "en-XX": { key: "x" } },
      { "en-US": { key: "x" }, "nl-NL": { unused: "{invalid" } }]) {
      expect(() => I18n.translate("key", "en-US", { resources: dictionaries, onMissing: "error" })).toThrow();
    }
  });
  it("enforces exact resource UTF-8 byte boundaries, including multibyte content", () => {
    const entries = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, i === 63 ? "" : "x".repeat(4096)]));
    const input = { "en-US": entries };
    const overhead = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    entries.k63 = "x".repeat(262_144 - overhead);
    const options = { resources: input, onMissing: "error" as const };
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBe(262_144);
    expect(I18n.translate("k0", "en-US", options)).toBe("x".repeat(4096));
    entries.k63 += "x";
    expect(() => I18n.translate("k0", "en-US", options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    entries.k63 = entries.k63.slice(1);
    entries.k0 = "é" + "x".repeat(4095);
    expect(() => I18n.translate("k0", "en-US", options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
  it("enforces exact interpolation byte boundaries before preserving literal control text", () => {
    const values = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`v${i}`, "\u0000".repeat(169)]));
    const overhead = new TextEncoder().encode(JSON.stringify(values)).byteLength;
    values.v63 += "x".repeat(65_536 - overhead);
    const template = Object.keys(values).map(name => `{${name}}`).join("");
    const options = { resources: { "en-US": { key: template } }, onMissing: "error" as const, values };
    expect(new TextEncoder().encode(JSON.stringify(values)).byteLength).toBe(65_536);
    expect(I18n.translate("key", "en-US", options)).toBe(Object.values(values).join(""));
    values.v63 += "x";
    expect(() => I18n.translate("key", "en-US", options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
  it("bounds final expanded output in characters and JSON bytes independently", () => {
    const options = { resources: { "en-US": { key: "{x}".repeat(4) } },
      values: { x: "x".repeat(4096) }, onMissing: "error" as const };
    expect(I18n.translate("key", "en-US", options)).toBe("x".repeat(16_384));
    options.resources["en-US"].key += "{x}";
    expect(() => I18n.translate("key", "en-US", options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    options.resources["en-US"].key = "{x}".repeat(3);
    options.values.x = "\u0000".repeat(4096);
    expect(() => I18n.translate("key", "en-US", options)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
});
