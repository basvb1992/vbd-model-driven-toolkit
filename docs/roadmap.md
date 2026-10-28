# Roadmap

All function catalog entries are **planned**. Delivery phase is not implementation
status and does not guarantee every proposed API name will survive design review.

## D0: Documentation baseline

- Feature specification and public function inventory.
- Environment-variable, binding, cache, launch, and window contracts.
- Example recipes, phased scope, supported-API references, and packaging plan.
- Standalone private GitHub repository.

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

## Release packaging workstream

Managed/unmanaged packaging can start once R1 contracts are stable. It is not
implied by function implementation. First verify BvB Demo target identity and
publisher without embedding that environment in portable sources.

First distributable release requires ALM acceptance evidence, owner-approved
license/visibility, tagged reproducible artifacts, and consumer installation
instructions. Repository creation alone is not a solution release.
