# Testing the toolkit in BvB

The standalone Core solution contains **two webresources only**:
`vbd_/toolkit/vbd.toolkit.js` and
`vbd_/toolkit/THIRD-PARTY-NOTICES.html`. It does not create an app, form, command,
table, environment-variable definition or test record. Importing the library
does not wire an existing application automatically.

For a launchable read-only example app, use the separate
[VBD Toolkit Playground companion](playground.md). Its app is in the
`VBDToolkitPlayground` solution; it is deliberately not added to Core.

**Current deployment:** standalone unmanaged `VBDModelDrivenToolkit` 0.7.0.0
is upgraded and its two resources are published in BvB Demo Apps. Import job
completion, zero component failures, exact component inventory, and the served
browser-resource SHA-256 were verified. No consumer test form/command handler
was created; follow the setup below to exercise the library in your own app.
The optional Playground 0.2.0.0 has 17 searchable/copyable examples and editable
safe local tools. Genuine current Core exports are retained locally pending
the owner's license decision; the old 0.5.0 GitHub draft remains unchanged.
This is not a clean managed-target or signed-in native form certification.

## Load it on a test form

Use an app and form you own for testing; do not change unrelated production
forms just to try the library.

1. In the maker portal, select the operator-confirmed BvB environment and open
   your **consumer/test solution**, not the Core solution.
2. Add the imported `vbd_/toolkit/vbd.toolkit.js` as a form library.
3. Add a consumer-owned JavaScript library with the handler below. Register
   `vbdToolkitSmokeOnLoad` on form OnLoad with **Pass execution context** enabled.
   Keep the toolkit library ahead of the handler library.
4. Save/publish that test form and open it through its model-driven app.
5. In browser developer tools, inspect the form's JavaScript execution context.
   Expect the source version shown in the release notes, explicit method-presence
   observations, and a record state without any dumped record payload.

```javascript
function vbdToolkitSmokeOnLoad(executionContext) {
  const context = VBD.Context.fromFormEvent(executionContext);
  const record = VBD.Context.getRecord(context);
  console.info("VBD toolkit smoke", {
    version: VBD.Diagnostics.getVersion(),
    capabilities: VBD.Diagnostics.getCapabilities(),
    recordState: record.state
  });
}
```

Do not load two toolkit bundles on the same page. Duplicate initialization is
an error; it never replaces another `VBD` runtime. An existing lowercase `vbd`
library is separate and is not overwritten.

## Try non-mutating behavior first

Start with capability observations and pure record/view link construction.
Use [core usage](core-usage.md) for exact arguments and current subsets.
Capability **presence is not permission, installation or support for every
client/option**. A record link neither opens a record nor grants access.

For panes, use a unique stable `vbd_`-prefixed pane ID, an existing custom page
or reviewed HTML webresource, and the original returned handle. The current
pane subset requires online desktop Web. Test foreign-ID rejection, repeated
creation, navigation completion and explicit close; do not use another
application's pane as a test target.

For environment variables, supply your consumer-owned definitions and values.
No default credentials or deployment-specific values ship in Core. See
[configuration contracts](environment-and-configuration.md) and
[launching](environment-launching.md) before registering a profile.
New windows must use the prepared, active-user-gesture path. Same-window profiles
must use their separate supported host contract, never an async popup workaround.

Only test create/update/delete, save, custom actions or business-rule behavior on
records specifically created for that purpose. Native/SDK checks do not replace
server permissions, field security, business rules or backups.

## Managed and unmanaged packages

BvB is the toolkit's development/test source and receives an **unmanaged**
installation. A genuine managed artifact is exported from that installation;
it is never fabricated by rewriting a ZIP flag.

Do not import that managed artifact into the same environment containing its
originating unmanaged solution. Use a separate approved clean target for managed
installation/upgrade validation. Lower-version managed import is not a general
rollback; removing a solution is not an automatic recovery strategy.

Public source visibility does not grant redistribution rights. While the
project remains UNLICENSED, release preparation is draft-only pending the
owner's license decision. See [distribution](distribution.md).

## What deployment verification does and does not prove

Read-only identity/version/component checks, staged dependency inspection,
successful native import, targeted webresource publication, exact server
content hashes and genuine export inspection are **deployment evidence**.
Local SDK fixtures, VM bundle smoke and offline PAC roundtrips are separate
source/package evidence.

Neither category alone proves that all 135 APIs behave correctly in every live
Dynamics form, security role, app, client or browser. Record the actual scenarios
you run, expected/observed results, toolkit/source version, and any missing
access or unsupported options. Do not copy real record values, tokens or
environment-specific credentials into GitHub issues or release attachments.

## Native form and command acceptance checklist

The searchable Playground distinguishes safe HTML-page examples from
**copy-only native host examples**. Copying a wrapper does not register it.
Use a consumer-owned test form/library and records explicitly approved for
testing. Never pass an HTML page's global context as a fabricated form context.

| Surface | Setup | Expected observation |
| --- | --- | --- |
| Form OnLoad/OnChange | Register a named consumer wrapper and enable Pass execution context. Resolve with Context.fromFormEvent. | Correct form/record state; missing fields fail explicitly; no automatic save or business write. |
| Form command | Configure the wrapper's parameter as PrimaryControl; resolve with Context.fromFormCommand. | Actual form context, not event-context assumptions. |
| Grid command | Supply SelectedControl and the actual documented selected references/IDs. Resolve with Context.fromGridCommand. | Only supplied selected rows are reported; empty/mixed selections follow the explicit policy. |
| Lookup filter | Use an actual supported lookup control and valid reviewed filter; retain/dispose the original registration. | Filter applies at PreSearch only and is removed by owned disposal; no parent DOM or foreign handler removal. |
| Choice baseline/restore | Use a singly bound supported choice control on test data; retain the exact baseline token. | Numeric identity/order preserved; excluded current selection rejects unless explicit clearing is chosen; unrelated/newer edits are not silently restored. |
| Form switching | Use a saved desktop-Web Update form with a permitted target. | Dirty form rejects by default; save policy is explicit and rechecks edits/identity; result means a navigation request, not target OnLoad proof. |
| Prepared app command | Prepare an approved newWindow profile on load/change, then use an active trusted command click. | No async reads between click and isolated window request; opener/referrer policy preserved; null handle remains unknown. |

Test at least one lower-privileged user separately from the administrator.
Permission denial must remain a visible failure/unknown where documented, not
be converted to missing data or allowed authorization. Do not grant roles to
make a test look green; document the actual intended access.

Keep evidence categories separate:

- **Automated source/browser fixtures:** deterministic helper behavior, rendered
  controls, keyboard/search/copy/error states and response limits.
- **Deployment/read-back:** native import result, exact owned identities,
  publication and served content hashes.
- **Live read adapter:** actual current-user Web API reads of owned toolkit
  resources/selected metadata through explicit typed adapters.
- **Native user acceptance:** signed-in app/form/ribbon/lookup interactions and
  role/browser matrix. This cannot be inferred from the first three categories.

If the automation browser is at Microsoft sign-in or no approved test form is
available, record the native checks as **not run**, rather than injecting tokens,
creating surprise consumer registrations or claiming a full live pass.
