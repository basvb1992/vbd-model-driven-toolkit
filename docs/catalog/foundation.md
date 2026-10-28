# Foundation and configuration functions

Sixteen entries are implemented locally: Config's validate/register/get,
Diagnostics' normalizeError/report/getVersion, and all ten Environment APIs.
The other 29 entries in this
file remain planned. See [catalog conventions](../function-catalog.md) and
[current usage](../getting-started.md); no entry is Dataverse-deployed yet.
`R1`/`R2`/`R3` indicate earliest delivery phase, not implementation status.

## VBD.Context

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Context.fromFormEvent` | Execution context, expected event | `OperationContext` | Resolve getFormContext and event args; reject incompatible input. | R1 |
| `VBD.Context.fromFormCommand` | PrimaryControl | `OperationContext` | Form-command adapter; not an event-context assumption. | R1 |
| `VBD.Context.fromGridCommand` | SelectedControl, selected references/IDs, table if needed | `OperationContext` | Normalize explicit grid selection; no inferred global form. | R1 |
| `VBD.Context.getRecord` | ctx | Current reference or declared unsaved state | Do not fabricate an ID for an unsaved form. | R1 |
| `VBD.Context.getSelection` | ctx, selection limits | `EntityRef[]` | Return only actual supplied/available selected records. | R1 |
| `VBD.Context.getClient` | Runtime context | Client/capability information | Report web/mobile/offline state without assuming support. | R1 |
| `VBD.Context.getApp` | Runtime context | App identity/properties | Use supported current-app properties. | R1 |
| `VBD.Context.getUser` | Runtime context | Safe user ID, locale, role metadata | Not a security token or effective-record authorization result. | R1 |
| `VBD.Context.requireSavedRecord` | ctx | Valid persisted `EntityRef` | Explicitly fail on unsaved/missing record. | R1 |
| `VBD.Context.requireCapability` | ctx, capability | Capability confirmation | Fail with a supported-surface explanation if unavailable. | R1 |

## VBD.Environment

Typed getters return promises of `ResolvedValue<T>`, not untyped raw database
rows. Required reads reject missing/invalid values. Optional reads distinguish
absence from access/service failure. See the [resolution contract](../environment-and-configuration.md).
The implemented resolver uses explicit unambiguous current/default reads, not
opaque solution-layer selection. Metadata inspection returns identity/type only,
never defaults or Secret values. See [runtime signatures](../environment-launching.md).

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Environment.get` | Schema name, expected type, value/cache policy | `ResolvedValue<unknown>` | Resolve supported effective value; reject Secret and unsupported types. | R1 |
| `VBD.Environment.getOptional` | Schema name, expected type, declared absence policy | Optional `ResolvedValue<unknown>` | Absence only for declared missing cases, not service errors. | R1 |
| `VBD.Environment.getText` | Schema name, trim/allowEmpty policy | `ResolvedValue<string>` | Preserve explicit empty handling; validate text definition. | R1 |
| `VBD.Environment.getNumber` | Schema name, range policy | `ResolvedValue<number>` | Finite invariant parsing; zero is a value. | R1 |
| `VBD.Environment.getBoolean` | Schema name, context/cache policy | `ResolvedValue<boolean>` | Explicit true/false and yes/no forms; no generic truthiness. | R1 |
| `VBD.Environment.getJson` | Schema name, runtime validator | `ResolvedValue<T>` | Parse then validate JSON; no unchecked generic cast. | R1 |
| `VBD.Environment.getDefinition` | Schema name, context | Safe definition metadata | Return identity/schema/type only; never default/current values. | R1 |
| `VBD.Environment.getMany` | Typed schema requests, bounded concurrency | Keyed resolved values | Failures remain associated with requests; no silent defaults. | R1 |
| `VBD.Environment.preload` | Typed schema requests, TTL | Preload summary | Resolve early for commands; cache only safe valid results. | R1 |
| `VBD.Environment.invalidate` | Schema names or current scope | Invalidated-entry count | Remove cached/prepared dependencies; no Dataverse mutation. | R1 |

## VBD.Config

Implemented subset: validate/register/get for the portable version-1 declaration
schema only. `load` and `resolve` remain planned. Registration rejects duplicate
keys by default, accepts explicit `{ replace: true }`, validates options, and
copies stored/retrieved configuration to prevent caller mutation.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Config.load` | Approved JSON webresource/config source, schema/version | Validated configuration | Load only registered sources; no arbitrary script loading. | R1 |
| `VBD.Config.register` | Name, validated in-memory configuration | Registration result | Reject duplicate/incompatible definitions unless explicit replacement allowed. | R1 |
| `VBD.Config.get` | Name, expected configuration kind | Registered configuration | Missing required configuration is actionable. | R1 |
| `VBD.Config.resolve` | Name/options, ctx, permitted overrides | Resolved typed configuration | Apply documented precedence and binding allowlists. | R1 |
| `VBD.Config.validate` | Unknown configuration, schema/version | Validation report | No effects; include invalid paths and unsupported operations. | R1 |

## VBD.Bindings

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Bindings.resolve` | ValueBinding, ctx, expected type | Validated value | Allowlisted literal/context/field/environment/config/result sources only. | R1 |
| `VBD.Bindings.resolveMany` | Named bindings, ctx, expected schema | Typed value map | Bound depth/cycles and validate output paths; no eval. | R1 |

## VBD.Cache

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Cache.getOrLoad` | Scoped key, safe loader, TTL/size policy | Loaded/cached value | Deduplicate in-flight reads; no persistent record/secret caching by default. | R1 |
| `VBD.Cache.invalidate` | Namespace/key/dependency | Invalidated-entry count | Invalidate dependent prepared configuration where applicable. | R1 |
| `VBD.Cache.clear` | Explicit environment/user cache scope | Cleared-entry count | Do not clear unrelated app/browser storage. | R1 |

## VBD.Security

Assessments return allowed/denied/unknown plus reason and scope. Effective server
authorization still governs every operation; incomplete metadata cannot mean allowed.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Security.assessTable` | Table, privilege/operation | `AccessAssessment` | Table-level UX hint; not effective access to every row. | R1 |
| `VBD.Security.assessRecord` | ref, operation | `AccessAssessment` | Use a supported effective-access contract where available; else unknown. | R2 |
| `VBD.Security.hasPrivilege` | Privilege identity, required scope | Privilege assessment | Stable privilege checks preferred over role display-name matching. | R1 |

## VBD.Diagnostics

Implemented subset: normalizeError/report/getVersion. Reporting requires an
explicit sink, with fixed safe messages and no serialized original cause/stack.
`getCapabilities` remains planned. Version reporting alone does not certify
client compatibility or installation.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Diagnostics.normalizeError` | Unknown error, safe operation metadata | `VbdError` | Preserve cause/correlation without logging sensitive payloads. | R1 |
| `VBD.Diagnostics.report` | Structured error/event, approved sink | Report receipt | Redact secrets, tokens, record payloads, and sensitive query parameters. | R1 |
| `VBD.Diagnostics.getVersion` | None | Toolkit/build/API version | Detect incompatible bundles; no environment enumeration. | R1 |
| `VBD.Diagnostics.getCapabilities` | ctx, requested modules | Capability report | Explain supported/unsupported surfaces without executing business actions. | R1 |

## VBD.Utils

Keep this module small; prefer native/platform utilities when they already meet
the public contract.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Utils.normalizeGuid` | GUID text | Normalized GUID | Validate before removing braces/changing representation. | R1 |
| `VBD.Utils.isGuid` | Unknown value | Boolean | Pure predicate; does not accept arbitrary recordId payloads. | R1 |
| `VBD.Utils.toEntityRef` | Table, ID, optional name | `EntityRef` | Validate required identity; no database read. | R1 |
| `VBD.Utils.escapeODataLiteral` | Value and OData scalar type | Serialized literal | Scalar values only; not arbitrary identifiers/query fragments. | R1 |
| `VBD.Utils.escapeXml` | Text value | Escaped XML text/attribute value | Not a complete FetchXML query validator. | R1 |
| `VBD.Utils.parseNumber` | Input, explicit format/range policy | Finite number | Reject ambiguous localization and invalid input. | R1 |
| `VBD.Utils.compareValues` | Typed values, allowlisted comparator | Boolean | Explicit null/date/lookup semantics; no expression evaluation. | R1 |
| `VBD.Utils.formatValue` | Typed value, locale, formatting options | Display text | Display formatting is not query serialization. | R2 |
