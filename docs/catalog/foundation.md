# Foundation and configuration functions

44 entries are implemented locally: Context 10, Config 5, Bindings 2, Cache 3,
Security 2, Diagnostics 4, Environment 10, and Utils 8.
The other entry in this
file remain planned. See [catalog conventions](../function-catalog.md) and
[current usage](../getting-started.md). The bundle is deployed in BvB for
testing; this is not live certification of every function.
`R1`/`R2`/`R3` indicate earliest delivery phase, not implementation status.

## VBD.Context

The current adapters use supplied supported contexts; create/bulk/undefined
forms never become guessed persisted records. See [core usage](../core-usage.md).

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

Implemented subset: validate/register/get/load/resolve for the portable version-1
declaration schema. Loading uses an explicitly approved typed JSON adapter;
resolution reads declared variables without arbitrary overrides. Registration rejects duplicate
keys by default, accepts explicit `{ replace: true }`, validates options, and
copies stored/retrieved configuration to prevent caller mutation.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Config.load` | Name, approved trustedJson loader and context/replace options | Validated registered declaration copy | Bounded JSON text only; no built-in fetch/script loader, races cannot overwrite newer configuration. | R1 |
| `VBD.Config.register` | Name, validated in-memory configuration | Registration result | Reject duplicate/incompatible definitions unless explicit replacement allowed. | R1 |
| `VBD.Config.get` | Name, expected configuration kind | Registered configuration | Missing required configuration is actionable. | R1 |
| `VBD.Config.resolve` | Registry name, context/cache TTL, exact variable policies | Copied declarations and typed resolved values | Declared variables only; no invocation-value/security/origin overrides. Optional absence remains explicit. | R1 |
| `VBD.Config.validate` | Unknown configuration, schema/version | Validation report | No effects; include invalid paths and unsupported operations. | R1 |

## VBD.Bindings

Implemented typed runtime binding graphs are separate from portable schema v1.
Exact field/environment/result/registered-variable approvals, safe own-property
paths, cycle/depth/count/byte limits and synchronous predicates are mandatory
where documented. See [runtime contracts](../environment-and-configuration.md).

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Bindings.resolve` | ValueBinding, ctx, expected type | Validated value | Allowlisted literal/context/field/environment/config/result sources only. | R1 |
| `VBD.Bindings.resolveMany` | Named bindings, ctx, expected schema | Typed value map | Bound depth/cycles and validate output paths; no eval. | R1 |

## VBD.Cache

Implemented memory-only cache requires approved configuration/metadata purpose,
an explicit revision and runtime guard, TTL and environment/user/language scope.
It is not a record/secret/token store. Generic cache invalidation does not
silently invalidate the separate Environment/prepared-launch state.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Cache.getOrLoad` | Scoped key, safe loader, TTL/size policy | Loaded/cached value | Deduplicate in-flight reads; no persistent record/secret caching by default. | R1 |
| `VBD.Cache.invalidate` | Namespace and optional key/dependency, current read scope | Invalidated-entry count including pending slots | Prevent stale repopulation of this generic cache; no browser storage or implicit Environment mutation. | R1 |
| `VBD.Cache.clear` | Explicit environment/user cache scope | Cleared-entry count | Do not clear unrelated app/browser storage. | R1 |

## VBD.Security

Assessments return allowed/denied/unknown plus reason and scope. Effective server
authorization still governs every operation; incomplete metadata cannot mean allowed.
assessTable/hasPrivilege are implemented; assessRecord remains R2/planned.
The native client depth encoding is not documented, so matching native
privileges produce unknown/unverified-depth rather than guessed allows.
Trusted adapters can attest a supported verified encoding; see
[Security usage](../core-usage.md#security--privilege-ux-hints-not-authorization).

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Security.assessTable` | Table, privilege/operation | `AccessAssessment` | Table-level UX hint; not effective access to every row. | R1 |
| `VBD.Security.assessRecord` | ref, operation | `AccessAssessment` | Use a supported effective-access contract where available; else unknown. | R2 |
| `VBD.Security.hasPrivilege` | Privilege identity, required scope | Privilege assessment | Stable privilege checks preferred over role display-name matching. | R1 |

## VBD.Diagnostics

Implemented subset: normalizeError/report/getVersion/getCapabilities. Reporting requires an
explicit sink, with fixed safe messages and no serialized original cause/stack.
`getCapabilities` observes supported SDK method presence without invoking APIs
or reading values; present does not mean authorized, enabled, compatible with
every client/option, or successfully installed. Version reporting alone does
not certify client compatibility or installation.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Diagnostics.normalizeError` | Unknown error, safe operation metadata | `VbdError` | Preserve cause/correlation without logging sensitive payloads. | R1 |
| `VBD.Diagnostics.report` | Structured error/event, approved sink | Report receipt | Redact secrets, tokens, record payloads, and sensitive query parameters. | R1 |
| `VBD.Diagnostics.getVersion` | None | Toolkit/build/API version | Detect incompatible bundles; no environment enumeration. | R1 |
| `VBD.Diagnostics.getCapabilities` | None; observes the current Xrm host | Method-presence report | Explicit present/absent; no SDK calls, access checks or client certification. Probe failures are errors. | R1 |

## VBD.Utils

All eight entries are implemented in documented source subsets. Comparisons are allowlisted and do not
coerce types; reference/choice arrays compare as multisets. Escaping is scalar,
not arbitrary query/expression serialization.
formatValue uses the shared [localization/display contracts](../localization.md),
not implicit coercion, HTML rendering or query formatting.

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
