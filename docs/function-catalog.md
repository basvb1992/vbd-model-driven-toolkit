# Proposed public function catalog

**Six functions have a local implementation; the other 192 remain planned.**
Unimplemented names and contracts are design candidates; review them before implementation.
This is the single inventory of intended public functions, not a list of existing
APIs or an instruction to implement everything in the first release.

Current inventory: **198 functions across 41 namespaces**. Earliest-phase
classification: 135 R1, 59 R2, and 4 R3. Implementation issues should select
bounded subsets; R1 is not a requirement to build 135 functions in one change.

## Implemented source subset

- `VBD.Config.validate`
- `VBD.Config.register`
- `VBD.Config.get`
- `VBD.Diagnostics.normalizeError`
- `VBD.Diagnostics.report`
- `VBD.Diagnostics.getVersion`

These six have local type/lint/build and automated evidence, not Dataverse
deployment verification. Their exact current schema/signatures and limitations
are in [getting started](getting-started.md). In particular, environment reads,
launch execution, command handlers, and recipe execution are not implemented.

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
