# Contributing

This repository currently contains a design baseline, not an implementation.
Do not treat catalog entries as callable APIs.

## Before implementing

1. Select catalog functions and the applicable feature acceptance criteria.
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

## Verification expectations

Tests should cover normal and invalid inputs, context mismatches, missing/empty
values, cancellation, permissions, unsupported surfaces, and relevant lifecycle
events. See the [feature specification](docs/feature-spec.md) for acceptance
mapping and the [roadmap](docs/roadmap.md) for phase gates.

Documentation-only contributions need link and catalog consistency checks,
not invented build/test infrastructure.

## License and releases

A license has not yet been selected. Do not publish packages or claim public
redistribution rights until the owner approves a license and release scope.
