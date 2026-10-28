# VBD Model-Driven Toolkit

A proposed configurable TypeScript toolkit for Dynamics 365 and Power Apps
model-driven apps: reusable form helpers, ribbon commands, Dataverse queries,
lookups, dialogs, app launchers, and environment-aware configuration.

**Status: early source implementation (0.5.0). 135 functions, local delivery
tools, and offline unmanaged solution packaging are implemented. No Dataverse deployment,
live form/ribbon installation, Studio, or public npm release is claimed.**

The design catalog currently covers **198 proposed functions across 41
namespaces**, with purpose, inputs, outputs, constraints, and delivery phase.
135 are locally implemented; the other 63 remain planned.

## Available now

- `VBD.Config.validate`, `register`, and `get`: strict portable declaration
  validation and an isolated in-memory registry.
- `VBD.Diagnostics.normalizeError`, `report`, and `getVersion`: structured
  errors, explicit redacted sinks, and version information.
- A browser `VBD` bundle, ESM developer bundle, and TypeScript declarations.
- Ten typed `VBD.Environment` APIs with supported online Xrm reads, explicit
  current/default precedence, protected-type guards, and scoped bounded caching.
- `VBD.Links.app`, three `VBD.Launch` APIs, and `VBD.Windows.open` for approved
  app destinations prepared before a synchronous isolated click request.
- Native context, navigation/dialog, progress/notification, grid and prepared-profile
  ribbon adapters, with explicit lifecycle/cancellation/failure outcomes.
- Owned desktop-Web side panes, pure approved-origin record/view links, and
  read-only method-presence diagnostics (not access or installation checks).
- Approved JSON configuration loading, typed declaration resolution, allowlisted
  bindings and scoped copy-isolated memory caching. No recipe engine or secrets store.
- Conservative privilege/table UX hints and same-window app profiles, separate
  from the active-gesture prepared-window path.
- Typed field/control/form/layout helpers, owned lookup/event registration, choices
  and bounded synchronous validation; no automatic save or server-rule bypass.
- Bounded OData/FetchXML data/query helpers and explicit operation contracts,
  field allowlists, delete confirmation and conditional-write policy.
- Local `preflight` JSON and `handover` Markdown tools. These use source and
  optional sanitized supplied evidence; no live environment is queried.
- Sanitized snapshot comparison and supplied-manifest upgrade reports, separate
  from the browser runtime.
- Local PAC unmanaged pack/unpack/repack with two independent webresources,
  complete bundled notices and bounded inspection. Managed creation remains
  blocked pending a genuine authorized Dataverse export.

Requires Node.js 24 or later for development/tools:

```powershell
npm ci
npm run check
node .\dist\vbd-toolkit.mjs preflight --config .\examples\customer-workspace.json
```

The example preflight intentionally exits **2 (incomplete)**: live deployment
and actual registry/handler wiring are unverified.
See [getting started](docs/getting-started.md) for usable APIs, report generation,
input limits, and the precise current boundaries.
See [environment reads and app launching](docs/environment-launching.md) for
the new runtime contracts, caller-owned setup/click example, and limitations.
See [core usage](docs/core-usage.md) for the next navigation/form/data milestones,
native handler parameters, scope bounds and unsupported subsets.
See [consultant tools](docs/consultant-tools.md) and
[solution packaging](docs/solution-packaging.md) for current delivery commands,
evidence limits, and the remaining managed/import/release gates.

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
| [Getting started](docs/getting-started.md) | Build, configuration/diagnostic APIs, portable schema, preflight, handover, and exit codes |
| [Core usage](docs/core-usage.md) | Native navigation, forms, lookup/events, command wiring, bounded data/query APIs and operation contracts |
| [Environment reads and app launching](docs/environment-launching.md) | Typed reads, scoped cache, approved app links, prepared tokens, and synchronous window requests |
| [Feature specification](docs/feature-spec.md) | Outcomes, boundaries, acceptance criteria, assumptions, and failure cases |
| [Function catalog](docs/function-catalog.md) | Complete proposed public API inventory, inputs, outputs, and delivery phases |
| [Architecture](docs/architecture.md) | Typed APIs, maker adapters, recipes, contexts, errors, and compatibility |
| [Consultant capabilities](docs/consultant-experience.md) | Prioritized diagnostic, delivery, comparison, handover, and Studio experiences |
| [Consultant tools](docs/consultant-tools.md) | Local sanitized comparison and supplied-manifest upgrade reports |
| [Solution packaging](docs/solution-packaging.md) | Offline unmanaged PAC packaging, complete notices, inspection and managed prerequisites |
| [Testing in BvB](docs/testing-in-bvb.md) | Consumer-owned test form setup, safe smoke scenarios and deployment evidence boundaries |
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
| Core solution unique name | `VBDModelDrivenToolkit` |
| Core webresource | `vbd_/toolkit/vbd.toolkit.js` |
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

The repository is now public, but a redistribution license remains undecided;
the package stays private/UNLICENSED. Draft releases do not grant reuse rights.
Future tagged releases should provide
managed and unmanaged solution ZIPs built from the same source revision.
Local unmanaged ZIPs can be generated and inspected, but have not been
import-tested. No managed ZIP, tagged release or public distribution is claimed.

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing implementation.
