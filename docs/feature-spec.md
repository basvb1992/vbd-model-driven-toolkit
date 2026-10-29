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
145 runtime functions and the bounded local
tooling subset are implemented; see [getting started](getting-started.md) and
[environment/launcher usage](environment-launching.md). The remaining 53 functions
are planned; [core usage](core-usage.md) defines current subset limitations.

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

## Current source milestones: interactions, forms, and data

[Issue #5](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/5)
selects 97 additional catalog APIs, targeting 118 implemented APIs. This is
not a claim that all R1/R2/R3 behavior or a solution package is complete.

- Interaction milestone: Context 10, Utils 7 (except formatValue), Navigation 8
  (except generative pages), Dialogs 6, UI 5, Commands 5, and the three R1 Grids APIs.
- Form milestone: the 39 R1 Fields/Controls/Forms/Layout/Lookups/Choices/
  Validation/Events entries.
- Data milestone: the seven R1 Data, five R1 Query, and two Actions entries.

Preserve schema version 1. Maker command keys combine configurationName/profileKey.
OnLoad/OnChange prepare app profiles; the click path performs no asynchronous
preparation. Generic multi-operation recipes and automatic workflow execution
remain out of scope. The previously proposed, never-shipped Events.onSave
signature is refined to accept explicit synchronous rules or bounded JSON.

Mutations are explicit: no implicit field-save/change firing, no silently lost
dirty data, no ignored ETags, no automatic mutation retries, and no global
rollback claim. Validate all targets before a group change; expose partial
failure if the native host fails partway. Lookup PreSearch callbacks are
synchronous and owned/disposable; filter XML rejects DTD/entities.

Bounds are 100 field/control targets per call, 1000 collection/selection items,
200 local validation rules, 256 KiB filter XML, and 8192-character display
messages. Data paging/filter limits must be explicit and tested. SDK callbacks,
typed operation contracts and supplied contexts are trusted application code,
not functions supplied by JSON configuration.

Acceptance requires strict type/lint/build/package-consumer checks, adversarial
unit/CLI/bundle/doc coverage, and controlled browser evidence for the actual
portable XML validation path and a prepared command click with no extra reads. Source fixtures
do not certify real Dynamics forms, tenant permissions, mobile/offline behavior,
deployment, or managed/unmanaged installation. No tenant writes are authorized
by this source milestone.

### Current milestone evidence mapping

| Area | Source evidence | Unverified boundary |
| --- | --- | --- |
| Context/navigation/UI/grid adapters | `tests/interactions.test.ts`, package consumer and browser-bundle tests. | Live native form layouts, target access, all client/options variants. |
| Typed fields/controls/layout/save safety | `tests/forms.test.ts`, native method/dirty/reentry/partial-failure fixtures. | Actual tenant metadata/field security and server rules. |
| Owned lookup/events, rules and prepared commands | `tests/form-events.test.ts`, UTF-8/character/DTD limits and synchronous request observations. | Native app registration/settings and specialized lookup behavior. |
| Bounded data/query/action contracts | Data/query/action suites, bounds and cross-realm browser builds; no live writes. | Actual tenant queries, custom operation metadata and conditional adapters. |
| Source-backed availability | `npm run docs:availability`, documentation/export parity checks. | Implemented subset is not a complete SDK/milestone certification. |

Controlled browser evidence on 2026-10-28 used the built 0.3.0 bundle in Chrome
156.0.4314.50 with synthetic routed `.example` pages and SDK fixtures. It observed
118 methods; malformed XML/DTD rejection; filter application only in PreSearch;
owned disposal; synchronous save prevention; one safe not-ready presentation;
OnLoad preparation; a trusted command click that opened before its promise
settled, with reads unchanged at six; null opener/empty referrer/no Referer
header; and one failed inactive-gesture outcome without another open/read.
The inactive attempt produced the second error presentation, not a delayed popup.
Both fixture pages/routes were removed. This is not a real Dynamics form,
server query/write, authorization, mobile/offline, or tenant deployment check.

## Local delivery integration slice

[Issue #11](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/11)
integrates the bounded [C05/C08 consultant tools](consultant-tools.md) and
[offline packaging](solution-packaging.md) with the current 0.3.0 core in an
isolated branch. User outcome: consultants can compare supplied sanitized
evidence and build an honest local unmanaged Core artifact from the same
reviewed sources, without requiring the Workflow/Interaction Framework.

Scope: preserve the 118 runtime exports, exact two-resource solution boundary,
shared browser build options, current solution/runtime versions, complete notices
for every bundled dependency, locked-input fingerprints, and original lane
provenance. No merge, tenant authentication/access, import/export/publish,
automatic app wiring, license decision or public release is included.
Assumptions: locked local dependencies, installed native PAC, fresh local output
paths and caller-supplied sanitized evidence. Reject unknown dependencies,
stale builds, incomplete notices, mismatched versions, unsafe archives and
existing outputs. Managed creation remains explicitly blocked.

| Observable acceptance criterion | Verification | Remaining boundary |
| --- | --- | --- |
| Integrate exact lane changes without editing original worktrees. | Separate branch and cherry-pick provenance; original heads/dirty states preserved. | Original PRs are not merged. |
| Current version/build/dependencies/notices agree. | Packaging source tests, shared-contract rebuild, exact notice comparison, scoped/fallback/unknown-package/lock-mismatch regressions. | Fingerprints do not establish trusted tagged provenance. |
| Package current 0.3.0 / 118-function runtime, not the old baseline. | Explicit actual-PAC pack/unpack/repack; archived JS VM inspection and payload hashes. | Not a live Dynamics installation or query/write test. |
| Preserve independence, bounded inspection and managed/no-overwrite gates. | Two resources, zero Dataverse dependencies; ZIP/XML/input/managed/no-overwrite tests. | Genuine managed export, clean import/upgrade and public release remain unverified. |
| Keep consultant reports local and evidence-qualified. | Consultant suites; supplied snapshot/manifest examples and redaction/exit-code tests. | No live collection or authoritative deprecation claims. |
| Make current delivery scope discoverable. | README, roadmap, distribution and linked usage guides. | Broader runtime catalog and Studio remain planned. |

## Navigation/capability continuation

[Issue #13](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/13)
scopes seven R1 APIs: four owned `SidePanes` helpers, `Links.record/view` and
`Diagnostics.getCapabilities`. The outcome is portable record/view links,
reusable native pane identities and honest API-presence observations.
This is a 0.4.0 source milestone, not completion of R1 or tenant certification.

Use the existing SDK invocation and origin/identity validators. Pane ownership
is per SDK-host/page instance, not server authorization. Coalesce identical
concurrent creation, reject foreign/incompatible IDs, bound tracked identities
to 32, and reject forged/stale/replaced handles. Do not retry native mutations
or close a pane as rollback. Serialize navigation; reject close during navigation.
Only online desktop Web clients and persisted-record/custom-page/webresource
page inputs are supported initially. No external URL/iframe/DOM contract.

Deep links must be pure and strictly allowlisted, including nested `formid`
encoding and savedquery/userquery type codes. Capability diagnostics inspect
method presence only; they neither invoke SDK functions nor infer access.
Config.load/resolve, Bindings/Cache/Security and non-popup `Launch.openProfile` remain planned.
No new dependencies, PR merges, tenant authentication/access, deployment,
managed conversion, automatic wiring or public redistribution are authorized.

Acceptance maps to focused native/lifecycle/link/probe fixtures, browser export
and package-consumer checks, complete source availability (125/198), matching
0.4.0/0.4.0.0 descriptors, full checks and explicit actual-PAC unmanaged
roundtrip. Real Dynamics pane rendering/access and clean imports remain unverified.

| Acceptance | Verified evidence | Unverified boundary |
| --- | --- | --- |
| Pure approved-origin links, nested form IDs, system/personal view codes and unchanged window policy. | `tests/navigation-helpers.test.ts`; browser-bundle link smoke. | Actual target record/view/form access. |
| Native ownership, concurrent creation, stale/forged/replaced/renamed handles, lifecycle locks and capacity. | Focused fixtures cover 32 tracked IDs, pending work, failures, reentry and host replacement; 300/1600 width and title/data thresholds. | Real Dynamics pane identity/resize/rendering behavior. |
| Capability observations without business actions/value reads. | Getter-failure, absent/present and non-invocation fixtures; browser-bundle smoke. | Presence is not native support, access or installation. |
| Compatible exports, versions, notices and isolated source. | Full check: 22 files / 707 tests with native PAC; strict types/lint/build/package-consumer checks; 125/198 availability. | The remaining 73 APIs and ten remaining R1 entries are not implemented. |
| Actual current packaged runtime and independence. | Actual PAC 2.12.2 unmanaged pack/unpack/repack; exact reusable archive reports 0.4.0 / 125 methods, two resources, zero Dataverse dependencies, nine complete package notices and 201 matching input fingerprints. | No managed export, tenant import, clean upgrade or public release. |

## R1 completion and BvB test-release slice

[Issue #15](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/15)
scopes the final ten R1 APIs and operator-authorized BvB deployment preparation.
Target source/solution versions are 0.5.0/0.5.0.0, with 135/198 APIs; 63 R2/R3
entries remain planned. Parallel isolated lanes own Config/Bindings/Cache (seven)
and Security (two); the integrator owns non-popup Launch.openProfile and release
orchestration. Existing PRs/worktrees/artifacts remain intact.

Preserve schema-v1 declaration safety, scoped bounded copy-isolated memory
caching, binding source/path/depth/cycle limits, typed environment provenance
and errors, and current namespace/SDK/window contracts. Same-window profiles
are separate from newWindow profiles; async openProfile must never become a
popup convenience. Privilege/table hints must retain allowed/denied/unknown
semantics and cannot substitute for server authorization.

Deployment is restricted to the standalone two-webresource toolkit after
current-target identity, installed-version/component checks and staged
dependency validation. Publish only toolkit resources; do not wire consumer
forms/apps or change environment-wide security. Genuine managed/unmanaged
exports must match the verified source/version/payloads, with accurate residual
live/clean-target verification limitations and no fabricated managed metadata.

The repository is now public, while its license remains UNLICENSED. License
confirmation was unavailable: preserve rights and prepare a GitHub draft
release rather than treating an unanswered license prompt as permission to
grant redistribution rights. Do not invent ALM approval identities or site
markers for this non-Power-Pages toolkit. Record unfulfilled deployment/release
gates explicitly; source/CLI success alone is not deployment evidence.

Pre-deployment read-only checks found an existing general VBD publisher with a
different option-value prefix. The toolkit must not overwrite that publisher.
Before the first actual toolkit install, its dedicated publisher unique name is
therefore `VBDModelDrivenToolkit` (display `VBD Toolkit`), retaining prefix `vbd`,
portable option prefix 59926 and the same solution/resource/component identities.
The packager pins this exact publisher, rather than broadly accepting arbitrary
publishers. Original local-only artifact identities remain historical.

The Power Pages-only plan wizard does not apply to this standalone model-driven
webresource solution. No site markers or approved-plan stamps are fabricated.
The operator's current request authorizes BvB testing; the active BvB Demo Apps
identity was checked against PAC and Dataverse WhoAmI, with no installed toolkit
or colliding resource/dedicated-publisher names. The bounded manual path stages
the exact reviewed artifact, requires Passed/zero validation/dependency errors,
imports without force-overwrite, publishes only the toolkit resource IDs and
reads back content before genuine export. No production target is inferred.

Source verification: 27 files / 997 tests passed with explicit native PAC,
strict types/lint/build/package-consumer checks and complete 135/198 exports.
Local pack/unpack/repack over the 0.5.0 source contains exactly two resources
and nine runtime packages, with zero Dataverse dependencies. StageSolution
returned Passed with zero missing dependencies/validation findings and only the
solution plus two resources. Actual import/publication/export evidence is
recorded below. A managed clean-target test remains separate.

### Actual BvB deployment evidence

The exact staged unmanaged 0.5.0.0 artifact was imported without force-overwrite
or workflow activation. Native async completion was state=3/status=30; import
progress=100 with only success results and zero component failures. Read-back
confirmed the dedicated publisher and exactly two webresources matching the
reviewed browser/notices hashes. Targeted PublishXml published only those IDs;
the browser webresource endpoint returned HTTP 200 with the exact source hash.
The unrelated general VBD publisher retained its original settings. No consumer
wiring, business data or global security setting was changed.

Native PAC then exported unchanged genuine managed/unmanaged 0.5.0.0 packages.
Both preserve 135 runtime methods and identical resources/notices. The closed
validator gained a separate explicit dataverseExport dialect for only observed
server 9.2 metadata, fixed zero padding, default flags and deterministic
resource/content-type paths. The original PAC dialect remains unchanged;
unknown attributes/fields/padding and extra components are rejected. Raw export
bytes were not rewritten. Checksums and remaining release gates are in
[packaging evidence](solution-packaging.md#current-050-bvb-test-evidence).

This fulfills the development test-install/export portion, not all live UI
behavior, managed clean-target import/upgrade, publisher/license governance or
public production release. The repository is public; no license was invented.

Final source plus closed export-dialect validation passed 27 files / 1013
tests with actual native PAC, strict types/lint/build and consumer declarations.
GitHub draft release assets retain genuine export bytes and checksums; public
binary publication remains blocked by the unresolved license decision.

## Optional Playground companion

[Issue #17](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/17)
addresses the missing launchable test experience without changing Core into
an app. A separate `VBDToolkitPlayground` solution supplies one model-driven
app/sitemap and three read-only example webresources; Core stays library-only.
There are no new runtime APIs, tables, business records, workflows, consumer
wiring or role changes.

Use the supported HTML-webresource global context, not parent DOM/Xrm access.
Explicit current-user reads are limited to bounded same-origin environment
metadata/values, with protected types rejected and values masked by default.
All output is text; no arbitrary script/query editor or write operations.
The [usage guide](playground.md) defines the UI and package contracts.

Acceptance maps to focused adapter/source-boundary tests, actual native PAC
pack/unpack, unchanged Core regression gates and browser fixtures covering
explicit-only reads, local examples, links, masking/text rendering, recoverable
errors, keyboard focus, desktop/mobile overflow and 200% zoom. BvB staging must
pass with no missing dependencies; actual import/publication/read-back must
confirm app, sitemap and exact resources. Real native app rendering is verified
only when an authenticated browser session can open it; otherwise record that
boundary and provide the direct app link. Core's existing tag/draft/assets and
unrelated applications must remain unchanged.

Actual evidence: corrected companion import and targeted app/sitemap/resource
publication succeeded, with zero component failures and matching server/served
resource hashes. The published app collection contains the active named app;
Core remains unchanged. The first import's unresolved redundant webresource
AppModuleComponent entries were removed after confirming the failure left no
companion records. Browser fixtures cover the read-only UI at desktop/mobile
widths, keyboard focus and 200% zoom. Live native launch reaches Microsoft
sign-in; authenticated native rendering remains unverified because the
automation browser has no BvB session. See [deployment details](playground.md).

## R2 metadata, form UX and operation-lock slice

[Issue #19](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/19)
selects ten R2 catalog APIs: five Metadata methods, three advanced Choices
methods, Forms.switchForm and Execution.withLock. Target source/solution versions
are 0.6.0/0.6.0.0, with 145/198 APIs across 30 namespaces. This does not implement
retry/preflight, dependency-bound lookups, relationship writes, batch/aggregate,
files, recipe execution or the other 53 candidates.

Metadata discovery is read-only and bounded, with explicit supported native or
typed adapter shapes, own safe copied outputs and environment/user/language
scope. Requested properties, choice labels/language and relationship identities
must be validated, not guessed from display labels. Unknown/incomplete/denied
metadata must not become an empty successful result. Caches and invalidation
must reject stale asynchronous completions and never retain failures.

Choice controls use original owned baseline tokens and supported option APIs.
Preflight capabilities/values before mutation; preserve/clear/report excluded
selection only under an explicit documented policy. No implicit OnChange/save
or imaginary rollback on partial native failure. switchForm uses actual
permitted formSelector items, explicit dirty behavior and post-save/reentry/
context checks; completion is a request, not proof of navigation.

withLock reserves a bounded scope/namespace/key/optional-record identity before
trusted typed callbacks run. Duplicate policy is rejection or an explicit busy
receipt, never an unbounded queue/reentrant wait. Finally release is
ownership-safe and scope changes are failures; it is a page-local UX mechanism,
not server authorization or durable workflow coordination.

Acceptance requires focused bounds/invalid/denied/copy/lifecycle/partial/race
tests, real browser-bundle and package-consumer parity, full gates and actual
native PAC unmanaged roundtrip over the current version. Metadata/control
native Dynamics behavior is not certified by fixtures alone.
Two isolated implementation lanes own Metadata and form UX; the integrator
owns locks, shared exports/version/catalog/spec and packaging. BvB's deployed
0.5.0 Core and 0.1.0 Playground, existing tags/draft assets, unrelated worktrees
and PRs remain unchanged. No deployment, tenant queries/writes, public binary
publication, license decision or merge is authorized by this source slice.

### R2 evidence and native limits

The original metadata lane commit is `2e8df3e`; the form/choice lane is
`dbaac9b`. They are applied in the isolated integration branch without changing
those worktrees. Parent-owned withLock adds no retries or server operations.

| Acceptance area | Evidence | Explicit limitation |
| --- | --- | --- |
| Read-only metadata identity, selected facts, safe copies, labels/relationships and cache races. | 148 focused `tests/metadata.test.ts` cases plus compiled cross-realm adapter smoke. | Native selected table/base/Boolean facts only; choices/relationships/extended facts require scope-attested read-only adapters. No live tenant metadata certification. |
| Choice baseline/restore ownership, explicit excluded-value policy and native partial failures. | `tests/advanced-forms-choices.test.ts` and compiled original-token set/restore smoke. | Singly bound choice/choices controls with numeric Int32 baselines; nonnumeric blank and multi-bound shapes reject rather than guess. Native ABA edits with identical state cannot be observed. |
| Permitted target/dirty/save/form identity and reentry safety. | `tests/advanced-forms-switch.test.ts` and compiled target-selector request smoke. | Saved desktop-Web Update forms only; no destination OnLoad/native transition proof. |
| Bounded duplicate lock, scope/record identity, failure/finally lifecycle. | 32 focused lock cases plus compiled busy/callback smoke and public generic consumer types. | Page-local only; no TTL/queue/retry/distributed locking or rollback. Unobserved away-and-back scope changes cannot be detected. |
| Existing behavior, public export/type/count and packaging consistency. | Full source gate and current offline PAC artifact checks recorded in [packaging evidence](solution-packaging.md#current-060-r2-source-evidence). | Source 0.6.0 is not the installed/exported BvB 0.5.0 test version. No new import or managed export. |

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
| DOC-04 | Consultant capabilities have priorities, inputs, outputs, ownership, boundaries, and verification criteria. | Capability coverage and cross-document consistency checks. | Documented; bounded C1a and C05/C08 local tooling implemented, broader capabilities planned. |
| SEP-01 | Core works in an environment without the Workflow/Interaction Framework. | Dependency inspection and clean-environment import/smoke checks with no framework installed. | Local package has zero Dataverse dependencies; clean-environment import remains unverified. |
| SEP-02 | Recipes remain bounded client interactions, not durable workflows. | Validator tests reject durable waits, triggers, cycles, resume state, and persistent retry definitions. | Planned. |
| API-01 | Public functions are under `VBD`; toolkit assets use `vbd`. | Type/build checks and exported-symbol/solution inspection. | 145-function source namespace; deployed BvB still has the verified 135-function 0.5.0 version. Full live coverage remains separate. |
| API-02 | Typed and maker-facing calls use the same validated operation contracts. | Unit tests plus form and command registration examples. | Prepared-profile command/load adapters share the typed launch core; other configured operations remain planned. |
| CFG-01 | Effective environment values, absent values, false/zero/empty, type errors, and access errors are handled distinctly. | Resolver tests and Dataverse integration fixtures. | Explicit unambiguous current/default semantics checked with typed adapters; real tenant/layered resolution unverified. |
| CFG-02 | Secret variables never return browser-readable secret values. | Type guard tests, negative integration test, and redacted diagnostics check. | Type-before-value and redaction adapter tests pass; live negative tenant check unverified. |
| NAV-01 | Configured app profiles launch without source edits between environments. | Two deployment configurations and verified generated destination URLs. | Approved destination/scope/preparation adapter tests pass; real deployment remains unverified. |
| NAV-02 | Window launch respects user activation and reports only observable outcomes. | Real-browser click, blocked/unknown cases, and session/isolation checks. | Controlled Chrome click, inactive rejection, no extra reads, opener/referrer isolation and honest unknown result verified; real tenant/SSO and other browsers unverified. |
| FORM-01 | Form values, multiple bound controls, events, and save policies behave explicitly. | Unit tests and model-driven form smoke scenarios. | Native host fixtures cover the bounded subset; live Dynamics form checks unverified. |
| DATA-01 | Queries respect paging limits; mutations report partial failures and retry safely. | Paging, throttling, concurrency, and failed-record tests. | Bounded paging/conditional/mutation uncertainty fixtures checked; no automatic mutations retry or live writes. |
| SEC-01 | Client UX never substitutes for server authorization. | Denied-permission tests and unsupported-operation checks. | Planned. |
| ALM-01 | Managed and unmanaged ZIPs come from the same tagged source. | Reproducible build, solution inspection, and import checks. | Genuine paired exports match the 0.5.0 runtime; unmanaged source import verified. Clean managed import/upgrade and public-release governance remain outstanding. |
| ALM-02 | Imports do not overwrite consuming app handlers/configuration automatically. | Clean-environment install and existing-app regression checks. | Planned. |
| CON-01 | Diagnostics and preflight are read-only and distinguish pass, warning, fail, unknown, and unsupported with evidence. | Known misconfiguration fixtures, denied-access cases, and write-detection checks. | Source/supplied-snapshot semantics verified locally; live checks/panel planned. |
| CON-02 | Generated handover distinguishes declared configuration from verified deployed registration. | Compare generated Markdown/HTML with fixtures and an inspected deployed sample; confirm redaction. | Markdown fixtures and unverified labels checked; live deployed comparison/HTML planned. |
| CON-03 | Comparison/upgrade reports identify relevant drift without treating intentional environment differences as errors or exporting sensitive values. | Two sanitized snapshots, expected-difference policy, deprecated-config fixtures, and redaction checks. | Bounded local C05/C08 tests and supplied evidence checked; live collection and authoritative compatibility policy unverified. |
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
