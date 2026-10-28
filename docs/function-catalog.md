# Proposed public function catalog

**118 functions have a local implementation; the other 80 remain planned.**
Unimplemented names and contracts are design candidates; review them before implementation.
This is the single inventory of intended public functions, not a list of existing
APIs or an instruction to implement everything in the first release.

Current inventory: **198 functions across 41 namespaces**. Earliest-phase
classification: 135 R1, 59 R2, and 4 R3. Implementation issues should select
bounded subsets; R1 is not a requirement to build 135 functions in one change.

## Implemented source subset

- `VBD.Actions.executeAction`
- `VBD.Actions.executeFunction`
- `VBD.Choices.getOptions`
- `VBD.Commands.execute`
- `VBD.Commands.refresh`
- `VBD.Commands.run`
- `VBD.Commands.runGrid`
- `VBD.Commands.validateSelection`
- `VBD.Config.get`
- `VBD.Config.register`
- `VBD.Config.validate`
- `VBD.Context.fromFormCommand`
- `VBD.Context.fromFormEvent`
- `VBD.Context.fromGridCommand`
- `VBD.Context.getApp`
- `VBD.Context.getClient`
- `VBD.Context.getRecord`
- `VBD.Context.getSelection`
- `VBD.Context.getUser`
- `VBD.Context.requireCapability`
- `VBD.Context.requireSavedRecord`
- `VBD.Controls.forAttribute`
- `VBD.Controls.setDisabled`
- `VBD.Controls.setFocus`
- `VBD.Controls.setLabel`
- `VBD.Controls.setVisible`
- `VBD.Data.create`
- `VBD.Data.delete`
- `VBD.Data.exists`
- `VBD.Data.retrieve`
- `VBD.Data.retrieveMany`
- `VBD.Data.retrieveRelated`
- `VBD.Data.update`
- `VBD.Diagnostics.getVersion`
- `VBD.Diagnostics.normalizeError`
- `VBD.Diagnostics.report`
- `VBD.Dialogs.alert`
- `VBD.Dialogs.confirm`
- `VBD.Dialogs.customPage`
- `VBD.Dialogs.error`
- `VBD.Dialogs.record`
- `VBD.Dialogs.webResource`
- `VBD.Environment.get`
- `VBD.Environment.getBoolean`
- `VBD.Environment.getDefinition`
- `VBD.Environment.getJson`
- `VBD.Environment.getMany`
- `VBD.Environment.getNumber`
- `VBD.Environment.getOptional`
- `VBD.Environment.getText`
- `VBD.Environment.invalidate`
- `VBD.Environment.preload`
- `VBD.Events.onChange`
- `VBD.Events.onLoad`
- `VBD.Events.onSave`
- `VBD.Events.register`
- `VBD.Events.unregister`
- `VBD.Fields.clear`
- `VBD.Fields.copy`
- `VBD.Fields.fireOnChange`
- `VBD.Fields.get`
- `VBD.Fields.getLookup`
- `VBD.Fields.set`
- `VBD.Fields.setDefault`
- `VBD.Fields.setLookup`
- `VBD.Fields.setRequired`
- `VBD.Fields.setSubmitMode`
- `VBD.Forms.clearNotification`
- `VBD.Forms.getType`
- `VBD.Forms.isDirty`
- `VBD.Forms.refresh`
- `VBD.Forms.save`
- `VBD.Forms.setNotification`
- `VBD.Grids.getSelected`
- `VBD.Grids.openSelected`
- `VBD.Grids.refresh`
- `VBD.Launch.getProfile`
- `VBD.Launch.openPrepared`
- `VBD.Launch.prepareProfile`
- `VBD.Layout.focusTab`
- `VBD.Layout.setSectionVisible`
- `VBD.Layout.setTabExpanded`
- `VBD.Layout.setTabVisible`
- `VBD.Links.app`
- `VBD.Lookups.addFilter`
- `VBD.Lookups.pick`
- `VBD.Lookups.removeFilter`
- `VBD.Lookups.setDefaultView`
- `VBD.Lookups.setEntityTypes`
- `VBD.Navigation.newRecord`
- `VBD.Navigation.openCustomPage`
- `VBD.Navigation.openDashboard`
- `VBD.Navigation.openRecord`
- `VBD.Navigation.openUrl`
- `VBD.Navigation.openView`
- `VBD.Navigation.openWebResource`
- `VBD.Navigation.quickCreate`
- `VBD.Query.buildFilter`
- `VBD.Query.executeFetchXml`
- `VBD.Query.executeOData`
- `VBD.Query.iteratePages`
- `VBD.Query.retrieveAll`
- `VBD.UI.clearNotification`
- `VBD.UI.hideProgress`
- `VBD.UI.notify`
- `VBD.UI.showProgress`
- `VBD.UI.withProgress`
- `VBD.Utils.compareValues`
- `VBD.Utils.escapeODataLiteral`
- `VBD.Utils.escapeXml`
- `VBD.Utils.isGuid`
- `VBD.Utils.normalizeGuid`
- `VBD.Utils.parseNumber`
- `VBD.Utils.toEntityRef`
- `VBD.Validation.evaluate`
- `VBD.Validation.validateBeforeSave`
- `VBD.Validation.validateFields`
- `VBD.Windows.open`

Generated from the built exports with `npm run docs:availability`.
Implementation means the documented source subset, not live tenant or deployment certification.
See [core usage](core-usage.md), [getting started](getting-started.md), and
[environment/app runtime usage](environment-launching.md) for exact contracts and limits.

## Reading the catalog

- Each row identifies one public function, its inputs, return contract, behavior,
  and earliest proposed phase.
- `R1`: core; `R2`: advanced/reusable interactions; `R3`: optional capability-gated
  extension. Phase is not implementation status; only the subset above is implemented.
- Inputs are proposed named options, not final positional JavaScript signatures.
  Exceptions are the documented maker adapters in [architecture](architecture.md).
- Reads/writes/navigation that need asynchronous platform APIs return promises.
  Immediate form helpers remain synchronous. `openPrepared` and browser window
  opening must remain synchronous along the actual click-activation path.
- `ctx` means an explicitly supplied supported context; `ref` means `EntityRef`.
- Common result/error types are defined in [architecture](architecture.md).
- Validation, access, unsupported-surface, configuration, and transport failures
  use explicit structured errors. A function returns absence/cancellation only
  where its row declares that outcome.
- Phase labels do not imply identical support on forms, grids, mobile, and offline.
  The implementing issue must specify and test the actual support matrix.

## Module map

| Area | Namespaces | Functions | Detailed inventory |
| --- | --- | --- | --- |
| Foundation and configuration | `VBD.Context`, `Environment`, `Config`, `Bindings`, `Cache`, `Security`, `Diagnostics`, `Utils` | 45 | [Foundation](catalog/foundation.md) |
| Dataverse data and queries | `VBD.Data`, `Query`, `Relationships`, `Actions`, `Batch`, `Metadata` | 25 | [Data](catalog/data.md) |
| Forms and lookups | `VBD.Fields`, `Controls`, `Forms`, `Layout`, `Lookups`, `Choices`, `Validation`, `Events` | 46 | [Forms](catalog/forms.md) |
| Navigation and app launching | `VBD.Navigation`, `Dialogs`, `SidePanes`, `Links`, `Launch`, `Windows` | 29 | [Navigation](catalog/navigation.md) |
| Commands and business helpers | `VBD.Commands`, `Rules`, `Grids`, `Records`, `Process`, `Activities` | 28 | [Commands](catalog/commands.md) |
| Shared services and recipes | `VBD.UI`, `Execution`, `Files`, `Integrations`, `Recipes`, `I18n`, `Messaging` | 25 | [Services](catalog/services.md) |

## Scope clarifications

- Toolkit-owned assets use `vbd`; target tables/columns/variables may use any prefix.
- Environment variables are first-class configuration, not a generic record fetch.
- Independent windows use the explicit [launch contract](app-launching.md);
  they do not imply offline or separate-login operation.
- Generic functions wrap supported contracts; specialized Dynamics operations
  need verified optional adapters, not guessed status changes.
- VBD Studio is a possible authoring application, not an implemented namespace.
- Consultant/Delivery Tools capabilities are documented separately in
  [consultant capabilities](consultant-experience.md); they are not extra
  browser functions in the 198-function inventory.
- Core is independent of the Workflow/Interaction Framework. `VBD.Recipes`
  composes bounded client interactions, not durable or scheduled workflows.
- Internal implementation helpers are not automatically public APIs. Add them
  here only when there is a reusable caller-facing requirement.

Related contracts: [configuration](environment-and-configuration.md),
[recipes](recipes.md), [distribution](distribution.md), and [roadmap](roadmap.md).
