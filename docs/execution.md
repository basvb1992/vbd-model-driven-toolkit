# Scoped operation locks

`VBD.Execution.withLock(key, operation, options?)` prevents duplicate/reentrant
work within this toolkit instance. It is not a distributed lock, authorization
check, durable workflow, cancellation mechanism or automatic retry.

```typescript
const result = await VBD.Execution.withLock({
  namespace: "consumerCommands", key: "submit",
  record: VBD.Context.requireSavedRecord(formContext)
}, async () => {
  return runReviewedOperation();
}, { duplicate: "return-busy" });
if (result.status === "busy") {
  // Keep the existing operation running; don't retry it.
}
```

`namespace` and `key` are exact case-sensitive identifiers of 1..128 characters
using the standard identifier grammar. An optional EntityRef is normalized;
record display names do not affect identity. Scope includes normalized
environment URL, user ID and language from the supported online current host
or an explicit `ReadContext`. No Web API call is made by the lock itself.

The default duplicate policy throws RESOURCE_BUSY. Explicit return-busy returns
only `{status:"busy"}` and **does not invoke the callback**. Successful callbacks
return `{status:"completed", value}` with the original awaited result, including
false/zero/empty/null/undefined. There is no queue or wait policy. The reservation
is installed before the callback is dispatched, so immediate concurrent calls
and reentry see the same busy state.

At most 128 operations can be active across all namespaces/scopes in this
runtime. Capacity exhaustion throws LIMIT_EXCEEDED; it does not evict pending
work. An unresolved trusted callback retains its lock until it settles. There
is deliberately no TTL that might release a lock while a native write is still
in flight. Independent browser frames/tabs or toolkit copies do not coordinate.

Scope and Environment invalidation generation are checked before dispatch and
after settlement. A change rejects CONFIG_EXPIRED; it cannot turn old work into
a successful result. Invalidation does not unlock a callback that is still in
flight. Finally cleanup removes only the original owned reservation and cannot
release a newer different-scope operation.
Checks observe the scope at dispatch/settlement; they cannot detect an
unreported scope change that changes away and back between those observations.

Structured VbdError failures are preserved. Other callback failures become safe
OPERATION_FAILED errors retaining their original cause. If both an operation
and its scope fail, both causes remain available for authorized diagnostics;
no raw message/payload is logged by the helper. Native writes/navigation may
already have occurred before any failure is observed. No rollback or safe
automatic retry is implied.

Focused source fixtures cover exact key/capacity thresholds, record identity,
distinct/same adapter scopes, immediate and async duplicates, reentry,
pre-dispatch and in-flight scope/invalidation changes, ownership-safe cleanup,
partial/unknown errors and falsy results. Real multi-click/native-host behavior
remains unverified until separately exercised in a consumer's app.

## Bounded read retry subset

```typescript
withRetry<T>(
  operation: ReadOperation<T>,
  options: ReadRetryOptions<Awaited<T>>
): Promise<Awaited<T>>
```

`Execution.withRetry` requires **`readOnly: true`**. This explicitly approves a
trusted application callback; it does not inspect names or prove JavaScript
purity. Mutation, idempotency guesses and extra options are rejected. There are
no automatic write retries, durable queues, recipe dispatchers or implicit
toolkit/native API calls.

```typescript
const answer = await VBD.Execution.withRetry(
  ({ attempt, signal }) => reviewedReadAdapter({ attempt, signal }),
  {
    readOnly: true,
    policy: {
      maxAttempts: 3, initialDelayMs: 250, backoffFactor: 2,
      maxDelayMs: 5000, maxTotalDelayMs: 15000, maxElapsedMs: 30000
    },
    guard: value => typeof value === "number" && Number.isFinite(value)
  }
);
// The original awaited value, including 0/false/""/null/undefined, not a wrapper.
```

`ReadOperation<T>` receives a frozen `ReadCallbackContext` containing a 1-based
`attempt` and the optional caller `signal`. `ReadRetryOptions<T>` also accepts
`context?: ReadContext` and `guard?: (value: T) => boolean`. Guards must return
exactly `true` synchronously. False, throws and async/thenable returns fail
CONFIG_VALUE_INVALID and **never retry**. Even invalid asynchronous guards are
observed and drained, not detached. There is no output coercion or JSON copying.

Policy fields are optional, exact and finite:

| Field | Default | Inclusive bounds |
| --- | --- | --- |
| `maxAttempts` (includes first dispatch) | 3 | integer 1..10 |
| `initialDelayMs` | 250 | integer 0..60000, no greater than `maxDelayMs` |
| `backoffFactor` | 2 | finite 1..4 |
| `maxDelayMs` | 5000 | integer 0..60000 |
| `maxTotalDelayMs` | 15000 | integer 0..300000 |
| `maxElapsedMs` | 30000 | integer 1..300000 |

Backoff is `min(maxDelayMs, ceil(initialDelayMs * backoffFactor^(attempt-1)))`.
The sum of **scheduled** waits may equal, but never exceed, the total-delay
budget. A proposed wait must leave positive elapsed budget for another
dispatch. Invalid policies reject INVALID_ARGUMENT before calling application
code. Exhausted attempts/delay admission preserve the final original safe
VbdError (or normalize an unknown failure to OPERATION_FAILED with its original
non-enumerable cause). Expired elapsed budget rejects LIMIT_EXCEEDED; original
failure evidence, when available, remains in its non-enumerable cause.

### Supported evidence, not error-message heuristics

Only own data properties matching `ReadRetryEvidence` are considered:
`{status: number, retryAfter?: number | string}`. Status must be exactly
**408, 429, 502, 503 or 504**. An approved read adapter must retain actual HTTP
response evidence; it must not manufacture a status from text/error codes.
Native Xrm failures exposing only `errorCode`/`message` are **not retryable**.
Generic network errors, 500, access/validation/concurrency errors, uncertain
mutations, inherited properties and accessor evidence are not retryable.

At most eight cause levels are inspected, and only through VbdError
DATA_READ_FAILED, SDK_OPERATION_FAILED or OPERATION_FAILED wrappers. A wrapper
code without retained HTTP evidence is insufficient. Every other VbdError,
including DATA_WRITE_FAILED, ACTION_FAILED, PARTIAL_FAILURE and
MUTATION_OUTCOME_UNKNOWN, is terminal even with a nested 503. Reflective failures
and cyclic/unrecognized wrappers are uncertain, not retry candidates.

The adapter may explicitly copy a literal HTTP `Retry-After` header into
`retryAfter`. Supported forms are nonnegative safe-integer seconds (number or
1..10 decimal digits) and canonical English IMF-fixdate HTTP dates. No arbitrary
exception text, nested arbitrary headers, localized dates or .NET TimeSpan is
parsed. Past valid dates mean zero additional server wait. The actual delay is
the larger of backoff and server wait. Malformed or above-maximum header
evidence terminates without retry; it is **never truncated** into an earlier
retry. A valid header still must fit total-delay and elapsed admission budgets.

Grounding checked against current Microsoft Learn:
[Dataverse service protection limits](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/api-limits)
documents HTTP 429 and numeric Retry-After seconds; the
[Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry)
requires transient-fault classification and warns about non-idempotent
operations. The additional narrow HTTP transport statuses above are this
toolkit's explicit read-only policy, not a claim that every native API exposes
them. HTTP-date support applies only when an adapter actually retains that
header form.

## Read-only preflight, not an action engine

```typescript
preflight(
  checks: readonly PreflightCheck[],
  options?: PreflightOptions
): Promise<PreflightReport>
```

Each check has a unique case-sensitive safe `id` (1..64 characters, starting
with a letter, then letters/digits/`._-`, excluding reserved prototype keys),
`readOnly: true`, optional `required` (default true), and trusted `run`.
It receives the same frozen callback context with `attempt: 1`; preflight
**does not retry**. It accepts 1..100 checks, concurrency integer 1..8 (default
4), and `maxElapsedMs` integer 1..300000 (default 30000). Options also accept
`context`, `signal` and a trusted read-only diagnostic `observer`. There are
no writes, navigation, user messages, configuration repairs or generic actions.
Checks must resolve to one of these **exact** observations:

```typescript
{ status: "pass", reason: "confirmed" }
{ status: "fail", reason: "denied" | "not-satisfied" }
{ status: "unknown", reason: "missing-data" | "inconclusive" }
{ status: "unsupported", reason: "unavailable" }
```

These are application assertions, **not server authorization**. Missing,
extra, invalid or accessor-bearing data becomes unknown/invalid-observation.
Callback exceptions (including denied reads) become unknown/check-failed,
not missing-data fallbacks or permission grants. Internal unknown reasons also
include cancelled and elapsed-budget. Every input check appears in input
order with `id`, `required`, `executed`, `status`, `reason`, and a safe
`correlationId` for internal failures. Unstarted checks explicitly have
`executed: false`; no skipped check disappears.

```typescript
const report = await VBD.Execution.preflight([
  {
    id: "requiredRead", readOnly: true,
    run: () => ({ status: "pass", reason: "confirmed" })
  },
  {
    id: "optionalMetadata", readOnly: true, required: false,
    run: () => ({ status: "unsupported", reason: "unavailable" })
  }
]);
// Safe result (correlationId varies):
// {
//   status: "incomplete", basis: "trusted-read-only-checks", correlationId: "...",
//   checks: [
//     {id:"requiredRead", required:true, executed:true, status:"pass", reason:"confirmed"},
//     {id:"optionalMetadata", required:false, executed:true, status:"unsupported", reason:"unavailable"}
//   ],
//   counts: {total:2, executed:2, pass:1, fail:0, unknown:0, unsupported:1, observerFailed:0}
// }
```

Overall is **blocked** if any required check fails; otherwise **ready** only
when every check passes and no observer failed; otherwise **incomplete**.
Optional fail/unknown/unsupported checks cannot disappear into ready.
All check failures remain visible even when another check blocks the plan.
A known fail remains fail if a later observer/cancellation/budget boundary
occurs; passing results cannot remain ready across that boundary.

An observer receives a frozen safe `PreflightEvidence` projection with no raw
diagnostic. It runs under the same concurrency slot and scope/budget checks.
Successful invocation adds `observer: "reported"`; failure adds
`observer: "failed"` and `observerCorrelationId`, increments `observerFailed`,
and prevents ready without erasing a known denial. Observers are not allowed
to perform repairs or user-facing actions.

Reports, result arrays, counts and results are frozen. Internal errors retain
original evidence in non-enumerable `diagnostic` or `observerDiagnostic`
VbdErrors, following the Security assessment pattern. JSON serialization
contains only bounded IDs/enums/booleans/counts/correlation IDs: never callback
payloads, error messages, stacks, raw causes, environment URLs or user IDs.
Authorized diagnostics can explicitly inspect retained errors; do not serialize
or log those raw causes.

## Shared lifecycle and verification boundaries

The two read APIs share at most **8 active runs per toolkit instance**, giving
at most **64 active preflight callbacks** (8 checks per run). Retry uses one
callback at a time. Capacity rejects LIMIT_EXCEEDED rather than queuing or
evicting unresolved work. This admission is separate from unchanged withLock.

They snapshot environment/user/language/invalidation generation and recheck
before dispatch, after awaited callbacks/guards/observers/delays and before
return. Scope unavailability/change rejects CONFIG_EXPIRED after started work
is drained, retaining observed failure evidence; stale data is not returned.
Initial unsupported/offline context fails before dispatch. As with withLock,
an unreported change away and back between observations cannot be detected.

Cancellation stops admission/retries/delays; retry rejects safe OPERATION_FAILED
with retained `cause.reason: "cancelled"` (not an arbitrary signal reason).
Preflight reports cancelled checks as unknown/incomplete unless a required
known fail already makes it blocked. Elapsed budget uses both wall and
monotonic clocks (including wall-clock jumps/suspension); reaching the bound
stops admission and invalidates late passing observations. Timers/listeners
exist only during retry delays and are cleaned on completion/cancellation.

**Bounds govern admission, scheduled waits and result acceptance, not trusted
JavaScript purity or server cancellation.** Unresolved callbacks, thenables,
invalid async guards and observers are awaited/drained. They may outlive the
elapsed budget and retain their admission slot indefinitely. No callback is
magically cancelled, detached or replaced with a duplicate attempt. Forwarding
a signal does not guarantee that application/native code honors it.

Focused source fixtures use controlled wall/monotonic clocks and timers for
attempt/delay/header/budget thresholds, cancellation, scope/generation races,
guard/observer failures, redaction, exact report decisions and concurrency.
The existing execution-lock suite is run unchanged. Root type re-exports,
catalog/version/count integration and Batch.execute remain parent-owned.
SENTINEL: native-host/consumer adapter evidence and real server cancellation
remain unverified; no live tenant reads, writes or deployment were performed.
Rollback is a single source commit revert; no persisted state/schema changes
or server-side rollback claims are involved.
