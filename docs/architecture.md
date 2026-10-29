# Architecture

Most contracts below are proposed. The implemented configuration/diagnostic
functions and local delivery tools are described in [getting started](getting-started.md).
The scoped environment/app-launch subset is in [runtime usage](environment-launching.md).
Their source-level checks are not Dataverse installation or live-app evidence.
The [core usage](core-usage.md) contract describes the 145 implemented methods
in the 0.6.0 source, including the bounded native UI/data subset, owned side panes and
conservative Security hints. [Configuration runtime](environment-and-configuration.md)
defines approved loading, bindings and memory caching without a recipe engine.
The R2 continuation adds [metadata](metadata.md), [advanced form UX](advanced-forms.md)
and [scoped operation locks](execution.md). BvB remains on the separately
verified 0.5.0 test installation until another authorized deployment.

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

The source uses strict TypeScript, Zod schemas, esbuild browser/ESM/CLI bundles,
ESLint, and Vitest. Loading the browser bundle needs no Node, Xrm, DOM, or
framework. Environment reads lazily require a supported online Xrm context
or explicit typed ReadContext; window requests require a supported browser
or explicit typed WindowHost. Local tools never invoke these live adapters.
Duplicate global initialization fails instead of replacing an existing `VBD`.

## Context and entry points

| Surface | Required input | Proposed adapter |
| --- | --- | --- |
| Form OnLoad/OnChange | Execution context, pass-context enabled, registryName/profileKey. | `VBD.Events.onLoad` or `onChange` |
| Synchronous OnSave validation | Execution context and reviewed typed/JSON rules. | `VBD.Events.onSave` |
| Form command | `PrimaryControl` plus static recipe/configuration key. | `VBD.Commands.run` |
| Grid/subgrid command | `SelectedControl` and explicit selected record references/IDs. | `VBD.Commands.runGrid` |
| Typed application code | An explicitly constructed context and typed options. | Direct namespace function or `VBD.Recipes.run` |

Current positional adapter contracts are:

- `VBD.Commands.run(primaryControl, commandKey)`
- `VBD.Commands.runGrid(selectedControl, selectedReferences, commandKey, entityType?)`
- `VBD.Events.onLoad(executionContext, commandKey)`
- `VBD.Events.onChange(executionContext, commandKey)`
- `VBD.Events.onSave(executionContext, rules, options?)`

commandKey is configurationName/profileKey in schema version 1. This is not a
generic function/recipe dispatcher. Maker command/load errors are presented once
and return an explicit failed outcome; presentation failure rejects. The typed
core throws. OnSave validates synchronously and prevents before returning;
neither registration nor a promise enables platform async app settings.

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
| `ResolvedValue<T>` | Value, schema name/type, fetched/expiry times, cache status, and explicit current/default provenance. |
| `Page<T>` | Items and supported continuation information; never an implicit unbounded result. |
| `OperationResult<T>` | Successful result or explicit cancellation/skipped outcome where the operation supports it. |
| `BatchResult` | Per-operation outcomes and summary; partial failure remains visible. |
| `LaunchResult` | Currently requested/unknown with isolation metadata; no returned handle or proof that the destination loaded. |
| `PreparedLaunch` | Frozen opaque identity/expiry token; its approved destination, scope, revision and freshness are private in-memory state. |
| `Disposable` | Explicit removal of a registered handler, subscription, or scoped resource. |

Unexpected errors reject/throw a structured `VbdError` with code, safe message,
operation, correlation ID, and original cause. Normal cancellation is not a
success-shaped error fallback. Missing optional results are allowed only where
the function explicitly declares optional behavior.

Proposed codes include `INVALID_ARGUMENT`, `CONTEXT_REQUIRED`,
`UNSUPPORTED_SURFACE`, `ATTRIBUTE_MISSING`, `CONFIG_NOT_FOUND`,
`CONFIG_INVALID`, `CONFIG_NOT_READY`, `CONFIG_EXPIRED`, `SECRET_NOT_SUPPORTED`,
`ACCESS_DENIED`, `POPUP_BLOCKED`, `CONCURRENCY_CONFLICT`, and `PARTIAL_FAILURE`.

The current implemented error codes are in `src/errors.ts`; future platform
codes above remain proposed. Diagnostic reporting derives messages from a fixed
code map and never serializes the original cause, native message, stack, or input.
An explicit sink is required; sink failure is an error, not a reporting receipt.

The core throws; maker command/load entry points present an appropriate user-facing
error once and retain diagnostic correlation in a discriminated failed outcome.
There is no success-shaped fallback. OnSave prevents first and propagates
unexpected failures for the native synchronous error path.

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

The implemented environment cache has explicit entry/character/in-flight limits.
It is not the future generic Cache module. Invalidation removes selected cached
names in the chosen scope and conservatively expires all prepared launches;
no values are stored in browser storage. Prepared state is capped at 128 tokens.
Replacing registered configuration changes its revision, invalidating prior
tokens without automatically mutating Dataverse or another app.

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

The data subset uses explicit scalar-write field allowlists, exact delete
confirmation and declared action metadata. Conditional updates require an
atomic adapter or fail before dispatch. Transport/scope/response failures can
leave a mutation outcome uncertain; there is no automatic retry or rollback.
Paging is bounded and not a server snapshot/transaction.
