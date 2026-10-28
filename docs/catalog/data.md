# Dataverse data and query functions

The 14 R1 Data/Query/Actions entries are implemented in the bounded subset in
[core usage](../core-usage.md); 11 R2 entries remain planned.
See [catalog conventions](../function-catalog.md).
The baseline is online Dataverse in the current environment. Cross-environment
authentication is not automatically supplied by an app launcher.
No live writes are part of verification. ETags require an atomic conditional
adapter; unsupported native conditional writes fail before dispatch.
Read lookup-shadow names are distinct from logical tables/FetchXML/write fields.

## VBD.Data

Require selected columns where practical. Respect field security and normalize
server errors without turning access denial into a missing record.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Data.retrieve` | ref, columns, permitted expands | Record | Required record read; reject not-found/access errors distinctly. | R1 |
| `VBD.Data.retrieveMany` | Table, query/options, page size | `Page<T>` | One bounded page; return supported continuation. | R1 |
| `VBD.Data.create` | Table, validated field payload | Created `EntityRef` | Exclude client-only/unsupported fields; not an open form edit. | R1 |
| `VBD.Data.update` | ref, payload, optional concurrency token | Update result | Support optimistic concurrency when specified; no unsafe retry. | R1 |
| `VBD.Data.delete` | ref, explicit mutation policy | Delete result | Maker adapter requires deliberate destructive-action configuration. | R1 |
| `VBD.Data.exists` | Table, bounded filter/key | Boolean | Missing match is false; denied/invalid query is an error. | R1 |
| `VBD.Data.retrieveRelated` | ref, navigation property, columns/filter/page size | Related record/page | Validate single/collection relationship shape. | R1 |
| `VBD.Data.upsert` | Table, supported alternate key, payload | Upsert result | Explicit alternate-key and concurrency semantics; not read-then-create guessing. | R2 |

## VBD.Query

Support raw OData/FetchXML for advanced consumers and structured safe helpers
for common conditions. Never substitute unescaped values into query templates.
FetchXML currently supports explicit selected/ordered root queries and scalar
filters, not joins/aggregates/general NOT/contains or ambiguous cookie-less paging.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Query.executeOData` | Table, validated OData options | `Page<T>` | Supported select/filter/order/expand/top; bounded response. | R1 |
| `VBD.Query.executeFetchXml` | Root table, FetchXML, paging options | `Page<T>` | Validate expected root; follow supported paging cookie behavior. | R1 |
| `VBD.Query.iteratePages` | Query specification, limits/cancellation | Async page iterator | Stop on bounds/cancellation and expose continuation errors. | R1 |
| `VBD.Query.retrieveAll` | Query, mandatory maximum records/pages | Bounded items plus limit status | Reaching a bound is explicit, never presented as complete data. | R1 |
| `VBD.Query.aggregate` | Supported aggregate FetchXML, result schema | Typed aggregate results | Server aggregation with alias/type validation. | R2 |
| `VBD.Query.buildFilter` | Structured conditions, allowed columns/operators | Filter representation | Validate identifiers separately from scalar escaping. | R1 |

## VBD.Relationships

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Relationships.associate` | Source ref, relationship/navigation property, target refs | Association result | Supported relationship shape; explicit bounded targets. | R2 |
| `VBD.Relationships.disassociate` | Source ref, relationship/navigation property, target refs | Disassociation result | Relationship removal, not target-record deletion. | R2 |

## VBD.Actions

Operation names and parameter metadata must be registered/validated; input values
alone are not enough to construct a correct Web API execution request.
Contracts declare parameter metadata and expected empty/validated JSON response.
Response validators may be async with a final scope check; parameter guards
must return synchronous proven JSON. Enumeration metadata remains unsupported.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Actions.executeAction` | Registered action/Custom API contract, binding, parameters | Validated action response | Mutating operation; no automatic retry without idempotency contract. | R1 |
| `VBD.Actions.executeFunction` | Registered function contract, binding, parameters | Validated function response | Use supported function semantics and metadata. | R1 |

## VBD.Batch

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Batch.execute` | Supported requests, concurrency/limits, failure policy | `BatchResult` | Report every attempted/skipped/failed item; outer success is insufficient. | R2 |
| `VBD.Batch.executeChangeset` | Supported transactional writes, constraints | Changeset result | Atomic only within supported server changeset; not UI/email/flow rollback. | R2 |

## VBD.Metadata

Scope caches by environment and language. Fetch only required metadata and do
not assume choice values or relationship names from display labels.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Metadata.getTable` | Table logical name, requested properties | Table metadata | Logical name/entity-set identity and requested capabilities. | R2 |
| `VBD.Metadata.getColumn` | Table, column logical name, properties | Column metadata | Type/targets/constraints under supported metadata API. | R2 |
| `VBD.Metadata.getChoices` | Table, column, language | Choice values and localized labels | Labels are display data, not stable identifiers. | R2 |
| `VBD.Metadata.getRelationships` | Table, relationship kind/filter | Relationship metadata | Return validated navigation properties and relationship identities. | R2 |
| `VBD.Metadata.invalidate` | Table/column/language scope | Invalidated-entry count | Refresh after customization changes; does not publish customizations. | R2 |
