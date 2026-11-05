# Bounded relationship mutations

`Relationships.associate` and `Relationships.disassociate` are the two callable
methods in `src/relationships.ts`. The parent integration owns the
`VBD.Relationships` root/browser export. This change does not edit that integration.

## Supported subset and official evidence

Public Microsoft Learn pages checked 2026-11-05:

- [Xrm.WebApi.online.execute](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-webapi/online/execute),
  **Associate a record** / **Disassociate a record** examples: the documented
  many-to-many requests have prototype `getMetadata()` returning
  `{boundParameter:null, parameterTypes:{}, operationType:2, operationName:"Associate"}`
  or `"Disassociate"`. Associate uses `target`, `relatedEntities`, `relationship`;
  Disassociate uses `target`, `relatedEntityId`, `relationship`. Neither returns
  a response body. This is a separate CRUD subset, not an arbitrary action or
  function; the shared Data/Actions execution allowlist is unchanged.
- [Associate/disassociate rows using the Web API](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/associate-disassociate-entities-using-web-api):
  navigation properties distinguish single-valued and collection-valued relations;
  collection reference association/removal uses `$ref` and successful responses
  are HTTP 204. Removing the reference is **not deleting either record**.
- [ManyToManyRelationshipMetadata](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/manytomanyrelationshipmetadata?view=dataverse-latest):
  `SchemaName`, `Entity1LogicalName`, `Entity2LogicalName`,
  `Entity1NavigationPropertyName`, `Entity2NavigationPropertyName`, intersect
  identity/attributes are metadata, not display labels or inferred plurals.
- [Web API navigation properties](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/web-api-navigation-properties):
  navigation names are case-sensitive; many-to-many navigation properties are
  collection-valued.

Only explicit **many-to-many, collection-valued** contracts are accepted, in either
declared source direction. Native execute is restricted to the documented
same-name relationship/navigation subset (`SchemaName === navigationProperty`).
Different names require the explicitly supplied typed adapter, which receives the
entire validated contract; no native alias mapping is invented. Single-valued,
1:N/N:1, conditional/ETag, atomic multi-target changesets and generalized execute
are unsupported here. There is no lookup-clear, record-delete or alternate
transport fallback.

Each target uses one request, including Associate (a one-element
`relatedEntities` array). Multi-target operations are sequential and **not
atomic**. No retry, rollback, automatic reconciliation or transaction claim is made.

## Signatures and exported types

```ts
Relationships.associate(
  source: EntityRef, relationship: RelationshipContract, targets: readonly EntityRef[],
  options?: RelationshipOptions
): Promise<RelationshipResult>;

Relationships.disassociate(
  source: EntityRef, relationship: RelationshipContract, targets: readonly EntityRef[],
  options: DisassociateOptions
): Promise<RelationshipResult>;
```

The module exports the `Relationships` value and these types:
`RelationshipContract`, `RelationshipRequestMetadata`, `RelationshipRequest`,
`RelationshipContext`, `RelationshipOptions`, `RelationshipConfirmation`,
`DisassociateOptions`, `RelationshipDiagnostic`, `RelationshipItem`,
`RelationshipResult`. No other callable API is exported.

`RelationshipContract` contains:

```ts
{
  scope: Readonly<ReadScope>; // environmentUrl, userId, languageId, online
  metadata: Extract<MetadataRelationship, { kind: "manyToMany" }>;
  sourceSide: "entity1" | "entity2";
  navigationProperty: string; // exact property on the declared source side
  cardinality: "collection";
}
```

Metadata and its scope must be explicitly supplied from a trusted schema contract
or a separately authorized, supported metadata read. This module performs **no
metadata or business-record discovery**. The caller must not relabel stale/foreign
metadata with a fresh scope. It validates contract consistency, not metadata
provenance, record existence, effective privileges or business rules.

Sources/targets are copied plain JSON, normalized GUID/logical-table references;
display names are dropped. Exactly 1..100 unique targets are required; normalized
duplicates, zero/invalid GUIDs, foreign target types, wrong source types, mismatched
navigation/cardinality and unsupported metadata fail before any mutation.
All targets and capabilities are preflighted before the first request.

## Minimal caller

Use the direct source-module import until parent namespace integration:

```ts
import { Relationships } from "../src/relationships.js";
import type { RelationshipContract } from "../src/relationships.js";

// Explicit local example only: use actual validated current-scope metadata/refs.
const relation: RelationshipContract = {
  scope: currentScope, // obtained in the current environment/user/language/online context
  sourceSide: "entity1",
  navigationProperty: "new_account_contact",
  cardinality: "collection",
  metadata: {
    kind: "manyToMany", SchemaName: "new_account_contact",
    Entity1LogicalName: "account", Entity2LogicalName: "contact",
    Entity1NavigationPropertyName: "new_account_contact",
    Entity2NavigationPropertyName: "new_account_contact",
    IntersectEntityName: "new_account_contact",
    Entity1IntersectAttribute: "accountid", Entity2IntersectAttribute: "contactid"
  }
};

const added = await Relationships.associate(source, relation, targets);
// After parent integration: VBD.Relationships.associate(source, relation, targets).
if (added.status !== "completed") {
  // Inspect added.items/added.error and reconcile server state; do not retry blindly.
}

// Deliberate, exact relation/source/ordered-target confirmation, not a blanket policy.
const removed = await Relationships.disassociate(source, relation, targets, {
  confirmation: { policy: "confirm-disassociate", source, relationship: relation, targets }
});
```

Confirmation includes the full exact contract/scope and the same ordered normalized
source/targets. There is no destructive-policy default, implicit user dialog or
record deletion.

## Trusted adapter boundary

```ts
interface RelationshipContext {
  getScope(): Readonly<ReadScope>;
  executeRelationship?(
    request: RelationshipRequest,
    scope: Readonly<ReadScope>,
    contract: Readonly<RelationshipContract>
  ): Promise<unknown>;
}
```

Supply it as `{context}` to either method. The method receiver is retained.
Requests, their references/target arrays, scope and contract metadata are copied
and frozen. The adapter must implement only the provided exact relationship,
current environment/user and supported relation semantics. Scope arguments do not
provide credentials or enforce authorization; a trusted callback's declaration is
not proof that its implementation is pure or that the server permits the write.
A generic DataContext `execute` is **not** accepted in place of this capability.

The explicit transport response is `{ok:boolean, status:number}`. Only consistent
`{ok:true,status:204}` confirms completion. No JSON/body validator or body read is
needed. Reject authoritative HTTP failures with an own integer `status` property;
SDK denial code `0x80040220` is also recognized. Other SDK errors without an
authoritative status remain uncertain rather than guessing from error messages.

Online environment URL, normalized user ID and language are checked through the
repository scope helpers before dispatch, after await, and after native response
validation (including validation that throws). Scope drift/read failure after a
request may mean the server mutation happened. There is no cross-environment auth
or automatic read/write discovery.

## Result and error semantics

Input, capability and initial scope failures **reject with `VbdError` before
dispatch**. Once dispatch processing starts, failures are explicit structured
results, not silent success; callers must inspect `status`.

- `status`: `completed`, `partial` (some confirmed complete), `failed`, `uncertain`.
- Ordered `items`: `completed`, `failed`, `uncertain`, `skipped`, each with the exact
  normalized target and `attempted` flag. Completed means an observed 204, not a
  subsequent server-state read. No failed request is claimed to have rolled back.
- `counts`: `requested`, `attempted`, `completed`, `failed`, `uncertain`, `skipped`.
  Attempted = completed + failed + uncertain. A pre-dispatch scope stop is skipped.
- Top-level `error` and failed/uncertain item `error` contain fixed safe messages,
  code, operation and correlation ID. Codes distinguish `ACCESS_DENIED` (401/403),
  `RESOURCE_NOT_FOUND` (404), `CONCURRENCY_CONFLICT` (412), `DATA_WRITE_FAILED`
  (other authoritative 4xx except 408) and `MUTATION_OUTCOME_UNKNOWN` (transport,
  408/5xx, malformed/contradictory status, unsupported successful status,
  response-validation exception or post-dispatch scope failure).
- Remaining targets are skipped after the first failed/uncertain operation.
  Scope failure between requests preserves earlier completion evidence, sets
  `CONFIG_EXPIRED`, and dispatches no further requests.
- Raw retained evidence is available only through non-enumerable `diagnostic`
  (`VbdError.cause`); JSON serialization of the result does not dump server/customer
  payloads. Treat even this diagnostic as privileged evidence, not telemetry text.

### Local native fixture and result

`tests/relationships.test.ts` uses a local `Xrm.WebApi.online.execute` receiver,
prototype metadata and synthetic references. For source account `11111111-1111-4111-8111-111111111111`
and target contact `22222222-2222-4222-8222-222222222222`, its Associate request is:

```ts
{
  target: { entityType: "account", id: "11111111-1111-4111-8111-111111111111" },
  relatedEntities: [{ entityType: "contact", id: "22222222-2222-4222-8222-222222222222" }],
  relationship: "new_account_contact"
}
// request.getMetadata() on its prototype:
// {boundParameter:null, parameterTypes:{}, operationType:2, operationName:"Associate"}
// execute resolves {ok:true,status:204}
// result.status === "completed"; item: {target, status:"completed", attempted:true, responseStatus:204}
// counts: {requested:1,attempted:1,completed:1,failed:0,uncertain:0,skipped:0}
```

Disassociate substitutes `relatedEntityId: target.id` for `relatedEntities` and
uses `operationName:"Disassociate"`. A three-target run with first 204 and second
transport failure returns `status:"partial"`, ordered
`[completed, uncertain, skipped]`, counts
`{requested:3,attempted:2,completed:1,failed:0,uncertain:1,skipped:1}`, and
`error.code:"MUTATION_OUTCOME_UNKNOWN"`. Nothing retries or deletes a record.

## Verification, remaining limits and rollback

Local verification: initial `npm run typecheck` detected missing `tsc`; resolved
with `npm ci --no-audit --no-fund` without manifest/lockfile edits. Final
`npm run typecheck`, `npm run lint`, `npm run build`, and
`npm run typecheck:package` pass. `npx vitest run tests/relationships.test.ts
tests/relationships.browser.test.ts` passes **102 cases**. The Data,
data-bounds, data-browser, action, query, read-resilience, read-batch and metadata
regression suites pass **497 cases**. Parent export-count/documentation suites
are intentionally not run in this lane.

Focused source and in-memory compiled cross-realm browser tests are local fixtures,
not native-client or Dataverse server certification. No tenant/authentication,
live mutation, deployment or role-specific behavior is verified. Required live
follow-up belongs to SENTINEL under separate authorization: actual SDK response
behavior, frozen-request compatibility, custom relationship direction/names,
effective access/business-rule failures and server-state reconciliation. Distinct
schema/navigation adapter implementations require their own authorized validation.

Parent integration owns root exports, consumer types, function count and version.
No low-code maker configuration is changed or needed by this source-only lane.
Rollback is removal/reversion of these additive owned files; it cannot undo any
relationship mutations already made by a future consumer.
