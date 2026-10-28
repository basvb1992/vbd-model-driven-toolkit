# App launching and independent windows

An independent window means a separate browser top-level browsing context.
It does not mean offline execution, another browser profile, a separate
authentication session, or access outside the user's licenses and privileges.

All APIs in this document are proposed.

## Destination and presentation are separate

| Destination | Proposed handling | Constraints |
| --- | --- | --- |
| Model-driven app | Build a supported app URL with app module identity. | Destination app must exist and be accessible. |
| Record/view/dashboard | Supported navigation or documented deep link. | Validate IDs, page type, and permitted parameters. |
| Custom page | Supported in-app navigation/dialog/side pane. | Do not invent a standalone arbitrary custom-page URL contract. |
| Generative page | Supported client navigation where available. | Capability and parameter contracts require verification. |
| Canvas app | Launch an approved player URL. | No claim that the toolkit operates inside the Canvas runtime. |
| External web app/help | Approved HTTPS destination. | Origin/path policies and no sensitive automatic query forwarding. |
| HTML webresource | Supported webresource navigation. | Explicit data contract and lifecycle. |

| Presentation | Meaning |
| --- | --- |
| Inline | Navigate within the current model-driven app using supported APIs. |
| Center/side dialog | Modal destination using supported `navigateTo` options. |
| App side pane | Persistent pane managed through `Xrm.App.sidePanes`. |
| New tab/window request | Browser-controlled top-level navigation request. |
| Reusable named window | Optional explicit connected-window mode; not default isolation. |

The host `Xrm.Navigation.openUrl` API documents `height` and `width`, not a
universal `openInNewWindow` option. Do not copy options from PCF navigation APIs
and assume the model-driven client API accepts them.

For record forms opened from inside the model-driven app, prefer supported
`Xrm.Navigation.openForm` or `navigateTo`, not a raw `window.open` form URL.
`openForm` does support `openInNewWindow` and documented width/height/chrome
options. Quick Create does not support a separate window/tab.

The `openForm` success callback applies to saved Quick Create records, not an
ordinary existing/new main form. Do not wrap a main-form open in a promise that
waits forever for an unsupported save/close callback.

Optional minimal-chrome record windows can expose supported `navbar`/`cmdbar`
settings with their documented constraints. They do not remove authorization
or force browser chrome. Navigation-bar URL settings are not effective in
multisession/workspace apps where the platform documents no support.

The independent browser app-launch path is for approved app/external destinations,
not a replacement for the native form adapter. A configuration requesting an
unsupported destination/presentation combination must fail validation.

## Launch profiles

A profile declares:

| Property | Meaning |
| --- | --- |
| `key` | Stable maker-facing name such as `customerWorkspace`. |
| `destinationKind` | Model-driven, approved Canvas URL, external URL, or supported in-app page. |
| `environment` | Current environment or an explicit validated environment binding. |
| `app` | App ID or supported unique name, or a permitted URL binding; never inferred from a display name. Use appid or appname, not both. |
| `page` | Optional supported record/view/dashboard destination. |
| `presentation` | Inline/dialog/side pane/new browsing context where supported. |
| `size` | Requested browser/dialog size; browser may ignore window features. |
| `parameterBindings` | Explicit allowlist of bound values and approved query keys. |
| `originPolicy` | Approved origins and paths; immutable to untrusted per-call input. |
| `fallbackPolicy` | Fail or use a specifically configured alternative; never silent fallback. |
| `dirtyFormPolicy` | Require save, ask, or proceed only where intentionally configured. |
| `reusePolicy` | Isolated by default; named reuse only as a separate explicit mode. |

Proposed workflow:

1. Configure target identities/URLs using environment variables.
2. Register a validated named profile in the consuming solution.
3. Prepare the profile on a supported load event.
4. Pass context and the profile key from a command.
5. Bind only permitted record/field values, revalidate, then request navigation.
6. Return only observable request metadata; report errors or configured fallbacks.

## User activation and asynchronous reads

Browsers can block a window opened after awaiting an environment-variable or
Dataverse read. The separate-window path must not depend on first fetching its
configuration after the user clicks.

- `VBD.Launch.prepareProfile` resolves safe asynchronous configuration before use.
- `VBD.Launch.openPrepared` validates the prepared scope/version and calls the
  browser-opening operation synchronously within the click's activation path.
- Dynamic form/selection bindings must be immediately available and validated.
- A missing/stale profile produces `CONFIG_NOT_READY` or `CONFIG_EXPIRED`.
  The maker adapter can explain that the user should retry after preparation.
- Do not open a surprise delayed popup, bypass blockers, or silently replace the
  current app. A same-tab fallback is allowed only if explicitly configured.
- The first implementation will not reserve blank windows and retain openers
  while asynchronous configuration loads.

Form save or a confirmation can also affect activation. If the flow requires
asynchronous preparation/save before opening, design a second explicit launch
gesture rather than assuming the original activation survives.

## Isolation, reuse, and messaging

Default new-context launches use an opener-isolated approach such as `noopener`,
with referrer behavior governed by an explicit policy. Requesting `_blank` is
not a guarantee that the browser opens a physical window rather than a tab.

A named reusable window and strict opener isolation are different modes. Browsers
can treat named targets differently with `noopener`; do not promise both reliable
reuse and complete opener isolation. Connected/named reuse remains a later,
explicit opt-in capability with its own security review.

An isolated cross-origin app cannot be inspected, refreshed, closed, or monitored
by the toolkit. Optional messaging only applies to cooperating pages with trusted
origins and a validated protocol. It must not be required for a normal launch.

All windows can share existing SSO/cookies. No function creates a separate sign-in
identity or grants access to the target environment.

## Honest launch results

Browser APIs may return no usable window handle when opener isolation is used,
even when the request succeeds. A null handle alone is not proof of blocking.

`LaunchResult` distinguishes a request issued, a provably blocked operation, and
an unknown browser outcome. It must not claim that:

- the user reached the destination;
- the destination app finished loading;
- the user had permission there;
- a record was saved; or
- a remote application returned data.

Custom-page and record dialogs likewise use their actual documented close-result
contracts. Dialog closure alone does not mean a save succeeded.

## Verification matrix

| Scenario | Expected evidence |
| --- | --- |
| Prepared profile from a direct click | Correct permitted URL requested in a real browser. |
| Unprepared/stale profile | Explicit not-ready/expired result; no surprise popup. |
| Popup disallowed | Observable blocked outcome or honest unknown; no false success claim. |
| Browser chooses a tab | Accepted browser behavior; no promise of forced window chrome. |
| Dirty/unsaved form | Configured policy applied without silent save/discard. |
| Cross-environment app | Correct approved origin/app; existing SSO may be shared. |
| Malicious scheme or unapproved origin | Rejected before navigation. |
| Sensitive field binding | Rejected unless that exact export is approved; no default forwarding. |
| Named reuse requested with strict isolation | Unsupported combination rejected or explicitly separated. |
| Mobile/offline | Capability result, not an assumed desktop fallback. |
