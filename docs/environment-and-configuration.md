# Environment variables and configuration

This is a proposed contract, not working code. Function names and phases are in
the [catalog](catalog/foundation.md).

## Why this belongs in core

A command should be deployable unchanged while the destination app, form,
feature flag, or permitted URL changes by environment. Prefer the current app's
environment and supported configuration resolution over hardcoded tenant values.

## Environment-variable API

`VBD.Environment` will provide required and optional reads, typed text/number/
boolean/JSON reads, definition inspection, bulk resolution, and preload/invalidate
operations.

Use the platform's `RetrieveEnvironmentVariableValue` contract for effective-value
resolution where suitable, alongside supported metadata retrieval for definition
type and diagnostics. Do not assume an SDK method shown in documentation is
itself a browser API; the implementation must use the supported Web API contract.

Proposed behavior:

1. Validate the schema name and caller's expected type.
2. Retrieve/validate the definition without exposing protected values.
3. Reject Secret definitions before any secret retrieval.
4. Resolve the effective current/default value through the supported contract.
5. Convert and validate against the declared type and supplied runtime schema.
6. Apply only explicitly declared optional-value/caller-fallback policies.
7. Cache successful safe results within the requested scope and TTL.

A current value takes precedence over a definition default. The default applies
when no current value is defined. Do not use truthiness: `false` and `0` are real
values. Empty strings need an explicit per-read `allowEmpty` contract and must
not automatically reveal a default value.

Distinguish a missing definition, no configured value, an empty value, a malformed
value, a denied read, and a failed service request. An optional read may return
absence only for documented missing cases, not for access or transport failures.

Provenance can be `current`, `default`, `platform`, or `callerFallback`.
Report `current`/`default` only when verified from the supported response and
metadata. If provenance is not observable, use `platform`; do not fabricate it.
If explicit table inspection finds ambiguous candidate value rows, report an
actionable configuration error rather than sorting by creation time and guessing.

## Types

| Definition type | Browser contract |
| --- | --- |
| Text | Text, with explicit trim/empty policies. |
| Decimal number | Finite number with documented invariant parsing and optional range validation. |
| Two options | Boolean using the platform's documented representation; not generic string truthiness. |
| JSON | Parsed unknown value validated by a runtime schema/validator. A TypeScript generic alone is insufficient. |
| Data source | Unsupported in the initial typed getters; require a separately defined supported metadata contract. Never treat it as connection credentials. |
| Secret | Reject with `SECRET_NOT_SUPPORTED`; retrieve/use secrets only on an authorized server path. |

## Configuration sources

`VBD.Config.resolve` has an explicit, documented precedence:

1. Allowed per-invocation options.
2. Named configuration/recipe values.
3. Declared environment-variable bindings.
4. Toolkit defaults for non-sensitive presentation settings.

This does not change current/default precedence within an environment variable.
Only explicitly overridable settings can be overridden. A recipe's origin
allowlist, operation allowlist, or mandatory confirmation cannot be disabled by
an arbitrary field value or URL parameter.

Start with validated JSON webresource configuration supplied by the consuming
solution. A configuration table and VBD Studio are optional later enhancements.
Do not require a custom table merely to open a dialog.

## Proposed toolkit-owned examples

| Schema/config key | Type | Example use |
| --- | --- | --- |
| `vbd_TargetModelDrivenAppId` | Text | App module ID in the current environment. |
| `vbd_TargetEnvironmentUrl` | Text | Explicit cross-environment base URL; validate permitted origins. |
| `vbd_TargetCanvasAppUrl` | Text | Approved Canvas player URL; launching is not Canvas runtime integration. |
| `vbd_HelpPortalUrl` | Text | Approved support/help destination. |
| `vbd_EnableAdvancedCommands` | Two options | UX feature flag, not authorization. |
| `vbd_LaunchProfiles` | JSON | Validated named app-launch profiles. |
| `vbd_ToolkitSettings` | JSON | Bounded presentation/cache settings. |

These are proposed definitions, not created components. Consumers can use their
own schema names. Avoid embedding deployment-specific current values in releases.

## Bindings

| Kind | Example meaning | Limits |
| --- | --- | --- |
| Literal | A dialog title or a fixed allowed choice. | Validate type and permitted values. |
| Context | Current table/record, app, user language. | Require the matching context; an unsaved record has no persisted ID. |
| Field | A lookup reference or form text. | Require a loaded supported attribute; treat user input as untrusted. |
| Environment | A named environment-variable value. | Typed reads, declared defaults, and no secret access. |
| Configuration | Another named key/profile. | Detect cycles and bound resolution depth. |
| Previous result | A previous recipe step's created-record ID. | Validate output path/type; no arbitrary property traversal. |

No JavaScript expressions, string-to-function conversion, unescaped FetchXML
substitution, or unrestricted URL interpolation.

## Caching and flags

- Cache keys include environment, user/security scope, and language where relevant.
- Use bounded TTL, size, and explicit invalidate/preload operations.
- Coalesce identical concurrent reads; never cache permission failures as absence.
- Prepared launches expire/invalidate when their configuration or scope changes.
- Expose effective feature flags for UX only; server authorization is independent.
- Do not store secrets, tokens, or arbitrary fetched record payloads in browser
  storage. Persistent caching is opt-in and limited to approved safe metadata.
- A cache hit is not a guarantee of immediately reflecting an administrator's
  last edit; document the freshness policy and refresh mechanism.

## Acceptance scenarios

Test current-over-default, default-only, missing definition, absent optional,
explicit empty, false, zero, invalid number/JSON, secret, data-source type,
denied access, multiple candidates, stale cache, concurrent requests, and
configuration cycles. Repeat app-profile resolution with two different deployment
settings without rebuilding the library.
