# Repository and solution distribution

Local source builds, CLI tools, and offline unmanaged solution packaging now
exist. Managed export, clean imports and public distribution remain gated.
See [getting started](getting-started.md),
[consultant tools](consultant-tools.md), and
[solution packaging](solution-packaging.md).

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
| `studio/` | Optional VBD Studio source and its separate solution; no Core prerequisite. |
| `tools/` | Explicit local/CI Delivery Tools, separate from browser bundles. |
| `scripts/` | Reproducible build/package/verify automation. |
| `docs/` | Specification, catalog, contracts, usage, and release guidance. |
| `artifacts/` | Ignored local build outputs; tagged releases publish selected ZIPs. |

Do not create empty implementation scaffolding merely to imply readiness.

Current `npm run build` outputs are:

| Output | Current purpose |
| --- | --- |
| `dist/vbd.toolkit.js` | Implemented `VBD` browser subset; duplicate initialization is rejected, platform adapters are lazy. |
| `dist/index.mjs` and `dist/types/` | ESM developer API and declarations. |
| `dist/vbd-toolkit.mjs` | Node.js 24+ local preflight/handover CLI; uses installed declared dependencies. |
| `dist/THIRD-PARTY-NOTICES.txt` | Notices for all packages actually bundled, including XML dependencies. |

Outputs are ignored local artifacts, not a published release. The package is
private/UNLICENSED pending owner license approval. Bundled dependencies retain
their own licenses; build metadata drives notice collection and missing notices
fail the build. The published @nodable/entities 3.1.0 package omits its LICENSE;
the exact declared upstream MIT notice is retained under third-party/licenses
with its immutable source blob. That fallback is version/license-bound, not a
general permission to omit notices.
The project uses npm's `omit-lockfile-registry-resolved` option: the lockfile
pins versions and integrity without embedding the development machine's mirror.
Each installer uses its configured approved registry (public npm on GitHub CI).
No global registry or TLS setting is modified. A distribution test protects
this portability boundary.

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
- No Core dependency on the Workflow/Interaction Framework or its solution
  components. Matching publisher prefixes do not imply shared component ownership.
- VBD Studio, if built, uses a separate proposed `VBDToolkitStudio` solution and
  a declared compatible Core version. It is not a workflow designer.
- Delivery Tools run outside Dataverse/browser bundles with their own explicit
  authentication and minimum read permissions for selected checks.
- Any framework integration ships separately with explicit opt-in dependencies;
  it is not included in Core or the default sample requirements.

## Product artifact boundaries

| Product area | Future delivery | Verification boundary |
| --- | --- | --- |
| Core | Managed/unmanaged `VBDModelDrivenToolkit` packages. | Clean import with no Studio or Workflow/Interaction Framework installed. |
| Studio | Optional independently versioned managed/unmanaged `VBDToolkitStudio` packages. | Compatible Core dependency only; no durable workflow features. |
| Delivery Tools | Optional local/CI tools with usage and authentication guidance. | Read-only checks/reports; missing access yields incomplete/unknown, not success. |
| Optional adapter | Separate explicit integration artifact if requested. | Missing external framework cannot break Core or unrelated consumers. |

Do not combine all products into a single mandatory installer. A Core release
must not wait for Studio, and no Delivery Tool may silently import/publish/fix
an environment as a side effect of a check.

## Managed and unmanaged packages

The current 0.3.0 source maps to solution version `0.3.0.0`. Local PAC builds
contain exactly the browser `VBD` resource and complete escaped third-party
notices; no consumer wiring, tools or framework assets ship. Receipts distinguish
zero Dataverse dependencies from the nine bundled runtime packages.
Build and inspection use the shared browser/notice contract and locked inputs.
No managed build is fabricated: it fails `MANAGED_EXPORT_REQUIRED` before
creating output. The [packaging guide](solution-packaging.md) records the local
evidence and future authorized export path. Neither variant is import-tested,
tagged or approved for redistribution.

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
7. Prove the selected artifact's dependency boundary, including a Core smoke test
   in an environment without the Workflow/Interaction Framework.

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
