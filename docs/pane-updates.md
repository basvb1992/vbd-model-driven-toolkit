# Updating owned side panes

`VBD.SidePanes.update(originalHandleOrOwnedId, patch)` updates an existing pane
created through this toolkit instance. It reuses the original
[online desktop-Web ownership/lifecycle contract](core-usage.md#owned-side-panes-and-deep-links);
it cannot adopt a foreign app's pane or a forged/copied token.

```typescript
const pane = await VBD.SidePanes.createOrGet({
  paneId: "vbd_consumerSummary", title: "Summary", width: 400
});
const receipt = VBD.SidePanes.update(pane, {
  title: "Customer summary", width: 600, canClose: true, hidden: false
});
// receipt: { status: "updated", paneId, changed: ["title", "width"] }
```

## Exact supported patch

At least one defined property is required. Unknown fields, accessors, unsafe
prototype keys, explicit undefined values and malformed types fail before
native writes.

| Property | Contract |
| --- | --- |
| title | Nonblank text, at most 256 characters |
| width | Integer 300..1600 pixels |
| canClose | Boolean, including false |
| hidden | Boolean, including false |

These are documented [AppSidePane properties](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-app-appsidepane).
Badge values, external icon paths, paneId changes, hideHeader, alwaysRender and
keepBadgeOnSelect are **not implemented in this update subset**. They are
rejected, never ignored or approximated using guessed encodings. This helper
uses native public properties only; no DOM, CSS or iframe manipulation.

## Capability and mutation semantics

The original current pane identity is checked before, between and after writes.
Every requested property must exist with a matching primitive type and a
discoverable writable data descriptor/native setter, including supported
prototype descriptors, before the first write. A missing, readonly or otherwise
unverifiable property fails UNSUPPORTED_SURFACE rather than creating a fake
capability. Exotic host proxies without discoverable descriptors are outside
this subset.

Property application order is deterministic: title, width, canClose, hidden.
Identical values do not dispatch a setter. The receipt contains only the
properties actually changed and verified; it does not claim destination
content loaded, access changed, or server configuration was updated.

The per-pane busy guard blocks recursive update/close/reuse and updates during
pending create/navigation. It is always released in finally. Original native
setters keep their receiver; rejected or silently clamped values are errors.

Any error after a setter is attempted throws PARTIAL_FAILURE, **even if the
first setter threw**, because native side effects may already have occurred.
Its retained cause identifies completed changed properties, attempted property,
uncertain outcome and the original failure. Read-back observation failures are
retained alongside it, not silently swallowed or substituted for the original.
No automatic rollback or retry is performed.

Observed title/width/canClose changes from this update are remembered for
subsequent createOrGet reuse. Callers must pass the new matching options when
reusing the existing ID. If native read-back cannot establish valid options,
reuse remains conservative rather than guessing. Lifecycle calls on an
otherwise original owned instance still work after an update failure; they do
not require its title/size to match the creation snapshot. A native replacement,
rename, closure or SDK-host change instead invalidates that ownership.

Focused source fixtures cover exact title/width/type bounds, all-properties
preflight, prototype setters, no-op writes, original/forged/replaced ownership,
pending/reentrant busy behavior, partial and first-setter failures, silent
clamping, observed reuse and failure-safe lifecycle release. Native Dynamics
rendering/proxy/property behavior remains unverified until separately tested.
This source slice does not upgrade the currently deployed BvB test app.
