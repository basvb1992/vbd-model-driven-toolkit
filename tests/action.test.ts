import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { Actions } from "../src/actions.js";
import type { OperationContract, ParameterContract } from "../src/actions.js";
import { dataFixture, deferredData, id, otherId, ref } from "./data-fixture.js";

afterEach(() => vi.unstubAllGlobals());
const empty: OperationContract<never> = {
  operationName: "vbd_Test", parameters: {}, response: { kind: "empty", status: 204 }
};
const json: OperationContract<{ result: string }> = {
  operationName: "vbd_Test", parameters: {},
  response: { kind: "json", status: 200, validate: (input) => z.object({ result: z.string() }).strict().parse(input) }
};
describe("supported explicit operation metadata", () => {
  it("executes a declared unbound 204 action once", async () => {
    const host = dataFixture();
    expect(await Actions.executeAction(empty, {}, host.client)).toBeUndefined();
    expect(host.execute).toHaveBeenCalledTimes(1);
    const request = host.execute.mock.calls[0]?.[0];
    expect(request?.getMetadata()).toEqual({
      boundParameter: null, operationType: 0, operationName: "vbd_Test", parameterTypes: {}
    });
  });
  it("uses explicit parameter metadata, normalizes GUIDs, and validates function JSON", async () => {
    const host = dataFixture();
    host.execute.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "Synthetic" }) });
    const contract: OperationContract<{ result: string }> = { ...json, parameters: {
      Name: { typeName: "Edm.String", structuralProperty: 1, nullable: false },
      Id: { typeName: "Edm.Guid", structuralProperty: 1, nullable: false },
      Values: { typeName: "Collection(Edm.Int32)", structuralProperty: 4, nullable: false },
      Optional: { typeName: "Edm.Boolean", structuralProperty: 1, nullable: true }
    } };
    expect(await Actions.executeFunction(contract, { Name: "A&B", Id: `{${id}}`, Values: [1, 2], Optional: null },
      host.client)).toEqual({ result: "Synthetic" });
    const request = host.execute.mock.calls[0]?.[0];
    expect(request).toMatchObject({ Name: "A&B", Id: id, Values: [1, 2], Optional: null });
    expect(request?.getMetadata()).toMatchObject({
      operationType: 1, parameterTypes: {
        Values: { typeName: "Collection(Edm.Int32)", structuralProperty: 4 }
      }
    });
  });
  it("supports exact entity binding, never parameter/binding/getMetadata collisions", async () => {
    const host = dataFixture();
    const contract = { ...empty, binding: { parameter: "entity", entityType: "account", typeName: "mscrm.account" } };
    await Actions.executeAction(contract, {}, { ...host.client, binding: ref });
    expect(host.execute.mock.calls[0]?.[0].entity).toEqual(ref);
    expect(host.execute.mock.calls[0]?.[0].getMetadata().boundParameter).toBe("entity");
    for (const change of [
      { binding: { ...contract.binding, entityType: "contact" } },
      { binding: { ...contract.binding, typeName: "mscrm.contact" } },
      { binding: { ...contract.binding, parameter: "getMetadata" } },
      { parameters: { entity: { typeName: "Edm.String", structuralProperty: 1, nullable: false } } }
    ]) {
      await expect(Actions.executeAction({ ...contract, ...change } as never, {}, { ...host.client, binding: ref }))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    await expect(Actions.executeAction(contract, {}, host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Actions.executeAction(empty, {}, { ...host.client, binding: ref })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it("requires validators for entity/complex values and accepts proven values", async () => {
    const host = dataFixture();
    const schema = z.object({ Name: z.string() }).strict();
    const contract = { ...empty, parameters: {
      Target: { typeName: "mscrm.account", structuralProperty: 5 as const, nullable: false,
        validate: (value: unknown) => schema.parse(value) },
      Options: { typeName: "mscrm.Options", structuralProperty: 2 as const, nullable: false,
        validate: (value: unknown) => schema.parse(value) },
      Items: { typeName: "Collection(mscrm.account)", structuralProperty: 4 as const, nullable: false,
        validate: (value: unknown) => schema.parse(value) }
    } };
    await Actions.executeAction(contract, { Target: { Name: "A" }, Options: { Name: "B" }, Items: [{ Name: "C" }] }, host.client);
    await expect(Actions.executeAction(contract, { Target: { Secret: "A" }, Options: {}, Items: [] }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    { typeName: "Edm.String", structuralProperty: 2, nullable: false },
    { typeName: "mscrm.account", structuralProperty: 5, nullable: false },
    { typeName: "Collection(mscrm.account)", structuralProperty: 4, nullable: false },
    { typeName: "Edm.Fake", structuralProperty: 1, nullable: false },
    { typeName: "Edm.String", structuralProperty: 3, nullable: false },
    { typeName: "Edm.String", structuralProperty: 1 },
    { typeName: "Collection(Edm.String)", structuralProperty: 1, nullable: false }
  ])("rejects unsupported/malformed metadata %j", async (metadata) => {
    const host = dataFixture();
    await expect(Actions.executeAction({ ...empty, parameters: { Value: metadata } } as never, { Value: "x" }, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("rejects arbitrary names, unexpected parameters, missing fields and unsafe keys", async () => {
    const host = dataFixture();
    for (const operationName of ["window.alert", "vbd_Test()", "", "x".repeat(129)]) {
      await expect(Actions.executeAction({ ...empty, operationName }, {}, host.client))
        .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    const parameter: ParameterContract = { typeName: "Edm.String", structuralProperty: 1, nullable: false };
    for (const name of ["getMetadata", "constructor", "__proto__"]) {
      await expect(Actions.executeAction({ ...empty, parameters: Object.fromEntries([[name, parameter]]) },
        Object.fromEntries([[name, "x"]]), host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    await expect(Actions.executeAction({ ...empty, parameters: { Required: parameter } }, {}, host.client))
      .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(Actions.executeAction(empty, { Extra: "x" }, host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it.each([
    ["Edm.Int32", 2147483648], ["Edm.Int64", 9007199254740992], ["Edm.Double", Infinity],
    ["Edm.Guid", "bad"], ["Edm.DateTimeOffset", "tomorrow"], ["Edm.Boolean", "true"],
    ["Edm.String", null], ["Edm.String", undefined]
  ])("rejects mismatched primitive %s %s", async (typeName, value) => {
    const host = dataFixture();
    await expect(Actions.executeAction({ ...empty, parameters: {
      Value: { typeName, structuralProperty: 1, nullable: false }
    } }, { Value: value }, host.client)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it("tests exact 100 parameters and 1000 collection-item bounds", async () => {
    const host = dataFixture();
    const parameter: ParameterContract = { typeName: "Edm.String", structuralProperty: 1, nullable: false };
    for (const count of [100, 101]) {
      const contract = { ...empty, parameters: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, parameter])) };
      const values = Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, "x"]));
      const pending = Actions.executeAction(contract, values, host.client);
      if (count === 100) { await expect(pending).resolves.toBeUndefined(); }
      else { await expect(pending).rejects.toMatchObject({ code: "INVALID_ARGUMENT" }); }
    }
    for (const count of [1000, 1001]) {
      const pending = Actions.executeAction({ ...empty, parameters: {
        Values: { typeName: "Collection(Edm.Int32)", structuralProperty: 4, nullable: false }
      } }, { Values: Array.from({ length: count }, (_, i) => i) }, host.client);
      if (count === 1000) { await expect(pending).resolves.toBeUndefined(); }
      else { await expect(pending).rejects.toMatchObject({ code: "INVALID_ARGUMENT" }); }
    }
    expect(host.execute).toHaveBeenCalledTimes(2);
  });
});
describe("strict responses, no retries and redacted errors", () => {
  it.each([undefined, null, {}, { status: 204 }, { ok: true, status: 200 }, { ok: true, status: "204" }])(
    "rejects malformed/unexpected action responses %j as uncertain, not empty success", async (response) => {
      const host = dataFixture();
      host.execute.mockResolvedValue(response);
      await expect(Actions.executeAction(empty, {}, host.client)).rejects.toMatchObject({ code: "MUTATION_OUTCOME_UNKNOWN" });
      expect(host.execute).toHaveBeenCalledTimes(1);
    });
  it("does not interpret HTTP failures as declared empty success", async () => {
    const host = dataFixture();
    for (const [status, code] of [[403, "ACCESS_DENIED"], [412, "CONCURRENCY_CONFLICT"], [400, "ACTION_FAILED"]] as const) {
      host.execute.mockResolvedValue({ ok: false, status });
      await expect(Actions.executeAction(empty, {}, host.client)).rejects.toMatchObject({ code });
    }
  });
  it("requires declared 204, a body method, bounded JSON and a proven result", async () => {
    const host = dataFixture();
    for (const response of [
      { ok: true, status: 204 },
      { ok: true, status: 200 },
      { ok: true, status: 200, json: async () => undefined },
      { ok: true, status: 200, json: async () => ({ result: 1 }) },
      { ok: true, status: 200, json: async () => { throw new Error("private body"); } }
    ]) {
      host.execute.mockResolvedValue(response);
      await expect(Actions.executeFunction(json, {}, host.client)).rejects.toBeInstanceOf(Error);
    }
    host.execute.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "Valid" }) });
    expect(await Actions.executeFunction(json, {}, host.client)).toEqual({ result: "Valid" });
  });
  it("accepts native Response-like prototypes, rather than only plain fake objects", async () => {
    const host = dataFixture();
    class SdkResponse {
      ok = true;
      status = 200;
      json() { return Promise.resolve({ result: "Valid" }); }
    }
    host.execute.mockResolvedValue(new SdkResponse());
    expect(await Actions.executeFunction(json, {}, host.client)).toEqual({ result: "Valid" });
  });
  it.each([[403, "ACCESS_DENIED"], [400, "ACTION_FAILED"], [undefined, "MUTATION_OUTCOME_UNKNOWN"]] as const)(
    "normalizes action rejection %s without logging, leaking or retrying", async (status, code) => {
      const host = dataFixture();
      const cause = { status, message: "PRIVATE DETAILS", headers: { authorization: "PRIVATE TOKEN" } };
      host.execute.mockRejectedValue(cause);
      const log = vi.spyOn(console, "error");
      try {
        const pending = Actions.executeAction(empty, {}, host.client);
        await expect(pending).rejects.toMatchObject({ code, cause });
        await expect(pending).rejects.not.toThrow("PRIVATE");
        expect(host.execute).toHaveBeenCalledTimes(1);
        expect(log).not.toHaveBeenCalled();
      } finally { log.mockRestore(); }
    });
  it("checks scope after headers and after JSON awaits", async () => {
    for (const kind of ["action", "function"] as const) {
      const host = dataFixture();
      const waiting = deferredData();
      host.execute.mockReturnValue(waiting.promise);
      const run = kind === "action" ? Actions.executeAction : Actions.executeFunction;
      const pending = run(json, {}, host.client);
      host.scope.userId = otherId;
      waiting.resolve({ ok: true, status: 200, json: async () => ({ result: "x" }) });
      await expect(pending).rejects.toMatchObject({ code: kind === "action" ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED" });
    }
    const host = dataFixture();
    const waiting = deferredData();
    const readingBody = deferredData();
    host.execute.mockResolvedValue({ ok: true, status: 200, json: () => { readingBody.resolve(null); return waiting.promise; } });
    const pending = Actions.executeAction(json, {}, host.client);
    await readingBody.promise;
    host.scope.languageId = 1043;
    waiting.resolve({ result: "x" });
    await expect(pending).rejects.toMatchObject({ code: "MUTATION_OUTCOME_UNKNOWN" });
  });
});

describe("awaited response validation and synchronous JSON parameter guards", () => {
  const parseResult = (input: unknown) => z.object({ result: z.string() }).strict().parse(input);
  it("supports declared/inferred async response validators with flattened public return types", async () => {
    const host = dataFixture();
    host.execute.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "Synthetic" }) });
    const declared: OperationContract<{ result: string }> = {
      ...json, response: { kind: "json", status: 200, validate: async (value) => parseResult(value) }
    };
    const explicitPromise: OperationContract<Promise<{ result: string }>> = {
      ...json, response: { kind: "json", status: 200, validate: async (value) => parseResult(value) }
    };
    const inferred = {
      operationName: "vbd_Test", parameters: {},
      response: { kind: "json" as const, status: 200 as const, validate: async (value: unknown) => parseResult(value) }
    };
    const first = Actions.executeAction(declared, {}, host.client);
    const second = Actions.executeFunction(explicitPromise, {}, host.client);
    const third = Actions.executeFunction(inferred, {}, host.client);
    expectTypeOf(first).toEqualTypeOf<Promise<{ result: string } | undefined>>();
    expectTypeOf(second).toEqualTypeOf<Promise<{ result: string } | undefined>>();
    expectTypeOf(third).toEqualTypeOf<Promise<{ result: string } | undefined>>();
    expect(await Promise.all([first, second, third])).toEqual(Array.from({ length: 3 }, () => ({ result: "Synthetic" })));
  });
  it.each(["action", "function"] as const)("checks all scope components after delayed %s response validation", async (kind) => {
    for (const field of ["user", "environment", "language", "online"] as const) {
      const host = dataFixture();
      const entered = deferredData();
      const waiting = deferredData();
      host.execute.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "Synthetic" }) });
      const contract: OperationContract<{ result: string }> = {
        ...json, response: { kind: "json", status: 200, validate: async (value) => {
          entered.resolve(null);
          await waiting.promise;
          return parseResult(value);
        } }
      };
      const run = kind === "action" ? Actions.executeAction : Actions.executeFunction;
      const pending = run(contract, {}, host.client);
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await entered.promise;
      expect(settled).toBe(false);
      if (field === "user") { host.scope.userId = otherId; }
      if (field === "environment") { host.scope.environmentUrl = "https://other.example"; }
      if (field === "language") { host.scope.languageId = 1043; }
      if (field === "online") { host.scope.online = false; }
      waiting.resolve(null);
      await expect(pending).rejects.toMatchObject({
        code: kind === "action" ? "MUTATION_OUTCOME_UNKNOWN" : "CONFIG_EXPIRED"
      });
      expect(host.execute).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["action", "function"] as const)("handles delayed %s validator rejection without leaking details", async (kind) => {
    const host = dataFixture();
    const entered = deferredData();
    const waiting = deferredData();
    const cause = new Error("PRIVATE VALIDATION DETAILS");
    host.execute.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: "Synthetic" }) });
    const contract: OperationContract<{ result: string }> = {
      ...json, response: { kind: "json", status: 200, validate: async () => {
        entered.resolve(null);
        await waiting.promise;
        throw cause;
      } }
    };
    const run = kind === "action" ? Actions.executeAction : Actions.executeFunction;
    const pending = run(contract, {}, host.client);
    await entered.promise;
    waiting.resolve(null);
    await expect(pending).rejects.toMatchObject({
      code: kind === "action" ? "MUTATION_OUTCOME_UNKNOWN" : "DATA_RESPONSE_INVALID", cause
    });
    await expect(pending).rejects.not.toThrow("PRIVATE");
    expect(host.execute).toHaveBeenCalledTimes(1);
  });

  const parameterShapes = [
    { name: "primitive", metadata: { typeName: "Edm.String", structuralProperty: 1, nullable: false }, value: "Synthetic" },
    { name: "complex", metadata: { typeName: "mscrm.Settings", structuralProperty: 2, nullable: false }, value: { Name: "Synthetic" } },
    { name: "entity", metadata: { typeName: "mscrm.account", structuralProperty: 5, nullable: false }, value: { Name: "Synthetic" } },
    { name: "primitive collection", metadata: { typeName: "Collection(Edm.String)", structuralProperty: 4, nullable: false },
      value: ["Synthetic"] },
    { name: "entity collection", metadata: { typeName: "Collection(mscrm.account)", structuralProperty: 4, nullable: false },
      value: [{ Name: "Synthetic" }] }
  ] satisfies { name: string; metadata: ParameterContract; value: unknown }[];
  it.each(parameterShapes)("rejects async/thenable $name guards promptly, observes rejection, never dispatches", async (shape) => {
    const host = dataFixture();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const outputs: (() => unknown)[] = [
        () => Promise.resolve({ Name: "Synthetic" }),
        () => Promise.reject(new Error("PRIVATE ASYNC GUARD")),
        () => new Promise<never>(() => { /* An invalid guard must not block dispatch validation. */ }),
        () => ({ then: (_resolve: unknown, reject: (cause: unknown) => void) => reject(new Error("PRIVATE THENABLE")) }),
        () => ({ then: async () => { throw new Error("PRIVATE ASYNC THEN"); } }),
        () => ({ then: () => undefined }),
        () => {
          const self = { then: () => self };
          return self;
        },
        () => runInNewContext('Promise.reject(new Error("PRIVATE FOREIGN GUARD"))'),
        () => ({ Name: Promise.reject(new Error("PRIVATE NESTED GUARD")) })
      ];
      for (const output of outputs) {
        const contract = { ...empty, parameters: {
          Value: { ...shape.metadata, validate: (() => output()) as never }
        } };
        await expect(Actions.executeAction(contract, { Value: shape.value }, host.client))
          .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      }
      // Allow Node's rejection checkpoint to run, including observers scheduled by
      // foreign promises and malformed async then methods. No pending output is awaited.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(host.execute).not.toHaveBeenCalled();
      expect(host.retrieveMultipleRecords).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  }, 3000);
});
