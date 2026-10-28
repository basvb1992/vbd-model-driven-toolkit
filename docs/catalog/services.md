# Shared services, files, and recipe functions

All entries are planned. See [catalog conventions](../function-catalog.md).
Optional modules must not become hidden prerequisites for core functions.

## VBD.UI

Form-specific notifications are in `VBD.Forms`. Global notifications use supported
platform APIs. Progress is owned/scoped so overlapping operations do not clear
each other's state unexpectedly.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.UI.showProgress` | Message, operation ID | Progress token | Validate platform capability and token ownership. | R1 |
| `VBD.UI.hideProgress` | Progress token | Cleanup result | Close owned progress state; report invalid ownership. | R1 |
| `VBD.UI.withProgress` | Message, trusted async operation | Operation result | Cleanup in finally; retain original error/cancellation. | R1 |
| `VBD.UI.notify` | Message, severity, scope, optional duration/actions | Notification token | Supported global notification contract only. | R1 |
| `VBD.UI.clearNotification` | Notification token | Clear result | Clear only owned/requested notification. | R1 |

## VBD.Execution

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Execution.withLock` | Scoped operation/record key, duplicate policy, trusted operation | Operation or explicit busy outcome | Prevent duplicate clicks/reentry; release in finally. | R2 |
| `VBD.Execution.withRetry` | Trusted operation, bounded retry/idempotency policy | Operation result | Retry only safe/declared-idempotent operations; respect throttling guidance. | R2 |
| `VBD.Execution.preflight` | Operation plan, ctx, read-only checks | Preflight report | No writes/navigation/messages; report unknown access/capability. | R2 |

## VBD.Files

Supported file-column and note-attachment contracts differ. Enforce file type,
size, memory limits, and platform-specific chunking where required.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Files.uploadColumn` | ref, file column, file, limits/cancellation | Upload result | Supported authenticated upload; no arbitrary filesystem access. | R2 |
| `VBD.Files.downloadColumn` | ref, file column, approved download policy | File/download result | Explicit user action and safe filename/type handling. | R2 |
| `VBD.Files.uploadNoteAttachment` | Note/parent ref, filename, content/type, limits | Attachment result | Validate annotation capability and distinct attachment payload format. | R2 |
| `VBD.Files.downloadNoteAttachment` | Note ref, download policy | File/download result | Access checks and size limits apply. | R2 |
| `VBD.Files.validate` | File metadata/content where required, allowlist/size policy | Validation report | Extension alone is insufficient to establish trusted content. | R2 |

## VBD.Integrations

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Integrations.request` | Registered approved server-operation key, typed inputs, completion policy | Accepted/completed operation reference/result | Custom API/server orchestration path; no anonymous flow URL or browser credential store. | R2 |

## VBD.Recipes

Recipes compose registered operations. Validation/preview are non-mutating;
execution can have side effects and cannot promise global rollback.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Recipes.register` | Recipe key, validated versioned steps | Registration result | Only allowlisted operations/bindings; reject invalid references/cycles. | R2 |
| `VBD.Recipes.validate` | Unknown recipe, operation registry/schema | Validation report | Check types, capabilities, dependencies, and failure policy. | R2 |
| `VBD.Recipes.preview` | Recipe key, ctx, permitted read-only resolution | Redacted execution plan | No writes, navigation, email, or workflow start. | R2 |
| `VBD.Recipes.run` | Recipe key, ctx, permitted inputs/cancellation | Per-step and final result | Stop/continue/skip policy explicit; preserve partial effects and errors. | R2 |
| `VBD.Recipes.list` | Registered scope/filter | Safe recipe summaries | Do not return secrets, full contexts, or unrelated configuration. | R2 |

R1 command/event adapters can execute one registered operation configuration
without requiring R2 multi-step recipe execution. This preserves a small first
release while keeping a stable maker entry point.

## VBD.I18n

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.I18n.getLanguage` | Supported user context | Language/locale information | No guessed locale from environment name. | R2 |
| `VBD.I18n.translate` | Resource key, locale, typed interpolation values | Localized text | Explicit missing-key/fallback policy; no unsafe HTML interpolation. | R2 |
| `VBD.I18n.formatDate` | Date value/behavior, locale, display options | Formatted text | Respect date-only/user-local/time-zone-independent semantics. | R2 |
| `VBD.I18n.formatNumber` | Finite number, locale, display options | Formatted text | Display result is not an OData or invariant numeric input. | R2 |

## VBD.Messaging

Optional cooperating-page protocol only. Default isolated app launches do not
provide a usable opener/handle or a messaging channel.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Messaging.send` | Explicit permitted peer, exact target origin, versioned schema payload | Send-request result | No wildcard target origin, credentials, or claimed remote processing receipt. | R3 |
| `VBD.Messaging.subscribe` | Expected origin/source, schema/protocol, trusted handler | `Disposable` | Validate origin, source, shape, version, and correlation; no arbitrary RPC execution. | R3 |
