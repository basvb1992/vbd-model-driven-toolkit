# Roadmap

118 catalog functions have a local implementation; the other 80 are planned.
Delivery phase is not implementation status and does not guarantee every
proposed API name will survive design review.

## Current progress: C1a and C1b

[Issue #1](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/1) scopes
the first implementation: six configuration/diagnostic APIs, strict schema,
browser/ESM/declaration builds, local source/snapshot preflight, and Markdown
handover. See [getting started](getting-started.md).

Local verification includes strict types/lint/build, NodeNext consumer types,
CLI behavior, redaction/bounds tests, and browser-bundle VM smoke checks.
[Issue #3](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/3) adds
ten environment APIs, approved app links, prepared profile tokens, and synchronous
isolated app-window requests. See [runtime usage](environment-launching.md).

This is not a completed R1 release: no generic configured-operation command
adapters, diagnostic panel or Dataverse import exists. Supported Xrm reads and
browser requests are implemented, but actual tenant integration remains unverified.

## Next core source milestones

[Issue #5](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/5)
adds the selected 97 interaction/form/data APIs described in
[core usage](core-usage.md). This covers the 39 R1 form entries, 14 R1
Data/Query/Actions entries, and 44 Context/Utils/navigation/dialog/UI/grid/command
entries. It does not complete all R1 options or the full roadmap.

The remaining 17 R1 entries are configuration load/resolve, bindings, generic
cache, table/privilege hints, capability reporting, side-pane helpers, record/view
links and non-popup openProfile. R2/R3 extensions remain separate scoped work.

## Integrated local delivery

[Issue #11](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/11)
integrates the independent consultant and packaging lanes into a separate
branch over the 0.3.0 core; their original worktrees and PRs remain unchanged.
[Consultant tools](consultant-tools.md) implement the bounded C05/C08 subset.
[Offline packaging](solution-packaging.md) reconciles the current source/version,
shared browser build options, nine bundled dependency notices, and actual PAC
unmanaged pack/unpack/repack. Neither tool changes the 118-function API count.

The package has two webresources and no Dataverse dependencies. This is local
evidence only: no import, authentication, deployment, merge, genuine managed
export, license approval or public release is implied.

## D0: Documentation baseline

- Feature specification and public function inventory.
- Environment-variable, binding, cache, launch, and window contracts.
- Example recipes, phased scope, supported-API references, and packaging plan.
- Standalone private GitHub repository.
- Consultant capability catalog and explicit separation from the existing
  Workflow/Interaction Framework.

No runtime code, deployment, solution export, or public package is part of D0.

## R1: Core implementation

- Strict TypeScript setup and the `VBD` global contract.
- Context, validation/error contracts, environment/configuration resolution,
  bindings, safe caching, and capability checks.
- Bounded data queries/CRUD and supported operation execution.
- Form/field/control/lookup helpers, navigation/dialogs, basic side panes.
- App-profile preparation and safe independent-window request path.
- Thin form/command adapters, notifications, and focused wiring examples.

Gate: selected R1 acceptance criteria pass unit/contract tests and model-driven
smoke checks. Verify browser activation behavior with real clicks, not only
mocked `window.open`. No public release until license and packaging are resolved.

## R2: Reusable interactions and advanced helpers

- Registered recipes and predicates, read-only preflight, duplicate-action locks.
- Batches, relationship operations, metadata, richer grid/record helpers.
- Files, activities, process helpers, localization, and approved integrations.
- Configuration diagnostics and richer examples.

Gate: partial failure, cancellation, event lifecycle, permissions, and bounded
execution are verified for every added capability.

## R3: Optional, capability-gated extensions

- Explicit offline/mobile support with a published per-function matrix.
- Named connected-window reuse and cooperating-page messaging, if justified.
- Optional configuration table and VBD Studio.
- Specialized Dynamics module adapters and developer package publication.

Gate: separate feature issue/spec delta and dependency/security review. Do not
turn these options into core prerequisites.

## Consultant value workstream

This workstream complements R1-R3; it does not add CLI/Studio capabilities to
the public browser function count. C1a is partial progress, not full completion. See the
[consultant catalog](consultant-experience.md) for IDs and observable evidence.

| Stage | Priority capabilities | Dependency / gate |
| --- | --- | --- |
| C1: Consultant essentials | C01 actionable diagnostics, C02 read-only deployment preflight, C03 generated handover. | Start with validated configuration/source contracts; add supported live checks only as Core/metadata contracts become available. Clearly label unverified results. |
| C2: Repeatable delivery | C04 health reports, C05 environment comparison, C06 pattern packs, C07 regression packs, C08 upgrade reports, C09 localization support. | Sanitized snapshots/fixtures, versioned schemas, known/unknown result semantics, and portable examples. |
| C3: Configuration Studio | C10 configure/validate/preview/wiring UI, reusing C1-C2 contracts. | Optional separate solution; configuration round-trip tests; no workflow designer or mandatory Core dependency on Studio. |

C1 is the first consultant-facing slice, not a commitment to implement all 198
runtime APIs before it. Each capability needs a bounded issue with acceptance
evidence before implementation status changes.

## Independence gate

Core must import and pass its smoke scenarios without Studio or the
Workflow/Interaction Framework installed. Recipes reject durable scheduling,
approval waits, persisted execution/resume state, and persistent retries.
Optional integration adapters use public contracts and remain separately
versioned. Sharing a publisher prefix or development environment is not a
reason to merge repositories, solutions, or release dependencies.

## Release packaging workstream

Managed/unmanaged packaging can start once R1 contracts are stable. It is not
implied by function implementation. First verify BvB Demo target identity and
publisher without embedding that environment in portable sources.
The [local unmanaged portion](solution-packaging.md) now exists; managed creation
fails explicitly until genuine authorized export prerequisites are satisfied.

First distributable release requires ALM acceptance evidence, owner-approved
license/visibility, tagged reproducible artifacts, and consumer installation
instructions. Repository creation alone is not a solution release.
