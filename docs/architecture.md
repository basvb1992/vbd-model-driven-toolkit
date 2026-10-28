# Architecture

All contracts below are proposed. No runtime exists yet.

## Product and framework separation

| Product area | Owns | Dependency direction |
| --- | --- | --- |
| VBD Core | Client APIs, adapters, validated configuration, bounded interactions. | Requires supported platform APIs, not Studio or a workflow framework. |
| VBD Studio | Optional configuration/diagnostic UI and wiring guidance. | Consumes Core's contracts; Core never depends on Studio. |
| VBD Delivery Tools | Source/metadata checks, comparison, handover, upgrade reports. | Uses explicit local/CI authentication and scoped supported reads; never injects admin credentials into Core. |
| External Workflow/Interaction Framework | Durable server execution, queues, schedules, approval waits, retries/resume. | No mandatory installation or version coupling in either direction. |

The consultant feature contracts are in
[consultant capabilities](consultant-experience.md); runtime function contracts
remain in the [function catalog](function-catalog.md).

Use the same `vbd` publisher prefix without sharing ownership of unrelated
components. Each solution has its own component inventory and version. Core
must not reference framework-owned tables, flows, plugins, controls, or APIs.
Do not move framework assets into the toolkit repository.

Any optional adapter must declare its external public contract/version and
dependency explicitly. The absence of that adapter or external system affects
only the opted-in interaction, not Core installation or unrelated operations.

## Layers

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Typed core | Validate options and call supported client/Dataverse APIs. | Know customer table names or silently infer contexts. |
| Surface adapters | Convert form events and command parameters into explicit contexts. | Pretend form event context, PrimaryControl, and SelectedControl are interchangeable. |
| Configuration and bindings | Resolve validated values and allowlisted context bindings. | Evaluate JavaScript strings or expose secrets. |
| Recipes | Compose finite registered client operations with defined failure policies. | Persist execution state, schedule/resume runs, or claim global rollback. |
| Optional authoring UI | Help makers create valid client configurations and wiring instructions. | Become a Core prerequisite or a workflow designer. |

## Runtime shape

- Public global namespace: `VBD`.
- Strict TypeScript source; official/community Xrm types evaluated during setup.
- Browser-compatible global bundle for webresource consumers.
- Typed module exports/declarations for developer consumers when packaging begins.
- Small core and explicit optional modules; no automatic global monkey-patching.
- One agreed major version of the global bundle per page. Detect duplicate or
  incompatible initialization instead of replacing existing consumers silently.
- Stable registered operation names for recipes; extensions register trusted
  functions in code, not unrestricted global names supplied by configuration.

Build tools and dependencies will be selected during implementation, not added
to a documentation-only repository in advance.

## Context and entry points

| Surface | Required input | Proposed adapter |
| --- | --- | --- |
| Form OnLoad/OnChange/OnSave | Execution context, with pass-execution-context enabled. | `VBD.Events.onLoad`, `onChange`, or `onSave` |
| Form command | `PrimaryControl` plus static recipe/configuration key. | `VBD.Commands.run` |
| Grid/subgrid command | `SelectedControl` and explicit selected record references/IDs. | `VBD.Commands.runGrid` |
| Typed application code | An explicitly constructed context and typed options. | Direct namespace function or `VBD.Recipes.run` |

Proposed positional adapter contracts are:

- `VBD.Commands.run(primaryControl, recipeKey)`
- `VBD.Commands.runGrid(selectedControl, selectedReferences, recipeKey)`
- `VBD.Events.onLoad(executionContext, recipeKey)`
- `VBD.Events.onChange(executionContext, recipeKey)`
- `VBD.Events.onSave(executionContext, recipeKey)`

The catalog documents operation contracts, not promises that every platform
designer exposes every parameter type. Validate actual parameter support per
surface and supply documented ID/reference adapters where necessary.

Classic custom enable rules and modern command visibility are separate.
Modern JavaScript actions are supported, but their Power Fx visibility rules
are not interchangeable with classic JavaScript custom rules. Async enable
rules are subject to platform support and deadlines. Do not issue network
requests on every ribbon reevaluation.

## Common types

| Type | Meaning |
| --- | --- |
| `EntityRef` | `{ entityType, id, name? }`, with validated GUID where required. |
| `OperationContext` | Surface, form/grid where supplied, current/selected references, app, client, and user scope. |
| `ValueBinding` | Explicit literal, context value, field, environment variable, configuration key, or previous-step result. |
| `ResolvedValue<T>` | Value, schema name/type, cache metadata, and provenance only when observable. |
| `Page<T>` | Items and supported continuation information; never an implicit unbounded result. |
| `OperationResult<T>` | Successful result or explicit cancellation/skipped outcome where the operation supports it. |
| `BatchResult` | Per-operation outcomes and summary; partial failure remains visible. |
| `LaunchResult` | Requested/observably blocked/unknown status and safe metadata; not proof that the destination loaded. |
| `PreparedLaunch` | Validated destination/options and scope/version/expiry; no credentials or user record payloads. |
| `Disposable` | Explicit removal of a registered handler, subscription, or scoped resource. |

Unexpected errors reject/throw a structured `VbdError` with code, safe message,
operation, correlation ID, and original cause. Normal cancellation is not a
success-shaped error fallback. Missing optional results are allowed only where
the function explicitly declares optional behavior.

Proposed codes include `INVALID_ARGUMENT`, `CONTEXT_REQUIRED`,
`UNSUPPORTED_SURFACE`, `ATTRIBUTE_MISSING`, `CONFIG_NOT_FOUND`,
`CONFIG_INVALID`, `CONFIG_NOT_READY`, `CONFIG_EXPIRED`, `SECRET_NOT_SUPPORTED`,
`ACCESS_DENIED`, `POPUP_BLOCKED`, `CONCURRENCY_CONFLICT`, and `PARTIAL_FAILURE`.

The core throws; maker entry points present an appropriate user-facing error
once and retain diagnostic correlation. No broad catch-and-return-default paths.

## Surface and capability policy

| Capability | Initial target | Boundary |
| --- | --- | --- |
| Dataverse queries/config reads | Online model-driven runtime | Server access checks remain authoritative. |
| Fields, tabs, sections, form save | Supplied supported form | Not homepage-grid operations. |
| Lookup filtering | Supported lookup control | PreSearch is synchronous; preload async dependencies. |
| Grid selection/refresh | Supported main grid or subgrid | Different grid types have different event/control APIs. |
| Record/custom-page dialogs | Supported Unified Interface navigation | Input and close-result contracts depend on page type. |
| Persistent app side panes | Supported web client | Capability-gated; not the same as a side dialog. |
| Independent browser windows | Browser with user activation | Browser controls popup/tab/window behavior. |
| Mobile/offline | Later explicit support | No transparent fallback to incorrect or unsupported behavior. |
| Cross-origin messaging | Optional cooperating applications | Not arbitrary access to another application's internals. |

Every implementation must declare supported surfaces and a deliberate unsupported
policy. Optional fallbacks must be configured and reported to the caller.

## Smart mechanisms

- Environment/user/language-scoped caches with TTL, invalidation, and in-flight
  read deduplication; no persistent record/secret cache by default.
- Duplicate-click and re-entrant-event protection scoped to operation and record.
- Operation-scoped progress cleanup in `finally`, with safe ownership when
  multiple operations overlap.
- Explicit dirty-form policy before navigation/refresh; no silent lost edits.
- Bounded concurrency, safe read retries, explicit mutation idempotency, and
  Dataverse throttling guidance.
- Preflight checks before writes and a read-only recipe validation/preview.
- Redacted diagnostics: no tokens, secret values, full record payloads, or
  sensitive URL query strings by default.
- Event disposables and idempotent registration rather than accumulating handlers.

## Bounded interaction contract

`VBD.Recipes` is a client interaction composer, not the existing workflow engine.
Each invocation is scoped to the current user action/form event and has finite
steps, selection/concurrency limits, and an execution-time policy.

- No arbitrary cycles, recursive recipe calls, or unbounded iteration.
- No Dataverse run-history/state tables, persisted checkpoints, resume tokens,
  scheduled triggers, durable timers, or approval wait states.
- Transient in-invocation retries require a bounded safe/idempotent policy.
  Persistent retry queues and background recovery are not toolkit features.
- Leaving/reloading the page does not create resumable work or imply rollback.
- A server handoff returns its accepted/completed status and correlation reference.
  Do not keep a browser recipe waiting for a long-running approval.
- Native business-process-flow UI helpers operate existing supported platform
  processes; they do not implement a new process engine.

Studio uses these same restrictions. It may edit input bindings, predicates,
and finite client steps, but cannot export a durable workflow definition.

## Server boundary

Custom APIs/plugins/approved orchestration handle security-critical validation,
transactions across supported writes, secrets, large bulk operations, external
credentials, and long-running work. A recipe spanning confirmation, email,
record creation, and navigation cannot be rolled back as one client transaction.
Server work can use any compatible approved API; the toolkit does not assume
or install the owner's Workflow/Interaction Framework.
