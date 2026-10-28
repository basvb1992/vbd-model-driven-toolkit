# VBD Model-Driven Toolkit

A proposed configurable TypeScript toolkit for Dynamics 365 and Power Apps
model-driven apps: reusable form helpers, ribbon commands, Dataverse queries,
lookups, dialogs, app launchers, and environment-aware configuration.

**Status: early source implementation (0.1.0). Six functions and local
source/snapshot delivery tools are implemented. No Dataverse deployment,
solution ZIP, Studio, launcher runtime, or public npm release exists yet.**

The design catalog currently covers **198 proposed functions across 41
namespaces**, with purpose, inputs, outputs, constraints, and delivery phase.
Six are locally implemented; the other 192 remain planned.

## Available now

- `VBD.Config.validate`, `register`, and `get`: strict portable declaration
  validation and an isolated in-memory registry.
- `VBD.Diagnostics.normalizeError`, `report`, and `getVersion`: structured
  errors, explicit redacted sinks, and version information.
- A browser `VBD` bundle, ESM developer bundle, and TypeScript declarations.
- Local `preflight` JSON and `handover` Markdown tools. These use source and
  optional sanitized supplied evidence; no live environment is queried.

Requires Node.js 24 or later for development/tools:

```powershell
npm ci
npm run check
node .\dist\vbd-toolkit.mjs preflight --config .\examples\customer-workspace.json
```

The example preflight intentionally exits **2 (incomplete)**: live deployment
is unverified and the configured launch/command runtime is not implemented.
See [getting started](docs/getting-started.md) for usable APIs, report generation,
input limits, and the precise current boundaries.

## What we are designing

- A typed developer API exposed as `VBD`.
- Maker-friendly form and command entry points with configurable parameters.
- Reusable recipes that compose supported operations without arbitrary code.
- Environment-variable-backed configuration and deployment-portable app launchers.
- Independent browser-window launch requests, distinct from modal dialogs,
  side panes, offline execution, and separate authentication sessions.
- A standalone solution distributed in managed and unmanaged formats.
- Optional consultant diagnostics, deployment preflight, generated handover,
  environment comparison, and a later configuration Studio.

The initial target is online Unified Interface. Mobile, offline, specialized
Dynamics operations, and cross-window messaging are separately gated capabilities.
This is not a Canvas App client library or a replacement for server-side security.

## Independent product, not another workflow engine

The toolkit is **separate from the existing Workflow/Interaction Framework**:
its own repository, solution, release lifecycle, and installation requirements.
Core must work when that framework is not installed.

VBD recipes are short, bounded client interactions. Durable runs, scheduling,
approval waits, resumable work, and persistent retries belong to an external
server/workflow system. Any future integration is optional and uses a public API.

| Product area | Purpose | Installation boundary |
| --- | --- | --- |
| **VBD Core** | Runtime library and maker entry points. | Standalone `VBDModelDrivenToolkit` solution. |
| **VBD Studio** | Optional configuration, preview, and wiring guidance. | Separate optional solution; not required by Core. |
| **VBD Delivery Tools** | Read-only preflight, comparison, and generated handover. | Local/CI tooling; no browser-hosted admin credentials. |

These are planned product areas, not released components. First consultant
priorities are actionable diagnostics, deployment readiness, and generated
handover; a visual authoring Studio comes later.

## Design documents

| Document | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Build, six implemented APIs, portable schema, preflight, handover, and exit codes |
| [Feature specification](docs/feature-spec.md) | Outcomes, boundaries, acceptance criteria, assumptions, and failure cases |
| [Function catalog](docs/function-catalog.md) | Complete proposed public API inventory, inputs, outputs, and delivery phases |
| [Architecture](docs/architecture.md) | Typed APIs, maker adapters, recipes, contexts, errors, and compatibility |
| [Consultant capabilities](docs/consultant-experience.md) | Prioritized diagnostic, delivery, comparison, handover, and Studio experiences |
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
