# Core interaction, form, and data usage

The 0.3.0 source adds 97 catalog functions: 118 of 198 are implemented across
24 namespaces. These are bounded source contracts, not certification of every
SDK feature, client, tenant, form, or permission configuration.
No live deployment or managed/unmanaged package is part of this milestone.

All methods are under global `VBD` in the browser bundle, or available through
`import * as VBD from "vbd-model-driven-toolkit"` in a configured local workspace.
The [catalog](function-catalog.md) is the authoritative method inventory.

## Context and references

Use the correct adapter, not Xrm.Page or an assumed global form:

- Context.fromFormEvent(executionContext) for form events with pass-context enabled.
- Context.fromFormCommand(PrimaryControl) for form ribbon commands.
- Context.fromGridCommand(SelectedControl, references?, entityType?) for grids.
  References accept canonical id/entityType or CRM Id/TypeName shapes. IDs alone
  need an explicit table or supported getEntityName. Conflicting shapes and
  duplicates fail.
- Context.getRecord reports saved, unsaved, or none; create/bulk/undefined forms
  never become a guessed persisted record. requireSavedRecord enforces this.
- Context.getSelection returns an independent snapshot, not all view rows.
- Context.getClient/getApp/getUser use supported current metadata. Missing role
  information is explicitly unavailable, not proof of no roles/access.
- Context.requireCapability checks the requested supported surface. It does not
  certify permissions, licensing, or every option on every native control.

EntityRef contains normalized entityType/id and optional name. Utils provides
GUID checks, reference construction, literal XML/OData escaping, invariant finite
number parsing and explicit typed comparisons. Date instants are preserved;
string dates/localized numbers are not silently coerced. Reference/choice arrays
compare as multisets; null has no relational order. Arbitrary objects are not
generic expression operands.

## Navigation and dialogs

| API group | Current contract |
| --- | --- |
| Navigation.openRecord(ref, options?) | Inline by default or mode=dialog; optional form/tab/default parameters. |
| Navigation.newRecord(table, options?) | Opens a create form, not a persisted database record. |
| Navigation.quickCreate(table, {formId?,data?}) | Resolves only on the documented Quick Create saved-reference callback. Cancellation may not settle that SDK callback. |
| Navigation.openView(table, {viewId?,viewType?}) | Inline list only; a view type requires its ID. |
| Navigation.openDashboard(id) | Inline dashboard request. |
| Navigation.openCustomPage(name, options?) | Supported entityName/recordId only; GUID recordId requires its table. |
| Navigation.openWebResource(name, options?) | Reviewed HTML resource name and explicit string data. No parent DOM access. |
| Navigation.openUrl({url,allowedOrigins,allowedQueryKeys?,width?,height?}) | Explicit approved HTTPS URL; no credentials, fragments, unapproved query keys or undocumented host options. |
| Dialogs.record/customPage/webResource | Typed dialog wrappers; position center/side and percent/pixel sizes. They do not prove a save. |
| Dialogs.alert/confirm/error | Native dialogs; confirmation returns confirmed/cancelled. Error dialogs use safe code/correlation details, not native messages/causes. |

Modal completion means closed; inline completion means the navigation API
completed, not that record content or access was independently verified.
Record new-window mode is deliberately not implemented here: it is not simulated
with unsupported URLs or a main-form Quick Create callback.
App windows use the separately documented [prepared launch path](environment-launching.md).

## Field and control behavior

Fields.get(formOrContext, column, expectedKind?) supports text, number, boolean,
date, lookup and choices, with explicit typed overloads. Missing attributes fail;
legitimate null/false/zero remain distinct. Dates, choices and lookup references
are copied so caller mutation cannot change native state without a setter.

Fields.set/clear/copy/setDefault never auto-save or fire OnChange by default.
Write options are fireOnChange and submitMode. Copy snapshots sources before
writing, validates all targets, rejects duplicate destinations, and preserves
existing non-null targets unless overwrite=true. Defaults preserve false/zero
and intentional empty strings unless emptyString=true. Invalid configuration
still fails even when a policy would otherwise skip a write.

Fields.setRequired and setSubmitMode use native explicit levels/modes.
fireOnChange protects owned reentry. getLookup/setLookup preserve cardinality,
validate logical targets where the host exposes them, require display labels
for writes, and use the native party-list flag for multiple values. No display
name or relationship metadata is guessed/fetched implicitly.

Controls.setVisible/setDisabled/setLabel default to all bound controls, including
headers/process controls. Use scope=control for one named control. setFocus
rejects hidden/disabled inputs. forAttribute passes a checked BoundControl to a
trusted typed callback and returns its results; caller-supplied async work remains
the caller's responsibility.

Group changes preflight targets and expose PARTIAL_FAILURE if native calls fail
after earlier steps. No rollback is implied. Client locking/required levels are
UX helpers, not field-level security or a replacement for server validation.

Forms.save awaits the native save and guards reentry. saveMode describes event
intent; it does not itself close/navigate. Forms.refresh rejects dirty forms by
default; dirtyPolicy=save is explicit and rechecks edits before refreshing.
isDirty/getType report native state. Form notifications use a vbd_toolkit_ prefix
and clear only their owned ID, including an explicit false result if absent.
Layout methods operate named tabs/sections through supported APIs, never DOM.

## Lookups and owned events

Lookups.pick requires allowed entityTypes, preserves selected references and
returns selected/cancelled. Missing/empty native results mean cancellation;
permissions and malformed responses remain errors.

Lookups.addFilter(form,control,xml,entity?) validates the filter root,
well-formed XML, UTF-8 size and XML characters. DTD/custom entity declarations are forbidden.
Only an owned synchronous PreSearch handler calls addCustomFilter; there are
no asynchronous reads in that callback. Identical registrations are idempotent.
removeFilter/dispose remove only the owned handler. This does not certify every
server operator/column or specialized owner-lookup behavior.
setDefaultView/setEntityTypes use supported native capabilities.
Choices.getOptions returns numeric values/localized labels, not new metadata.

Events.register(form,{event,column?},handler) supports change, save and data-load
events with owned deduplication/disposal. Column is required only for change.
load means data.addOnLoad, not an invented UI lifecycle. Trusted callbacks are
actual functions, never names evaluated from JSON. Callers own native async-event
settings; registering a function does not enable them.

Validation.evaluate uses at most 200 allowlisted required/range/length/equals/
format rules. Formats are simple email shape, HTTPS URL and GUID, not arbitrary
regex. Optional empty values skip non-required checks; false/zero are present.
validateFields reads at most 100 unique loaded fields and shows a form-level
first issue/count while returning all issues. Messages never include values
unless the trusted caller deliberately configured that text.

Validation.validateBeforeSave and Events.onSave(executionContext,rules,options?)
run synchronous local validation and prevent invalid saves before returning.
Rules can be a typed array or at most 256 KiB JSON. Unknown errors also prevent
the save before propagating. This refines a previously proposed unshipped
recipe-key signature; there is no async validator/workflow engine in this path.

## Prepared-profile form/ribbon entry points

Schema version 1 remains app-profile-only. Register once during reviewed
bootstrap, normally using configuration.id as the registry name:

```javascript
VBD.Config.register(configuration.id, configuration);
```

Configure native entry points with the same `registryName/profileKey` string:

| Surface | Function | Parameters |
| --- | --- | --- |
| Form OnLoad | VBD.Events.onLoad | ExecutionContext, registryName/profileKey |
| Explicit reprepare on change | VBD.Events.onChange | ExecutionContext, same key |
| Form command | VBD.Commands.run | PrimaryControl, same key |
| Grid command | VBD.Commands.runGrid | SelectedControl, selected references/IDs, same key, optional table |
| Synchronous save rules | VBD.Events.onSave | ExecutionContext, reviewed JSON rules |

OnLoad/OnChange return prepared/superseded/failed. A returned promise does not
enable Power Apps' async OnLoad setting. Early clicks fail visibly rather than
opening a delayed popup. Commands.run/runGrid present a safe error once and
return a discriminated failed outcome; error-presentation failure rejects with
both causes retained. Commands.execute is the typed throwing core, not a
general arbitrary operation runner. No await occurs before a prepared window
request. Configuration replacement/scope/TTL/invalidation rules still apply.

Commands.refresh targets the appropriate native ribbon. validateSelection returns
explicit issues for count/table/duplicates. Grids.getSelected/refresh/openSelected
use a supported supplied grid; openSelected requires exactly one row.
Other configured operations/recipes, Power Fx visibility and classic enable
rules are not made interchangeable by these adapters.

UI.showProgress/hideProgress/withProgress own overlapping VBD tokens on the
shared native progress surface. They cannot coordinate an unrelated library
that calls the native global spinner directly. withProgress retains operation
and cleanup errors; a cleanup-failure cause contains its token for explicit retry.
UI.notify/clearNotification use official global notification levels and returned
owned IDs. Auto-dismiss/background actions are deliberately unsupported here.

## Data, queries and operation contracts

All data methods use current online SDK identity or an explicit typed DataContext.
No cross-environment authentication, automatic mutation retry, secret endpoint, or live
tenant fixture is supplied.

- Data.retrieve(ref,columns,client?) and retrieveMany(table,options,client?)
  return bounded records/pages, not unchecked caller-generic types.
- Data.create/update require allowedFields and explicitly supplied scalar JSON.
  No inferred relationships/deep inserts/system response payloads. Date values
  should be explicit supported server strings, not locale-dependent coercions.
- Data.update etag requires an atomic conditional adapter; native updateRecord
  cannot accept a header, so conditional writes are rejected before dispatch.
- Data.delete requires policy=confirm-delete and confirmation of the exact ref.
- Data.exists requires explicit entitySet/select/filter and returns false only
  for actual no-match, never a denied/invalid/transport failure.
- Data.retrieveRelated requires explicit navigation/cardinality/rootColumns/
  columns/maximum. Expanded continuation is not replayed through guessed routes;
  incomplete results state limit/unsupportedContinuation.

Query.executeOData uses explicit entitySet and columns. Lookup shadow properties
such as _ownerid_value are allowed only for read select/order/filter policy;
tables, FetchXML attributes and writes use logical names. Raw advanced filters
are deliberate strings; buildFilter instead uses column/type/operator allowlists.

Query.executeFetchXml supports a selected/ordered single root entity and scalar
filters. Joins, aggregates, simple paging without supported cookies and general
FetchXML NOT/contains are explicitly rejected, not silently approximated.
iteratePages/retrieveAll require limits; continuation tokens are opaque and
scope-bound. Complete/maxPages/maxRecords/cancelled are explicit outcomes.
Cancellation stops subsequent dispatch, not an SDK request already in flight.

Actions.executeAction/executeFunction require explicit OperationContract metadata
for operation/parameters/binding and an empty/status or validated JSON response.
Response validators may be asynchronous with flattened typed results and a final
scope check. Parameter validators return synchronous proven JSON; invalid
thenables are safely rejected before dispatch. No metadata is guessed from values.
Actions/functions do not become anonymous flow calls or a workflow dependency.

Writes/actions can reach the server before a transport/scope/validation failure.
MUTATION_OUTCOME_UNKNOWN is not rollback and must not trigger blind retry.
Permissions, server business rules and specialized close/resolve operations
remain authoritative.

## Exact source bounds

| Area | Limit |
| --- | --- |
| Field/control operations | 100 resolved targets; validation at most 100 unique native fields |
| Selection/collection | 1000 items; no inferred selection of all rows |
| Rules/messages | 200 rules; 8192 display characters; no arbitrary regex/expressions |
| XML | 256 KiB UTF-8, strict root/characters, no DTD/entities |
| Data pages | 1-5000 rows; 1-100 pages and 1-100000 total records, explicit limits |
| Structured filters | Depth 8, 100 nodes, 100 IN values, 64 KiB generated output |
| OData | Raw filter 65536 characters, 100 orders, 10 expands with top at most 100, encoded input at most 262144 characters |
| Related rows | 1-1000, with extra-record truncation probe |
| JSON | 256 KiB UTF-8, depth 8, 10000 nodes, 65536-character strings, arrays 1000, objects 512 keys / writes 100 |
| Operations | 100 parameters; collection 1000; ETag token content 128 characters |

Every caller-supplied SDK context, callback, and operation validator is trusted
application code. It is not executed from untrusted JSON. Native server access,
actual form layouts, async app settings, all browsers/mobile/offline variants,
and tenant/solution deployment remain unverified unless separately evidenced.
