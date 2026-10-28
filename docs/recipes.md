# Proposed recipes and smart mechanisms

These are design scenarios, not runnable configurations. Refer to the
[function catalog](function-catalog.md) for individual planned APIs.
R1 supports direct configured operations; multi-step recipe execution is R2.

Recipes are finite client interactions, not workflows in the separate
Workflow/Interaction Framework. They have no durable waits, schedules,
persisted run state, or resume behavior. See [architecture](architecture.md).

## Independent customer workspace

**Outcome:** a ribbon button opens the appropriate app in a separate browsing
context without a deployment-specific URL in the script.

- Environment variables supply approved target environment/app identity.
- A named launch profile declares destination, permitted parameters, and isolation.
- OnLoad prepares safe configuration; click-time bindings add the current saved
  record only when explicitly permitted.
- The click path calls `VBD.Launch.openPrepared` without an asynchronous read first.
- Missing/stale preparation is actionable; browser outcome is reported honestly.
- No separate login, offline capability, or remote-app readiness is implied.

## Contextual summary pane

**Outcome:** selecting a customer opens/reuses a named summary pane.

- `VBD.SidePanes.createOrGet` uses a stable pane ID.
- Supported page context includes only the approved table/record reference.
- `VBD.SidePanes.navigate` updates the pane rather than creating duplicate panes.
- An unsupported client reports a capability error or an explicit configured
  alternative; never silently changes the interaction.

## Dependent lookup with safe invalidation

**Outcome:** a child lookup is restricted by its selected parent.

- Read parent value and prepare any asynchronous supporting information.
- Register a scoped synchronous PreSearch handler.
- On parent change, invalidate prepared filter state.
- Explicit policy determines whether an incompatible existing child is retained,
  cleared, or shown as a validation issue.
- Dispose handlers when appropriate; repeated registration does not accumulate.

## Conditional form rules

**Outcome:** a configured rule controls required/visible/disabled states and
validation messages.

- Typed predicates inspect declared field/context values.
- Apply changes to the selected scope of all controls bound to each attribute.
- Use stable owned notification IDs.
- Guard reentry if an explicit set fires OnChange.
- Saving and server authorization remain independent.

## Create related and return

**Outcome:** a command starts a related record with approved copied values.

- Require a saved parent, validate mapping types, and choose direct-create or
  prefilled-form mode explicitly.
- Open the supported form/dialog with only permitted parameters.
- Refresh the parent/subgrid according to actual documented completion signals.
- Dialog closure alone does not count as a save; dirty parent policy is explicit.

## Bulk update selected records

**Outcome:** a grid command safely processes a bounded selection.

- Validate selection size/table and preflight capabilities.
- Confirm intended changes, acquire an operation/selection lock, and show progress.
- Run bounded supported writes; use a changeset only where real server atomicity
  is applicable and requested.
- Display successes, failures, skipped records, and conflicts separately.
- Refresh the intended grid and release progress/lock even after failure.
- No blind mutation retries or false all-success notification.

## Clone an approved subset

**Outcome:** create a copy without accidentally copying IDs or system state.

- Use a declared field allowlist and validated overrides.
- Exclude unsupported identity/system/relationship fields.
- Create through supported APIs, then explicitly open the created reference.
- Related-record cloning is a separate bounded operation, not implicit recursion.

## Run a server business operation

**Outcome:** invoke an approved Custom API or orchestrated process.

- Resolve a registered operation contract, not an arbitrary endpoint string.
- Validate parameters, saved record, and explicit confirmation requirements.
- Execute with correlation and an idempotency contract where applicable.
- Distinguish accepted-for-processing from completed.
- Return after an accepted long-running handoff; do not hold a browser recipe
  open for an approval or make the external framework a Core dependency.
- Show actionable errors and refresh only the declared affected surfaces.

## Feature-controlled commands

**Outcome:** an environment-specific flag changes a command's UX.

- Resolve a typed Boolean environment value before rule evaluation.
- Use explicit not-ready/unknown semantics and safe disabled behavior.
- Refresh command state after prepared configuration changes.
- Map to the appropriate classic or modern visibility mechanism.
- The server still rejects unauthorized operations regardless of flag/visibility.

## Configuration health report

**Outcome:** a developer or authorized maker can diagnose bad wiring without
executing the business interaction.

- Validate named operations, binding types, profile policies, and required context.
- Report missing schema names, unsupported surfaces, and configuration cycles.
- Redact values, record data, and URL parameters.
- A later Studio can display this report; core diagnostics need no authoring UI.

## Safe refresh policy

**Outcome:** a finished operation updates the UI without silently losing edits.

- Refresh a targeted subgrid when only related records changed.
- For form data refresh, inspect dirty state and honor the configured policy.
- Refresh ribbon state separately from data where needed.
- Do not use page reload as a universal repair mechanism.

## Optional connected-page handoff

**Outcome:** two intentionally cooperating pages exchange a small validated event.

- Explicitly opt into a connected-window mode; default launches stay isolated.
- Pin exact origins, expected source, protocol version, and message schema.
- Correlate requests and dispose subscriptions; do not expose arbitrary functions.
- No tokens, credentials, full records, or universal cross-origin window control.
- This is R3 and must not complicate the normal independent-launch path.
