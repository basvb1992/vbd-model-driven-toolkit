import { vi } from "vitest";
import { appId } from "./environment-helpers.js";

export function nativeControl(name: string) {
  const state = { visible: true, disabled: false, label: name, targets: ["account", "contact", "systemuser", "team"] };
  const preSearch = new Set<() => unknown>();
  const control = {
    getName: vi.fn(() => name), getVisible: vi.fn(() => state.visible), getDisabled: vi.fn(() => state.disabled),
    setVisible: vi.fn((value: boolean) => { state.visible = value; }),
    setDisabled: vi.fn((value: boolean) => { state.disabled = value; }),
    setLabel: vi.fn((value: string) => { state.label = value; }),
    setFocus: vi.fn(),
    getEntityTypes: vi.fn(() => [...state.targets]),
    setEntityTypes: vi.fn((value: string[]) => { state.targets = [...value]; }),
    setDefaultView: vi.fn((id: string) => { void id; }),
    addCustomFilter: vi.fn((xml: string, entity?: string) => { void xml; void entity; }),
    addPreSearch: vi.fn((handler: () => unknown) => { preSearch.add(handler); }),
    removePreSearch: vi.fn((handler: () => unknown) => { preSearch.delete(handler); })
  };
  return { control, state, search: () => { for (const handler of [...preSearch]) handler(); }, preSearch };
}
export function nativeForm(initial: Record<string, { type: string; value: unknown }> = {
  name: { type: "string", value: null },
  number: { type: "integer", value: 0 },
  enabled: { type: "boolean", value: false },
  lookup: { type: "lookup", value: null },
  choices: { type: "multiselectoptionset", value: [] },
  date: { type: "datetime", value: new Date("2026-10-28T10:00:00Z") }
}) {
  const state = { dirty: false, type: 2, id: appId };
  const attributes = new Map<string, ReturnType<typeof createAttribute>>();
  const controls = new Map<string, ReturnType<typeof nativeControl>>();
  const loadHandlers = new Set<unknown>(), saveHandlers = new Set<unknown>();
  function createAttribute(name: string, type: string, value: unknown) {
    const body = nativeControl(name), header = nativeControl(`header_${name}`);
    controls.set(name, body); controls.set(`header_${name}`, header);
    const data = { value, type, partyList: false, required: "none", submit: "dirty" };
    const handlers = new Set<(input: unknown) => unknown>();
    const attribute = {
      getAttributeType: vi.fn(() => data.type), getValue: vi.fn(() => data.value),
      setValue: vi.fn((next: unknown) => { data.value = next; state.dirty = true; }),
      getMaxLength: vi.fn(() => 1_048_576), getMin: vi.fn(() => -1_000_000), getMax: vi.fn(() => 1_000_000),
      getIsPartyList: vi.fn(() => data.partyList),
      setRequiredLevel: vi.fn((level: string) => { data.required = level; }),
      setSubmitMode: vi.fn((mode: string) => { data.submit = mode; }),
      controls: { get: () => [body.control, header.control] },
      addOnChange: vi.fn((handler: (input: unknown) => unknown) => { handlers.add(handler); }),
      removeOnChange: vi.fn((handler: (input: unknown) => unknown) => { handlers.delete(handler); }),
      fireOnChange: vi.fn(() => { for (const handler of [...handlers]) handler(execution); }),
      getOptions: vi.fn(() => [{ value: 1, text: "One" }, { value: 2, text: "Two" }])
    };
    return { attribute, data, body, header, handlers };
  }
  for (const [name, value] of Object.entries(initial)) attributes.set(name, createAttribute(name, value.type, value.value));
  const sectionState = { visible: true };
  const section = { setVisible: vi.fn((value: boolean) => { sectionState.visible = value; }) };
  const tabState = { visible: true, display: "collapsed" };
  const tab = {
    getVisible: vi.fn(() => tabState.visible),
    setVisible: vi.fn((value: boolean) => { tabState.visible = value; }),
    setDisplayState: vi.fn((value: string) => { tabState.display = value; }), setFocus: vi.fn(),
    sections: { get: vi.fn((name: string) => name === "section" ? section : null) }
  };
  const notifications = new Map<string, { message: string; level: string }>();
  const form = {
    getAttribute: vi.fn((name: string) => attributes.get(name)?.attribute ?? null),
    getControl: vi.fn((name: string) => controls.get(name)?.control ?? null),
    data: {
      getIsDirty: vi.fn(() => state.dirty),
      save: vi.fn(async (options?: unknown) => { void options; state.dirty = false; state.type = 2; }),
      refresh: vi.fn(async (save: boolean) => { void save; }),
      addOnLoad: vi.fn((handler: unknown) => { loadHandlers.add(handler); }),
      removeOnLoad: vi.fn((handler: unknown) => { loadHandlers.delete(handler); }),
      entity: {
        getEntityName: vi.fn(() => "account"), getId: vi.fn(() => state.id),
        addOnSave: vi.fn((handler: unknown) => { saveHandlers.add(handler); }),
        removeOnSave: vi.fn((handler: unknown) => { saveHandlers.delete(handler); })
      }
    },
    ui: {
      getFormType: vi.fn(() => state.type), refreshRibbon: vi.fn((all: boolean) => { void all; }),
      tabs: { get: vi.fn((name: string) => name === "tab" ? tab : null) },
      setFormNotification: vi.fn((message: string, level: string, id: string) => { notifications.set(id, { message, level }); return true; }),
      clearFormNotification: vi.fn((id: string) => notifications.delete(id))
    }
  };
  const args = { preventDefault: vi.fn(), getSaveMode: () => 1 };
  const execution = { getFormContext: () => form, getEventArgs: () => args };
  function field(name: string) {
    const value = attributes.get(name);
    if (!value) throw new Error("Missing fixture field.");
    return value;
  }
  return { form, execution, args, state, field, attributes, controls, tab, tabState, section, sectionState,
    notifications, loadHandlers, saveHandlers };
}

export function nativeGrid(references = [{ entityType: "account", id: appId }]) {
  const state = { references };
  const grid = {
    getGrid: () => ({ getSelectedRows: () => ({ get: () => state.references.map(ref => ({
      data: { entity: { getEntityName: () => ref.entityType, getId: () => ref.id } }
    })) }) }),
    getEntityName: () => "account", refresh: vi.fn(), refreshRibbon: vi.fn()
  };
  return { grid, state };
}

export function nativeSdk() {
  const navigateTo = vi.fn(async (_page: unknown, _options: unknown): Promise<unknown> => {
    void _page; void _options; return undefined;
  });
  const navigation = {
    navigateTo, openUrl: vi.fn((_url: string, _options: unknown) => { void _url; void _options; }),
    openForm: vi.fn(async (_options: unknown, _parameters: unknown) => {
      void _options; void _parameters;
      return { savedEntityReference: [{ entityType: "account", id: appId, name: "Fixture" }] };
    }),
    openAlertDialog: vi.fn(async (_options: unknown) => { void _options; }),
    openConfirmDialog: vi.fn(async (_options: unknown) => { void _options; return { confirmed: true }; }),
    openErrorDialog: vi.fn(async (_options: unknown) => { void _options; })
  };
  const settings = { userId: crypto.randomUUID(), languageId: 1033 };
  const client = {
    getClient: vi.fn(() => "Web"), getClientState: vi.fn(() => "Online"), getFormFactor: vi.fn(() => 1)
  };
  const utility = {
    getGlobalContext: () => ({
      getClientUrl: () => "https://source.example", userSettings: settings, client,
      getCurrentAppProperties: async () => ({ appId, uniqueName: "vbd_Fixture", displayName: "Fixture" })
    }),
    showProgressIndicator: vi.fn((_message: string) => { void _message; }), closeProgressIndicator: vi.fn(),
    lookupObjects: vi.fn(async (_options: unknown): Promise<unknown> => { void _options; return []; })
  };
  const app = {
    addGlobalNotification: vi.fn(async (_options: unknown) => { void _options; return crypto.randomUUID(); }),
    clearGlobalNotification: vi.fn(async (_id: string) => { void _id; })
  };
  const xrm = { Navigation: navigation, Utility: utility, App: app };
  return { xrm, navigation, utility, app, client, settings };
}
