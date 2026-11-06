# Selected-grid processing and owned subgrid events

Source 0.9 adds `Grids.runSelected` and `Grids.registerOnLoad`. These are
typed APIs for consumer-owned form/ribbon handlers, not a change to the
prepared app-launch-only `Commands.run`/`runGrid` dispatch contract.

## Process an explicit selection

```ts
import { Data, Grids } from "vbd-model-driven-toolkit";
import type { GridOperation, GridRunResult } from "vbd-model-driven-toolkit";

type AccountName = { name: string | null };
const readName: GridOperation<AccountName> = {
  kind: "read",
  run: record => Data.retrieve(record, ["name"]),
  validate: (value): value is AccountName =>
    typeof value === "object" && value !== null &&
    "name" in value && (typeof value.name === "string" || value.name === null)
};

// Consumer webresource: wire SelectedControl and
// SelectedControlSelectedItemReferences from the grid command.
export async function vbd_ReadSelectedNames(
  selectedControl: unknown, selectedReferences: readonly unknown[]
): Promise<GridRunResult<AccountName>> {
  return Grids.runSelected(selectedControl, readName, {
    selectedReferences, allowedTables: ["account"],
    min: 1, max: 25, failurePolicy: "stop"
  });
}
```

`runSelected(input, operation, options)` requires a real supplied grid or
genuine `OperationContext`; there is no global form lookup. When
selectedReferences is omitted, read native selected rows **once**. Otherwise
normalize exactly the supplied references (SDK Id/TypeName aliases and
ID-only strings with explicit/native table identity are supported).
Preflight the complete selection before any operation. Reject duplicates,
empty/over-bound selections, disallowed tables and mixed tables unless
allowMixedTables is explicitly true.

Options: required allowedTables (1..20 unique case-insensitive logical names),
min (default 1), max (default 100), each within 1..1000, optional entityType,
selectedReferences, failurePolicy (`stop` default or `continue`),
maxResultBytes (default 1 MiB, maximum 2 MiB), trusted ReadContext and
AbortSignal-compatible cancellation. Unknown options, accessors, unsafe keys,
cycles and invalid references fail before dispatch. Native context/signal
objects are explicit opaque capabilities, not JSON data.

The snapshot and individual references are frozen. Refreshes/selection changes
do not add records or retarget pending work. Processing is **sequential only**:
there is no concurrency, retry, resume, transaction or rollback option. One
active invocation per original grid, at most eight active grids per runtime;
another grid is independent within that bound. Scope/
generation/native-method changes stop further dispatch. A direct control
reference cannot prove that the same control is still displayed in a newly
navigated form: native lifetime/host verification remains separate.

Callbacks are trusted, not discovered or dynamically evaluated. `kind: "read"`
is a caller purity declaration, not enforced authorization. Mutation callbacks
are allowed only when explicitly declared `kind: "mutation"`; rejected
transport, invalid output/guard or changed scope after invocation yields
**uncertain**, not a promise that no write occurred. A fulfilled callback plus
validated JSON is caller-provided completion evidence, not independent server
verification. Do not label mutating work as read or retry uncertain writes.

Results must be bounded safe JSON, at most 256 KiB per value. The synchronous
type guard receives an isolated copy; false, async and mutating guards fail.
Undefined is not an implicit successful mutation receipt. Zero/false/null are
preserved when the guard accepts them. No raw callback exception text is
serialized; per-item diagnostic retains the original cause non-enumerably.

Every selected record has succeeded/failed/uncertain/skipped status. Counts
include requested, attempted, succeeded, failed, uncertain and skipped;
attempted counts actual callback calls, while a pre-dispatch context failure
can produce a failed item without a callback attempt. stopReason distinguishes
failure, cancelled, resultLimit, scopeChanged and contextError. A partial
result is never complete. Result-byte exhaustion stops new work; it cannot
undo a mutation already invoked. Cancellation stops future dispatch and does
not abort/roll back native work in flight; confirmed results remain confirmed.

## Own one subgrid load handler

```ts
import { Commands, Context, Grids } from "vbd-model-driven-toolkit";
import type { GridLoadHandler } from "vbd-model-driven-toolkit";

// Obtain subgrid using getFormContext().getControl("Contacts")
// inside the consumer's supported form OnLoad handler.
declare const subgrid: unknown;
const refreshCommands: GridLoadHandler = executionContext => {
  Commands.refresh(Context.fromFormEvent(executionContext));
};
const token = Grids.registerOnLoad(subgrid, refreshCommands);
// Reusing the same control/function returns this original token.
// Dispose only when the consumer ends its registration lifecycle.
token.dispose();
```

Require documented native getGrid/getGridType/addOnLoad/removeOnLoad.
getGridType must be **2 (Subgrid)**; 1 means HomePageGrid, not read-only versus
editable. Current Microsoft Learn documents addOnLoad on **both read-only and
editable subgrids**. This does not certify every grid implementation/version.
No DOM or hidden grid-type inference is used.

The SDK passes execution context as the first handler argument; getEventSource
must return the original subgrid. Reject foreign sources or changed native
identity. Preserve native method receivers. Handlers must be synchronous and
return undefined; throw normalized errors on exceptions, valued/async returns
or recursive dispatch. Invalid async returns are observed only to avoid
unhandled rejections; they are never treated as successful handlers.

At most 100 owned registrations per control, independent of foreign handlers.
Deduplicate original function identity only; disposal removes only its owned
wrapper with the captured original remover, never all listeners. Disposed
wrappers are inert even when an old native event pipeline retained them.
Native removal failure leaves the token active for deliberate cleanup retry.

If native addition fails after possible side effects, attempt owned cleanup.
When cleanup also fails, throw PARTIAL_FAILURE retaining both causes and the
original Disposable in `error.cause.disposable`. Block false registration reuse
and caller callbacks until cleanup succeeds. Keep that recovery token and
invoke its dispose deliberately after diagnosis; no automatic mutation retry
or claim of rollback is made.

## Verification boundary and references

Focused synthetic native fixtures and compiled browser/consumer checks are
source evidence, not signed-in model-driven UI, all-client/role coverage or
live business-write certification. No deployment or native writes accompany
this source slice.

- [Subgrid addOnLoad](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/grids/gridcontrol/addonload)
- [Grid type values](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/grids/gridcontrol/getgridtype)
- [Documented event sources](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/executioncontext/geteventsource)
