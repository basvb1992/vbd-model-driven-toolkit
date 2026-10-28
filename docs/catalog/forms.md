# Form, control, and lookup functions

The 39 R1 entries are implemented in a bounded source subset; seven R2 entries
remain planned. See [catalog conventions](../function-catalog.md) and
[current signatures/policies](../core-usage.md).
These functions require the appropriate supplied form/control context. Missing
attributes/controls are errors unless an explicit optional-target policy is
declared. Returning silently would hide incorrect maker configuration.

## VBD.Fields

Setting values does not imply firing OnChange or saving. Those behaviors must
be explicit. Date-only, user-local, and time-zone-independent values need
different documented handling.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Fields.get` | ctx, column, expected type | Typed value or legitimate null | Validate attribute type; distinguish null from missing attribute. | R1 |
| `VBD.Fields.set` | ctx, column, value, change/submit policy | Change result | Type-safe set; no implicit save or event loop. | R1 |
| `VBD.Fields.clear` | ctx, columns, change policy | Per-field change result | Set supported null values; don't invent empty defaults. | R1 |
| `VBD.Fields.copy` | ctx, source/target mappings, overwrite policy | Mapping result | Validate conversions and lookup types. | R1 |
| `VBD.Fields.setDefault` | ctx, column, value, empty policy | Applied/skipped result | Preserve existing values unless explicitly allowed. | R1 |
| `VBD.Fields.setRequired` | ctx, columns, none/recommended/required | Applied result | Client changes cannot remove server-required constraints. | R1 |
| `VBD.Fields.setSubmitMode` | ctx, columns, dirty/always/never | Applied result | Explicit platform semantics; no implied persistence. | R1 |
| `VBD.Fields.fireOnChange` | ctx, column, reentry policy | Dispatch result | Prevent unintended recursive recipe execution. | R1 |
| `VBD.Fields.getLookup` | ctx, lookup column | `EntityRef[]` or null | Preserve single/multi lookup semantics. | R1 |
| `VBD.Fields.setLookup` | ctx, column, refs/null, change policy | Change result | Validate target table and lookup cardinality. | R1 |

## VBD.Controls

An attribute can appear in body, header, or process controls. Operations by column
must deliberately apply to all supported bound controls or a specified subset.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Controls.setVisible` | ctx, targets, boolean, control scope | Per-control result | Supported visibility only; no DOM manipulation. | R1 |
| `VBD.Controls.setDisabled` | ctx, targets, boolean, control scope | Per-control result | UX lock is not field security. | R1 |
| `VBD.Controls.setLabel` | ctx, targets, label/localization key | Per-control result | Supported label API only. | R1 |
| `VBD.Controls.setFocus` | ctx, target | Focus result | Fail on hidden/unavailable control rather than silently ignoring. | R1 |
| `VBD.Controls.forAttribute` | ctx, column, trusted typed operation | Per-control results | Developer helper; no configured JavaScript callback strings. | R1 |

## VBD.Forms

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Forms.save` | ctx, supported save options | Save result | Respect validation/event failures; no double save/reentry. | R1 |
| `VBD.Forms.refresh` | ctx, explicit dirty/save policy | Refresh result | Never silently discard edits or auto-save unexpectedly. | R1 |
| `VBD.Forms.isDirty` | ctx | Boolean | Report form data state, not server change tracking. | R1 |
| `VBD.Forms.getType` | ctx | Supported form type | Used to distinguish create/update/read-only contexts. | R1 |
| `VBD.Forms.switchForm` | ctx, form ID, dirty policy | Navigation request result | Only available permitted forms; explicit unsaved-change behavior. | R2 |
| `VBD.Forms.setNotification` | ctx, ID, message, severity | Notification result | Stable caller-owned IDs avoid duplicate messages. | R1 |
| `VBD.Forms.clearNotification` | ctx, notification ID | Clear result | Clear only the specified toolkit/caller-owned notification. | R1 |

## VBD.Layout

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Layout.setTabVisible` | ctx, tab names, boolean | Applied result | Validate named tabs. | R1 |
| `VBD.Layout.setTabExpanded` | ctx, tab names, boolean | Applied result | Use supported expanded/collapsed state. | R1 |
| `VBD.Layout.setSectionVisible` | ctx, tab/section pairs, boolean | Applied result | Sections require their parent tab identity. | R1 |
| `VBD.Layout.focusTab` | ctx, tab name | Focus result | Supported tab focus/expansion only. | R1 |

## VBD.Lookups

PreSearch hooks are synchronous. Resolve asynchronous filter dependencies before
the hook, and invalidate them when the parent changes. Unsupported lookup types
must be reported rather than silently accepting a filter that never applies.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Lookups.pick` | Allowed tables, views/filters, single/multi policy | Selected refs or canceled outcome | Use supported lookupObjects options; cancellation is not an error. | R1 |
| `VBD.Lookups.addFilter` | ctx, lookup control, validated filter, target table | `Disposable` | Register one scoped PreSearch handler; reject unsupported filter shape. | R1 |
| `VBD.Lookups.removeFilter` | Filter registration token | Removal result | Remove owned handler; do not remove other libraries' handlers. | R1 |
| `VBD.Lookups.addView` | ctx, lookup, view ID/name, FetchXML, layout, default flag | View registration result | Supported addCustomView controls only; no universal owner-lookup promise. | R2 |
| `VBD.Lookups.setDefaultView` | ctx, lookup, permitted view ID | Applied result | View must be applicable and available. | R1 |
| `VBD.Lookups.setEntityTypes` | ctx, lookup, allowed table names | Applied result | Supported multi-table lookup control only. | R1 |
| `VBD.Lookups.bindDependent` | ctx, parent column, child lookup, filter/clear policy | `Disposable` | Preload/invalidate safely; explicit clear/retain-invalid selection behavior. | R2 |
| `VBD.Lookups.validateSelection` | Selected refs, allowed targets/predicate, access policy | Validation result | Use supported checks; permission failure is not an invalid-record default. | R2 |

## VBD.Choices

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Choices.getOptions` | ctx, choice control/attribute | Value/label options | Preserve numeric identity and multi-select differences. | R1 |
| `VBD.Choices.filterOptions` | ctx, control, allowed values, current-value policy | Applied result | Explicitly retain/clear/report an existing excluded selection. | R2 |
| `VBD.Choices.restoreOptions` | ctx, control, captured baseline token | Applied result | Restore known baseline, not guessed metadata/order. | R2 |
| `VBD.Choices.setOptions` | ctx, control, validated values/labels/order | Applied result | Display options only; does not create server-side choices. | R2 |

## VBD.Validation

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Validation.evaluate` | Typed rule set, values/ctx | Validation issues | Pure/declared reads; supported comparisons, ranges, and formats. | R1 |
| `VBD.Validation.validateFields` | ctx, field rules, message policy | Validation report | Set/clear only owned field/form notifications. | R1 |
| `VBD.Validation.validateBeforeSave` | Save event context, rules, supported async policy | Validation/save decision | Use documented event settings; never assume async saving is enabled. | R1 |

## VBD.Events

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Events.onLoad` | Execution context, recipe key | Surface-appropriate completion | Maker adapter; validate lifecycle and prepare command configuration. | R1 |
| `VBD.Events.onChange` | Execution context, recipe key | Surface-appropriate completion | Maker adapter with reentry guard and no implicit save. | R1 |
| `VBD.Events.onSave` | Execution context, typed/JSON local rules, notification options | Synchronous validation/save decision | Prevent invalid saves before returning; no async rule/workflow engine or automatic save. | R1 |
| `VBD.Events.register` | ctx, supported event/target, trusted handler or recipe key | `Disposable` | Idempotent scoped registration; reject unsupported events. | R1 |
| `VBD.Events.unregister` | Registration token | Removal result | Dispose only matching owned registration. | R1 |
