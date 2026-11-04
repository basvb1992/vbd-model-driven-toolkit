# Getting started: source implementation

This is an early source implementation with local unmanaged packaging,
with a verified unmanaged BvB test installation, not a production-ready release.
Current source is 0.7.0; the verified BvB Core installation and draft export
assets remain 0.5.0. New R2 helpers are source-only until separately deployed.
Requires Node.js 24+ and npm. The npm package is private and not published.
Building and local delivery tools need no environment login, Xrm, Studio, or
Workflow/Interaction Framework. Runtime environment reads use the caller's
supported online Xrm context, or an explicitly supplied typed context.

## Build and check

From the repository root:

```powershell
npm ci
npm run check
```

The check runs strict types, lint, browser/ESM/CLI builds, NodeNext package
consumer declarations, and automated tests. Browser smoke coverage uses a VM
without Node/Xrm/DOM dependencies; it is not a live model-driven installation.
Built output is described in [distribution](distribution.md).

## Implemented APIs

Inside a configured local workspace, developer code can import the ESM package
as `import * as VBD from "vbd-model-driven-toolkit"`. After loading the built
browser bundle once, implemented modules are under global `VBD`.
The toolkit resources are imported/published in BvB; no consumer form/ribbon
registration has been performed.
The core interaction/form/data, owned-pane and Security subsets are documented in [core usage](core-usage.md).
R2 usage is in [metadata](metadata.md), [advanced forms](advanced-forms.md) and
[operation locks](execution.md).
The 0.7.0 continuation adds explicit [read-job batches](read-batches.md),
read-only retry/preflight and [localization/value formatting](localization.md).
Approved configuration loading/resolution, bindings and memory caching are
documented in [configuration runtime](environment-and-configuration.md).
See [BvB testing](testing-in-bvb.md) before wiring a consumer-owned test form.
The new environment/launcher methods are documented separately in
[environment reads and app launching](environment-launching.md).

| Function | Current signature / behavior |
| --- | --- |
| Config.validate | `validate(input: unknown)` returns a discriminated valid/configuration/findings result. Invalid values are not reflected into findings. |
| Config.register | `register(name, input, { replace?: boolean })` validates and stores a copy; accidental replacement and unknown options fail. Returns name/schemaVersion/replaced. |
| Config.get | `get(name)` returns a validated independent copy; missing/invalid keys throw. |
| Diagnostics.normalizeError | `normalizeError(error, { operation })` returns a structured VbdError with correlation and original non-serialized cause. |
| Diagnostics.report | `report(error, { operation, sink })` awaits an explicit safe sink and returns a receipt; sink failure throws. |
| Diagnostics.getVersion | `getVersion()` returns the toolkit source version. |
| Diagnostics.getCapabilities | `getCapabilities()` returns present/absent SDK-method observations only; no invocation, values, access or installation checks. |

For example, with configuration loaded by the calling application:

```typescript
const validation = VBD.Config.validate(configuration);
if (validation.valid) {
  VBD.Config.register("customerWorkspace", validation.configuration);
  VBD.Config.get("customerWorkspace");
}
```

No automatic telemetry exists. Diagnostic reports contain a fixed code/message,
safe operation identifier, and correlation ID, not native messages, stacks,
original causes, variable values, or record payloads. Treat operation names as
approved metadata; do not put credentials in any identifier.

## Version-1 configuration

See [customer-workspace.json](../examples/customer-workspace.json).

| Field | Contract |
| --- | --- |
| schemaVersion | Exactly `1`. |
| id | Logical identifier, 1-128 characters; first letter then letters/digits/dot/underscore/hyphen. |
| environmentVariables | 1-200 schema-name/type/required declarations; no current/default/raw values. Types: text, number, boolean, JSON. |
| launchProfiles | 1-100 declarations, currently modelDrivenApp/newWindow only, with key, appId binding, optional environmentUrl binding, and 1-20 allowedOrigins bindings. |
| registrations | 0-500 id/surface/profileKey declarations; formCommand or gridCommand only. |

Variable schema names start with a letter and otherwise contain letters, digits,
or underscores, at most 128 characters. Declarations/profile/registration names
must be unique ignoring case; references must match the declared spelling.
Launch references must point to required text variables. Other variable
declarations may be optional. All unknown fields, Secret/Data source declaration
types, literal destinations, workflow definitions, and invalid references fail.

This validates a portable declaration, not actual values, URL origins, app
availability, command deployment, or browser launching. Runtime preparation
now resolves and validates a destination, but this source-level report does
not invoke it. Prepared-profile command entry points are implemented, but this
report does not inspect their actual bootstrap/registration/app settings.

## Source preflight

```powershell
node .\dist\vbd-toolkit.mjs preflight --config .\examples\customer-workspace.json
```

JSON goes to standard output. Findings distinguish source evidence, supplied
snapshot evidence, and unverified checks. They use pass, warning, fail, unknown,
and unsupported statuses.

| Exit code | Meaning |
| --- | --- |
| 0 | Complete success, or help output. |
| 1 | Invalid input, definite failed check, or I/O/reporting failure. |
| 2 | Evidence incomplete or an expected runtime/check is unsupported. |

**A valid current example returns 2, not 0.** Live verification and generic
registry/handler wiring are unverified, so current valid configurations cannot be
certified deployment-ready. Do not mask code 2 as success in a deployment gate.

## Optional sanitized snapshot

See [sanitized-snapshot.json](../examples/sanitized-snapshot.json). It is historical
example data, not evidence collected from an actual environment. It will become
stale; do not change its timestamp merely to make a check pass.

```powershell
node .\dist\vbd-toolkit.mjs preflight --config .\examples\customer-workspace.json --snapshot .\examples\sanitized-snapshot.json
```

Snapshot version 1 permits targetAlias, observedAt, and up to 200 variable
evidence records. An available record has schemaName, status=available, type,
hasCurrentValue, and hasDefaultValue. Non-available records contain only
schemaName and status=missing/denied/unknown/unsupported.

No raw values are accepted. A configured false/zero/empty value still counts as
presence; this checker does not inspect or validate its contents. Secret/Data
source metadata types can be reported as incompatible with the declared
browser-safe type, but no secret value is retrieved.

Evidence must be within 24 hours old and no more than 5 minutes ahead of the
current clock. Stale/future-skew evidence is unknown and cannot pass variable
checks. Missing required definitions/values and wrong types fail; optional
absence warns; denied reads remain unknown. Evidence is supplied, not independently
verified. There is no live collector in this slice.

## Generate a handover

```powershell
New-Item -ItemType Directory -Path .\reports -Force | Out-Null
node .\dist\vbd-toolkit.mjs handover --config .\examples\customer-workspace.json --output .\reports\handover.md
```

Reports include source version/revision when supplied, evidence scope/time,
declared variables/profiles/registrations, findings, and troubleshooting.
Wiring instructions are declared templates, not proof of deployed commands.
They assume configuration is registered using its id; adjust for a caller-owned
registry alias and prepare the same registryName/profileKey on load.
Handover retains the preflight exit code, including 2.

Use `--revision` with a 7-40 character Git hexadecimal revision when appropriate.
Omit `--output` to print the report. Parent directories must already exist;
existing outputs, including input files, are never overwritten.

Files must be regular UTF-8 JSON files, optionally with a UTF-8 BOM, at most
1 MiB each. Reports contain approved structural metadata, not current values,
raw URLs, secrets, or business records. Review them under your customer policy;
local `reports/` is ignored and nothing is uploaded automatically.

## Not included yet

Remaining generic configuration/binding/security/metadata/process/file/recipe
APIs, live CLI metadata/access collection, a diagnostic panel, Studio and tenant
deployment remain future work. Independent consultant/packaging work is owned
by its separate lane and is not automatically integrated here.
The workflow framework stays independent.
