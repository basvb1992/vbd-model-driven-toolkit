# Local consultant tools: C05 and C08

Bounded implementation of [issue #6](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/6).
Requirements stay in that issue and the [feature specification](feature-spec.md).
These separate Delivery Tools do not add browser APIs, change package exports,
or require Studio, Dataverse credentials, or the Workflow/Interaction Framework.

## Run from the repository root

Node.js 24+ and the repository's existing dependencies are required. Build the
shared `VbdError`/`Diagnostics` APIs first; the standalone `.mjs` entry imports
`dist/index.mjs`. No additional installation, bundling or package changes:

```powershell
npm run build
node tools/consultant/cli.mjs --help
node tools/consultant/cli.mjs compare --left examples/consultant/left.snapshot.json --right examples/consultant/right.snapshot.json --policy examples/consultant/expected-differences.json --now 2026-10-28T10:00:00.000Z
node tools/consultant/cli.mjs upgrade --inventory examples/consultant/inventory.json --manifest examples/consultant/compatibility.manifest.json --now 2026-10-28T10:00:00.000Z --format markdown
```

The comparison example exits **0**: two exact presence differences are expected.
The upgrade example exits **2**: a synthetic deprecation and declared-only
registration require review. **The example manifest is invented test metadata,
not a published compatibility matrix or an assertion that any version/API is
deprecated.** It does not establish that `0.3.0` exists.

Default output is JSON on stdout; `--format markdown` selects Markdown.
Optionally add `--output new-report.json` or, for Markdown,
`--output new-report.md`. Parent directories must already exist. Existing files,
including any input or hard-linked input, are never overwritten.
`--now` is mandatory: select an explicit ISO observation time, normally the
review time. The fixed example time only reproduces historical fixture results;
do not use it to present old evidence as current.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | All selected checks passed **within the stated local scope**. |
| 1 | At least one finding failed, or invalid/unreadable input/output. Invalid inputs produce only a sanitized diagnostic on stderr and no report. |
| 2 | No failures, but warning/unknown/unsupported findings remain. |

Failed or incomplete **valid** reports are still rendered/written. A warning,
including a deprecation or both definitions missing, requires review and prevents
a passed readiness result. No input values, native error text, stack, or local
file paths appear in diagnostics. A missing build is a setup failure before the
CLI starts; run `npm run build`.

## Input contracts and bounds

All objects are strict: unknown properties at any depth are rejected, including
`value`, `currentValue`, URLs, record payloads, and arbitrary free-text metadata.
Inputs contain sanitized declarations/evidence only. The tool cannot detect
secrets deliberately disguised as syntactically valid identifiers: use
non-sensitive aliases/IDs. Do not put customer assets into repository examples.

| Input/bound | Accepted |
| --- | --- |
| File | At most **1,048,576 bytes**, regular local UTF-8 JSON. Fatal UTF-8 decoding; malformed JSON rejected. Reading is capped even if the file grows. |
| Paths | At most 4,096 characters. No control characters, UNC/device paths, `..` segments, linked parents, alternate data streams, reserved device names, or trailing dot/space segments. Output extension must match the format. No directory creation. |
| Every input | `schemaVersion: 1`; no automatic conversion from other schemas. |
| Identifier/alias/contract/registration ID | 1–128 ASCII characters: starts with a letter, then letters/digits/`.`/`_`/`-`. |
| Variable schema name | 1–128 ASCII characters: starts with a letter, then letters/digits/`_`. |
| Function name | At most 128 characters; `VBD.<letter-led alphanumeric namespace>.<letter-led alphanumeric function>`. No expression or wildcard. |
| Time | ISO datetime with timezone, at most 35 characters. Freshness inclusive: age ≤24 hours and future skew ≤5 minutes, relative to `--now`. |
| Release label | Exactly `N.N.N`, each integer 0–9999 with no leading zeroes. No ranges, prefixes, prereleases, build suffixes or compatibility inference. |
| Source revision | 7–40 hexadecimal characters, supplied explicitly in the inventory. |
| Duplicate identities | Rejected case-insensitively within each identity list. Version/function/contract lookups and inventory reference links are exact. |

The CLI rejects duplicate flags, positional arguments, irrelevant command flags,
empty arguments, and unsupported formats. Output uses exclusive creation, with
owner-only mode where the OS supports it. Inputs and parent directories must not
be concurrently replaced by an adversary; this is local customer-controlled
tooling, not a filesystem sandbox or atomic directory-race defense. A write error
can leave a partial newly created output; remove it explicitly before retrying.
No telemetry, networking, package discovery, Dataverse read/write, or upgrades
are performed. Only the explicitly selected local files are read.

### C05: snapshots and expected-difference policy

Use the existing sanitized snapshot v1 semantics, illustrated by
[left](../examples/consultant/left.snapshot.json) and
[right](../examples/consultant/right.snapshot.json):

- `targetAlias`, `observedAt`, `environmentVariables` (0–200).
- Available entry: **only** `schemaName`, `status: "available"`,
  `type: text|number|boolean|json|secret|dataSource`, `hasCurrentValue` and
  `hasDefaultValue` booleans.
- Unavailable entry: **only** `schemaName`, `status:
  missing|denied|unknown|unsupported`.

Names are matched case-insensitively and findings are ordered by normalized
schema name. Aliases/timestamps are provenance, not drift. An omitted name means
**unobserved**, not an observed missing definition. Empty inventories cannot pass.
Both explicitly missing definitions require review. Stale/future evidence,
denied/unknown/unsupported access and protected `secret`/`dataSource` types cannot
establish a passing variable check.

The [policy](../examples/consultant/expected-differences.json) requires
`policyId` and `expectedDifferences` (0–200). Each rule contains exactly:

- `schemaName`; `facet: definition|currentPresence|defaultPresence`;
- `left` and `right` unequal booleans: an **exact directional** expectation;
- `reason: environmentSpecific|optionalDefinition` (bounded explanatory labels).

`definition` compares observed available (`true`) versus observed missing
(`false`), never omitted/inaccessible evidence. Presence facets compare the
corresponding booleans only when both definitions are available and browser-safe.
Each schema-name/facet pair is unique. An exact match emits
`EXPECTED_DIFFERENCE`; unmatched drift fails. Unused/reversed/unestablished rules
are reported as unknown, not silently discarded. Policy never waives freshness,
access, unsupported/protected types or type mismatches. Presence expectations
can coexist with a type failure, but cannot change that failure.

Identical false presence flags mean **no presence drift**, not that a required
value exists. This comparison does not have a required-value declaration or
compare actual values. A passed result means the selected sanitized structures
match or have explicitly permitted differences, not that an environment is ready
for deployment.

### C08: declared inventory and supplied compatibility manifest

The [inventory](../examples/consultant/inventory.json) contains:

- `inventoryId`, `sourceRevision`, `observedAt`, `installedVersion`, `targetVersion`;
- `functions` (1–200): `{id, name}`;
- `configurations` (0–100): `{id, contract}`; these are explicit versioned
  contract identifiers, **not** raw configuration contents or auto-scanned code;
- `registrationCoverage: complete|incomplete|unknown`;
- `registrations` (0–500): `{id, functionRef, configurationRef?, evidence}`.
  References must resolve to exact inventory IDs. Evidence is
  `declared|observed|denied|unknown|unsupported`.
  **Only** `observed` requires/accepts `observedAt`.

The [manifest](../examples/consultant/compatibility.manifest.json) contains
`manifestId`, `observedAt`, and `versions` (1–16). Each version has:

- `version`, `status: supported|unsupported`;
- `functions` (0–200): `{name, status, replacement?}`;
- `configurations` (0–100): `{key, status, replacement?}`.
- Contract status is `supported|deprecated|removed|unsupported`.
  A replacement is allowed only on deprecated/removed entries, must resolve
  exactly to another **supported** entry of the same kind in the **same version**,
  and is a migration suggestion, not proof of behavioral equivalence.

An authorized reviewer supplies the matrix; the tool neither downloads it nor
authenticates its authority. `observedAt` means evidence was last checked, not the
release publication date. Both the inventory and manifest must be fresh. Release
labels select exact entries only; even a patch increment absent from the matrix
is **unknown**. Missing API/configuration entries are unknown, not removed.
Deprecated means warning; removed means failure; unsupported remains unsupported.
Both installed and target versions are checked; existing problems are not hidden.
There is no code scan, configuration parser, rewrite, inferred migration path,
transition compatibility guarantee, Studio check, or downgrade guarantee.

Registration readiness is conservative: coverage must be `complete`, the list
nonempty, every function/configuration reference covered by a registration, and
each registration have fresh `observed` evidence. Declared-only, denied,
unsupported, omitted and stale observations never become pass. An observed row
is explicitly **supplied observation**, not independent deployed inspection.
If a utility legitimately has no registration, this slice still reports that
coverage unknown; review it separately rather than inventing evidence.

## Report and pure-function usage

```javascript
import { compareSnapshots, upgradeImpact, renderMarkdown, exitCode }
  from "./tools/consultant/reports.mjs";

const report = compareSnapshots(leftSnapshot, rightSnapshot, policy, {
  now: "2026-10-28T10:00:00.000Z"
});
// Or: upgradeImpact(inventory, compatibilityManifest, { now: selectedTime })
const markdown = renderMarkdown(report);
const status = exitCode(report);
```

The pure report functions do no file/network I/O and do not mutate inputs. They
validate every input and throw a safe `VbdError(INVALID_ARGUMENT)` on schema
failure, without retaining rejected payloads or Zod errors. Only pass validated
report outputs to the renderer. File-byte/path checks belong to the separate CLI
I/O boundary; callers loading objects themselves own that boundary.

JSON report schema v1 includes `capabilityId`, toolkit version, normalized selected
`generatedAt`, bounded scope, redaction/limitations, evidence sources, findings,
five-status summary and readiness. Every finding has a stable check ID,
capability, status, safe subject, reason, actionable remediation, structural
details and evidence `{source, path}` references. Sources identify
source declarations versus supplied snapshots/manifest, IDs/aliases, observation
times, inventory revision and selected versions where applicable.

Source `sha256` is the digest of `JSON.stringify` of the **validated schema
object**, not the original file bytes; whitespace differences are irrelevant.
Array indexes refer to the supplied validated arrays. Registration observations
include their individual observation times. Aliases are not globally unique
identities; source ID (`left`, `right`, `policy`, `inventory`, `manifest`) and digest
distinguish them. No local paths, raw values, URLs, business records, native
errors or credentials are included. JSON and Markdown are deterministic for the
same inputs, built toolkit version and selected time. Diagnostic correlation IDs
are intentionally separate and nondeterministic.

## Acceptance evidence and verification

```powershell
npm run build
npm exec -- vitest run tests/consultant
npm run typecheck
npm run lint
npm run check
```

| Issue #6 acceptance | Observable automated evidence |
| --- | --- |
| Definition/type/presence comparison; aliases/times provenance; directional expected policy | `tests/consultant/comparison.test.ts`: matching case-insensitive identities, all three difference facets, reversed/unused policy, type failure despite expected presence. |
| Missing/incompatible/denied/unknown/unsupported/protected/stale evidence cannot pass | Comparison tests: omitted versus observed missing, empty inventory, both missing, schema version, protected types, access statuses, exact freshness boundaries and future skew. |
| Explicit version compatibility, deprecation/removal, unknown contracts and actionable replacement | `tests/consultant/upgrade.test.ts`: exact versions, no semver inference, all statuses, installed/target checks, valid and invalid replacement links. |
| Incomplete registration evidence remains honest | Upgrade tests: all nonobserved statuses, empty/incomplete/uncovered inventory and stale/future supplied observations. |
| Strict bounds, schema and redaction | Report tests: unknown/raw fields, malformed identities/versions/references, duplicates and item/string bounds. `tests/consultant/cli.test.ts`: malformed JSON, fatal UTF-8, exact/over 1 MiB and multibyte size, sanitized errors without native path/value echoes. |
| Deterministic reports, scope/provenance and local-only behavior | Comparison/upgrade tests: exact repeat equality, evidence references/digests, JSON/Markdown labels, input immutability and network spies. |
| CLI statuses, safe paths and no overwrite | CLI tests: both commands' 0/1/2, invalid flags/formats, new JSON/Markdown output, existing output/input/hard link, linked parent, unsafe paths and no output on invalid input. |

Local verification on 2026-10-28, Windows / Node.js 24.22.1: **98 focused tests
passed**, and `npm run check` passed typecheck, lint, build, package-consumer
types and **292 tests**. The two exact example commands above were also exercised:
comparison exit 0/passed; upgrade exit 2/incomplete. Cross-platform test paths
are used, but execution on other operating systems remains unverified.

### SENTINEL / integrator handoff

Local tests cannot verify evidence truth, manifest authority, real Dataverse
permissions, deployed registrations, effective values/solution layers, app
availability, license/security compliance or actual upgrade behavior. These
remain **unverified**, not skipped checks counted as passing. SENTINEL should
review report interpretation and separately validate any live deployment using
explicit authorization and synthetic/sanitized evidence. No low-code maker
configuration changes are required or performed by this slice.

Rollback is incremental: remove the isolated consultant tool/test/example
directories and this usage document. No runtime exports, API counts, shared
build/package/CI assets or environment state change. Generated customer reports
stay local; do not commit them.
