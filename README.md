# VBD Model-Driven Toolkit

A proposed configurable TypeScript toolkit for Dynamics 365 and Power Apps
model-driven apps: reusable form helpers, ribbon commands, Dataverse queries,
lookups, dialogs, app launchers, and environment-aware configuration.

**Status: documentation and API design only. No functions, solution packages,
deployment scripts, or npm package have been implemented or released.**

The design catalog currently covers **198 proposed functions across 41
namespaces**, with purpose, inputs, outputs, constraints, and delivery phase.

## What we are designing

- A typed developer API exposed as `VBD`.
- Maker-friendly form and command entry points with configurable parameters.
- Reusable recipes that compose supported operations without arbitrary code.
- Environment-variable-backed configuration and deployment-portable app launchers.
- Independent browser-window launch requests, distinct from modal dialogs,
  side panes, offline execution, and separate authentication sessions.
- A standalone solution distributed in managed and unmanaged formats.

The initial target is online Unified Interface. Mobile, offline, specialized
Dynamics operations, and cross-window messaging are separately gated capabilities.
This is not a Canvas App client library or a replacement for server-side security.

## Design documents

| Document | Contents |
| --- | --- |
| [Feature specification](docs/feature-spec.md) | Outcomes, boundaries, acceptance criteria, assumptions, and failure cases |
| [Function catalog](docs/function-catalog.md) | Complete proposed public API inventory, inputs, outputs, and delivery phases |
| [Architecture](docs/architecture.md) | Typed APIs, maker adapters, recipes, contexts, errors, and compatibility |
| [Environment and configuration](docs/environment-and-configuration.md) | Value resolution, types, caching, secrets, feature flags, and bindings |
| [Apps and independent windows](docs/app-launching.md) | App profiles, deep links, popup restrictions, authentication, and return contracts |
| [Recipe examples](docs/recipes.md) | Proposed end-to-end interactions and smart mechanisms |
| [Distribution](docs/distribution.md) | Repository conventions, solution packaging, sharing, and upgrade strategy |
| [Roadmap](docs/roadmap.md) | Phases and implementation gates |
| [Official references](docs/references.md) | Microsoft documentation underpinning platform boundaries |

## Naming

| Asset | Convention |
| --- | --- |
| Product | VBD Model-Driven Toolkit |
| Public namespace | `VBD`, for example `VBD.Environment.getText` |
| Dataverse publisher prefix | `vbd` |
| Toolkit-owned schema names | `vbd_<name>` |
| Proposed solution unique name | `VBDModelDrivenToolkit` |
| Proposed core webresource | `vbd_/toolkit/vbd.toolkit.js` |
| Proposed maker adapter webresource | `vbd_/toolkit/vbd.commands.js` |
| Repository | `vbd-model-driven-toolkit` |

`VBD` is the case-sensitive JavaScript namespace; `vbd` is the lowercase
Dataverse publisher prefix. Toolkit-owned assets use this prefix, but callers
can target tables, columns, and environment variables belonging to any publisher.

## Development and sharing

The intended first development environment is the owner's BvB Demo environment.
Its exact identity and publisher must be verified before a future deployment.
No environment URLs, app IDs, tenant values, credentials, or customer data are
required in this repository.

The repository is initially private. Public visibility and a redistribution
license are pending owner approval. Future tagged releases should provide
managed and unmanaged solution ZIPs built from the same source revision.
There are no installable ZIPs yet.

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing implementation.
