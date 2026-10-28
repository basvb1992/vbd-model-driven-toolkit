# Optional VBD Toolkit Playground app

Core is a reusable JavaScript library, not a model-driven app. The separate
**VBD Toolkit Playground** companion provides an app you can open to try safe
examples. Look for its app in the `VBDToolkitPlayground` solution, not in the
library-only `VBDModelDrivenToolkit` solution.

The companion contains one model-driven app, its sitemap and three webresources
(HTML page, compiled handlers and SVG icon). It requires the separately installed
Core 0.5.0.0 webresource. It does not duplicate Core, add runtime exports, create
tables/records/flows/plugins, install consumer form/ribbon handlers, or grant
roles. Core's 135/198 source API count and existing test tag stay unchanged.

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

The UI uses familiar system/Segoe typography, restrained Fluent-aligned colors,
native labelled controls, visible keyboard focus and a responsive two-to-one
column layout. Loading disables conflicting actions; errors recover controls;
long results wrap; no decorative motion is authored. Browser fixture checks
cover desktop 1280px, mobile-width 390px, 200% zoom, keyboard focus, read-only
behavior, masked/revealed values, text-only rendering and recoverable errors.
These are not a full accessibility or native Dynamics client certification.

## Installation boundary

Import Core first, then the optional unmanaged companion in the approved test
environment. Publish the companion app, sitemap and its three resources only.
Open the app by its display name **VBD Toolkit Playground**, or use the current
environment's `main.aspx?appname=vbd_ToolkitPlayground` deep link.

Do not grant extra roles just to suppress an access error. App visibility and
Dataverse read permissions remain the platform's responsibility. The companion
does not modify unrelated apps or the existing Core release. Public binary
publication remains draft-only while the toolkit is UNLICENSED.
