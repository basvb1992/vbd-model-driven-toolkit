import type { ReadContext } from "../src/platform.js";

type Bag = Record<string, unknown>;
function record(input: unknown): Bag {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("The supported Dataverse global context is unavailable.");
  }
  return input as Bag;
}
function invoke(owner: Bag, name: string): unknown {
  const method = owner[name];
  if (typeof method !== "function") throw new Error("The required global context method is unavailable.");
  return Reflect.apply(method, owner, []);
}
export function globalContext(): Bag {
  const get: unknown = Reflect.get(globalThis, "GetGlobalContext");
  if (typeof get !== "function") throw new Error("Open this page as a Dataverse HTML webresource.");
  return record(Reflect.apply(get, globalThis, []));
}
export function createReadContext(
  get: () => Bag = globalContext,
  request: typeof fetch = globalThis.fetch.bind(globalThis)
): ReadContext {
  return {
    getScope: () => {
      const current = get(), user = record(current.userSettings), client = record(current.client);
      const environmentUrl = invoke(current, "getClientUrl");
      if (typeof environmentUrl !== "string" || typeof user.userId !== "string" ||
          typeof user.languageId !== "number") throw new Error("The current read scope is incomplete.");
      return {
        environmentUrl, userId: user.userId, languageId: user.languageId,
        online: invoke(client, "getClientState") === "Online"
      };
    },
    retrieveMultipleRecords: async (table, query, maximumPageSize) => {
      const tables: Record<string, string> = {
        environmentvariabledefinition: "environmentvariabledefinitions",
        environmentvariablevalue: "environmentvariablevalues"
      };
      if (!Object.hasOwn(tables, table) || !query.startsWith("?$select=") ||
          !query.endsWith("&$top=2") || maximumPageSize !== 2 || query.length > 4096 ||
          /[\r\n#\\]/.test(query)) throw new Error("This adapter accepts only bounded environment-variable reads.");
      const current = get(), environment = invoke(current, "getClientUrl");
      if (typeof environment !== "string") throw new Error("The current environment URL is unavailable.");
      const root = new URL(environment);
      if (root.origin !== globalThis.location.origin || root.pathname !== "/" || root.search || root.hash ||
          root.protocol !== "https:" || root.username || root.password) {
        throw new Error("Environment reads must stay in the current Dataverse origin.");
      }
      const response = await request(new URL(`/api/data/v9.2/${tables[table]}${query}`, root), {
        method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: "application/json", "OData-Version": "4.0", Prefer: "odata.maxpagesize=2" }
      });
      if (!response.ok) throw Object.assign(new Error("The current-user Dataverse read failed."), { status: response.status });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("The read response has no bounded body reader.");
      let total = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          total += item.value.byteLength;
          if (total > 2_097_152) {
            await reader.cancel();
            throw new Error("The read response exceeded the 2 MiB limit.");
          }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      const data = record(parsed);
      return { entities: data.value, ...(data["@odata.nextLink"] ? { nextLink: data["@odata.nextLink"] } : {}) };
    }
  };
}
export async function currentApp(): Promise<{ environmentUrl: string; appId: string }> {
  const current = globalContext(), environmentUrl = invoke(current, "getClientUrl");
  const app = record(await invoke(current, "getCurrentAppProperties"));
  if (typeof environmentUrl !== "string" || typeof app.appId !== "string") {
    throw new Error("The current app identity is unavailable.");
  }
  return { environmentUrl, appId: app.appId };
}
