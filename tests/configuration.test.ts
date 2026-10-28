import { describe, expect, it } from "vitest";
import { Config, VbdError } from "../src/index.js";
import { configuration, first } from "./helpers.js";

describe("configuration validation", () => {
  it("accepts the portable example without resolving values or registering commands", () => {
    const result = Config.validate(configuration());
    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([expect.objectContaining({ id: "CONFIG_VALID", status: "pass" })]);
  });

  it.each([null, [], "value", 42, true, undefined])("rejects a non-object input: %s", (input) => {
    expect(Config.validate(input).valid).toBe(false);
  });

  it("rejects unsupported schema versions and unknown properties without echoing values", () => {
    const result = Config.validate({
      ...configuration(), schemaVersion: 99,
      "PRIVATE_KEY_CANARY": "https://private.example/?token=PRIVATE_VALUE_CANARY"
    });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY_CANARY|PRIVATE_VALUE_CANARY|private\.example/);
  });

  it.each(["workflow", "schedule", "approvalWait", "resumeToken", "retryQueue"])(
    "rejects workflow property %s", (property) => {
      expect(Config.validate({ ...configuration(), [property]: { enabled: true } }).valid).toBe(false);
    }
  );

  it.each(["secret", "dataSource"])("rejects browser-unsafe variable type %s", (type) => {
    const input = configuration();
    input.environmentVariables = [{ ...first(input.environmentVariables), type }];
    expect(Config.validate(input).valid).toBe(false);
  });

  it("rejects raw values in a declaration", () => {
    const input = configuration();
    const result = Config.validate({
      ...input,
      environmentVariables: input.environmentVariables.map((item) => ({ ...item, value: "SECRET_CANARY" }))
    });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET_CANARY");
  });

  it("rejects literal destinations instead of environment bindings", () => {
    const input = configuration();
    const profile = first(input.launchProfiles);
    const result = Config.validate({
      ...input,
      launchProfiles: [{ ...profile, environmentUrl: "https://private.example/?token=CANARY" }]
    });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  it("rejects duplicate variable names case-insensitively", () => {
    const input = configuration();
    const variable = first(input.environmentVariables);
    input.environmentVariables.push({ ...variable, schemaName: variable.schemaName.toUpperCase() });
    expect(Config.validate(input).findings).toContainEqual(
      expect.objectContaining({ path: "environmentVariables[3].schemaName", status: "fail" })
    );
  });

  it("rejects duplicate profile and registration identities", () => {
    const input = configuration();
    input.launchProfiles.push(structuredClone(first(input.launchProfiles)));
    input.registrations.push(structuredClone(first(input.registrations)));
    const paths = Config.validate(input).findings.map((item) => item.path);
    expect(paths).toContain("launchProfiles[1].key");
    expect(paths).toContain("registrations[1].id");
  });

  it("reports an undeclared binding at the exact safe path", () => {
    const input = configuration();
    first(input.launchProfiles).appId.environmentVariable = "vbd_Missing";
    expect(Config.validate(input).findings).toContainEqual(expect.objectContaining({
      path: "launchProfiles[0].appId.environmentVariable",
      message: expect.stringContaining("undeclared")
    }));
  });

  it.each([{ type: "boolean", required: true }, { type: "text", required: false }])(
    "requires launch bindings to declare required text: %j", (change) => {
      const input = configuration();
      Object.assign(first(input.environmentVariables), change);
      expect(Config.validate(input).valid).toBe(false);
    }
  );

  it("rejects undeclared registration profile keys", () => {
    const input = configuration();
    first(input.registrations).profileKey = "missingProfile";
    expect(Config.validate(input).findings).toContainEqual(
      expect.objectContaining({ path: "registrations[0].profileKey" })
    );
  });

  it("accepts 128-character identifiers and rejects 129", () => {
    expect(Config.validate({ ...configuration(), id: "A".repeat(128) }).valid).toBe(true);
    expect(Config.validate({ ...configuration(), id: "A".repeat(129) }).valid).toBe(false);
  });

  it("enforces 200 variable, 100 profile, 500 registration, and 20 origin limits", () => {
    const variables = configuration();
    for (let index = variables.environmentVariables.length; index < 200; index++) {
      variables.environmentVariables.push({ schemaName: `vbd_Extra${index}`, type: "text", required: false });
    }
    expect(Config.validate(variables).valid).toBe(true);
    variables.environmentVariables.push({ schemaName: "vbd_Over", type: "text", required: false });
    expect(Config.validate(variables).valid).toBe(false);

    const profiles = configuration();
    for (let index = 1; index < 100; index++) {
      profiles.launchProfiles.push({ ...first(profiles.launchProfiles), key: `profile${index}` });
    }
    expect(Config.validate(profiles).valid).toBe(true);
    profiles.launchProfiles.push({ ...first(profiles.launchProfiles), key: "over" });
    expect(Config.validate(profiles).valid).toBe(false);

    const registrations = configuration();
    for (let index = 1; index < 500; index++) {
      registrations.registrations.push({ ...first(registrations.registrations), id: `registration${index}` });
    }
    expect(Config.validate(registrations).valid).toBe(true);
    registrations.registrations.push({ ...first(registrations.registrations), id: "over" });
    expect(Config.validate(registrations).valid).toBe(false);

    const origins = configuration();
    first(origins.launchProfiles).allowedOrigins = Array.from({ length: 20 }, () => ({
      environmentVariable: "vbd_ApprovedAppOrigin"
    }));
    expect(Config.validate(origins).valid).toBe(true);
    first(origins.launchProfiles).allowedOrigins.push({ environmentVariable: "vbd_ApprovedAppOrigin" });
    expect(Config.validate(origins).valid).toBe(false);
  });
});

describe("configuration registry", () => {
  const key = (): string => `test-${crypto.randomUUID()}`;

  it("registers and retrieves independent copies", () => {
    const name = key();
    const input = configuration();
    expect(Config.register(name, input)).toMatchObject({ name, schemaVersion: 1, replaced: false });
    input.id = "changed";
    const retrieved = Config.get(name);
    expect(retrieved.id).toBe("customerWorkspace");
    retrieved.id = "alsoChanged";
    first(retrieved.launchProfiles).appId.environmentVariable = "vbd_Mutated";
    expect(Config.get(name).id).toBe("customerWorkspace");
    expect(first(Config.get(name).launchProfiles).appId.environmentVariable)
      .toBe("vbd_TargetModelDrivenAppId");
  });

  it("rejects accidental replacement and permits explicit replacement", () => {
    const name = key();
    Config.register(name, configuration());
    expect(() => Config.register(name, configuration())).toThrow(VbdError);
    expect(() => Config.register(name, configuration())).toThrow(/already registered/);
    const changed = { ...configuration(), id: "replacement" };
    expect(Config.register(name, changed, { replace: true }).replaced).toBe(true);
    expect(Config.get(name).id).toBe("replacement");
  });

  it("does not replace a valid registration with invalid input", () => {
    const name = key();
    Config.register(name, configuration());
    expect(() => Config.register(name, {}, { replace: true })).toThrow(/invalid/);
    expect(Config.get(name).id).toBe("customerWorkspace");
  });

  it("reports missing and invalid registry keys explicitly", () => {
    expect(() => Config.get(key())).toThrow(/not registered/);
    expect(() => Config.get("not a valid key")).toThrow(/argument is invalid/);
    expect(() => Config.register("not a valid key", configuration())).toThrow(/argument is invalid/);
  });

  it.each([null, "replace", { replace: "true" }, { allowOverwrite: true }])(
    "rejects malformed or unknown registration options: %j", (options) => {
      expect(() => Reflect.apply(Config.register, undefined, [key(), configuration(), options]))
        .toThrow(/argument is invalid/);
    }
  );
});
