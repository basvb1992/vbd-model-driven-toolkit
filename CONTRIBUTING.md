# Contributing

This repository contains an early implementation alongside the broader design.
Only the six functions listed as implemented in the catalog are callable.
Do not treat planned entries or generated command templates as existing APIs.

## Before implementing

1. Select catalog functions and the applicable feature acceptance criteria.
   For consultant tooling, select the capability ID and its Core/Studio/Delivery
   Tools owner from the consultant capability catalog.
2. Record the bounded change and proposed observable behavior in an issue.
3. Keep the existing feature specification and catalog current; do not create
   a parallel requirements document.
4. Check the official supported API and its form/grid/client restrictions.
5. Add implementation, focused tests, documentation, and maker wiring examples
   together. Set implementation status only after verification.

## Engineering boundaries

- Use TypeScript with strict typing and supported platform APIs.
- Expose the `VBD` namespace; use `vbd` for toolkit-owned solution assets.
- Prefer typed options objects internally and thin maker-facing adapters.
- Never use `eval`, undocumented application internals, or model-driven DOM access.
- Never embed secrets or deployment-specific current values in source or releases.
- Do not silently ignore missing controls, denied access, invalid configuration,
  unsupported clients, popup uncertainty, or partial write failures.
- Keep authorization, transactional business rules, secrets, and long-running
  work on the server.
- Do not deploy to or modify any environment without an explicitly scoped task.
- Keep core independent of customer tables and optional Dynamics modules.
- Keep the toolkit independent of the Workflow/Interaction Framework. Do not add
  its solution assets or runtime dependencies to Core.
- Keep recipes bounded and non-durable; do not add scheduling, approval waits,
  persisted run state, resumable execution, or a second workflow designer.
- Run privileged/environment-wide delivery checks in explicit local/CI tooling,
  not browser webresources. An inconclusive read must not become a passing check.
- Do not expand the public runtime function count to include proposed CLI
  capabilities or Studio screens.

## Verification expectations

Tests should cover normal and invalid inputs, context mismatches, missing/empty
values, cancellation, permissions, unsupported surfaces, and relevant lifecycle
events. See the [feature specification](docs/feature-spec.md) for acceptance
mapping and the [roadmap](docs/roadmap.md) for phase gates.

Documentation-only contributions need link and catalog consistency checks,
not invented build/test infrastructure.

For implementation changes, use Node.js 24+, `npm ci`, and `npm run check`.
The check includes strict types, lint, build, NodeNext package-consumer types,
and unit/CLI/browser-bundle VM tests. Commit the dependency lockfile when needed.
Live model-driven behavior and solution import are separate future checks.

## License and releases

A license has not yet been selected. Do not publish packages or claim public
redistribution rights until the owner approves a license and release scope.
