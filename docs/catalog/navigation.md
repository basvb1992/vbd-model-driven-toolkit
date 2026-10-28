# Navigation, app launcher, and window functions

All entries are planned. See [catalog conventions](../function-catalog.md) and
the mandatory [app/window contract](../app-launching.md).

## VBD.Navigation

Use supported page-type contracts. Record forms, custom pages, HTML webresources,
and generative pages do not accept identical input objects or return values.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Navigation.openRecord` | ref, optional form/tab, supported data, presentation/chrome options | Navigation request/result | Native openForm for supported separate-window forms; navigateTo for dialogs; no main-form save callback assumption. | R1 |
| `VBD.Navigation.newRecord` | Table, approved defaults, mapping source, form/presentation | Create-form navigation request/result | Opening a main form is not creating/saving a record or promising a save/close completion. | R1 |
| `VBD.Navigation.quickCreate` | Table, supported defaults/options | Documented Quick Create save result | Only enabled/supported Quick Create forms; no separate window/tab or invented cancel callback. | R1 |
| `VBD.Navigation.openView` | Table, view ID/type | Navigation request result | Entity-list navigateTo is inline; no generic list-modal promise. | R1 |
| `VBD.Navigation.openDashboard` | Dashboard ID, supported options | Navigation request result | Use supported dashboard page behavior. | R1 |
| `VBD.Navigation.openCustomPage` | Page logical name, entityName/recordId, presentation | Documented navigation/close result | No arbitrary JSON in recordId or invented return payload. | R1 |
| `VBD.Navigation.openWebResource` | HTML webresource name, encoded data, presentation | Navigation/close result | Explicit supported data contract and origin boundaries. | R1 |
| `VBD.Navigation.openGenerativePage` | Page ID, supported context/data, presentation | Supported navigation result | Verify tenant/client feature and input configuration first. | R3 |
| `VBD.Navigation.openUrl` | Approved URL, host-supported size options | Host navigation request result | No undocumented host openInNewWindow parameter. | R1 |

## VBD.Dialogs

Dialog callbacks/results follow the platform page contract. Closing a dialog
does not prove a record saved. Refresh policies must account for that distinction.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Dialogs.record` | Existing/new record specification, title, size, position | Documented record-dialog result | Reuse navigation contract; validate percent/pixel sizes. | R1 |
| `VBD.Dialogs.customPage` | Page name, supported record context, title, size, position | Close completion | Custom-page return data requires a separately supported contract. | R1 |
| `VBD.Dialogs.webResource` | HTML resource, data, title, size, position | Close completion | No access to unsupported model-driven parent DOM. | R1 |
| `VBD.Dialogs.alert` | Message, title, button label, size | Acknowledgment | Supported accessible platform dialog. | R1 |
| `VBD.Dialogs.confirm` | Message/title, confirm/cancel labels | Confirmed/canceled outcome | Cancellation is explicit; don't treat it as an error or true. | R1 |
| `VBD.Dialogs.error` | Structured error, safe details policy | Dialog completion | Redacted actionable message and correlation ID. | R1 |

## VBD.SidePanes

Persistent app panes are a separate feature from side-positioned modal dialogs.
Use stable pane identities to avoid creating duplicates on every click.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.SidePanes.createOrGet` | Pane ID, title, supported width/options | Supported pane reference/token | Reuse matching pane; reject incompatible/unsupported options. | R1 |
| `VBD.SidePanes.navigate` | Pane token/ID, supported page input | Navigation completion | Do not promise arbitrary external iframe embedding. | R1 |
| `VBD.SidePanes.select` | Pane ID | Selection result | Require an existing supported pane. | R1 |
| `VBD.SidePanes.close` | Pane ID | Close result | Close owned/requested pane, not unrelated app panes. | R1 |
| `VBD.SidePanes.update` | Pane ID, supported title/badge/properties | Applied result | Capability-check individual platform properties. | R2 |

## VBD.Links

URL construction is pure and must validate schemes, origins, supported query
keys, IDs, and encoding. Never forward the entire form or current URL by default.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Links.record` | Approved environment/app identity, ref, supported form options | Validated URL | Build a documented model-driven record deep link. | R1 |
| `VBD.Links.app` | Approved environment and app identity | Validated URL | Current environment by default; cross-environment must be explicit. | R1 |
| `VBD.Links.view` | Approved environment/app, table, view identity/type | Validated URL | Use documented list/view addressing only. | R1 |

## VBD.Launch

Profiles bind environment variables and immediate context to supported destinations.
These are launch configuration helpers, not authentication or app provisioning.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Launch.getProfile` | Registered profile key | Validated unresolved profile | Check destination/presentation/override policy. | R1 |
| `VBD.Launch.prepareProfile` | Profile key, safe ctx, TTL/scope | `PreparedLaunch` | Resolve async configuration early; expire on dependency/scope change. | R1 |
| `VBD.Launch.openPrepared` | Prepared launch, immediate permitted bindings | Synchronous `LaunchResult` | Validate and request browser opening during user activation; no await before open. | R1 |
| `VBD.Launch.openProfile` | Profile key, ctx, supported non-popup presentation | Navigation request/result | Async convenience for inline/dialog/pane/host navigation; independent windows require openPrepared. | R1 |

## VBD.Windows

No window API forces browser UI, grants a separate login, or proves destination
readiness. Isolated-window and reusable-connected-window modes are distinct.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Windows.open` | Already validated app/external URL, isolated target/size/referrer policy | Synchronous `LaunchResult` | Not a replacement for native form navigation; no async resolution; no opener by default; null handle alone is not proof of blocking. | R1 |
| `VBD.Windows.openNamed` | Approved URL, stable name, explicit connected-mode policy | Request result and permitted handle/token | Optional reuse; cannot guarantee isolation/reuse together or manage cross-origin internals. | R3 |
