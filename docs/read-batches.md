# Bounded read-job batches

`VBD.Batch.execute(requests, options?)` coordinates explicit **read-only**
trusted callbacks. It is not the Dataverse `$batch` transport, a changeset,
a transaction, a recipe engine or automatic mutation retry.
`Batch.executeChangeset` remains planned.

```typescript
const report = await VBD.Batch.execute([
  {
    id: "featureFlags", kind: "read",
    run: () => loadReviewedReadOnlyFlags(),
    validate: (value: unknown): value is { enabled: boolean } =>
      typeof value === "object" && value !== null &&
      "enabled" in value && typeof value.enabled === "boolean"
  }
], { concurrency: 4, failurePolicy: "stop", maxResultBytes: 1048576 });
```

The read declaration and runtime guard are explicit caller trust contracts.
They cannot prove a JavaScript callback is pure or prevent a dishonest callback
from writing elsewhere. Supply reviewed typed read wrappers, not configured
code strings, unbound SDK methods or arbitrary request metadata.

## Input and execution bounds

- 1..1000 plain, own-safe requests with case-insensitively unique IDs.
  IDs use the standard identifier grammar, are at most 128 characters and
  retain their declared spelling in results.
- Each request requires exactly id, kind=read, run and a synchronous type guard.
  Unknown fields, accessors, cycles, unsupported kinds and duplicate IDs fail
  before any job is dispatched.
- Concurrency is 1..8, default 4. At most eight batches are active in this
  runtime, so at most 64 callbacks are admitted concurrently.
- Every successful value must be finite safe JSON: depth 8, 10000 nodes,
  strings at most 65536 UTF-16 units, arrays 1000 and objects 512 keys,
  at most 256 KiB UTF-8 per item.
- Successful JSON values share a total UTF-8 budget: default 1 MiB,
  configurable 1 byte..2 MiB. This counts serialized successful values,
  not caller-owned callback memory or bounded diagnostic/receipt overhead.

Source and returned values are copied. Guards receive an isolated copy but
must validate it without transformation; mutations, false/throwing guards and
async/thenable guards fail the item. Invalid async guard returns are observed
to avoid unhandled rejections, not awaited as a new operation.
Results are not cached or persisted.
Return plain record/metadata DTOs only, not live SDK objects, opaque paging or
prepared-launch tokens, choice-baseline handles, Response objects or Dates.
JSON copying cannot preserve those runtime identities. Use continuation/token
APIs outside the batch or project a read result to the data fields you need.

## Honest outcomes

Items remain in **input order**, regardless of completion order:

| Item status | Output |
| --- | --- |
| succeeded | id and copied validated value; false/zero/empty/null remain values |
| failed | id and safe code/message/correlation; private original diagnostic retained non-enumerably |
| skipped | id and explicit failure/cancelled/resultLimit reason |

The report includes counts for total, attempted, succeeded, failed and skipped,
plus resultBytes and stopReason=none/failure/cancelled/resultLimit.
Overall status is succeeded only when no job failed or was skipped and no stop
condition was observed; otherwise partial, failed, cancelled or limited is explicit.
Processing all jobs under continue policy does not make mixed failures success.

Default failurePolicy=stop prevents **new** work after the first observed
failure. Explicit continue attempts subsequent jobs, still reporting failures.
Already-started callbacks are drained and keep their real outcome; there is no
rollback, detachment or forced native cancellation. Budget allocation follows
completion order, while receipt items follow input order. The first observed
stop reason is retained if a different condition occurs in-flight.

An optional signal with a current boolean aborted property (for example
AbortSignal) stops new dispatch. Pre-aborted batches return cancelled/skipped
without running jobs. In-flight native reads are not magically aborted.
Unresolved trusted callbacks retain their active batch slot until they settle;
there is no queue or timeout that falsely claims their work stopped.

## Scope and diagnostics

Use the supported online current host or explicit ReadContext. The helper itself
performs no Web API read. Environment/user/language scope and Environment
invalidation generation are checked before dispatch, after settlement and around
guards. Scope changes reject CONFIG_EXPIRED after started workers drain, rather
than returning stale data. Original failure evidence and attempted counts remain
in the retained error cause, not a public payload dump.
Only observed scope transitions can be detected; an unreported change away and
back between checks is not independently observable.

Callback failures are not retried. Safe failure DTOs never serialize original
messages, stacks or record payloads. A failed item's diagnostic property is
non-enumerable and available only for deliberate authorized diagnosis.
Cancellation observer failures are explicit errors, not an empty success.
No preflight/read-only declaration, count or successful receipt establishes
Dataverse authorization.

Focused source tests cover exact counts/order/UTF-8 budget, stop/continue,
draining, pre/in-flight cancellation and first-stop precedence, schema/guard
failures, redaction/copy isolation, scope/invalidation changes, 1000 jobs,
eight-way concurrency and eight active batches. Native/network integration
remains unverified until separately exercised with a consumer's reviewed reads.
