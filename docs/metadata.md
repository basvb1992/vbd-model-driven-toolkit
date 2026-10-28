# R2 Metadata: usage, contracts and verification evidence

Implements only the five Metadata catalog operations for #19. Source entry:
`src/metadata.ts`. Parent integration owns the root/browser exports, availability
counts, descriptors and version; this lane does not change those files.
No tenant authentication, live metadata calls, business-record reads, writes,
deployment or publication were used for verification.

## Runtime contract

The sole runtime export is the frozen `Metadata` object, intended for
`VBD.Metadata` integration:

```ts
Metadata.getTable(table: string, options?: MetadataTableOptions): Promise<TableMetadata>
Metadata.getColumn(table: string, column: string, options?: MetadataColumnOptions): Promise<ColumnMetadata>
Metadata.getChoices(table: string, column: string, options?: MetadataChoiceOptions): Promise<ChoiceMetadata>
Metadata.getRelationships(table: string, options: MetadataRelationshipOptions): Promise<RelationshipMetadata>
Metadata.invalidate(options?: MetadataInvalidation): number
```

Identifiers are exact, not labels: lowercase table/column logical names,
case-preserving entity-set, schema and navigation names. Identifier syntax is
ASCII letter followed by up to 127 letters/digits/underscores; unsafe
`constructor`, `prototype`, `__proto__` names are rejected. No pluralization,
label lookup, entity-set guessing, role-name inference or privilege interpretation.
Only online, current-user/current-environment metadata is in scope.

```ts
// Source entry until the parent wires VBD.Metadata.
import { Metadata } from "../src/metadata.js";

const table = await Metadata.getTable("account", {
  properties: ["PrimaryIdAttribute", "IsOptimisticConcurrencyEnabled"]
});
const column = await Metadata.getColumn("account", "name", {
  properties: ["DisplayName"]
});
// Use table.EntitySetName and column.LogicalName, never their display labels.
Metadata.invalidate({ table: "account" }); // refresh this source/current scope
```

Every call returns an isolated safe JSON copy. Output property presence matters:
requested facts must be present; `false`, `0`, `""` (display text) and explicitly
nullable facts are not replaced with truthiness defaults. No Dates, functions,
accessors, cycles, unsafe keys, raw SDK objects, credentials or service dumps
are returned. Unknown adapter properties are rejected, not forwarded.
Native responses are projected onto selected own data properties; unselected
SDK methods/privileges/data are never copied. Errors retain no raw service cause.

## Native supported subset — not a general metadata Web API client

Without `options.context`, table/column reads bind the supported
`Xrm.Utility.getEntityMetadata(table, columns)` receiver. Scope is obtained from
the supported global context, client URL/state and user ID/UI language. No
`Xrm.WebApi` business-record capability is required.

* **getTable:** always `LogicalName`, `EntitySetName`; optional explicit
  `properties`: `DisplayName`, `Description`, `PrimaryIdAttribute`,
  `PrimaryNameAttribute`, `PrimaryImageAttribute`, `IsCustomEntity`, `IsActivity`,
  `IsOptimisticConcurrencyEnabled`, `ObjectTypeCode`.
  Calls native metadata with `columns: []`.
* **getColumn:** always `EntityLogicalName`, `LogicalName`, numeric SDK
  `AttributeType` (0–20). Optional native properties: `DisplayName` and, **only
  for Boolean/0**, `DefaultFormValue`. Requests exactly `[column]`; accepts the
  documented collection through receiver-bound `get()` or a returned array.
  Exactly one matching column is required. This is not form attribute metadata.
* **getChoices:** requires an adapter. Learn documents native `OptionSet` as
  key:value pairs, without an LCID-addressable localized-label contract or
  sufficiently precise cross-type option shapes. This implementation deliberately
  does not infer a key's meaning, infer multi-select from Virtual/17, or assign a
  guessed language to native labels.
* **getRelationships:** requires an adapter. The native API does not document
  relationship collections or navigation properties.

Native display strings are whatever language the host supplies for the current
UI user; these APIs cannot request another language for table/column display
text, and do not claim those strings have a verified label LCID. Choice-language
selection is available only through the explicit adapter below. Native extended
column-property requests fail `UNSUPPORTED_SURFACE` before dispatch.
Missing or malformed native requested data fails, never empty-success.

## Typed read-only adapter boundary

`MetadataContext` has receiver-bound `getScope()` and optional read-only methods:

```ts
getScope(): Readonly<ReadScope>
getTable?(table: string, properties: readonly MetadataTableProperty[]):
  Promise<MetadataRead<TableMetadata>>
getColumn?(table: string, column: string, properties: readonly MetadataColumnProperty[]):
  Promise<MetadataRead<ColumnMetadata>>
getChoices?(table: string, column: string, languageId: number, fallbackLanguageId?: number):
  Promise<MetadataRead<MetadataChoiceSource>>
getRelationships?(table: string, selection: Readonly<MetadataRelationshipSelection>):
  Promise<MetadataRead<MetadataRelationship[]>>
```

`MetadataRead<T>` is `{ scope: Readonly<ReadScope>; complete: boolean;
metadata: T | null }`. Scope contains `environmentUrl`, `userId`, `languageId`
(UI LCID), `online`. URL origin and GUID are normalized and compared to the
captured current scope. Adapters must attest the actual read scope and
completeness, not substitute defaults for unknown fields or partial pages.
`null` with `complete: true` means established absence. `complete: false` is
unsupported/inconclusive, not absence.

The adapter contract is a bounded **normalized projection**, not a raw Web API
response. An integrator must use supported, current-user metadata reads and map
only verified selected facts. It must not impersonate an admin, export the
environment, read business records, access credentials, or infer access from
metadata. This lane supplies no transport, authentication or URL execution hook.
FORGE/parent owns any concrete adapter/schema mapping; no AXIOM/CANVAS maker
configuration is necessary for the native subset.

Additional adapter column properties:

| Property | Contract / applicable numeric SDK types |
| --- | --- |
| `Targets` | 1–32 unique logical names; Customer/1, Lookup/6, Owner/9 only |
| `MaxLength` | nonnegative integer or null; Memo/7, String/14 only |
| `MinValue`, `MaxValue` | finite number or null; Decimal/2, Double/3, Integer/5, Money/8, BigInt/18; ordered when both numeric |
| `Precision` | integer 0–10 or null; Decimal/2, Double/3, Money/8 |
| `RequiredLevel` | `None`, `SystemRequired`, `ApplicationRequired`, `Recommended`; normalize the documented managed property's `Value` |
| `IsValidForRead`, `IsValidForCreate`, `IsValidForUpdate` | Boolean or null |

`PrimaryNameAttribute` and `PrimaryImageAttribute` may explicitly be null;
identity strings cannot be empty. Table/column defaults request identities/type
only. Requested property lists must be known, unique and bounded (9/11).
Unrequested known facts may be supplied by an adapter but are not returned;
inconsistent supplied facts still fail validation.

### Choices

`MetadataChoiceSource` contains exact `EntityLogicalName`, `LogicalName`,
`AttributeType`, `kind` and `Options: { Value; Labels: { LanguageCode; Label }[] }[]`.
Supported kind/type pairs are `boolean/0`, `picklist/11`, `multiselect/17`,
`state/12`, `status/13`. Multi-select requires the adapter's explicit supported
type-cast evidence; Virtual/17 alone is not proof. For Boolean, normalize
documented true/false options into exactly values 0 and 1. This API returns
value/label identities only, not status transitions, state links or global-choice
set identities. Choice values are unique signed 32-bit integers; labels need
not be unique and may be empty strings.

`MetadataChoiceOptions` adds `languageId?: number` and
`fallbackLanguageId?: number`. LCIDs are integers 1–65535. Default requested
language is the captured UI language. No fallback is applied unless an
alternative, different LCID is explicitly supplied. Each option must have one
unambiguous matching requested label or the explicit fallback label. Missing
labels fail `UNSUPPORTED_SURFACE`; duplicated label LCIDs fail validation.
Output is `{ table, column, kind, languageId, choices }`, where each choice has
`{ value, label, languageId, isFallback }`. `languageId` on each choice is its
actual label language; the outer field remains the requested language.

```ts
// `context` is an integrator's verified MetadataContext, not a raw service object.
const choices = await Metadata.getChoices("account", "accountcategorycode", {
  context, languageId: 1043, fallbackLanguageId: 1033
});
```

Empty non-Boolean options are accepted only with explicit complete attestation.
No label is used as a stable identifier.

### Relationships

`MetadataRelationshipOptions` requires `kind`: `oneToMany`, `manyToOne` or
`manyToMany`, and optionally exact `schemaName` and referencing `column`.
The column filter is invalid for many-to-many. No implicit "all" expansion.
An adapter must return the entire filtered selection:

* 1:N / N:1: `SchemaName`, `ReferencedEntity`, `ReferencedAttribute`,
  `ReferencingEntity`, `ReferencingAttribute`,
  `ReferencedEntityNavigationPropertyName`,
  `ReferencingEntityNavigationPropertyName`, plus normalized `kind`.
  The requested table must be the referenced / referencing side respectively.
* N:N: `SchemaName`, `Entity1LogicalName`, `Entity2LogicalName`,
  `Entity1NavigationPropertyName`, `Entity2NavigationPropertyName`,
  `IntersectEntityName`, `Entity1IntersectAttribute`,
  `Entity2IntersectAttribute`, plus `kind`. The requested table must be a side.

Schema identities and table-side navigation identities must be unambiguous.
Self-references are allowed only with distinct navigation identities. Navigation,
schema and intersect names are not interchangeable. Output is
`{ table, kind, relationships }` with copied validated identities.
A complete empty unfiltered collection is legitimate; a missing exact schema
filter is `RESOURCE_NOT_FOUND`. Mismatched filters/shape/direction are errors.

## Cache and invalidation

Uses the existing shared in-memory `Cache`, without changing it:

* Fixed TTL **60,000 ms**, expires at equality; clock rollback reloads.
* Shared maximum **128 slots**, **64 active loads**, **1,048,576 bytes** total
  cached JSON. Metadata additionally limits its collision-free routing to
  **128 entries**; oldest routes are retired. Shared consumers may evict
  metadata sooner. No persistent/browser storage.
* Maximum **65,536 UTF-8 bytes** for an adapter envelope, selected native
  projection, normalized result and copied cache result. No partial/truncated
  "complete" result. JSON guard limits: 10,000 visited nodes, depth 8, arrays
  1,000 items (from the shared copier). Native projected objects: at most 128
  own keys; native requested-column collection at most 256 items and exactly
  one match. Choices: at most 256 options/16 labels each; relationships: 128;
  display text/labels: 1,024 characters. No unbounded paging.
* Cache keys distinguish **source object identity**, normalized environment,
  user, **UI language**, operation, table, column, requested properties, requested
  choice LCID and explicit fallback LCID. Equivalent property ordering coalesces.
  Reuse one context object for sharing and invalidation; a fresh adapter object
  intentionally does not share another adapter's cache.
* Concurrent identical reads coalesce. Each caller gets a fresh copy. Failures,
  unsupported/incomplete data, invalid responses and failed validation are never
  cached. Requested inputs are copied before dispatch; an adapter cannot mutate
  the catalog selection.
* Scope, shared environment generation, routing identity and invalidation are
  rechecked during pending reads, normalization, cache validation and return.
  Invalidated/evicted or changed-scope pending work cannot repopulate or return
  an old value. This does not cancel a request already dispatched to the host.

`invalidate({ context?, table?, column?, languageId? })` affects **only that
source and its current environment/user/UI-language scope**. Omitted context
selects the native source. Omitted selectors select all matching entries.
`column` requires `table`; it clears that column's metadata and choices **plus
all relationship selections for the requested table**, conservatively.
It does not clear unrelated column entries or table-only facts. A table
selection clears its table, columns, choices and relationships. A language
selection matches the requested choice LCID (UI LCID for non-choice reads),
not a per-option fallback LCID. Omit it for all requested languages.

Invalidation does not infer reverse dependencies in other tables, cross adapter
identities, cross user/environment/UI-language scopes, publish customizations,
or clear Microsoft's own SDK cache. After relationship changes invalidate both
participating tables explicitly, or omit `table` for all locally routed entries.
The count is actual shared entries removed, **including pending work**; already
evicted entries count zero. Shared `Cache.clear` and environment generation
invalidation also prevent stale metadata reuse.

## Errors and integration types

Uses existing `VbdError` codes only:
`INVALID_ARGUMENT`, `UNSUPPORTED_SURFACE`, `DATA_RESPONSE_INVALID`,
`CONFIG_AMBIGUOUS`, `RESOURCE_NOT_FOUND`, `ACCESS_DENIED`, `DATA_READ_FAILED`,
`LIMIT_EXCEEDED`, `CONFIG_EXPIRED` (and shared URL/scope validation errors).
401/403 and documented missing-privilege code `0x80040220` are denied; 404 or an
explicit complete null is absence; transport failures are read errors.
No failure becomes an empty collection or guessed metadata.

Parent integration type exports, all from `metadata.ts`:
`MetadataAttributeType`, `MetadataTableProperty`, `MetadataColumnProperty`,
`TableMetadata`, `ColumnMetadata`, `MetadataChoiceSource`, `ChoiceMetadata`,
`MetadataRelationshipKind`, `MetadataRelationship`, `RelationshipMetadata`,
`MetadataRelationshipSelection`, `MetadataRead`, `MetadataContext`,
`MetadataOptions`, `MetadataTableOptions`, `MetadataColumnOptions`,
`MetadataChoiceOptions`, `MetadataRelationshipOptions`, `MetadataInvalidation`.
`ReadScope` is reused from `platform.ts`, not re-exported by this module.

## Evidence and SENTINEL handoff

Official Microsoft Learn pages read on **2026-10-28** before implementation
(public documentation only, no tenant connections):

* [getEntityMetadata](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-utility/getentitymetadata):
  native table/column properties, collection, numeric type code and limited
  `OptionSet` description; no documented relationships or label-language selector.
* [Query table definitions using the Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query-metadata-web-api):
  explicit metadata selection, cast-specific attributes/option sets, label
  languages, managed RequiredLevel, entity-scoped relationship collections.
* [OneToManyRelationshipMetadata](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/onetomanyrelationshipmetadata)
  and [ManyToManyRelationshipMetadata](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/manytomanyrelationshipmetadata):
  exact schema, entity, column, navigation and intersect identities.
* [AttributeTypeCode](https://learn.microsoft.com/en-us/dotnet/api/microsoft.xrm.sdk.metadata.attributetypecode):
  SDK numeric type identities. Adapter normalization is required for Web API
  enum/managed-property representations; raw Web API payloads are not accepted.

Reproducible source verification:

```text
# Initial probe detected missing node_modules/.bin/tsc.cmd, then:
npm ci --no-audit --no-fund
npm run typecheck
npx --no-install eslint src/metadata.ts tests/metadata.test.ts
npx --no-install vitest run tests/metadata.test.ts
npx --no-install vitest run tests/metadata.test.ts tests/cache.test.ts tests/security.test.ts
npm run build
```

Verified outcomes: typecheck, targeted ESLint and build pass; **148 metadata
tests**, **357 total tests across the three focused/regression suites** pass.
The initial missing-compiler probe failed as intended; the locked dependency
install succeeded without registry/TLS/manifest changes. Parent-owned full
docs/export-count tests were deliberately not run as this lane's acceptance.

Focused tests include native/adapter calls and receiver binding; missing host
capabilities; exact identities/type validation; absence/denied/transport
separation; malformed/partial/ambiguous responses; unsafe structures and no getter
execution; false/zero/empty/null preservation; language/fallback; isolated copies;
TTL/coalescing/capacity/byte/count thresholds; pending invalidation; adapter/user/
environment/language isolation; shared-cache generation; and scope-observation
race sweeps covering cached normalization/validation/return.

SENTINEL: parent-owned full docs/export-count, root/browser/package-consumer
integration and any future authorized live model-driven validation remain
separate. No rendered UI or native tenant behavior was verified here. Adapter
implementations must demonstrate supported cast/selection/completeness and
current-user read scope before use. No new maker wiring or low-code work.

Rollback: revert this lane's single additive commit (three owned files); there
are no schema/data/solution changes to undo. Parent should omit or revert its
own export wiring if rolling back the integrated feature.
