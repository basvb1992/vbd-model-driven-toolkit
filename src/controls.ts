import { z } from "zod";
import { formOf } from "./context.js";
import { attributeOf, controlOf } from "./forms.js";
import { VbdError } from "./errors.js";
import {
  call, collectionItems, messageSchema, nameSchema, partial, requireMethod, resultOf, sdkObject
} from "./sdk.js";
import type { SdkObject } from "./sdk.js";
import { parseInput } from "./validation.js";

export interface BoundControl {
  getName(): string;
  getVisible(): boolean;
  getDisabled(): boolean;
  setVisible(value: boolean): void;
  setDisabled(value: boolean): void;
  setLabel(value: string): void;
  setFocus(): void;
}
function isBoundControl(value: SdkObject): value is SdkObject & BoundControl {
  return ["getName", "getVisible", "getDisabled", "setVisible", "setDisabled", "setLabel", "setFocus"]
    .every(method => typeof value[method] === "function");
}
function boundControls(input: unknown, column: string): SdkObject[] {
  const attribute = attributeOf(input, column);
  const controls = collectionItems(attribute.controls, 100).map(sdkObject);
  if (controls.length === 0) throw new VbdError("FORM_TARGET_MISSING", { operation: "controls.bound" });
  return [...new Set(controls)];
}
function targets(input: unknown, names: string | readonly string[], settings: { scope?: "attribute" | "control" }) {
  const options = parseInput(z.object({ scope: z.enum(["attribute", "control"]).default("attribute") }).strict(),
    settings, "controls.targets");
  const parsed = parseInput(z.union([nameSchema, z.array(nameSchema).min(1).max(100)]), names, "controls.targets");
  const selectors = typeof parsed === "string" ? [parsed] : parsed;
  const controls = [...new Set(selectors.flatMap(name =>
    options.scope === "attribute" ? boundControls(input, name) : [controlOf(input, name)]))];
  if (controls.length > 100) throw new VbdError("LIMIT_EXCEEDED", { operation: "controls.targets" });
  return controls;
}
function apply(input: unknown, names: string | readonly string[], value: unknown, method: string,
  settings: { scope?: "attribute" | "control" }) {
  const controls = targets(input, names, settings);
  for (const control of controls) requireMethod(control, method);
  return partial(controls.map((control, index) => ({
    key: String(index),
    run: () => { call(control, method, value); return { applied: true as const }; }
  })));
}
function setVisible(input: unknown, names: string | readonly string[], value: boolean,
  settings: { scope?: "attribute" | "control" } = {}) {
  parseInput(z.boolean(), value, "controls.setVisible");
  return apply(input, names, value, "setVisible", settings);
}
function setDisabled(input: unknown, names: string | readonly string[], value: boolean,
  settings: { scope?: "attribute" | "control" } = {}) {
  parseInput(z.boolean(), value, "controls.setDisabled");
  return apply(input, names, value, "setDisabled", settings);
}
function setLabel(input: unknown, names: string | readonly string[], value: string,
  settings: { scope?: "attribute" | "control" } = {}) {
  parseInput(messageSchema, value, "controls.setLabel");
  return apply(input, names, value, "setLabel", settings);
}
function setFocus(input: unknown, name: string) {
  const control = controlOf(input, name);
  if (!resultOf(z.boolean(), call(control, "getVisible")) ||
      resultOf(z.boolean(), call(control, "getDisabled"))) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "controls.setFocus" });
  }
  call(control, "setFocus");
  return { requested: true };
}
function forAttribute<T>(input: unknown, column: string, operation: (control: BoundControl) => T): T[] {
  if (typeof operation !== "function") throw new VbdError("INVALID_ARGUMENT", { operation: "controls.forAttribute" });
  const controls = boundControls(input, column).map(control => {
    if (!isBoundControl(control)) throw new VbdError("UNSUPPORTED_SURFACE", { operation: "controls.forAttribute" });
    return control;
  });
  return partial(controls.map((control, index) => ({
    key: String(index), run: () => operation(control)
  })));
}
function tabOf(input: unknown, name: string): SdkObject {
  parseInput(nameSchema, name, "layout.tab");
  const tab = call(sdkObject(formOf(input).ui).tabs, "get", name);
  if (tab === null || tab === undefined) throw new VbdError("FORM_TARGET_MISSING", { operation: "layout.tab" });
  return sdkObject(tab);
}
function setTabVisible(input: unknown, names: string | readonly string[], visible: boolean) {
  parseInput(z.boolean(), visible, "layout.visibility");
  const values = parseInput(z.union([nameSchema, z.array(nameSchema).min(1).max(100)]), names, "layout.targets");
  const list = typeof values === "string" ? [values] : values;
  if (new Set(list).size !== list.length) throw new VbdError("INVALID_ARGUMENT", { operation: "layout.targets" });
  const tabs = list.map(name => ({ name, tab: tabOf(input, name) }));
  for (const item of tabs) requireMethod(item.tab, "setVisible");
  return partial(tabs.map(item => ({
    key: item.name, run: () => { call(item.tab, "setVisible", visible); return { name: item.name }; }
  })));
}
function setTabExpanded(input: unknown, names: string | readonly string[], expanded: boolean) {
  parseInput(z.boolean(), expanded, "layout.expansion");
  const values = parseInput(z.union([nameSchema, z.array(nameSchema).min(1).max(100)]), names, "layout.targets");
  const list = typeof values === "string" ? [values] : values;
  if (new Set(list).size !== list.length) throw new VbdError("INVALID_ARGUMENT", { operation: "layout.targets" });
  const tabs = list.map(name => ({ name, tab: tabOf(input, name) }));
  for (const item of tabs) requireMethod(item.tab, "setDisplayState");
  return partial(tabs.map(item => ({
    key: item.name, run: () => { call(item.tab, "setDisplayState", expanded ? "expanded" : "collapsed"); return { name: item.name }; }
  })));
}
function setSectionVisible(input: unknown, pairs: readonly { tab: string; section: string }[], visible: boolean) {
  parseInput(z.boolean(), visible, "layout.section");
  const values = parseInput(z.array(z.object({ tab: nameSchema, section: nameSchema }).strict()).min(1).max(100),
    pairs, "layout.section");
  if (new Set(values.map(value => JSON.stringify([value.tab, value.section]))).size !== values.length) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "layout.section" });
  }
  const sections = values.map(pair => {
    const section = call(tabOf(input, pair.tab).sections, "get", pair.section);
    if (section === null || section === undefined) throw new VbdError("FORM_TARGET_MISSING", { operation: "layout.section" });
    requireMethod(section, "setVisible");
    return { key: `${pair.tab}/${pair.section}`, section };
  });
  return partial(sections.map(item => ({
    key: item.key, run: () => { call(item.section, "setVisible", visible); return { key: item.key }; }
  })));
}
function focusTab(input: unknown, name: string) {
  const tab = tabOf(input, name);
  if (!resultOf(z.boolean(), call(tab, "getVisible"))) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "layout.focusTab" });
  }
  requireMethod(tab, "setFocus");
  requireMethod(tab, "setDisplayState");
  partial([
    { key: "expand", run: () => call(tab, "setDisplayState", "expanded") },
    { key: "focus", run: () => call(tab, "setFocus") }
  ]);
  return { requested: true };
}
export const Controls = Object.freeze({ setVisible, setDisabled, setLabel, setFocus, forAttribute });
export const Layout = Object.freeze({ setTabVisible, setTabExpanded, setSectionVisible, focusTab });
