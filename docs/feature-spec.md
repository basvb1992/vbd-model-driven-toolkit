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
Most entries remain planned. Twenty-one runtime functions and the bounded local
tooling subset are implemented; see [getting started](getting-started.md) and
[environment/launcher usage](environment-launching.md).

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
- Implementing the full catalog, deploying, or publishing solution packages in
  the initial implementation slice.

## Foundation implementation slice: C1a

Tracked in [issue #1](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/1).
This records the original foundation scope; C1b below extends current availability.
Implement six catalog functions: `VBD.Config.validate`, `VBD.Config.register`,
`VBD.Config.get`, `VBD.Diagnostics.normalizeError`, `VBD.Diagnostics.report`,
and `VBD.Diagnostics.getVersion`.

The first configuration schema describes typed environment-variable requirements,
model-driven app launch-profile declarations, and form/grid registration
declarations. It rejects raw values, unknown properties, duplicate identities,
invalid references/types, and workflow definitions. Validation is not execution:
environment-variable reads, launchers, and command entry points remain planned.

Add local-only source/sanitized-snapshot preflight and Markdown handover tools.
They perform no network calls or Dataverse writes. Snapshot evidence covers
variable definition type and value presence/access only, never actual values.
Live application/registration/permission verification remains unknown/unsupported.

Observable bounds: input files at most 1 MiB, at most 200 variable declarations,
100 profiles, and 500 registrations, identifiers at most 128 characters, snapshot
freshness 24 hours, and future clock skew at most 5 minutes. CLI exit codes are
0 for complete success, 1 for invalid input/failure, and 2 for incomplete evidence.
Existing output files must not be overwritten. Test every bound and redaction
behavior, browser namespace initialization, registry isolation, and CLI outcomes.

This slice is partial progress on API-01, CON-01, and CON-02; it cannot satisfy
Dataverse deployment, effective-value retrieval, or live-browser launch criteria.

### C1a acceptance evidence

| Behavior | Local evidence | Unverified boundary |
| --- | --- | --- |
| Strict schema, safe paths, bounds, registry isolation, and replacement policy. | `tests/configuration.test.ts`; strict types/lint. | Environment-value retrieval was outside C1a; see C1b. |
| Safe diagnostics, cause retention, explicit sink, and sink failure. | `tests/diagnostics.test.ts`. | No panel or model-driven notification integration. |
| Global namespace, duplicate guard, no Node/Xrm/DOM/framework dependency. | `tests/browser.test.ts` VM bundle smoke and package-consumer type check. | Not a live model-driven/browser installation check. |
| Snapshot presence/type/access/freshness and incomplete statuses. | `tests/delivery.test.ts`. | Supplied evidence is not independent live verification. |
| Deterministic redacted handover and declared registration labels. | `tests/delivery.test.ts`. | No real deployed registration was inspected. |
| CLI file/argument bounds, exit codes, malformed input, and no overwrite. | `tests/cli.test.ts`. | No Dataverse or public packaging/deployment. |

## Current implementation slice: C1b

Tracked in [issue #3](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/3),
stacked on the unmerged C1a foundation rather than automatically merging it.
Implement the ten `VBD.Environment` functions, `VBD.Links.app`,
`VBD.Launch.getProfile`, `VBD.Launch.prepareProfile`, `VBD.Launch.openPrepared`,
and `VBD.Windows.open`. Non-popup openProfile and ribbon handlers remain planned.

Use supported online Xrm.WebApi reads or an explicit typed read context.
Definition metadata is inspected before any value read; Secret/Data source
values are rejected. Explicit current/default reads preserve empty/false/zero
and observable provenance; ambiguous rows fail rather than guessing a layer or
newest row. This is not a claim to implement opaque platform solution-layer
resolution. Optional reads absorb only the selected missing-definition/value
cases, not access, validation, ambiguity, or transport errors.

Cache only in memory, scoped to environment/user/language. TTL defaults to 60
seconds and is at most 5 minutes. Bound cache to 128 entries and 2 Mi UTF-16 code
units of values, each value at most 1 Mi code units, with at most 64 in-flight
loads. Batch reads accept at most 100 unique requests and 1-8 workers (default
4). Scope changes/invalidation during a read fail explicitly; failures are not
cached. JSON requires a runtime predicate, never just a generic annotation.

App destinations require an HTTPS root environment, one valid app ID or unique
name, an exact approved origin, and no credentials/fragments/arbitrary parameters.
Prepared opaque tokens are limited to 128 and expire within 5 minutes, capped
by their source freshness. Registry replacement, scope change, or environment
invalidation invalidates them. Opening makes no asynchronous reads, requires
observable active user activation, and requests _blank/noopener/noreferrer.
A null handle means unknown outcome, not proof of blocking or destination load.

Verify TTL/bounds, race and invalidation cases, secret rejection before reads,
batch errors, URL policy, opaque-token integrity, and gesture/isolation behavior
with typed adapters and the browser bundle. Live Dataverse resolution, actual
physical-browser popup behavior, and solution installation remain unverified
unless separately exercised. Do not deploy or include production values.

### C1b acceptance evidence

| Behavior | Observed evidence | Remaining boundary |
| --- | --- | --- |
| Current/default, empty/false/zero, JSON guard, missing and error distinctions. | `tests/environment.test.ts` with typed readonly fixtures. | Live Dataverse/solution-layer and field-security behavior unverified. |
| Scope/TTL/bounds, in-flight deduplication, invalidation and cached/validation-time races. | Environment tests include reproductions fixed by final scope/generation checks and batch-wide scope binding. | No claim of instant reflection of administrator edits before TTL. |
| Approved origins/app identity, opaque tokens, revision/freshness/capacity invalidation. | `tests/launch.test.ts`, package-consumer types and browser-bundle integration. | Target app installation, license and user access unverified. |
| Real click, synchronous isolated request and inactive-gesture rejection. | Controlled Chrome 156.0.4314.50 check on 2026-10-28 using routed `.example` pages and synthetic Xrm metadata. Trusted active click opened the exact approved app URL; reads stayed 6 before/after. Opener was null, document referrer empty, and no Referer header was sent. After activation expired, USER_ACTIVATION_REQUIRED was raised, native open count stayed 1, and reads stayed 6. | No actual Dynamics app, tenant authentication/SSO, other browser, or managed installation was exercised. |

The browser check loaded the built 0.2.0 bundle, prepared before the click,
then verified requested/unknown remained the public result even though the
automation could independently observe the controlled destination. Both fixture
pages/routes were cleaned up. This is scoped browser evidence, not a live tenant
or deployment certification.

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
| DOC-02 | Environment-variable and separate-window contracts are explicit. | Contract review against official references and scenario matrix. | Bounded runtime subset implemented; tenant installation unverified. |
| DOC-03 | Repository is independently accessible with committed design documents. | GitHub repository, remote commit, and file/link checks. | Documentation baseline delivery. |
| DOC-04 | Consultant capabilities have priorities, inputs, outputs, ownership, boundaries, and verification criteria. | Capability coverage and cross-document consistency checks. | Documented; bounded C1a tooling implemented, broader capabilities planned. |
| SEP-01 | Core works in an environment without the Workflow/Interaction Framework. | Dependency inspection and clean-environment import/smoke checks with no framework installed. | Planned; design boundary documented. |
| SEP-02 | Recipes remain bounded client interactions, not durable workflows. | Validator tests reject durable waits, triggers, cycles, resume state, and persistent retry definitions. | Planned. |
| API-01 | Public functions are under `VBD`; toolkit assets use `vbd`. | Type/build checks and exported-symbol/solution inspection. | Twenty-one-function namespace verified locally; Dataverse assets not created. |
| API-02 | Typed and maker-facing calls use the same validated operation contracts. | Unit tests plus form and command registration examples. | Planned. |
| CFG-01 | Effective environment values, absent values, false/zero/empty, type errors, and access errors are handled distinctly. | Resolver tests and Dataverse integration fixtures. | Explicit unambiguous current/default semantics checked with typed adapters; real tenant/layered resolution unverified. |
| CFG-02 | Secret variables never return browser-readable secret values. | Type guard tests, negative integration test, and redacted diagnostics check. | Type-before-value and redaction adapter tests pass; live negative tenant check unverified. |
| NAV-01 | Configured app profiles launch without source edits between environments. | Two deployment configurations and verified generated destination URLs. | Approved destination/scope/preparation adapter tests pass; real deployment remains unverified. |
| NAV-02 | Window launch respects user activation and reports only observable outcomes. | Real-browser click, blocked/unknown cases, and session/isolation checks. | Controlled Chrome click, inactive rejection, no extra reads, opener/referrer isolation and honest unknown result verified; real tenant/SSO and other browsers unverified. |
| FORM-01 | Form values, multiple bound controls, events, and save policies behave explicitly. | Unit tests and model-driven form smoke scenarios. | Planned. |
| DATA-01 | Queries respect paging limits; mutations report partial failures and retry safely. | Paging, throttling, concurrency, and failed-record tests. | Planned. |
| SEC-01 | Client UX never substitutes for server authorization. | Denied-permission tests and unsupported-operation checks. | Planned. |
| ALM-01 | Managed and unmanaged ZIPs come from the same tagged source. | Reproducible build, solution inspection, and import checks. | Planned; no packages. |
| ALM-02 | Imports do not overwrite consuming app handlers/configuration automatically. | Clean-environment install and existing-app regression checks. | Planned. |
| CON-01 | Diagnostics and preflight are read-only and distinguish pass, warning, fail, unknown, and unsupported with evidence. | Known misconfiguration fixtures, denied-access cases, and write-detection checks. | Source/supplied-snapshot semantics verified locally; live checks/panel planned. |
| CON-02 | Generated handover distinguishes declared configuration from verified deployed registration. | Compare generated Markdown/HTML with fixtures and an inspected deployed sample; confirm redaction. | Markdown fixtures and unverified labels checked; live deployed comparison/HTML planned. |
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
