# Repository and solution distribution

This document describes future delivery. There is no build or deploy command yet.

## Repository

The standalone repository is
[basvb1992/vbd-model-driven-toolkit](https://github.com/basvb1992/vbd-model-driven-toolkit).
The initial checkout is independent of the existing demo repository. It must not
copy customer assets, credentials, internal configuration, or unrelated code.

Proposed implementation layout:

| Path | Future contents |
| --- | --- |
| `src/` | Strict TypeScript core and explicit optional modules. |
| `tests/` | Unit and contract tests with non-sensitive fixtures. |
| `examples/` | Form/ribbon wiring and generic recipe configurations. |
| `solution/` | Unpacked `VBDModelDrivenToolkit` solution source. |
| `scripts/` | Reproducible build/package/verify automation. |
| `docs/` | Specification, catalog, contracts, usage, and release guidance. |
| `artifacts/` | Ignored local build outputs; tagged releases publish selected ZIPs. |

Do not create empty implementation scaffolding merely to imply readiness.

## Solution boundary

- Toolkit-owned assets use the `vbd` publisher prefix.
- Core webresources and required localization/configuration schemas belong to
  the toolkit solution.
- Consumer-owned app modules, forms, commands, environment-variable definitions,
  launch profiles, and table bindings normally belong to the consumer's solution.
- Shared configuration definitions are included only when actually required.
- Example commands/forms belong in a clearly separate optional sample solution
  when they would otherwise introduce table or app dependencies.
- Importing core never silently wires every form or modifies unrelated apps.
- Existing lowercase `vbd` globals from other libraries are not renamed or
  overwritten. The new toolkit exposes the separate `VBD` public contract.

## Managed and unmanaged packages

| Artifact | Intended use |
| --- | --- |
| `VBDModelDrivenToolkit_<version>_managed.zip` | Normal managed installation and upgrades in consuming environments. |
| `VBDModelDrivenToolkit_<version>_unmanaged.zip` | Development/customization use, with unmanaged-layer implications documented. |
| Type declarations/browser assets | Optional developer consumption from the same source/version. |
| npm package | Optional later channel; package name/ownership and publication remain undecided. |

Generate both ZIPs from one tagged revision and one consistent solution version.
Do not edit or maintain separate managed/unmanaged source implementations.
Do not commit environment-specific current values or production secrets.

## Release evidence

Before publishing an implementation release:

1. Build, type-check, lint, and test the selected modules.
2. Verify public exports and maker entry points.
3. Package managed/unmanaged variants and inspect component/dependency lists.
4. Run solution checks and clean-target import/smoke scenarios.
5. Verify an existing consumer upgrade without unexpected handler/config changes.
6. Publish checksums, release notes, compatibility matrix, known limitations,
   examples, and migration notes with the tagged artifacts.

Managed import is not proof that commands or forms have been registered.
Installation guidance must include precise consumer wiring steps.

## Upgrade and rollback policy

Use semantic API versioning and a matching compatible Dataverse solution version.
Preserve named entry points within a major version; deprecate explicitly.
Do not promise a lower-version managed import as a general rollback strategy.
Use tested forward fixes and environment backup/restore procedures appropriate
to the consuming organization. Uninstall dependency and data impacts need review.

## Access and license

The repository was created private. The owner can share access with collaborators.
A public repository and redistribution license are not yet approved. Do not
publish reusable solution binaries or a package without resolving the license,
ownership of included assets, and release governance.
