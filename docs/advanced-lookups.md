# Advanced lookups: bounded R2 source subset

Only `Lookups.addView`, `Lookups.bindDependent`, and `Lookups.validateSelection`
are added here. Existing Lookups and Choices contracts are unchanged. These are
pro-code calls, not JSON-configurable workflows. Use actual supplied native form
contexts or `Context.fromFormEvent(executionContext)` /
`Context.fromFormCommand(primaryControl)`; do not construct SDK objects in
production. Root package/browser type wiring belongs to the integration lane.

## addView

```ts
Lookups.addView(
  input: unknown, controlName: string, options: LookupViewOptions
): LookupViewReceipt
```

Required options:

```ts
{
  lookupKind: "standard";
  ownerLookup: false;
  identityPolicy: "caller-unique";
  viewId: string;                  // GUID, normalized
  entityType: string;              // allowed native lookup target
  displayName: string;             // nonblank, 1..256 characters
  tableTypeCode: number;           // actual table object type code, not guessed
  primaryIdColumn: string;         // actual metadata primary ID column
  primaryNameColumn: string;       // actual, distinct primary name column
  fetchXml: string;
  layoutXml: string;
  isDefault: boolean;
}
```

The explicit kind/owner declarations are trusted caller assertions, not a way
to override native limitations. Native `getControlType()` must be `lookup`,
the bound loaded attribute must be a non-party-list lookup, and the target
must be in `getEntityTypes()`. `ownerid` is also rejected. There is no supported
general native owner-lookup classifier: callers must not declare another owner
lookup as standard. Unsupported/custom controls fail before mutation.

### Exact XML subset

All XML goes through the shared `checkedXml` validator/parser. Layout is checked
inside a temporary `<fetch>` wrapper and validated as **exactly one grid**;
the wrapper is never sent to the SDK. No second general XML parser is used.
Each checked document is limited to 262,144 UTF-8 bytes (layout includes that
15-byte wrapper). Logical names are the shared 1..128-character identifier
grammar. XML declarations, PI, DTD, entities other than built-in/numeric XML
references, comments, CDATA, namespaces, non-whitespace text, unknown elements
and unknown attributes are rejected. Numeric references must encode legal XML
characters.

* Fetch root requires exactly `version="1.0" output-format="xml-platform"
  mapping="logical" distinct="false"`.
* Exactly one `entity name="..."`, equal to normalized `entityType`.
  Exactly 1..50 unique `<attribute name="..."/>` entries, including the primary ID.
* Optional 1..5 unique `<order attribute="..." descending="true|false"/>`.
* Optional one flat `<filter type="and|or">` with 1..50 conditions.
  Only `eq`/`ne` with a required `value` of at most 2,048 characters, and
  `null`/`not-null` without `value`. No nested filters or joins.
* Layout requires `<grid name="resultset" object="..." jump="..."
  select="1" icon="1" preview="1">`. Object is a canonical positive decimal
  Int32 equal to `tableTypeCode`; jump equals `primaryNameColumn`.
* Exactly one `<row name="result" id="...">`, ID equal to
  `primaryIdColumn`, containing 1..20 unique `<cell name="..." width="..."/>`.
  Widths are canonical decimal integers 1..1,000; total width at most 10,000.
  The primary-name cell is required.
* Every cell, order and condition column must appear in FetchXML attributes.
  No aliases, aggregates, links, paging, all-attributes, icon-provider callbacks,
  nested layouts or other native FetchXML/layout features are supported here.

No values are interpolated by the implementation. Authors assembling their
own XML must use `Utils.escapeXml` for every interpolated value.

Example (account schema is illustrative; verify the actual metadata contract):

```ts
const viewId = crypto.randomUUID(); // retain this per control; don't regenerate on every call
const receipt = VBD.Lookups.addView(formContext, "childaccountid", {
  lookupKind: "standard", ownerLookup: false, identityPolicy: "caller-unique",
  viewId, entityType: "account", displayName: "Accounts", tableTypeCode: 1,
  primaryIdColumn: "accountid", primaryNameColumn: "name", isDefault: false,
  fetchXml: '<fetch version="1.0" output-format="xml-platform" mapping="logical" distinct="false"><entity name="account"><attribute name="accountid"/><attribute name="name"/></entity></fetch>',
  layoutXml: '<grid name="resultset" object="1" jump="name" select="1" icon="1" preview="1"><row name="result" id="accountid"><cell name="name" width="200"/></row></grid>'
});
// {status:"requested", viewId, entityType:"account", removable:false}
```

At most 32 view identities per actual control, including uncertain requests.
Exactly repeated normalized options return a fresh frozen `status:"existing"`
receipt without native dispatch; different options for an owned ID conflict.
XML identity is lexical, not semantic. A changed form/bound attribute cannot
reuse that owned ID. The current native default ID is rejected on a first call.
Native APIs do **not** enumerate all available/foreign view IDs, so
`caller-unique` explicitly makes the caller responsible for all other collisions.
Native throws leave the ID reserved and throw `MUTATION_OUTCOME_UNKNOWN` with the
original cause; never retry the ID assuming no effect.

Only `addCustomView(viewId, entityType, displayName, fetchXml, layoutXml,
isDefault)` mutates the control, with its native receiver preserved. A receipt
means a request returned, not that the host rendered the view or verified its
schema against server metadata. **There is no supported removeCustomView API
and no Disposable or rollback guarantee.** Reloading/replacing the native form
control is the host lifecycle boundary; do not invent a removal method.

## bindDependent

```ts
Lookups.bindDependent(
  input: unknown, options: DependentLookupOptions
): DependentLookupBinding
```

Options are strict, all required except `context`:

```ts
{
  parentColumn: string; parentTables: readonly string[];
  childControl: string; entityType: string;
  lookupKind: "standard"; ownerLookup: false;
  selectionOnInvalidate: "clear" | "retain-invalid";
  emptyParent: "not-ready";
  prepare(parent: readonly EntityRef[]): string | PromiseLike<string>;
  onError(failure: {error: VbdError; scope: string}): void;
  context?: ReadContext;
}
```

The parent is a loaded non-party-list lookup with zero or one normalized unique
reference in the declared tables. The child uses the same native control/owner
restrictions as addView. A main-form-like native surface with data OnLoad,
record identity methods and `ui.formSelector.getCurrentItem()` is required
(a legitimate null current item is supported). `prepare` receives isolated copied refs; its string
must be the same flat filter subset described above, with at least one
condition. The toolkit never fetches business records or builds filters from
unescaped values on the caller's behalf.

```ts
const binding = VBD.Lookups.bindDependent(
  VBD.Context.fromFormEvent(executionContext), {
    parentColumn: "parentaccountid", parentTables: ["account"],
    childControl: "childaccountid", entityType: "account",
    lookupKind: "standard", ownerLookup: false,
    selectionOnInvalidate: "retain-invalid", emptyParent: "not-ready",
    prepare: async refs => {
      // Resolve any trusted async dependencies HERE, never in PreSearch.
      const parent = refs[0]!;
      return `<filter type="and"><condition attribute="parentaccountid" operator="eq" value="${VBD.Utils.escapeXml(parent.id)}"/></filter>`;
    },
    onError: ({error, scope}) => {
      reportLookupFailure(error, scope); // application-owned synchronous diagnostic/notification sink
    }
  }
);
const ready = await binding.readiness;
// {status:"ready", parent:[{entityType:"account",id:"...",name?:"..."}],
//  selection:"retained-unvalidated"}
binding.dispose(); // application-owned teardown; removes only these three handlers
```

The binding is a frozen opaque `Disposable`, plus:

* `state`: copied state, checking current identity/scope and ready parent drift.
* `readiness`: current promise, **resolves** to ready/not-ready/failed, never
  rejects as background error handling. Capture it to observe a particular run.
* `refresh()`: explicit invalidation/preparation, returns that run's readiness.
* `dispose()`: `{removed:true}`, then `{removed:false}`. Copied/fabricated
  bindings cannot invoke lifecycle methods.

State shapes:

```ts
{status:"ready", parent: EntityRef[], selection}
{status:"not-ready", reason:"preparing"|"parent-empty"|"superseded"|"disposed", selection}
{status:"failed", error: VbdError, scope: string, selection}
// selection: "retained-unvalidated" | "cleared" | "unknown"
```

`selection` describes the last invalidation treatment, not validation of a later
user selection. Clear happens initially and on each change/load/refresh only
with explicit `"clear"` consent, by `setValue(null)` and readback. A failing or
ignored clear reports unknown, not rollback. Retain never drops current refs:
they remain **unvalidated** during preparation, parent-empty and failure states.
No save, submit-mode change or `fireOnChange` is implicit.

One owned parent OnChange, data OnLoad, and child PreSearch handler are installed.
All native handlers return synchronously. A search before readiness calls
`onError` and throws `CONFIG_NOT_READY`, with no native filter; an existing
preparation may still finish. Other callback/native errors remain observable in
failed readiness and/or the synchronous search exception. Native PreSearch has
no supported await/cancel contract: **throwing/reporting not-ready is not a
promise that native search results are blocked. This is UX filtering, never
authorization or server validation.** Makers must coordinate availability with
their own readiness UX, and enforce business rules server-side.

Parent changes (even observed A-B-A), data loads, refresh, disposal, reference
replacement, record/form identity, online environment/user/language scope and
Environment invalidation generation invalidate pending work. Checks run around
awaits and immediately before applying a filter. Old runs cannot overwrite new
state or install a filter; their own readiness retains errors and the required
sink receives late failures with the **original** scope. An undelivered
A-B-A sequence between observations is inherently undetectable. Fire the actual
parent event or call `refresh()` for every programmatic invalidation. Generic
Cache invalidation and external source changes are not auto-subscribed.
Form/record/scope replacement requires disposal/rebinding, not adoption of a new
context by the old handle.

`onError` must be synchronous diagnostic-only code, not a reentrant lifecycle
callback. Sink throws/async outputs are retained as `ERROR_PRESENTATION_FAILED`
with both original error and sink failure. Callback rejection and simultaneous
scope failure retain both pieces of evidence, never turn into an empty filter.
No timer, DOM, parent frame or fabricated native context is used.

Exactly repeated contracts coalesce by actual callbacks/context/native refs,
not JSON-serialized functions. A different contract for an owned child conflicts.
Self-dependencies, owned cycles and synchronous reentry are rejected. Foreign
libraries' dependency graphs are not introspectable; callers must avoid those
cycles too. Limits: 100 bindings per form, eight pending preparations per
binding, 64 page-local pending preparations; pending counts remain reserved
until callbacks drain, including after disposal.

Cleanup attempts all owned removers even after one fails, and permits retrying
`dispose()` for only the failed removers. Failure after partial installation
throws `PARTIAL_FAILURE`; `error.cause.binding` is the retained opaque cleanup
handle if cleanup itself failed. No native rollback is claimed.

## validateSelection

```ts
Lookups.validateSelection(
  refs: readonly EntityRef[], options: LookupSelectionOptions
): Promise<LookupSelectionResult>
```

Strict options:

```ts
{
  allowedTables: readonly string[];     // 1..100 unique normalized logical names
  cardinality: {min: number; max: number}; // 0 <= min <= max <= 100; max >= 1
  empty: "valid" | "invalid";          // only used when cardinality permits zero
  predicate:
    | {mode:"sync"; test(ref:EntityRef):boolean}
    | {mode:"async"; test(ref:EntityRef):boolean|PromiseLike<boolean>};
  access:
    | {policy:"not-checked"}
    | {policy:"required"; mode:"sync"; check(ref:EntityRef):LookupAccessEvidence}
    | {policy:"required"; mode:"async";
       check(ref:EntityRef):LookupAccessEvidence|PromiseLike<LookupAccessEvidence>};
  context?: ReadContext;
  concurrency?: number;               // 1..8, default 4
}
// LookupAccessEvidence:
// {ref:EntityRef, status:"granted"|"denied"|"unknown", basis:"caller-evidence"}
```

Input is at most 100 unique normalized refs and 262,144 copied JSON UTF-8 bytes,
with shared logical-name/GUID/name limits. Duplicates are rejected, not silently
deduplicated. Unknown properties, accessors and malformed refs are errors.
Exact target and cardinality failures return invalid without calling predicates
or evidence adapters. Empty returns only the explicitly declared policy.

```ts
const result = await VBD.Lookups.validateSelection(selectedRefs, {
  allowedTables: ["account"], cardinality: {min: 0, max: 1}, empty: "invalid",
  predicate: {mode: "sync", test: ref => approvedIds.has(ref.id)},
  access: {policy: "not-checked"}
});
// {status:"valid", reason:"validated", basis:"trusted-caller-checks",
//  records:[{ref:{entityType:"account",id:"...",name?:"..."},
//            predicate:"passed",access:"not-checked"}]}
```

Results have status `valid|invalid|unknown`, reason
`validated|empty|cardinality|target|predicate|access-unknown`,
`basis:"trusted-caller-checks"`, and copied `records` containing `ref`,
`predicate:"passed"|"failed"|"not-run"` and
`access:"granted"|"unknown"|"not-checked"`.
Unknown access takes precedence over predicate false; the per-item false remains
visible. False is an ordinary invalid result, not a thrown callback failure.
Denied evidence throws `ACCESS_DENIED` with that evidence, not invalid/unknown.
Required evidence must fully describe exactly the requested ref; a partial,
array, duplicated-for-another-ref, mismatched or malformed response is rejected.

All predicates and access adapters are trusted application code, not a sandbox.
Type predicates are accepted as boolean predicates; no unchecked generic output
is exposed. Async mode actually awaits and validates outputs; sync mode rejects
and observes accidental thenables, including rejecting promises. Refs, callback
arguments, evidence and results are isolated copies. Throw/reject is an error,
not false. Existing `VbdError` identity is preserved outside shared synchronous
predicate-guard wrapping (which retains the original as its cause); explicit 401/403 or native
`0x80040220` evidence becomes `ACCESS_DENIED`, other read failures retain their
cause as `DATA_READ_FAILED`. Invalid sync guards use the shared
`CONFIG_VALUE_INVALID` contract; malformed async/evidence output is an argument
or response error. Scope changes throw `CONFIG_EXPIRED`, retaining concurrent
callback failures too.

At most eight validation runs, each with 1..8 workers. Started callbacks drain
before failure is returned/capacity released; no later items start after an
observed failure. Scope/generation guards surround callbacks/awaits and final
results. These helpers never retrieve records themselves or infer effective
current-record permissions. `"granted"` is caller-provided evidence, **not an
authorization claim**, and `"not-checked"` remains expressly unchecked.

## Native basis, verification and rollback

Official supported API references:

* [addCustomView: lookup-only, owner exclusion, view-ID uniqueness](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/addcustomview)
* [View layout grid/row/cell example](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/customize-entity-views)
* [addPreSearch: supplied execution context](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/addpresearch)
* [addCustomFilter: PreSearch only, filters combined with AND](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/addcustomfilter)

Local tests use supplied in-memory native fixtures with receiver assertions.
They are not native-client, permission, rendered/input or tenant certification.
AXIOM/CANVAS: wire explicit supplied contexts, readiness UX, diagnostic sink and
teardown; verify actual schema, lookup kinds and server-side validation.
SENTINEL: verify rendered views, keyboard lookup behavior, actual PreSearch timing
and role-based outcomes only in a separately authorized native-client lane.
No tenant auth/data operations or deployment are part of this source change.

Rollback is incremental: remove this source commit and rebuild the parent
bundle; dispose live dependency bindings first. Already requested custom views
cannot be removed through a supported API; reconcile via native form lifecycle.
No environment/deployed state is changed by the implementation or local tests.
