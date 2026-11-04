# Optional VBD Toolkit Playground app

Core is a reusable JavaScript library, not a model-driven app. The separate
**VBD Toolkit Playground** companion provides an app you can open to try safe
examples. Look for its app in the `VBDToolkitPlayground` solution, not in the
library-only `VBDModelDrivenToolkit` solution.

The companion contains one model-driven app, its sitemap and three webresources
(HTML page, compiled handlers and SVG icon). It requires the separately installed
Core webresource. Existing safe tools require Core 0.5.0; the additional
localization, choice baseline/restore, read-batch, retry and preflight examples
require Core 0.7.0. Each example checks its actual required methods, not just
the version string. It does not duplicate Core, add runtime exports, create
tables/records/flows/plugins, install consumer form/ribbon handlers, or grant
roles. Core API counts, solution versions/provenance and existing tags remain
outside this UI change.

## What you can try

| Action | Behavior |
| --- | --- |
| Inspect library | Loaded Core version and method-presence observations; no business query. |
| Run local examples | Literal false/zero bindings and a copy-isolated memory cache; no network reads. |
| Read variable | Explicit typed current-user environment-variable reads; values hidden unless you opt to reveal them. Secret/Data source guards remain enforced. |
| Validate JSON | Validates portable declarations without registering or resolving them. No code execution. |
| Build link | Pure record/system-view/personal-view URL preview for the current environment; no navigation or access claim. |

No example runs on page load. Only the explicit variable-read button makes
bounded GET requests to the two environment-variable entity sets. Requests use
same-origin browser credentials, reject redirects, time out after 20 seconds
and bound streamed responses to 2 MiB. No tokens are stored in the page or
configuration. Errors are visible safe diagnostics, not raw server causes.
Results are rendered as text, never HTML.

This sitemap HTML page uses the supported relative `ClientGlobalContext.js.aspx`
script. **It does not provide `Xrm`, a form or a ribbon context.** Native form,
lookup, dialog, save and command tests belong in the consumer-owned form/ribbon
setup described in [testing in BvB](testing-in-bvb.md). Missing host capabilities
in the Playground are expected, not evidence that the library failed to install.
It never reads a parent frame's DOM or fabricates a global SDK host.

## Find, edit, copy and run an example

The directory is a two-pane extension of the existing safe tools: search by
title, stable ID or API name, then combine category and surface filters. Empty
results explain how to recover. Selecting an example focuses its detail
heading. The detail pane shows minimum Core, exact required methods, actual
host, consumer-library wiring, editable parameters and **Copy TypeScript**.
No snippets are evaluated or installed by this page.

| Stable example ID | Category / surface | What to use |
| --- | --- | --- |
| `library-inspect` | Diagnostics / Sitemap HTML | Installed version, compiled-method observations and optional native SDK observations. Never asserts native support or an API count from a version string. |
| `form-onload` | Forms / Form event | `Context.fromFormEvent(executionContext)` and record state only. |
| `form-command` | Commands / Form command | `Context.fromFormCommand(PrimaryControl)` and record state only. |
| `grid-command` | Commands / Grid command | `Context.fromGridCommand(SelectedControl, SelectedControlSelectedItemReferences)`, selection snapshot and `Commands.validateSelection`. Editable expected table; no row retrieval. |
| `lookup-filter` | Forms / Form event | `Lookups.addFilter(context, controlName, filterXml, "account")` with a fixed active-account filter, original registration token and `removeFilter`. Editable control name. |
| `choice-restore` | Forms / Form command | `Choices.filterOptions(context, controlName, allowedValues, settings)` then `restoreOptions(context, controlName, baseline, settings)`. Editable existing option/control; opaque baseline remains local. |
| `prepared-command` | Commands / Form command | Existing `configurationName/profileKey`, `Events.onLoad`/`onChange` before click; `Commands.run(PrimaryControl, key)` or `runGrid(SelectedControl, selectedReferences, key)`. |
| `record-link` | Navigation / Sitemap HTML | Existing editable record/system-view/personal-view inputs; current same-origin allowlist, no navigation/access check. |
| `environment-read` | Configuration / Sitemap HTML | Existing explicit typed read; masked by default. Copied consumer code uses the native Core read context, not the companion adapter. |
| `literal-bindings` | Configuration / Sitemap HTML | Editable integer and literal false via `Bindings.resolveMany`; no missing-value coercion. |
| `memory-cache` | Configuration / Sitemap HTML | Editable configuration integer, approved `Cache.getOrLoad`, input-specific revision, one-second memory-only TTL. |
| `format-number` | Localization / Sitemap HTML | Editable finite number/BCP 47 locale via `I18n.formatNumber`; browser Intl support still required. |
| `translate` | Localization / Sitemap HTML | Fixed English/Dutch resources and editable literal greeting name via `I18n.translate`; missing-resource errors, no HTML. |
| `read-batch` | Execution / Sitemap HTML | Two fixed local read callbacks with editable integer and success/rejected-guard scenario via `Batch.execute`. Partial is not success. |
| `retry-read` | Execution / Sitemap HTML | Fixed local callback fails once with 429 evidence; editable integer and one/two-attempt budget via `Execution.withRetry`. Exhaustion is a failure, never a successful empty value. |
| `preflight` | Execution / Sitemap HTML | Fixed local check with pass/unknown/fail observation via `Execution.preflight`. Only ready succeeds; unknown remains incomplete. No tenant/access certification. |
| `validate-config` | Configuration / Sitemap HTML | Existing bounded editable JSON, `Config.validate` without registration or resolution. Invalid reports are not success banners. |

### Host and maker wiring

**Native examples are copy-only, never runnable here.** Build the displayed
consumer-owned TypeScript against the toolkit types as an IIFE with global name
`ConsultantExamples`. The exported function then has the displayed global
target, for example `ConsultantExamples.onLoad`. Upload the compiled JavaScript
to your own consumer/test solution, not Core or this companion. Load
`vbd_/toolkit/vbd.toolkit.js` before the consumer library; never load Core twice.
No generic maker handler is supplied or implied.

- Form **OnLoad**: register `ConsultantExamples.onLoad` with **Pass execution
  context** enabled. This wrapper calls `Context.fromFormEvent(executionContext)`.
- Form ribbon: target `ConsultantExamples.formCommand`, CRM parameter
  **PrimaryControl**. This is a form context, not event executionContext.
- Grid ribbon: target `ConsultantExamples.gridCommand`, CRM parameters
  **SelectedControl**, **SelectedControlSelectedItemReferences**, in that order.
  Do not substitute form context or row IDs without the documented table context.
- Lookup lifecycle: repeated OnLoad removes this wrapper's previous filter token.
  `ConsultantExamples.removeLookup` takes no parameters and removes only that
  registration. Review the lookup target table before wiring the fixed filter.
- Choice baseline: wire `ConsultantExamples.filterChoice` and
  `ConsultantExamples.restoreChoice`, each with PrimaryControl. A single-bound
  supported choice control and existing option identity are required. The
  original opaque baseline is usable only with the same live control and no
  competing writer; never serialize it. Excluding selected values is rejected.
  This is a local native mutation, not a server choice change or save.
- Registry/profile: the trusted registry/profile must already exist and use
  **newWindow**. Register the displayed OnLoad/OnChange wrappers with pass-context
  enabled; OnChange requires a relevant column registration. Preparation must
  finish **before** the user clicks the command. Grid-only consumers need their
  own prior supported preparation lifecycle in the same runtime. No preparation
  inside the click, delayed popup, async popup workaround or new provisioning UI.

Maker handoff: the consumer owner/AXIOM wires only their approved test
form/commands after reviewing these contracts. The Playground does not register
any library or handler. See [testing in BvB](testing-in-bvb.md),
[core usage](core-usage.md), [advanced forms](advanced-forms.md),
[localization](localization.md), [read batches](read-batches.md) and
[execution](execution.md) for restrictions and lifecycle details.

### Safety and state policy

Local runners use a reserved `https://local.invalid` scope and a synthetic user
identity, with a read adapter that always throws. They are real fixed callbacks,
not placeholder operations, and cannot query business records. These fixtures
do not certify real data adapters, retry permissions or preflight deployment
readiness. Editable fields cannot choose an API, callback, template, query or
executable code path.

Code is generated only for current validated inputs using JSON string escaping,
including quotes/newlines/script-shaped literal values. Invalid edits clear the
code and disable copying/running; prior results are invalidated. Link edits also
clear the generated URL. Copy revalidates at click time; denied/unavailable
clipboard access leaves a visible manual-copy instruction and focuses the code
or generated URL. Code and results use `textContent`, never HTML.

During an operation, selection, filters, editable fields and conflicting actions
are locked until settlement; failure always recovers controls. Changing a
selection/input clears previous output, including previously revealed variable
values. Read values remain masked unless the existing Reveal checkbox was
explicitly selected; copied native read code reflects that checkbox without
embedding any resolved value. Batch results show only status/counts/item IDs; preflight
shows bounded status/reasons. Partial, invalid, blocked and incomplete outcomes
are not wrapped in a successful banner. Errors never serialize original server
causes, tokens or values; optional diagnostics expose only safe code/correlation
identifiers.

Older/missing Core disables only unsupported runners/actions with missing-method
and minimum-version guidance. Inspect remains usable to explain missing Core;
native wiring and copy-only guidance remain available. A compiled namespace is
not proof that an SDK host, permissions or a supported native client exists.
Refreshing after installing/publishing Core is required.

## UI verification handoff

Stable selectors: `#example-search`, `#category-filter`, `#surface-filter`,
`#catalog-count`, `#catalog-empty`, `#example-list`,
`#example-<stable ID>` / `[data-example-id="<stable ID>"]`,
`#example-details`, `#example-heading`, `#availability`, `#example-wiring`,
`#example-fields`, `#input-<field ID>`, `#input-status`, `#run-example`,
`#example-code`, `#copy-typescript`, `#copy-status`. Existing action/input IDs,
`#result` and `#status` are preserved.

Suggested parent/SENTINEL rendered fixture flows (no fake Xrm or authenticated
browser takeover):

1. Initial directory: 17 entries, no fetch. Search `I18n.formatNumber`, combine
   Localization/Sitemap HTML, then search a nonexistent term and recover.
2. Select `translate`, edit `#input-person` with quotes/newlines/script-shaped
   text, run and copy. Verify literal text only. Deny clipboard permission and
   follow the visible manual-copy recovery; clear the input to disable code/run.
3. `format-number`: edit `#input-amount`/`#input-locale`; then try invalid number.
   `literal-bindings`/`memory-cache`: change `#input-count`; confirm false/zero
   and input-specific cache revision without fetches.
4. `read-batch`: set `#input-outcome` to `reject`; expect partial/error, not
   success. `preflight`: default `#input-observation=unknown` is incomplete;
   pass is locally ready, fail is blocked. `retry-read`: one attempt fails;
   two return the integer with two attempts and zero network reads.
5. `record-link`: Use current environment/app, enter a valid test ID, build/copy.
   Change table/destination/ID and confirm old URL disappears. Never navigate.
   `environment-read`: only explicit Read variable may fetch, same origin and
   masked until Reveal is opted into; uncheck Reveal to clear the old output.
6. Native examples show Copy only and exact wiring; no Run button/native calls.
   Remove `I18n`, `Batch`, `Execution` in a fixture or use older Core: only affected
   runners disable. Inspect reports actual version/method presence, not a count.
7. Hold a local runner promise pending: verify disabled selection/inputs and
   `aria-busy`, then safe failure/recovery. Inspect keyboard order, visible focus,
   screen-reader status, 390px mobile, 1280px desktop and 200% zoom/overflow.

Verification commands for this revision:

```powershell
npm run typecheck
npm run lint
npm run build:playground
npx vitest run tests/playground.test.ts tests/playground-examples.test.ts tests/playground-examples-ui.test.ts
```

Lane verification passed typecheck, lint, Playground build and **3 focused
test files / 77 tests** (19 existing, 58 added). The initial typecheck reported
missing `tsc`; the requested `npm ci --no-audit --no-fund` restored locked
dependencies before verification. No dependency manifests or lockfiles changed.

The new tests exercise source contracts, generated-wrapper strict TypeScript and
the compiled UI in a **non-rendered DOM contract fixture**, not a browser or
native-client certification. Rendered/input/accessibility checks and authenticated
native app/form/ribbon checks remain parent/SENTINEL-owned after integration.
Packaging, package-consumer parity, solution version/provenance, deployment and
release validation are parent-owned. Rollback is reverting only this UI/test/doc
commit and rebuilding companion assets; it does not roll back Core or remove
consumer-owned maker wiring.

## Build and package

From the repository root:

```powershell
npm run build
npm run build:playground
npm run check
node tools\playground\package.mjs artifacts\PlaygroundLocal01 "C:\path\to\pac.exe"
```

The output directory must be fresh. Native PAC packs/unpacks the companion;
the tool checks app/sitemap/resource inventory, the sole explicit Core dependency
and exact built resource hashes. Existing outputs are never overwritten.
Source is in `playground/`; compiled assets stay ignored in `dist/playground/`.
No extra npm dependencies or third-party assets are bundled.

The app's component list references its sitemap only. The three webresources
are separate solution roots and the sitemap opens the HTML resource. Import
rejects webresource AppModuleComponent entries that specify only schemaName
without an object ID; do not add those redundant entries. A failed initial
attempt was inspected and confirmed to leave no companion solution/app/resources
before applying this targeted correction.

The UI uses familiar system/Segoe typography, restrained Fluent-aligned colors,
native labelled controls, visible keyboard focus and a responsive two-to-one
column layout. Loading disables conflicting actions; errors recover controls;
long results wrap; no decorative motion is authored. The original deployed
companion's browser fixtures covered desktop/mobile/zoom and safe-read states.
The new directory still requires the rendered verification handoff above;
neither fixture category is a full accessibility/native-client certification.

## Installation boundary

Import Core first, then the optional unmanaged companion in the approved test
environment. Publish the companion app, sitemap and its three resources only.
Open the app by its display name **VBD Toolkit Playground**, or use the current
environment's `main.aspx?appname=vbd_ToolkitPlayground` deep link.

Do not grant extra roles just to suppress an access error. App visibility and
Dataverse read permissions remain the platform's responsibility. The companion
does not modify unrelated apps or the existing Core release. Public binary
publication remains draft-only while the toolkit is UNLICENSED.

## Historical BvB deployment evidence (original companion, not this UI revision)

The optional companion **0.1.0.0** is imported and published in BvB Demo Apps.
The corrected native package SHA-256 is
`c27d38b456630008f0ed624d7a74f99e44cd982b92e4320bef0441b24e07e7af`,
retained locally in ignored `artifacts\PlaygroundDeployment-02`.
Staging passed without missing dependencies/validation findings. Import
completed native state=3/status=30, progress=100 and zero component failures.

Read-back confirmed exactly **one active named app, one sitemap and three
webresources**, with no tables/flows/security-role components. Targeted
PublishXml published only those companion IDs. The app became visible in
`appmodules` after publication; checking that published collection before
publishing would incorrectly report a missing app.

The actual sitemap opens the expected companion HTML resource. All resource
content hashes match the built inputs; the published HTML endpoint returned
HTTP 200 and SHA-256
`341712d511e9981c5c382424cf24121c0c3ecf934762e0f33a1e6ba20a13f12a`.
No role grants, consumer wiring or business-data changes were made.

Source verification passed **29 test files / 1038 tests**, including the
existing actual Core PAC integration and the companion's actual native
pack/unpack/no-overwrite check. Browser fixtures exercised the compiled UI,
supported global-context adapter and no automatic data reads, without fabricating
Xrm. The live app URL correctly reaches the organization's Microsoft sign-in;
the automation browser has no signed-in BvB session, so authenticated native-app
rendering and every user's app visibility remain **unverified**, not assumed
from the successful import or fixture screenshot.
