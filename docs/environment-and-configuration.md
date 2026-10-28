# Environment variables and configuration

All ten Environment APIs now have a bounded source implementation alongside
Config.validate/register/get. Config.load/resolve, Bindings.resolve/resolveMany,
and Cache.getOrLoad/invalidate/clear now have focused source implementations;
package/browser export integration and availability counts are owned by the
parent integration lane. See [runtime usage](environment-launching.md),
[getting started](getting-started.md), and the [catalog](catalog/foundation.md).
Live Dataverse installation/resolution is not yet verified.

## Why this belongs in core

A command should be deployable unchanged while the destination app, form,
feature flag, or permitted URL changes by environment. Prefer the current app's
environment and supported configuration resolution over hardcoded tenant values.

## Environment-variable API

`VBD.Environment` provides required and optional reads, typed text/number/
boolean/JSON reads, definition inspection, bulk resolution, and preload/invalidate
operations.

The current implementation uses supported Xrm.WebApi definition/value queries
with explicit current/default provenance and ambiguity rejection. Metadata type
is selected before any current/default value. It does not choose a newest row
or claim equivalence with opaque platform solution-layer resolution.

The platform `RetrieveEnvironmentVariableValue` function remains a future
alternative when its different provenance/ambiguity contract is explicitly
selected. An SDK method is not itself a browser API.

Implemented behavior:

1. Validate the schema name and caller's expected type.
2. Retrieve/validate the definition without exposing protected values.
3. Reject Secret definitions before any secret retrieval.
4. Read at most one explicit current candidate; only if absent/null read the default.
5. Convert and validate against the declared type and supplied runtime schema.
6. Apply only explicitly declared optional absence policies; no caller-value fallback is implemented.
7. Cache successful safe results within the requested scope and TTL.

A current value takes precedence over a definition default. The default applies
when no current value is defined. Do not use truthiness: `false` and `0` are real
values. Empty strings need an explicit per-read `allowEmpty` contract and must
not automatically reveal a default value.

Distinguish a missing definition, no configured value, an empty value, a malformed
value, a denied read, and a failed service request. An optional read may return
absence only for documented missing cases, not for access or transport failures.

Current provenance is `current` or `default`, observed from those explicit reads.
`platform`/`callerFallback` are reserved design options, not implemented modes.
If explicit table inspection finds ambiguous candidate value rows, report an
actionable configuration error rather than sorting by creation time and guessing.

## Types

| Definition type | Browser contract |
| --- | --- |
| Text | Text, with explicit trim/empty policies. |
| Decimal number | Finite number with documented invariant parsing and optional range validation. |
| Two options | Explicit case-insensitive true/false and yes/no strings after trimming; 0/1 and other strings are rejected. |
| JSON | Parsed unknown value validated by a runtime schema/validator. A TypeScript generic alone is insufficient. |
| Data source | Unsupported in the initial typed getters; require a separately defined supported metadata contract. Never treat it as connection credentials. |
| Secret | Reject with `SECRET_NOT_SUPPORTED`; retrieve/use secrets only on an authorized server path. |

## Configuration sources

The R1 implementation is deliberately **not** a general configuration/recipe
engine. It offers no invocation-value overrides, interpolation, operation
dispatch, security overrides, or presentation defaults. Registered declarations
select typed environment reads, whose existing explicit current/default
precedence remains unchanged.

Current schema version 1 supports only model-driven app profile declarations,
required text environment bindings for app/origin/environment references, and
declared form/grid commands. Other variable declarations may use text, number,
boolean, or JSON. All properties are allowlisted; unknown fields, raw values,
Secret/Data source types, and workflow definitions are rejected.
Preparing a registered profile now resolves its declared bindings through the
typed environment API; it does not extend the configuration schema to arbitrary
expressions, records, credentials, or workflow execution.

`presentation` remains `newWindow` only, including form/grid registrations.
No same-window dispatch, profile preparation, or launch changes are made here.

The local snapshot format describes definition type and value presence/access
only. Passing these checks does not prove a URL is allowed, an app is accessible,
or an effective value has the correct content.

### Source-module signatures

These are named source exports pending parent-owned package/browser integration.
`ReadContext` is the existing supported online environment-read adapter.

```ts
Config.load(
  name: string,
  source: TrustedConfigurationSource,
  options?: ConfigurationLoadOptions
): Promise<ToolkitConfiguration>

Config.resolve(
  name: string,
  options?: ConfigurationResolveOptions
): Promise<ResolvedConfiguration>

interface TrustedConfigurationSource {
  kind: "trustedJson";
  approved: true;
  loadJson(maximumBytes: number): Promise<string>;
}
interface ConfigurationLoadOptions { context?: ReadContext; replace?: boolean }
interface ConfigurationVariablePolicy {
  allowEmpty?: boolean;
  validate?: (value: unknown) => boolean;
}
interface ConfigurationResolveOptions {
  context?: ReadContext;
  cacheTtlMs?: number;
  variables?: Readonly<Record<string, ConfigurationVariablePolicy>>;
}
interface ResolvedConfiguration {
  name: string;
  revision: number;
  configuration: ToolkitConfiguration;
  values: Record<string, ResolvedValue<unknown> | undefined>;
}
```

`Config.load` accepts **only an explicitly approved trusted typed adapter**.
There is no URL, script, dynamic import, fetch, or generic webresource-name
overload. The consuming solution must supply audited adapter code; `approved`
is an explicit trust assertion, not a discovery/authorization mechanism.
The adapter must allowlist its JSON source in the current environment, use a
supported same-origin read if reading a webresource, reject redirects outside
that policy, avoid credentials/tokens in configuration, and cap response bytes
**before materializing text** using the supplied 262,144-byte budget. Toolkit
code independently checks returned UTF-8 bytes, parses JSON, checks bounded
JSON structure, validates version 1, then registers under the requested name.
Source exceptions remain failures; existing `VbdError`s are preserved, other
adapter exceptions become `DATA_READ_FAILED`. Malformed JSON is `INVALID_JSON`.
No network operation is built into this module.

Replacement is explicit, like `Config.register`. Revision, scope and environment
generation are captured before invoking the loader and rechecked before
registration. Concurrent replacement wins over stale work; stale work cannot
overwrite it. Returned declarations are copies. Legacy validate/register/get
retain their declaration schema and capacities, independently of load's smaller
transport budget.

`Config.resolve` reads **all** environment declarations in a registered version-1
configuration, sequentially (maximum 200). It returns copied declarations and
typed `ResolvedValue` envelopes by exact schema name. Required declarations fail
on absence. `required: false` explicitly permits either a missing definition or
an unconfigured value; its own result property is `undefined`, not a default or
`null`. Denied, malformed, ambiguous, unsupported and service failures still
fail the operation. Text is not trimmed and rejects empty by default; exact
per-variable `{ allowEmpty: true }` preserves `""`. False and zero remain values.
JSON declarations always require a synchronous runtime `validate` predicate,
even when optional. Number/boolean conversion uses the existing typed APIs.
Policies for undeclared variables, wrong-type policies, and unknown options
are rejected before reads. JSON predicates receive copies; mutating a predicate
argument does not alter returned values.

TTL is 60 seconds by default, configurable from 0 through 300,000 ms, and uses
the **unchanged existing raw Environment cache**, not the generic Cache below.
Revision, normalized environment/user/language scope, and environment generation
are rechecked around asynchronous work and predicates. A successful resolution
does not validate destinations or prove effective authorization. Profile launch
preparation and dispatch remain separate APIs.

## Proposed toolkit-owned examples

| Schema/config key | Type | Example use |
| --- | --- | --- |
| `vbd_TargetModelDrivenAppId` | Text | App module ID in the current environment. |
| `vbd_TargetEnvironmentUrl` | Text | Explicit cross-environment base URL; validate permitted origins. |
| `vbd_TargetCanvasAppUrl` | Text | Approved Canvas player URL; launching is not Canvas runtime integration. |
| `vbd_HelpPortalUrl` | Text | Approved support/help destination. |
| `vbd_EnableAdvancedCommands` | Two options | UX feature flag, not authorization. |
| `vbd_LaunchProfiles` | JSON | Validated named app-launch profiles. |
| `vbd_ToolkitSettings` | JSON | Bounded presentation/cache settings. |

These are proposed definitions, not created components. Consumers can use their
own schema names. Avoid embedding deployment-specific current values in releases.

## Bindings

| Kind | Example meaning | Limits |
| --- | --- | --- |
| Literal | A dialog title or a fixed allowed choice. | Validate type and permitted values. |
| Context | Current table/record, app, user language. | Require the matching context; an unsaved record has no persisted ID. |
| Field | A lookup reference or form text. | Require a loaded supported attribute; treat user input as untrusted. |
| Environment | A named environment-variable value. | Typed reads, declared defaults, and no secret access. |
| Configuration | Another named key/profile. | Detect cycles and bound resolution depth. |
| Previous result | A previous recipe step's created-record ID. | Validate output path/type; no arbitrary property traversal. |

No JavaScript expressions, string-to-function conversion, unescaped FetchXML
substitution, or unrestricted URL interpolation.

### Implemented binding subset

```ts
Bindings.resolve(binding: ValueBinding, options?: BindingOptions): Promise<unknown>
Bindings.resolveMany(
  bindings: Readonly<Record<string, ValueBinding>>, options?: BindingOptions
): Promise<Record<string, unknown>>

type BindingType = "text" | "number" | "boolean" | "json" | "date" | "lookup" | "choices";
type BindingSource =
  | { kind: "literal"; value: unknown }
  | { kind: "context"; key: "record" | "selection" | "userId" | "languageId" | "environmentUrl" }
  | { kind: "field"; column: string }
  | { kind: "environment"; schemaName: string }
  | { kind: "config"; key: string }
  | { kind: "config"; name: string; variable: string }
  | { kind: "result"; path: readonly string[] };
interface ValueBinding {
  source: BindingSource;
  type: BindingType;
  allowEmpty?: boolean;
  nullable?: boolean;
  validate?: (value: unknown) => boolean;
}
interface BindingOptions {
  context?: ReadContext;
  operationContext?: OperationContext;
  fields?: readonly string[];
  environment?: readonly string[];
  resultPaths?: readonly (readonly string[])[];
  results?: Readonly<Record<string, unknown>>;
  configuration?: Readonly<Record<string, ValueBinding>>;
  registered?: readonly { name: string; variable: string }[];
  configurationOptions?: Readonly<Record<string, Omit<ConfigurationResolveOptions, "context">>>;
}
```

- Every binding declares an expected runtime type. JSON additionally requires a
  real synchronous predicate; an unchecked generic is not an output schema.
  Async predicates (including rejecting/never-settling ones) are rejected
  promptly and their rejections are observed. Additional predicates for other
  types may narrow allowed values.
- A literal is copied at invocation. Context supports only saved record,
  supplied selection, and normalized scope values; no app/global property
  traversal. Record/selection require an existing toolkit `OperationContext`.
  An unsaved record fails. Field reads use `Fields.get`, require an exact
  `fields` approval and matching operation context, and fail if not loaded.
- Environment sources require exact `environment` approvals and support only
  text/number/boolean/JSON through the existing typed APIs, with no optional
  fallback. `config.key` follows the caller's bounded runtime `configuration`
  binding graph; it is **not** extra portable JSON schema or a workflow.
  `config.name/variable` selects an explicitly approved registered declaration
  after `Config.resolve`; the entire registered configuration is resolved, so
  its JSON policies must be provided in `configurationOptions`.
- Result paths are arrays of exact own-data property segments, with an exact
  matching `resultPaths` approval. No dot-string parser, getters, inherited
  properties, wildcards, or prototype/constructor/getMetadata traversal.
  Approved results and literals are copied before asynchronous work; other
  input definitions/policies are also captured, not read live from caller maps.
- Date bindings return new `Date` instances representing the same instant,
  never JSON strings. Lookup bindings return copied, strict `EntityRef[]`,
  normalizing IDs/table names and rejecting duplicates. Choices are integer
  arrays. Dates are unsupported inside JSON; there is no silent date/lookup
  conversion to unrelated text/scalars. Date custom properties are not copied.
  `nullable: true` admits null for typed non-JSON values; JSON null is decided by
  its required predicate. Empty text needs `allowEmpty: true`. Missing values
  never become null/empty/success-shaped defaults.
- Maximum 100 named outputs, graph definitions, approvals per list and
  configuration-options entries; maximum 100 expanded binding visits,
  reference depth 8, path length 8, and a 262,144-byte cumulative value-work
  budget (including copied literal/result snapshots and expanded results).
  Cycles fail; repeated references still count as work.
- JSON copies additionally enforce depth 8, 10,000 nodes, 1,000 array entries,
  512 object members, 65,536 characters per string, finite numbers and a
  262,144-byte serialized budget. They reject cycles, accessors, symbols,
  non-plain objects and unsafe own keys. No eval, free interpolation, stored
  binding state or secrets store exists.
- Scope/environment-generation checks span the entire batch and predicates;
  relevant registered revisions are captured before its first await.
  Forms/results are not a transactional server snapshot, and this cannot prove
  effective access to records. Any failure rejects the batch without partial
  success output.

## Caching and flags

- Cache keys include environment, user/security scope, and language where relevant.
- Use bounded TTL, size, and explicit invalidate/preload operations.
- Coalesce identical concurrent reads; never cache permission failures as absence.
- Prepared launches expire/invalidate when their configuration or scope changes.
- Any explicit environment invalidation conservatively expires all prepared
  tokens; selected cache entries themselves are removed only in the chosen scope.
- Expose effective feature flags for UX only; server authorization is independent.
- Do not store secrets, tokens, or arbitrary fetched record payloads in browser
  storage. This implementation has **no persistent caching option**.
- A cache hit is not a guarantee of immediately reflecting an administrator's
  last edit; document the freshness policy and refresh mechanism.

### Generic memory-cache contract

```ts
Cache.getOrLoad<T>(key: CacheKey, options: CacheLoadOptions<T>): Promise<T>
Cache.invalidate(selection: CacheInvalidation, options?: CacheScopeOptions): number
Cache.clear(options?: CacheScopeOptions): number

interface CacheKey { namespace: string; key: string }
interface CacheLoadOptions<T> {
  context?: ReadContext;
  approved: true;
  purpose: "configuration" | "metadata";
  revision: string;
  ttlMs: number;
  maxBytes?: number;
  dependencies?: readonly string[];
  load(): Promise<unknown>;
  validate(value: unknown): value is T;
}
interface CacheInvalidation { namespace: string; key?: string; dependency?: string }
interface CacheScopeOptions { context?: ReadContext }
```

The cache is module-instance, **memory-only**, for explicitly caller-approved
safe configuration/metadata JSON. It cannot detect disguised secrets. Consumers
must never approve records, secrets, credentials or tokens; the purpose label
and predicate are responsibilities, not content classification or authorization.
There is no browser storage, cross-tab coordination, tenant mutation, or network
loader built into Cache. Scope always includes normalized environment, user,
and language; offline/unsupported scope fails rather than sharing a global key.

Keys use the existing bounded identifier syntax. Revision is a required
1–128-character caller contract/freshness revision. Changing revision or other
cache policy for the same scoped namespace/key disconnects prior in-flight
work. Consumers must invalidate/re-request with the changed revision when
their source/schema changes; this does not watch arbitrary external mutations.
Dependencies are up to 32 unique identifier labels; callers own the mapping
from source/registry changes to invalidation. Generic Cache does not change
Environment's raw cache or automatically invalidate prepared-launch tokens.
Environment.invalidate continues to increment its existing generation, which
also conservatively expires generic cached/in-flight values.

TTL is required, finite integer 1–300,000 ms, measured from validated load
completion; backwards clock movement expires stored entries. There are at most
128 entries (including pending keys), 64 active loads, 1 MiB total serialized
stored values and 262,144 bytes per value (optionally lower via `maxBytes`).
The JSON-copy limits above also apply. Capacity evicts oldest inserted entries,
not LRU; eviction can expire pending callers. Invalidated loads remain in the
active-load budget until they settle; invalidation does not cancel external work.

Concurrent identical scoped keys/policies coalesce the loader. Each caller
revalidates an isolated copy, including on hits. A predicate cannot mutate the
stored/returned canonical value. Callers must agree on one validator/loader
contract per key/revision; a failed coalesced caller may conservatively expire
other waiters. Loader/validation failures are never cached. Existing `VbdError`s
are preserved; untyped loader errors become `DATA_READ_FAILED`.

Invalidation matches current scope plus namespace, and optional key **and**
dependency (intersection when both supplied). It removes pending-key coalescing
as well as stored values and returns the removed slot count. `clear` removes all
namespaces only in the explicitly resolved current scope. Neither touches
unrelated browser/app storage. Strong slot identity, scope and environment
generation checks before/after loads and predicates prevent stale work from
returning successfully or repopulating a replaced/invalidated slot. TTL alone
is not immediate source freshness or authoritative effective authorization.

### Maker and release handoff

Consuming solution owners (AXIOM/CANVAS) must approve/wire a trusted JSON source,
create/populate declared environment definitions, provide exact binding
approvals and runtime predicates, and own source-revision/dependency invalidation.
Do not embed deployment values or credentials into the portable declaration.
No maker or tenant changes are performed by these modules. Parent owns root/
browser exports, catalog availability/version counts, and any separate
same-window implementation. SENTINEL must verify actual host context/permissions
and trusted adapter source/streaming policy before release; live model-driven
input, tenant behavior and release packaging are not verified by unit tests.

## Acceptance scenarios

Test current-over-default, default-only, missing definition, absent optional,
explicit empty, false, zero, invalid number/JSON, secret, data-source type,
denied access, multiple candidates, stale cache, concurrent requests, and
configuration cycles. Repeat app-profile resolution with two different deployment
settings without rebuilding the library.
