# Consultant capability catalog

**Status: partial C1a foundations are implemented; no complete consultant UI or
live deployment checker is available.** C01 has structured diagnostic contracts,
C02 has source/sanitized-snapshot preflight, and C03 has declared-configuration
Markdown handover. All broader capability requirements remain planned.
This catalog defines experiences built around the runtime library. It does not
add functions to the 198-function [runtime catalog](function-catalog.md).
See [getting started](getting-started.md) for current commands and limitations.

The requested user outcomes and acceptance criteria remain in the existing
[feature specification](feature-spec.md). Technical and packaging boundaries
remain in [architecture](architecture.md) and [distribution](distribution.md).

## Product ownership

| Product area | Responsibility | Must remain outside it |
| --- | --- | --- |
| VBD Core | Typed APIs, safe bindings, runtime diagnostics, bounded client interactions. | Privileged tenant inspection and durable workflow execution. |
| VBD Studio | Optional configuration/health/authoring UI using validated Core contracts. | A general workflow designer or prerequisite for using the library. |
| VBD Delivery Tools | Read-only source/metadata checks, comparison, reports, handover generation. | Browser-hosted admin credentials and automatic environment repair/deployment. |

The toolkit is separate from the owner's Workflow/Interaction Framework.
Core has no dependency on that framework's tables, APIs, plugins, flows, controls,
configuration, or release cycle. Any future integration is an optional adapter
to a public contract. Shared publisher prefix and development environment do
not change this boundary.

## Priority map

Stages C1-C3 are the consultant workstream in the [roadmap](roadmap.md), not new
runtime API phases.

| ID | Capability | Owner | Stage | Consultant outcome |
| --- | --- | --- | --- | --- |
| C01 | Actionable diagnostic panel | Core diagnostic contract; optional Studio/custom diagnostic surface. | C1 | Understand why a configured interaction fails without reproducing custom debugging code. |
| C02 | Deployment readiness checker | Delivery Tools. | C1 | Find missing configuration and incompatible dependencies before customer handover. |
| C03 | Generated handover documentation | Delivery Tools. | C1 | Deliver an accurate configuration/support inventory instead of a manually maintained spreadsheet. |
| C04 | Configuration health dashboard | Delivery report contract; optional Studio renderer. | C2 | See invalid, missing, stale, and unsupported configuration in one view. |
| C05 | Environment comparison | Delivery Tools. | C2 | Separate relevant drift from intentional deployment differences. |
| C06 | Reusable interaction pattern packs | Versioned examples/configuration; Core executes supported operations. | C2 | Reuse proven consultant patterns without customer-table dependencies. |
| C07 | Regression scenario packs | Delivery Tools and test fixtures. | C2 | Verify supported interactions and common failure paths consistently. |
| C08 | Upgrade impact report | Delivery Tools. | C2 | Identify affected configurations and deprecated APIs before an upgrade. |
| C09 | Localization support pack | Core localization contract and versioned resources. | C2 | Avoid hardcoded customer messages and inconsistent locale handling. |
| C10 | Configure, validate, preview, and wire Studio | Optional Studio. | C3 | Produce valid configuration and exact registration instructions without hand-editing every setting. |

## C01: Actionable diagnostic panel

**Inputs:** explicitly supplied supported form/grid context, registered VBD
operations/handlers, configuration validation results, capability information,
and bounded redacted error events.

**Outputs:** named invalid settings, expected types/context, safe field/control
identities, VBD registration state, unsupported-surface explanations, correlation
IDs, and suggested corrective steps. Show errors such as a missing saved record,
unprepared launch profile, or incompatible lookup control.

**Boundary:** inspect only supported context/metadata and VBD-owned registrations.
Do not claim to enumerate all third-party event handlers, inspect the application
DOM, reveal record values by default, or certify effective access/licensing.
The panel does not automatically execute a failing command to diagnose it.

**Required evidence:** known invalid-context/missing-variable fixtures yield
specific actionable findings; sensitive values are absent; no write, navigation,
or event-handler side effect occurs during inspection.

## C02: Deployment readiness checker

**Inputs:** selected solution/source inventory, versioned configuration,
requested target scope, and explicitly authorized supported metadata/configuration
reads. Local/static mode works without pretending it has checked a live target.

**Outputs:** checks for referenced tables/columns, supported field types,
required definitions/value presence, permitted destinations, declared component
dependencies, and inspectable command/form registration. Report exactly which
checks ran against source versus the deployed target.

**Boundary:** read-only by default and by contract for this checker. No import,
publish, repair, role assignment, workflow start, or dependency auto-installation.
Missing metadata permissions, uninspectable registrations, and unsupported
component formats produce unknown/unsupported findings, never pass.

**Required evidence:** missing column, wrong field type, absent setting,
unavailable app/dependency, and denied-read fixtures are detected. A clean Core
target without the Workflow/Interaction Framework can pass the relevant checks.

## C03: Generated handover documentation

**Inputs:** versioned configuration, declared registrations, solution inventory,
toolkit compatibility data, and optional supported deployed-verification evidence.

**Outputs:** Markdown first, with optional HTML rendering: function/configuration
inventory, command/event wiring register, environment-variable definition and
value-presence checklist, dependencies, limitations, and troubleshooting runbook.
Include document version, source revision, observation time, and verification scope.

**Boundary:** distinguish declared, observed, and unverified registration. Do not
claim that a command is deployed just because its configuration exists. Exclude
credentials, Secret values, current configuration values, full URLs with sensitive
queries, and record payloads by default. Local reports are customer-controlled
artifacts, not automatically committed to this source repository.

**Required evidence:** generated content matches fixtures and observed sample
registrations, remains deterministic for fixed input, labels incomplete evidence,
and contains no forbidden values.

## C04: Configuration health dashboard

**Inputs:** the same versioned findings from validation/preflight plus supported
freshness/cache information.

**Outputs:** grouped actionable findings, affected profile/operation IDs,
verification scope, observation time, and explicit stale/unknown indicators.
An initial static report can precede a Studio screen.

**Boundary:** rendering does not invent a separate validator or perform live
repairs. Cached success is not a guarantee of current environment health.

**Required evidence:** the same finding set produces consistent report/dashboard
status; stale evidence and denied reads cannot yield an all-green dashboard.

## C05: Environment comparison

**Inputs:** two explicitly selected sanitized snapshots, compatible snapshot
schemas, and an expected-difference policy. Live collection requires separate
authorized reads for each target.

**Outputs:** relevant structural/configuration drift, missing components,
incompatible types/versions, and intentional environment-specific differences.
Identify which side and evidence support each finding.

**Boundary:** no business-record export, secret retrieval, automatic synchronization,
or recommendation to copy development current values into production. Different
app IDs/origins can be expected; inaccessible properties remain unknown.

**Required evidence:** fixtures distinguish missing schema/type drift from expected
app/URL differences, detect incompatible snapshots, and preserve redaction.

## C06: Reusable interaction pattern packs

**Inputs:** versioned parameterized examples, required Core capabilities, and
generic caller-supplied logical names.

**Outputs:** patterns for contextual app/pane launch, dependent lookup, conditional
form, related-record creation, and bounded selected-record operations, together
with precise wiring instructions and negative scenarios.

**Boundary:** installing an example must not silently alter existing apps or require
customer/Dynamics-module/Workflow Framework tables. No scheduled/durable pattern.
An optional specialized integration declares its dependency separately.

**Required evidence:** bind a pattern to two generic table/configuration fixtures,
verify supported surfaces and invalid inputs, and prove no hidden framework
reference or automatic registration.

## C07: Regression scenario packs

**Inputs:** selected supported interactions, non-sensitive fixtures, explicit
environment/test scope, and documented expected outcomes.

**Outputs:** scenarios for create/update forms, empty/mixed selections, canceled
dialogs, unsaved/dirty forms, missing configuration, denied access, and browser
launch behavior, with results linked to acceptance criteria.

**Boundary:** no claim of complete customer-app certification. Static validation
does not substitute for actual form/browser behavior. Any data-writing test
requires explicit isolated scope and cleanup ownership; the default preflight
checker never runs mutating tests.

**Required evidence:** positive and negative fixtures produce their expected
outcomes; skipped/unavailable scenarios are reported, not counted as passed.

## C08: Upgrade impact report

**Inputs:** installed/target Core versions, published compatibility/deprecation
metadata, selected configuration, and inspectable declared registrations.

**Outputs:** affected function/configuration references, severity/reason,
supported migrations, and unverified registration coverage.

**Boundary:** no automatic code rewrite, solution upgrade, unmanaged-layer change,
or managed downgrade guarantee. Studio compatibility is checked separately;
the Workflow/Interaction Framework version is not a Core requirement.

**Required evidence:** versioned fixtures identify deprecated/removed contracts,
compatible unchanged references, unknown target versions, and missing evidence.

## C09: Localization support pack

**Inputs:** resource keys, user locale, versioned translations, typed interpolation
values, and explicit date/number behavior.

**Outputs:** portable messages and display formatting through the existing
`VBD.I18n` functions, plus a resource-completeness report.

**Boundary:** no new localization engine if the supported platform/native API
suffices. Missing translation fallback is explicit; display-formatted numbers
must not be reused as invariant query values.

**Required evidence:** locale fixtures cover missing keys, fallback reporting,
escaping, date-only versus user-local values, and numeric formatting.

## C10: Configure, validate, preview, and wire Studio

**Inputs:** a selected supported pattern, permitted table/control metadata,
explicit context/bindings, and configuration contracts from Core.

**Outputs:** validated portable configuration, a non-mutating/redacted preview,
and exact per-surface library/function/parameter registration instructions.
Command/event instructions distinguish classic and modern designer limitations.

**Boundary:** a configuration/interaction authoring surface, not a workflow
designer. No durable state, schedules, approval waits, arbitrary code, or required
dependency for Core. It does not claim that exporting configuration registers
handlers or deploys a command. Saving/exporting configuration is a deliberate
Studio action; validation and preview remain non-mutating.

**Required evidence:** export/import round trips preserve configuration; direct
developer and Studio-produced configurations have equivalent supported behavior;
invalid bindings, unsupported surfaces, and workflow-engine definitions fail.

## Shared finding contract

Diagnostic/preflight/health/upgrade findings share:

| Field | Meaning |
| --- | --- |
| Stable check ID and capability ID | Identify the check and owning consultant capability. |
| Status | Pass, warning, fail, unknown, or unsupported; summary cannot hide incomplete checks. |
| Scope and source | Selected component/profile, source-versus-live evidence, target alias, and permissions used. |
| Expected and observed | Safe structural information, not secrets or business payloads. |
| Evidence time/version | Observation time, toolkit/schema version, and source revision where available. |
| Remediation | Actionable instructions, not automatically executed repair. |
| Correlation | Link related findings/errors without leaking sensitive context. |

Reports are read-only outputs under the customer's control. No external
telemetry/upload is required. Automatic fixes, tenant-wide discovery, and
privileged deployment are separate future scopes, not implied by these features.

## First implementation slice

Prioritize C01, C02, and C03. Start with one validated interaction configuration,
one explicit context, one source/target scope, and deterministic redacted reports.
Extend coverage through bounded implementation issues instead of waiting for
all runtime functions or building Studio first.

Only the scoped C1a source-level behavior has automated evidence. A diagnostic
panel, live metadata collection, deployed registration verification, and the
remaining capability requirements are unimplemented/unverified. This catalog
does not certify those broader behaviors.
