# Standalone Core: bounded offline solution packaging

Issues: [#7](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/7)
and [#11](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/11)
(expanded 0.3.0 core integration), plus
[#13](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/13)
(0.4.0 navigation/capability source), and
[#15](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/15)
(0.5.0 R1 completion and BvB test-release preparation).
This implements the **local unmanaged** portion of the distribution design.
It does not change the shared roadmap/specification to claim ALM completion.
No environment access, authentication, deployment, import, publish or release
operation is performed by these tools. License/redistribution approval is pending.

## What is actually in the solution

Independent solution: `VBDModelDrivenToolkit`; dedicated publisher unique name
`VBDModelDrivenToolkit` (display `VBD Toolkit`), prefix `vbd`.
The publisher option-value prefix `59926` comes from the official PAC initializer
for `vbd`; there are **no choices, tables, columns or relationships** here.
This publisher identity was isolated before first deployment in 0.5.0 because
BvB already has an unrelated general VBD publisher with different settings.
That existing publisher is not adopted or overwritten. Solution/resource names
and stable component IDs are unchanged. Historical 0.2/0.3/0.4 local artifacts
retain their original publisher and require their original source for inspection.

| Dataverse webresource name | Type | Input |
| --- | --- | --- |
| `vbd_/toolkit/vbd.toolkit.js` | JavaScript (3) | Exactly compiled `dist/vbd.toolkit.js` |
| `vbd_/toolkit/THIRD-PARTY-NOTICES.html` | HTML (1) | Escaped, complete `dist/THIRD-PARTY-NOTICES.txt` inside an inert `<pre>` |

`vbd_` is the asset/publisher prefix, **not** the public JavaScript namespace.
The browser contract remains `VBD`. Physical source/package filenames such as
`WebResources/vbd_toolkit.js` are not the logical Dataverse webresource names.
PAC unpack uses the logical name as its physical directory hierarchy.
TXT is not a Dataverse webresource type; the notices are HTML, not mislabeled JS.
The plain notice must exactly match the canonical shared build notice for
**all nine actually bundled packages**, not just Zod. The HTML wrapper escapes
that complete text without rendering any dependency content as markup.

Only those two resources ship. ESM/declarations, Node delivery tools, consultant
tools, Studio, sample commands and customer assets are excluded. There is no
Workflow/Interaction Framework dependency or framework component reuse.
Forms, apps, commands, environment-variable definitions/current values, table
bindings, flows, plugins and configuration schemas are not included. Installing
Core will not wire any customer app. Consumer wiring belongs in a separately
reviewed consumer solution; no app-module Web API operations are attempted.

## Supported source, not a bespoke solution ZIP

Official documentation consulted on 2026-10-28:

- [PAC solution reference](https://learn.microsoft.com/en-us/power-platform/developer/cli/reference/solution)
  documents legacy XML detection (`Other/Solution.xml`,
  `Other/Customizations.xml`), offline `pack`/`unpack`, and newer YAML detection.
- [SolutionPackager](https://learn.microsoft.com/en-us/power-platform/alm/solution-packager-tool)
  explicitly says it **cannot convert unmanaged to managed**. Import and export
  through Dataverse are required; `Both` needs both genuine exported variants.

The checked-in `solution/Other/*.xml` and `solution/WebResources/*.data.xml`
use the PAC/SolutionPackager XML layout. The `Other` skeleton was verified using:

```powershell
pac solution init --publisher-name VBD --publisher-prefix vbd --outputDirectory artifacts/PackagingProbe
```

The source is intentionally incomplete **until materialization by this tool**:
compiled payloads are not committed, and the two `WebResourceId` values are
derived during staging. IDs are stable UUID-shaped SHA-256 name digests with
RFC version-8/variant bits, from
`VBDModelDrivenToolkit/WebResource/<logical-name>`. They are not tenant IDs,
do not vary by machine/version and must not be changed between upgrades.
No environment GUID is hardcoded. Name-based root references are retained;
PAC rejects ID-based duplicates for these webresources.

The tool stages the real source and resources into a new local directory,
then executes the installed PAC:

```text
pac help
pac solution pack help
pac solution unpack help
pac solution pack --zipfile <new-output.zip> --folder <staged-source> --packagetype Unmanaged
pac solution unpack --zipfile <output.zip> --folder <new-unpacked-directory> --packagetype Unmanaged
pac solution pack --zipfile <new-roundtrip.zip> --folder <unpacked-directory> --packagetype Unmanaged
```

PAC, not a custom archive writer, creates both local ZIPs. Every ZIP is inspected
before unpacking, and both are validated against the same source/version/build.
The test-only archive constructor is not used by the production tool.

## Local usage

Node.js 24+ and the repository's existing locked dependencies are required.
Use this checkout only. Run selected tests first; if dependencies are missing,
run `npm ci` here, without global npm/TLS configuration changes.
Build before packaging:

```powershell
npm exec --no -- vitest run tests/packaging
# Only if the above fails because dependencies are missing:
npm ci
npm run build

# Discover noninteractively; do not inspect auth profiles or request tokens.
Get-Command pac,pac.exe -ErrorAction SilentlyContinue
pac help
pac solution pack help
pac solution unpack help

node tools/packaging/package.mjs build --out artifacts/CoreLocal01
# If needed, append: --pac "C:\path\to\pac.exe"
```

`pac --version` is not supported by the tested PAC 2.12.2; `pac help` reports
its version without authentication. No CLI is auto-installed. Missing CLI fails
with `CLI_MISSING`, not a constructed ZIP fallback.

The output directory must be **new**, a direct `artifacts/<run-name>` child.
Caller filesystem paths accept portable slashes and native Windows backslashes,
for example `--out artifacts\CoreLocal01` and
`--file artifacts\CoreLocal01\VBDModelDrivenToolkit_0.5.0.0_unmanaged.zip`.
Both entry points normalize separators once before validation, without resolving
dot segments. Traversal remains invalid. **ZIP entry paths still require
forward slashes**; filesystem normalization never applies to archive entries.
The output directory is never deleted, reused, cleaned or clobbered.
On failure, retain the partial directory for diagnosis and choose a new run
name. Successful output contains:

- `source/`: materialized real XML source and the two payloads.
- `VBDModelDrivenToolkit_0.5.0.0_unmanaged.zip`: actual PAC local output.
- `unpacked/`, `roundtrip.zip`: actual PAC roundtrip evidence.
- `pack.txt`, `unpack.txt`, `repack.txt`: successful offline PAC output.
- `evidence.json`, `SHA256SUMS`: validated component/payload hashes, input
  fingerprints (runtime source, schema source, packaging tools, build script,
  configuration, package/lock and notice), CLI version and explicit limitations.

The receipt is not a signature or independently authenticated provenance.
A failed PAC phase reports the phase/exit status without reflecting arbitrary
input/output or secrets. No success receipt is written on failure.

Inspect an existing local unmanaged ZIP against this checkout and build:

```powershell
$e = Get-Content artifacts/CoreLocal01/evidence.json -Raw | ConvertFrom-Json
node tools\packaging\package.mjs verify --file artifacts\CoreLocal01\VBDModelDrivenToolkit_0.5.0.0_unmanaged.zip --sha256 $e.sha256
```

The explicit SHA-256 must come from the expected evidence. Computing a digest
from an untrusted file does not establish its provenance. `verify` performs
bounded inspection only: it does not extract or execute an input archive.

### Version and dependency contracts

- Stable package `major.minor.patch` maps to solution `major.minor.patch.0`;
  all four components must be canonical decimals, each `0..65535`.
- `Solution.xml` and both descriptors must match that version. Prerelease
  versions, mismatched source and changing only ZIP names are rejected.
  The existing `src/version.ts` literal must also match `package.json`.
- A future release must update these sources together with the owner's package
  version change, then rebuild once from the same reviewed/tagged revision.
- The tool independently reproduces the browser build **in memory**, using the
  same `scripts/bundle-contract.mjs` options as `scripts/build.mjs` and existing
  esbuild. A stale or
  substituted bundle fails `STALE_BUILD`. It emits no rebuilt files.
- The build graph may include only `src/` and these reviewed runtime packages:
  `@nodable/entities`, `anynum`, `fast-xml-builder`, `fast-xml-parser`,
  `is-unsafe`, `path-expression-matcher`, `strnum`, `xml-naming`, and `zod`.
  Warnings, runtime external imports, Studio/framework/delivery imports and
  oversized graphs are rejected. Root dependencies must remain exactly
  `fast-xml-parser` and `zod`; observed installed package identities/versions
  must match the lock. All observed package inputs, metadata and licenses are
  fingerprinted. Scoped package input handling does not loosen ZIP path rules.
- The shared collector includes every observed package's complete license/notice
  files. The exact upstream fallback for `@nodable/entities` is accepted only
  for version `3.1.0` declaring MIT; missing or empty licenses fail. The
  packager requires exact equality with the reproduced complete notice.
  Future dependencies or baseline changes require explicit review of these
  contracts; no automatic allowlist expansion is performed.
- Evidence `dependencies: []` means **zero Dataverse solution dependencies**.
  `runtimeDependencies` separately identifies the nine bundled OSS packages;
  zero solution dependencies does not mean zero third-party code.
- Reproducibility means equivalent source, identities, version and content.
  PAC ZIP timestamps/order may differ: byte-identical ZIPs are **not promised**.
  Each actual ZIP has its own checksum.

### Closed validation and bounds

The validator requires exactly the standalone solution identity/publisher,
two named type-61 roots, two correctly typed/identified webresources, empty
dependency lists and no populated non-webresource component collection.
Empty/default generated publisher address metadata is accepted; populated
contacts/addresses and unexpected metadata are rejected, not silently stripped.
The archive must contain exactly solution/customizations/content-type metadata
and the two referenced payloads, with no dangling, duplicate or extra files.

Limits: ZIP 16 MiB; 16 entries; entry 8 MiB; total expanded 20 MiB; XML and raw
notice 256 KiB; portable entry path 180 ASCII characters; XML depth 23 and fewer
than 8,000 tokens. The closed solution and unpacked-solution inventories are
limited to 16 files/32 tree nodes and four directory levels. Runtime `src/`
has a separate bound of 512 files/512 total tree nodes and eight directory
levels; directories count toward the node budget. Bundler inputs remain
limited to 512 files/20 MiB total.
Both local/central ZIP headers, CRC-32, SHA-256, sizes, data descriptors and
non-overlapping contiguous ranges are checked. Store/deflate only; no ZIP64,
split archives, encryption, links/special files, directory entries, archive
comments, extra fields, prefixes, gaps or unindexed/trailing data.
Traversal, absolute/UNC/drive paths, backslashes, device names, unsafe characters,
case collisions and input/output links/junctions are rejected.

The XML reader deliberately accepts a small closed UTF-8 dialect: no DTD,
external entities, comments, processing instructions or ambiguous duplicate
elements/attributes. General exported solutions are **not** supported.
If server/PAC metadata evolves, fail closed, review it and add supported
fixtures before extending the contract; do not turn off validation.
Credential/JWT/private-key and tenant CRM URL patterns are rejected without
echoing their values. Pattern scanning is not a comprehensive secret audit:
review the source/build and export provenance before any release.
No current environment-variable values are allowed at all.

All generated artifacts remain under existing ignored `artifacts/`/`dist/`
policy. Do not source-control ZIPs or publish pending license approval.

## Managed prerequisite — never an offline conversion

`build --kind managed` and `build --kind both` fail with
`MANAGED_EXPORT_REQUIRED` **before** creating output or invoking PAC.
There is no managed-flag rewrite, unmanaged-as-managed fallback or managed ZIP
writer. A managed-looking archive is not proof of a genuine managed export.

The following is a **future authorized operator path, NOT executed here**.
It requires dedicated dev/clean validation environments, explicit authorization,
separately established authentication, and license/release approval as applicable.
Environment URLs are operator variables, never checked-in values:

```powershell
# Only in a separately approved deployment task:
pac solution import --path artifacts\CoreLocal01\VBDModelDrivenToolkit_0.5.0.0_unmanaged.zip --environment $AuthorizedDevUrl

# A fresh directory; never pass --overwrite.
New-Item -ItemType Directory artifacts/ManagedEvidence01
pac solution export --name VBDModelDrivenToolkit --path artifacts\ManagedEvidence01\VBDModelDrivenToolkit_0.5.0.0.zip --managed false --environment $AuthorizedDevUrl
pac solution export --name VBDModelDrivenToolkit --path artifacts\ManagedEvidence01\VBDModelDrivenToolkit_0.5.0.0_managed.zip --managed true --environment $AuthorizedDevUrl

# ExpectedManagedSha256 comes from the operator's recorded genuine export evidence.
node tools\packaging\package.mjs verify --file artifacts\ManagedEvidence01\VBDModelDrivenToolkit_0.5.0.0_managed.zip --sha256 $ExpectedManagedSha256 --kind managed
```

Offline managed inspection checks the managed flag, identity/version, stable
component IDs, no dependencies/additional components, and the exact same
browser/notice content. It **always** reports `managedProvenance: UNVERIFIED`,
`importTested: false`, `publicReleaseReady: false`: ZIP contents/checksums alone
cannot attest authenticated export provenance. If a genuine export has
additional metadata, stop for review; never relabel a local package to pass.
Record the export command/version, source revision, operator-approved environment
scope and matching input fingerprints separately, without credentials.

Only after both genuine exports pass inspection, the documented combined-source
path is (new destinations only; paired filenames above are significant):

```powershell
pac solution unpack --zipfile artifacts\ManagedEvidence01\VBDModelDrivenToolkit_0.5.0.0.zip --folder artifacts\ManagedEvidence01\both-source --packagetype Both
pac solution pack --zipfile artifacts/ManagedEvidence01/repacked.zip --folder artifacts/ManagedEvidence01/both-source --packagetype Both
# Reinspect BOTH produced ZIPs against the same reviewed build/checksums.

# Separate approved clean-target installation, no Studio/framework installed:
pac solution import --path artifacts\ManagedEvidence01\VBDModelDrivenToolkit_0.5.0.0_managed.zip --environment $AuthorizedCleanTargetUrl
```

That combined-source/export path, clean import, solution checking, live `VBD`
smoke/wiring, existing-consumer upgrade and dependency/uninstall checks remain
**unverified**. Do not claim ALM-01, ALM-02 or SEP-01 complete. Test unmanaged
customization layers separately. Lower-version managed import is not a general
rollback; use reviewed forward fixes or environment backup/restore procedures.

## Tests and acceptance evidence

```powershell
npm exec --no -- vitest run tests/packaging
npm exec --no -- eslint tools/packaging tests/packaging
$env:VBD_PACKAGING_PAC = (Get-Command pac).Source
npm exec --no -- vitest run tests/packaging -t "actual local PAC"
# Full repository gate:
npm run check
```

| Issue/spec boundary | Evidence | What it does not prove |
| --- | --- | --- |
| API-01 asset/publisher naming; source/version/input contracts | Focused source/manifest, prefix, type, version, notice, missing/stale build and source-fingerprint tests | No new public runtime API/count claim |
| Standalone/no framework or Studio dependency (SEP-01 local portion) | Closed source/archive inventory, empty dependencies, restricted browser build graph; real PAC inspection | Not a clean environment import/smoke test |
| Safe local packaging | Traversal, links, bounds, XML/ZIP corruption, CRC/SHA, output path/no-overwrite and CLI/invalid-input tests | Not a general ZIP utility or secret-audit certification |
| No fabricated managed release (ALM-01 partial) | Managed/both build rejection; in-memory constructed managed candidate explicitly remains provenance-unverified | No genuine managed export, paired-source repack, tagged release or import |
| Actual supported local source | Explicit opt-in integration executes PAC pack/unpack/repack over the actual compiled runtime and notice, then checks hashes and no-overwrite | Not mocked pack evidence, solution checker or Dataverse validation |
| Non-destructive failure | Mocked-help/failed-pack tests retain partial staging and withhold success receipt | Mocks are not actual PAC execution |

The default test run skips the clearly labelled actual-PAC test unless
`VBD_PACKAGING_PAC` is explicitly supplied. Other archives are constructed test
fixtures, including the managed-flag demonstration **only in memory**.
Tests retain generated fixtures in ignored artifacts rather than deleting
directories. Actual PAC 2.12.2 (`2.12.2+ga6b1ffa`, .NET 10.0.14), Node 24.22.1
were exercised locally on 2026-10-28. Logs report `Unmanaged Pack complete`,
`Unmanaged Extract complete` and another `Unmanaged Pack complete`.
No Dataverse requests, authentication/token commands, imports/publishes,
release upload, commit or publication are part of this acceptance evidence.

Historical verification on the original isolated **0.2.0** packaging branch
(2026-10-28), before current-core integration:

- Focused run: **91 passed, 1 explicitly skipped** (actual-PAC opt-in unset).
- Explicit actual-PAC selection: **1 passed, 91 unselected/skipped**, using
  native Windows build/verify paths and checking portable-path equivalence.
- `npm run check` with `VBD_PACKAGING_PAC` set: **10 test files,
  286 tests passed**, including actual PAC integration; strict type checks,
  shared lint, build and package-consumer checks all passed.
- Generated browser hash:
  `1b40e0d16f6aa8e8b90e4e91879115a0bf24da69767c0a78117481c36da07405`.
  The checked original ZIP and roundtrip payloads matched this hash.

These are local acceptance observations, not a genuine managed export or
licensed/public/import-tested release.

### Historical integrated 0.3.0 evidence

The separate integration branch combines core commit `98bc9dc`, consultant
commit `d281dd0` and packaging commit `66e42eb`, then reconciles the shared
build/notice contract, reviewed dependency graph and versioned descriptors.
The historical 0.2.0 observations above are not reused as current-core proof.

- Full `npm run check` with explicit native PAC: **21 test files, 640 tests
  passed**; includes strict types, lint, build and package-consumer checks.
  Without the opt-in, the actual-PAC test remains explicitly skipped.
- PAC `2.12.2+ga6b1ffa` performed actual unmanaged pack/unpack/repack over the
  current 0.3.0 source. The archived browser resource itself reports **0.3.0
  and 118 methods**; its SHA-256 is
  `b61140ae532e75820221e3dcc7815d45bd770da2a49af79d25d11090b7e02d08`.
- Exactly **two webresources, zero Dataverse dependencies and nine bundled
  runtime packages** were inspected. Complete notices include `anynum`, the
  transitive dependency of `strnum`, and the version-bound scoped-package fallback.
- Reusable local artifact:
  `artifacts\CoreIntegration-1793189236176\VBDModelDrivenToolkit_0.3.0.0_unmanaged.zip`.
  SHA-256:
  `719a15eeb3fe129c6780efb256531763887ec32f23c4271f46931ee2b7e5a43c`.
  Its adjacent receipt, checksums and PAC logs remain local ignored outputs.
- The previous coordinator's 0.2.0 artifact was read-only checked and retains
  SHA-256 `48c94bfde1bd27de41c600d44ca566bd7b834ebc39473cec8e09d2ecc9cfc7b6`.

These are local observations, not release provenance. No authentication,
Dataverse requests, import/export/publish/deploy, managed conversion or public
binary release was performed. License approval, genuine managed export,
clean import/upgrade and tagged-source verification remain outstanding.

### Historical 0.4.0 navigation/capability evidence

The next isolated milestone adds seven catalog APIs, not additional solution
components or dependencies. `npm run check` with explicit native PAC passed
**22 test files / 707 tests**, including actual unmanaged pack/unpack/repack.
The exact archived browser resource reports **0.4.0 / 125 methods** and exposes
the four SidePanes methods plus pure links and capability observations.
Its SHA-256 is
`cd3a1ab57aad1fba087a74948911545e4fe9588a2c6176785a50826b89717425`.

Local reusable artifact:
`artifacts\NavigationHelpers-1793192072616\VBDModelDrivenToolkit_0.4.0.0_unmanaged.zip`.
SHA-256:
`69c1a96777781fa3295a50295f6223ca3ac5a1fbef80924bd51cf29f9be67966`.
The receipt, logs and checksums remain ignored local outputs. Exactly two
resources, zero Dataverse dependencies, nine complete runtime package notices,
and 201 current source/input fingerprints were independently checked.

The original 0.3.0 checkout stays at `11af60c` and its ZIP retains SHA-256
`719a15eeb3fe129c6780efb256531763887ec32f23c4271f46931ee2b7e5a43c`.
Historical ZIPs must be inspected with their matching original source/build,
not passed off as the current version. No original worktree or artifact was
overwritten. The managed/import/tag/license/public-release gates above remain
unchanged; no authentication or tenant operations were performed.
