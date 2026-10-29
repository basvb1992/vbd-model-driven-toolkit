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
