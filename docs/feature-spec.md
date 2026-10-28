# Feature specification

Design baseline: 2026-10-28. This specification defines requested behavior;
the architecture describes how it may be delivered.

## User outcome

Developers and makers can add common model-driven app behaviors without
rewriting table-specific JavaScript. They configure supported inputs and reuse
the same tested functions across Dynamics 365 and Power Apps model-driven apps.
Deployments resolve environment-specific values without changing source code.

Consultants can diagnose configuration, check deployment readiness, and generate
an evidence-based handover without building a separate support tool for each
customer. This toolkit is a separate product from the owner's Workflow/Interaction
Framework and must remain usable when that framework is not installed.

## Scope

- Public `VBD` TypeScript/JavaScript API and `vbd`-prefixed solution assets.
- Form events, classic ribbon commands, modern JavaScript command actions,
  homepage grids, and subgrids through explicit adapters.
- Queries, CRUD, lookups, field/control behavior, validation, dialogs,
  side panes, notifications, and reusable interactions.
- Typed environment-variable reads, configuration bindings, feature flags,
  environment-aware app profiles, and independent browser-window requests.
- Safe composition, diagnostics, bounded caching, duplicate-action prevention,
  and explicit client-capability checks.
- Standalone source repository and reproducible managed/unmanaged packaging.
- Optional consultant diagnostics, read-only delivery tools, generated handover,
  configuration comparison, reusable patterns, and later authoring Studio.

The [function catalog](function-catalog.md) is the authoritative proposed public
runtime API inventory. The [consultant capability catalog](consultant-experience.md)
defines the surrounding product experiences, not additional browser API functions.
Both catalogs describe planned work, not implemented features.

## Non-goals

- A new general-purpose workflow engine or arbitrary expression interpreter.
- Rebuilding, bundling, or requiring the existing Workflow/Interaction Framework.
- Durable execution state, scheduled triggers, approval waits, resumable runs,
  persistent retry queues, or a workflow designer in the toolkit or its Studio.
- Manipulating the model-driven application DOM or undocumented APIs.
- Automatically attaching commands or handlers to every installed application.
- Bypassing roles, licenses, field security, popup policies, or browser isolation.
- Creating separate authentication sessions or browser profiles.
- Making app windows work offline merely by opening them separately.
- Exposing Secret environment variables or client-side credentials.
- Browser execution of unbounded bulk work or long-running orchestration.
- Requiring a configuration table, PCF, server plugin, or a particular Dynamics
  module to use the core toolkit.
- Implementing the library as part of this initial documentation-only request.

## Dependencies and assumptions

- Supported Power Apps/Dataverse client APIs, with online Unified Interface
  as the initial baseline.
- Callers explicitly pass form/grid event context; no global form context.
- Dataverse grants the caller the required data/configuration access.
- App profiles reference apps already deployed and available to their users.
- BvB Demo is the intended first development target, but identity, publisher,
  access, and deployment scope remain to be verified before deployment.
- The standalone toolkit can be used without the owner's existing demo factory.
- Core installs and runs without the Workflow/Interaction Framework, its tables,
  plugins, flows, PCF controls, or configuration. Any future integration is an
  optional adapter to a public contract, never an implicit dependency.
- Core, optional Studio, and external Delivery Tools have distinct packaging,
  access requirements, and release gates within this repository.
- Public visibility, license, final API signatures, and optional modules require
  review before a public implementation release.

## Observable acceptance criteria

| ID | Criterion | Required verification evidence | Current status |
| --- | --- | --- | --- |
| DOC-01 | Every proposed function has a name, purpose, inputs, output, phase, and relevant constraints. | Catalog inventory and duplicate/coverage check. | Documented; checked in documentation baseline. |
| DOC-02 | Environment-variable and separate-window contracts are explicit. | Contract review against official references and scenario matrix. | Documented; runtime behavior not implemented. |
| DOC-03 | Repository is independently accessible with committed design documents. | GitHub repository, remote commit, and file/link checks. | Documentation baseline delivery. |
| DOC-04 | Consultant capabilities have priorities, inputs, outputs, ownership, boundaries, and verification criteria. | Capability coverage and cross-document consistency checks. | Documented; no consultant tooling implemented. |
| SEP-01 | Core works in an environment without the Workflow/Interaction Framework. | Dependency inspection and clean-environment import/smoke checks with no framework installed. | Planned; design boundary documented. |
| SEP-02 | Recipes remain bounded client interactions, not durable workflows. | Validator tests reject durable waits, triggers, cycles, resume state, and persistent retry definitions. | Planned. |
| API-01 | Public functions are under `VBD`; toolkit assets use `vbd`. | Type/build checks and exported-symbol/solution inspection. | Planned; no runtime code. |
| API-02 | Typed and maker-facing calls use the same validated operation contracts. | Unit tests plus form and command registration examples. | Planned. |
| CFG-01 | Effective environment values, absent values, false/zero/empty, type errors, and access errors are handled distinctly. | Resolver tests and Dataverse integration fixtures. | Planned. |
| CFG-02 | Secret variables never return browser-readable secret values. | Type guard tests, negative integration test, and redacted diagnostics check. | Planned. |
| NAV-01 | Configured app profiles launch without source edits between environments. | Two deployment configurations and verified generated destination URLs. | Planned. |
| NAV-02 | Window launch respects user activation and reports only observable outcomes. | Real-browser click, blocked/unknown cases, and session/isolation checks. | Planned. |
| FORM-01 | Form values, multiple bound controls, events, and save policies behave explicitly. | Unit tests and model-driven form smoke scenarios. | Planned. |
| DATA-01 | Queries respect paging limits; mutations report partial failures and retry safely. | Paging, throttling, concurrency, and failed-record tests. | Planned. |
| SEC-01 | Client UX never substitutes for server authorization. | Denied-permission tests and unsupported-operation checks. | Planned. |
| ALM-01 | Managed and unmanaged ZIPs come from the same tagged source. | Reproducible build, solution inspection, and import checks. | Planned; no packages. |
| ALM-02 | Imports do not overwrite consuming app handlers/configuration automatically. | Clean-environment install and existing-app regression checks. | Planned. |
| CON-01 | Diagnostics and preflight are read-only and distinguish pass, warning, fail, unknown, and unsupported with evidence. | Known misconfiguration fixtures, denied-access cases, and write-detection checks. | Planned. |
| CON-02 | Generated handover distinguishes declared configuration from verified deployed registration. | Compare generated Markdown/HTML with fixtures and an inspected deployed sample; confirm redaction. | Planned. |
| CON-03 | Comparison/upgrade reports identify relevant drift without treating intentional environment differences as errors or exporting sensitive values. | Two sanitized snapshots, expected-difference policy, deprecated-config fixtures, and redaction checks. | Planned. |
| CON-04 | Studio exports configurations that use the same validated contracts as direct developer configuration. | Round-trip configuration and compare runtime behavior; reject workflow-engine definitions and unapproved operations. | Planned. |
| CON-05 | Patterns, regression packs, and localization remain portable and explicitly versioned. | Generic-table fixtures, negative scenarios, supported-surface checks, and missing-translation behavior. | Planned. |

No runtime criterion is satisfied merely because its function appears in the
catalog. Implementers must link evidence to the corresponding criterion.

## Failure and edge cases

- Unsaved record, absent form attribute, repeated controls, dirty form, or
  re-entrant event handler.
- Missing definition, no value, explicit empty value, malformed JSON, unsupported
  environment-variable type, or denied configuration read.
- Multiple candidate value records or inconsistent resolution; never guess using
  an arbitrary newest-record rule.
- Configuration changes while cached, concurrent loads, and stale prepared app
  profiles after user/environment/configuration changes.
- Popup blocked or unobservable, user activation lost after an asynchronous
  read, target app inaccessible, cross-origin destination, or window already closed.
- A dialog closing without saving, canceled confirmation/picker, and unsupported
  custom-page return-data expectations.
- Lookup parent changes during preloading; asynchronous work in synchronous hooks.
- API throttling, batch partial failures, optimistic-concurrency conflict,
  duplicate clicks, invalid state/status transitions, or unsupported offline calls.
- Delivery checker has only partial metadata/solution access, or declared handler
  registration cannot be verified through a supported source.
- Intentional app IDs/origins differ between environments; a comparison must not
  recommend copying development current values into production.
- Diagnostics encounter third-party handlers they cannot enumerate; do not claim
  a complete form audit or inspect undocumented runtime internals.
- Optional framework adapter is absent, incompatible, or denies a request; core
  functions and unrelated profiles must remain unaffected.

## Change control

Function additions and contract changes update this specification only when user
outcomes change. Update the catalog for API inventory, architecture for technical
contracts, and roadmap for delivery status; avoid duplicating those sources here.
