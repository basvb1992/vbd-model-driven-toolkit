# Testing the toolkit in BvB

The standalone Core solution contains **two webresources only**:
`vbd_/toolkit/vbd.toolkit.js` and
`vbd_/toolkit/THIRD-PARTY-NOTICES.html`. It does not create an app, form, command,
table, environment-variable definition or test record. Importing the library
does not wire an existing application automatically.

For a launchable read-only example app, use the separate
[VBD Toolkit Playground companion](playground.md). Its app is in the
`VBDToolkitPlayground` solution; it is deliberately not added to Core.

**Current deployment:** standalone unmanaged `VBDModelDrivenToolkit` 0.5.0.0
is imported and its two resources are published in BvB Demo Apps. Import job
completion, zero component failures, exact component inventory, and the served
browser-resource SHA-256 were verified. No consumer test form/command handler
was created; follow the setup below to exercise the library in your own app.
Genuine managed/unmanaged exports are available as draft-release assets pending
the owner's license decision. This is not a clean managed-target certification.

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
