# Synchronous command rules (R2)

`Rules.evaluate/all/any/not` implement four existing catalog entries. Root,
browser namespace, package exports, counts and version integration are parent-owned.
Until that integration lands, import `Rules` and its types from `src/rules.ts`
inside this checkout; do not claim the published/root package already exports them.
There is no rule registry, expression interpreter, network read or async evaluator.

## Exact public contract

```ts
import type { OperationContext } from "../src/context.js";
import type { ReadContext, ReadScope } from "../src/platform.js";

type RuleScalar = string | number | boolean | null;
type RuleComparison =
  | { readonly op: "eq" | "ne"; readonly value: RuleScalar }
  | { readonly op: "lt" | "lte" | "gt" | "gte"; readonly value: number };
interface RuleAll { readonly kind: "all"; readonly conditions: readonly RuleCondition[] }
interface RuleAny { readonly kind: "any"; readonly conditions: readonly RuleCondition[] }
interface RuleNot { readonly kind: "not"; readonly condition: RuleCondition }
type RuleCondition =
  | RuleAll | RuleAny | RuleNot
  | { readonly kind: "record"; readonly state: "saved" | "unsaved" }
  | { readonly kind: "selection"; readonly min: number; readonly max: number; readonly tables?: readonly string[] }
  | { readonly kind: "capability"; readonly name: "form" | "grid" }
  | ({ readonly kind: "field"; readonly field: string } & RuleComparison)
  | ({ readonly kind: "prepared"; readonly key: string } & RuleComparison);
type RulePreparedFact =
  | { readonly state: "ready"; readonly value: RuleScalar }
  | { readonly state: "notReady" };
interface RulePreparedValues {
  readonly scope: Readonly<ReadScope>;
  readonly values: Readonly<Record<string, RulePreparedFact>>;
}
interface RulePreparedPolicy {
  readonly key: string;
  readonly validate?: (value: unknown) => boolean;
}
interface RuleEvaluationOptions {
  readonly context: OperationContext;
  readonly scope: Readonly<ReadScope>;
  readonly scopeContext?: ReadContext;
  readonly allowedFields: readonly string[];
  readonly allowedPrepared: readonly RulePreparedPolicy[];
  readonly prepared?: RulePreparedValues;
}
type RuleState = "matched" | "notMatched" | "unknown";
type RuleReason =
  | "comparison-satisfied" | "comparison-not-satisfied" | "comparison-type-mismatch"
  | "record-state-satisfied" | "record-state-not-satisfied" | "record-unavailable"
  | "selection-satisfied" | "selection-not-satisfied" | "selection-surface-unavailable"
  | "capability-available" | "capability-unavailable"
  | "field-not-loaded" | "field-surface-unavailable"
  | "prepared-missing" | "prepared-not-ready"
  | "all-satisfied" | "all-not-matched" | "all-unknown"
  | "any-satisfied" | "any-not-matched" | "any-unknown"
  | "negated-match" | "negated-no-match" | "negated-unknown";
interface RuleAssessment {
  readonly state: RuleState;
  readonly reason: RuleReason;
  readonly basis: "ux-only";
  readonly children: readonly RuleAssessment[];
}

// Public methods on the frozen Rules namespace (not additional catalog APIs):
declare function evaluate(input: RuleCondition | string, settings: RuleEvaluationOptions): RuleAssessment;
declare function all(conditions: readonly RuleCondition[]): RuleAll;
declare function any(conditions: readonly RuleCondition[]): RuleAny;
declare function not(condition: RuleCondition): RuleNot;
```

All these named types are exported by `src/rules.ts`. `ReadScope` is the existing
`{ environmentUrl: string; userId: string; languageId: number; online: boolean }`.
`ReadContext` is the existing scope/read adapter; evaluation calls **only**
`getScope`, never `retrieveMultipleRecords`. The native fallback requires the
existing supported online Xrm Utility/WebApi shape, but does not invoke WebApi.
Supply a trusted `scopeContext` when that native shape is unavailable. Scope
normalization, user GUID identity, online checks and invalidation generation
come from the shared helpers. Wrong/stale scopes throw `CONFIG_EXPIRED`;
offline/unsupported scope throws rather than becoming a missing fact.

## Behavior and supported subset

- AND: a `notMatched` child dominates `unknown`. OR: a `matched` child dominates
  `unknown`. NOT preserves `unknown`. Empty AND/OR is invalid, not a vacuous match.
- Assessments and constructor trees are deep-frozen copies. Children include
  only visited branches in order, including the decisive child; skipped branches
  are not reported as observed. No raw values, environment URLs or user IDs are
  in assessments.
- **Complete preflight happens before observation:** strict JSON/tree schemas,
  field/prepared allowlists, all supplied fact shapes and every ready-fact guard,
  including unused/short-circuited inputs. Only native observations short-circuit.
- `eq/ne` use strict scalar equality: false, zero, empty string and null are
  distinct ready values. No coercion, trimming or case folding of values.
  Numeric ordering with a nonnumber observation is `notMatched` /
  `comparison-type-mismatch`, not unknown. Nonfinite numbers are invalid.
- `record` delegates to genuine native `Context.getRecord`: create/empty ID is
  unsaved; unsupported/bulk-edit/no single selected record is unknown.
  A malformed ID/form type is an error, not an unsaved fallback.
- `selection` uses the normalized **Context snapshot**, not all view records or
  a fresh grid read. Recreate Context on each ribbon invocation. Inclusive
  min/max supports 0..1000; optional table names normalize to lowercase. Empty
  selection can match min/max 0; on a form it is unknown.
- `capability` supports only form/grid presence on a genuine Context and uses
  `Context.requireCapability` for available capabilities. Absence is
  `notMatched`. This does not attest save/write access, record privilege,
  field security or other client features.
- `field` must be in `allowedFields` (exact logical attribute name; no paths).
  Supported SDK types: boolean, integer, optionset, decimal, double, money,
  string, memo. Native type/value is validated; integer/choice must be integer.
  State/status comparisons are ordinary allowlisted scalar fields, not guessed
  lifecycle transitions. Null is a loaded, known empty value.
  Native `getAttribute(...) === null` is `unknown` / `field-not-loaded`; on a
  grid it is `field-surface-unavailable`. A missing method, undefined/invalid
  response, thrown SDK error or unsupported field type **throws**. Referenced
  fields and record state are observed at most once per evaluation.
- `prepared` must be in `allowedPrepared`. Missing key/container is
  `prepared-missing`; explicit `{state:"notReady"}` is `prepared-not-ready`.
  Undefined or malformed supplied values are invalid, not missing. No extra
  prepared keys are accepted. Every container must declare the current scope.
  `validate` is a trusted validation guard: exactly synchronous `true` accepts.
  False, throws and async/thenable returns throw `CONFIG_VALUE_INVALID` (cause
  retained; invalid promises observed by the shared `runtimePredicate`).
  No callbacks are allowed in condition trees.

Limits are fixed, not caller-expandable: 32 KiB UTF-8 for each tree, scope,
field allowlist and prepared JSON payload; 256 condition occurrences (shared
acyclic nodes count each time); tree depth 6 (root 0); 1..64 children per AND/OR;
100 unique allowed fields, prepared policies and supplied facts; strings at
most 32768 characters. The shared JSON structural depth **8** also applies
(arrays/objects each add depth), so deeply alternating AND/OR can reach it
before tree depth 6. Shared JSON limits of 10000 values and 1000 array items
also apply. Native field strings above the supported bound are invalid SDK
responses. Capacity violations throw; no truncation.

Accessors, symbols, hidden properties, cycles, unsafe keys, sparse/extended
arrays, custom prototypes and array subclasses are rejected. Ordinary
cross-realm objects/arrays and null-prototype JSON records work. Shared JSON
preflight is reused; Rules adds a narrow array-prototype guard so the copier
cannot dispatch overridden array methods, and rejects JSON functions before
thenable handling. SDK contexts/callbacks are opaque trusted code, not JSON.
Transparent proxies can run traps: inputs are copied before guards, and scope
is checked before/after guards/native observations and before returning.
This is not a sandbox for malicious caller code or a transaction across form
edits. Recursive evaluation throws `EVENT_REENTRY`; failure resets the guard.

## Form and ribbon TypeScript examples

After parent namespace integration, a form handler can compose a condition:

```ts
import { Context, Rules } from "vbd-model-driven-toolkit";
import type { RuleEvaluationOptions } from "vbd-model-driven-toolkit";

const plan = Rules.all([
  { kind: "record", state: "saved" },
  { kind: "field", field: "statuscode", op: "eq", value: 1 },
  { kind: "prepared", key: "featureEnabled", op: "eq", value: true }
]);

// Trusted application code owns loading/freshness; no fetch inside this handler.
export function assessForm(
  executionContext: unknown,
  facts: Omit<RuleEvaluationOptions, "context">
) {
  return Rules.evaluate(plan, {
    ...facts, context: Context.fromFormEvent(executionContext)
  });
}

// Bind PrimaryControl to this classic CustomRule wrapper.
export function canRun(
  primaryControl: unknown,
  facts: Omit<RuleEvaluationOptions, "context">
): boolean {
  return Rules.evaluate(plan, {
    ...facts, context: Context.fromFormCommand(primaryControl)
  }).state === "matched";
}
```

`facts` must explicitly provide current `scope`, `allowedFields: ["statuscode"]`,
`allowedPrepared: [{key:"featureEnabled"}]`, and optionally
`prepared: {scope, values:{featureEnabled:{state:"ready",value:true}}}`.
For ribbon wiring, use an application-owned wrapper that obtains these
synchronously from its current scoped cache; a maker rule cannot supply a
TypeScript options object as an arbitrary ribbon parameter.

For a grid: `Rules.evaluate({kind:"selection", min:1, max:5, tables:["account"]},
{...facts, context:Context.fromGridCommand(selectedControl)})`. This uses actual
selected rows, not an app-global cached selection; it performs no writes.

Return a boolean immediately from the maker-facing CustomRule; only `matched`
enables. Preload async facts in a separate event/action, mark not-ready
explicitly, invalidate on scope/context changes and request a supported
`Commands.refresh` when ready. Never fetch/await or use a promise in this
evaluator. Errors propagate: an application may explicitly report via
Diagnostics and return false at its UX boundary, but must not relabel errors
as missing/unknown or log raw private values.

## Native/unsupported boundaries and handoff

Official contracts reviewed:
[getValue](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/attributes/getvalue),
[getAttributeType](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/attributes/getattributetype),
[CustomRule](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/define-ribbon-enable-rules).
Unified Interface permits promise-based CustomRules with a platform 10-second
deadline; **this engine deliberately supports synchronous rules only**. Modern
Power Fx visibility is not a JavaScript CustomRule consumer.

Unsupported: lookup/reference/array/date/file/image comparisons, regex/text
operators, arbitrary functions/async operations, registered rule names,
privilege/role/security checks, inferred authorization, network retrieval,
form mutation, process transitions and offline evaluation. Caller flags
including precomputed privilege hints are still caller-trusted UX inputs:
**not authorization, privilege evidence or server enforcement**. All native
capability and field observations are UX only.

`tests/rules.native.test.ts` compiles an in-memory browser fixture wiring just
Rules + existing Context, with foreign native SDK receivers, false/zero values,
scope checks and a synchronous boolean enable wrapper. It never contacts a tenant.
Strict source types and focused tests also compile the public signatures.

AXIOM/CANVAS handoff: wire the webresource/PrimaryControl or SelectedControl,
own the current-scope prepared cache and refresh policy, and preserve the
modern/classic distinction. SENTINEL: validate rendered command enablement,
OnLoad/OnChange timing, selection changes, missing/secured/unloaded fields,
client restrictions, cache invalidation and error reporting in the signed-in
host. Those checks, native PAC, solution import, managed-target checks and
deployment/release are unverified here. Parent owns exports/catalog/version
and package-consumer coverage of integrated Rules.

Rollback: revert the scoped implementation commit; no registrations, persisted
state, schema changes, migrations, environment operations or releases occur.
