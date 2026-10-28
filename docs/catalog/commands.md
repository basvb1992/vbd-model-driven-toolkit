# Commands, grids, and business helper functions

All entries are planned. See [catalog conventions](../function-catalog.md).
Client predicates are UX decisions, not server authorization.

## VBD.Commands

The thin maker adapters have deliberate positional signatures documented in
[architecture](../architecture.md). Internal operations use typed options.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Commands.run` | PrimaryControl, recipe key | Maker-facing operation completion | Normalize form context, report errors once, invoke registered interaction. | R1 |
| `VBD.Commands.runGrid` | SelectedControl, selected references, recipe key | Maker-facing operation completion | Validate grid selection and supported parameter wiring. | R1 |
| `VBD.Commands.execute` | Typed ctx, operation/config key, permitted options | Operation result | Single configured operation without forcing a recipe engine. | R1 |
| `VBD.Commands.refresh` | ctx, supported command scope | Refresh request result | Supported refreshRibbon behavior; do not recreate buttons. | R1 |
| `VBD.Commands.validateSelection` | References/count, min/max/table constraints | Validation result | Distinguish empty, mixed-table, invalid, and excessive selection. | R1 |

## VBD.Rules

Rules use a small allowlisted condition model: saved/unsaved, field comparison,
state/status, selection bounds, capability, configured flag, and privilege hints.
Async data must be preloaded for synchronous visibility/enablement consumers.
Modern Power Fx visibility is not a direct JavaScript custom-rule consumer.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Rules.evaluate` | Registered/typed condition, prepared values/ctx | Rule assessment | Explicit unknown/not-ready outcome; surface adapters decide safe behavior. | R2 |
| `VBD.Rules.all` | Typed conditions | Composite condition | Logical AND without JavaScript evaluation. | R2 |
| `VBD.Rules.any` | Typed conditions | Composite condition | Logical OR; preserve declared unknown semantics. | R2 |
| `VBD.Rules.not` | Typed condition | Composite condition | Negation does not convert unavailable authorization into allowed. | R2 |

## VBD.Grids

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Grids.getSelected` | Supported grid context | `EntityRef[]` | Only actual selection, not all records in a view. | R1 |
| `VBD.Grids.refresh` | Grid context/name with parent ctx | Refresh request result | Target one supported grid/subgrid; no whole-page reload. | R1 |
| `VBD.Grids.openSelected` | Grid selection, navigation options | Navigation request/result | Require exactly one selection unless explicit bounded multi-open policy. | R1 |
| `VBD.Grids.runSelected` | Selection, registered operation, limits/failure policy | `BatchResult` | Bounded processing; visible partial/skipped outcomes. | R2 |
| `VBD.Grids.registerOnLoad` | Supported grid, trusted handler/recipe | `Disposable` | Grid-type capability check and duplicate-registration prevention. | R2 |

## VBD.Records

These are composed business conveniences, not alternate ways to bypass Dataverse
rules. Caller must explicitly choose save/refresh/open behavior.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Records.clone` | Source ref, field allowlist, overrides | Created ref and field summary | Exclude IDs/system fields/unsupported relationships; no copy-everything mode. | R2 |
| `VBD.Records.createRelated` | Parent ref, target table, relationship, approved mappings | Created ref or prefilled-form result | Explicit direct-create versus open-form mode. | R2 |
| `VBD.Records.assign` | ref, user/team owner ref, supported operation policy | Assignment result | Use supported ownership operation and privileges. | R2 |
| `VBD.Records.setStatus` | ref, validated state/status, operation contract | Transition result | Specialized close/resolve/fulfill operations require their proper APIs. | R2 |

## VBD.Process

Business process flow helpers require a supported loaded process/form. Moving
stages can fail because of required data, active path, permissions, or save state.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Process.getActive` | ctx | Process/instance/stage information | Report legitimate no-process state explicitly. | R2 |
| `VBD.Process.setActive` | ctx, available process ID, dirty policy | Process switch result | Apply supported activation contract; don't assume instance identity. | R2 |
| `VBD.Process.moveNext` | ctx, preconditions/save policy | Stage transition result | Preserve platform transition status/reason. | R2 |
| `VBD.Process.movePrevious` | ctx, preconditions/save policy | Stage transition result | Supported previous-stage transition only. | R2 |
| `VBD.Process.setActiveStage` | ctx, stage ID, supported active-path policy | Stage selection/activation result | No arbitrary skip across invalid paths or required steps. | R2 |

## VBD.Activities

Validate party-list/reference semantics, date behavior, and permissions. Opening
an email form and sending an email are deliberately different operations.

| Function | Inputs | Returns | Behavior / boundary | Phase |
| --- | --- | --- | --- | --- |
| `VBD.Activities.createTask` | Regarding, subject, owner, dates, approved fields | Created task ref | No hardcoded recipients/owners. | R2 |
| `VBD.Activities.createAppointment` | Regarding, parties, subject, start/end, approved fields | Created appointment ref | Validate intervals, parties, and time-zone policy. | R2 |
| `VBD.Activities.openEmail` | Regarding, parties, subject/body, form options | Compose navigation result | Does not send or promise a saved email. | R2 |
| `VBD.Activities.createNote` | Regarding, subject/text, optional approved attachment | Created note ref | Enforce allowed MIME/size and table capability. | R2 |
| `VBD.Activities.sendEmail` | Existing email ref, explicit confirmation/server policy | Supported send-operation result | Server send semantics; avoid duplicate sends and blind retries. | R2 |
