# Localization and typed display (bounded R2 source implementation)

Issue: [#21](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/21).
This incremental lane implements exactly `I18n.getLanguage`, `I18n.translate`,
`I18n.formatDate`, `I18n.formatNumber` and `Utils.formatValue`.
The parent owns root/browser exports, catalog availability/counts, version and
integration validation. No deployed BvB/release assets are changed here.
Until parent wiring, import `I18n` from `src/i18n.ts` and `Utils` from
`src/utils.ts` in source integrations; these are not new package subpath exports.

## Signatures and type exports

```ts
I18n.getLanguage(options?: LanguageOptions): LanguageInfo;
I18n.translate(key: string, locale: string, options: TranslationOptions): string;
I18n.formatNumber(value: number, locale: string, options: NumberFormatOptions): string;
I18n.formatDate(value: string | Date, locale: string, options: DateFormatOptions): string;
Utils.formatValue(input: DisplayValue, options: ValueFormatOptions): string;
```

`src/i18n.ts` exports the frozen runtime `I18n` object and types
`LanguageContext`, `LanguageOptions`, `LanguageInfo`, `TranslationScalar`,
`TranslationResources`, `TranslationOptions`, `NumberFormatOptions`,
`DateFormatOptions`, `DateStyle`, `TimeStyle`.
`src/utils.ts` preserves its existing runtime exports (`Utils`,
`dateMilliseconds`, `assertXmlCharacters`) and adds type re-exports
`DisplayValue`, `ValueFormatOptions`. Its frozen `Utils` gains only `formatValue`.
The helper modules are implementation details, not new namespace methods.
There is no registry, registration API, DOM access, network request, metadata
lookup, tenant query, write, expression interpreter or persistent state.

## Explicit locales, errors and defaults

All display calls, including text/null dispatch and translation's key fallback,
require a locale. Accepted BCP47 subset: two/three-letter language, optional
four-letter script, optional two-letter or three-digit region. No variants,
extensions, private-use tags, whitespace or underscores. Intl canonicalization
accepts casing/canonical aliases, but both number and date Intl formatters must
resolve to **exactly that canonical tag**. Lookup support by itself is not
evidence: `en-XX` must not silently become `en`. For example `en-us` becomes
`en-US`; `en-US`, `en-GB`, `nl-NL` and `de-DE` are tested. Other tags require the
same exact runtime support; there is no bundled locale database or locale pack.

Locale availability and currency/timezone data depend on the host's Intl/ICU.
Require an Intl-capable modern client, including `Intl.supportedValuesOf` for
currency validation. Unsupported requests fail, never use OS/browser defaults.
Punctuation, nonbreaking spaces, names and rounding follow that runtime's Intl
data, not a byte-stable cross-ICU serialization format.

Invalid shapes/options/values/missing interpolation use `VbdError`
`INVALID_ARGUMENT`; declared translation/resource bounds use `LIMIT_EXCEEDED`.
Missing required translations use `RESOURCE_NOT_FOUND`. Unavailable native
context uses `UNSUPPORTED_SURFACE`; SDK failures retain the normal SDK error and
cause. Invalid/incomplete native metadata is an error, not a successful unknown
language. No broad catch turns failure into display text.

## Language evidence, not locale guessing

`LanguageContext` is a supplied snapshot:

```ts
interface LanguageContext {
  readonly environmentUrl: string; // HTTPS origin, no path/query/credentials
  readonly userId: string;         // valid GUID
  readonly languageId: number;     // integer LCID 1..65535
}
interface LanguageOptions {
  readonly context?: LanguageContext;
  readonly localeMap?: readonly { readonly languageId: number; readonly locale: string }[];
}
```

With no supplied context, read only supported
`Xrm.Utility.getGlobalContext().userSettings.languageId`, `userId` and
`getClientUrl()`. No WebApi or online/client-state requirement. Supplied contexts
require all three fields and cannot add a locale assertion. This validates
scope/shape, not the authenticity of caller-supplied evidence. The caller must
provide a trusted current-user snapshot, not an authorization assertion.
The native properties are documented in Microsoft's public
[userSettings Client API reference](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-utility/getglobalcontext/usersettings);
`languageId` is the current user's LCID, not a BCP47 locale.

Result: `{ source: "native" | "supplied", scope: { environmentUrl, userId },
languageId, locale: string | null, localeEvidence:
"approved-exact-map" | "unmapped" }`. URL/GUID are normalized using existing
validators. LCIDs do not imply a built-in BCP47 mapping. Without a matching
caller-approved exact mapping, even LCID 1033 has `locale: null` and
`localeEvidence: "unmapped"`. This is the only explicit unknown-locale outcome.
There is no default display locale.

Maps contain at most 64 unique LCIDs; validate every mapping's exact locale
support, including unused mappings. Missing entries remain unmapped. Duplicate,
sparse, accessor or malformed entries fail. Approval/provenance of each LCID
mapping is the integrator's responsibility; supplying a map attests approval.
No inference from environment names, browser, OS, incomplete metadata, Windows
timezone identifiers, or a nearby language/region is performed.

```ts
const info = I18n.getLanguage({
  context: {
    environmentUrl: "https://example.crm.dynamics.com",
    userId: "11111111-2222-3333-4444-555555555555",
    languageId: 1043
  },
  localeMap: [{ languageId: 1043, locale: "nl-NL" }] // reviewed exact mapping
});
// info.locale === "nl-NL"; evidence === "approved-exact-map"
// Omitting localeMap yields locale === null, evidence === "unmapped".
```

The origin/GUID above are synthetic fixtures, not configuration defaults.

## Per-call plain-text resources

`TranslationResources` is
`Readonly<Record<string, Readonly<Record<string, string>>>>`: canonical exact
locale keys mapped to flat, exact message keys and string templates.

`TranslationOptions` requires `resources`, optionally scalar `values`, and:

- `{ onMissing: "error" }`: missing language or key throws.
- `{ onMissing: "key" }`: missing language/key returns the requested exact key;
  interpolation must be empty.
- `{ onMissing: "fallback", fallbackLocale: string }`: use one explicitly
  validated different locale only when the requested language/key is absent.
  The fallback dictionary must exist, even if not needed. If its key is missing,
  throw. No fallback chains, automatic parent-language fallback or key fallback.

Templates use `{name}` only. Names start with an ASCII letter, then letters,
digits or underscores, up to 64 characters. Repeated names are allowed and use
the same value. Every brace must belong to this grammar; no escaping syntax,
nested templates, property paths, plural/select rules or executable expressions.
The supplied names must equal the selected template's unique names exactly:
missing, extra and malformed placeholders fail. Values are strings, finite
numbers or booleans, converted only after scalar validation. Null, undefined,
objects, arrays, bigint, functions and non-finite numbers fail. Empty strings,
false and zero remain intentional values. Inserted values are never reparsed.

Message keys start with an ASCII letter, followed by letters/digits/dot/underscore/
hyphen, at most 128 characters. Dots are literal, not path traversal.
`__proto__`, `prototype`, `constructor` are forbidden object keys/names.
Only own enumerable data properties on plain JSON objects (including null
prototypes and foreign-realm JSON) are accepted. Symbols, accessors (including
`then`/`toJSON` getters), hidden properties, custom prototypes, cycles, nested
dictionaries, arrays and non-string leaves fail without invoking getters or
coercion hooks. All resource entries are validated, including unused templates.
Snapshots are copied per call; no global mutable registry or retained reference.
As with other synchronous object APIs, hostile JavaScript Proxies are not an
isolation boundary: reflection traps may throw. Supply parsed JSON/plain data,
not executable Proxy wrappers.

Bounds (fixed, not caller-overridable):

| Input/output | Limit |
| --- | --- |
| Resource languages / entries per language | 16 / 256 |
| Resource nodes (root + language objects + string leaves) | 2048 |
| Copied resource JSON, UTF-8 bytes | 262144 |
| Template / interpolation string | 4096 UTF-16 code units each |
| Unique placeholder names / supplied values | 64 / 64 |
| Copied interpolation JSON, UTF-8 bytes | 65536 |
| Output | 16384 UTF-16 code units and 65536 UTF-8 JSON bytes |

Malformed UTF-16 is rejected. Byte limits include JSON syntax/escaping.
No HTML escaping/rendering is promised: output is **plain text**, and literal
markup may occur in resources/values. Assign it using a caller's text API, never
`innerHTML` or an HTML interpreter. The toolkit neither renders nor sanitizes HTML.

```ts
I18n.translate("summary", "nl-NL", {
  resources: { "nl-NL": { summary: "{name}: {count}/{enabled}/{empty}" } },
  onMissing: "error",
  values: { name: "Ada", count: 0, enabled: false, empty: "" }
});
// "Ada: 0/false/"
```

## Display numbers

`NumberFormatOptions` is a union with required `style`:

```ts
type NumberFormatOptions = {
  readonly useGrouping?: boolean;
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
} & (
  | { readonly style: "decimal" | "percent" }
  | { readonly style: "currency"; readonly currency: string;
      readonly currencyDisplay?: "code" | "symbol" }
);
```

Only primitive finite numbers; never parse/coerce localized strings. Fraction
digits are integers 0..20 inclusive, with min <= max when both supplied.
Explicit false grouping and zero fraction digits are preserved. When omitted,
grouping, fraction defaults, rounding and symbol display follow Intl, including
currency minor units and adjustment of unspecified fraction bounds.
Currency must be an uppercase three-letter entry in the runtime's
`Intl.supportedValuesOf("currency")`; a syntactically valid invented code fails.
Currency options on other styles, undefined explicit options, compact/scientific
notation, units, sign/rounding/significant-digit options and unknown keys fail.

```ts
I18n.formatNumber(1234.5, "de-DE", {
  style: "decimal", useGrouping: true,
  minimumFractionDigits: 2, maximumFractionDigits: 2
}); // "1.234,50"
I18n.formatNumber(0.125, "en-US", { style: "percent", maximumFractionDigits: 1 });
// "12.5%"
```

Display text is not an OData literal, invariant input or query serialization.

## Date subset: explicit behavior, Gregorian calendar

`DateStyle = "short" | "medium" | "long" | "full"` and
`TimeStyle = "short" | "medium" | "long"`. `dateStyle` is always required;
`timeStyle` is optional only for independent/local values. Omitted timeStyle
means date display only. All dates use Gregorian calendar and Latin digits.
Locale controls names/order/hour-cycle/punctuation; alternate calendars,
numbering systems, custom component/hour options and arbitrary Intl options
are intentionally unsupported.

| Options | Required value and behavior |
| --- | --- |
| `{ behavior: "dateOnly", dateStyle }` | Real calendar-only string `YYYY-MM-DD`, years 0001..9999. No Date, time component, offset or zone option. |
| `{ behavior: "timeZoneIndependent", dateStyle, timeStyle? }` | Real wall-clock string `YYYY-MM-DDTHH:mm:ss` or exactly `.SSS` milliseconds, years 0001..9999, 00..23/00..59/00..59. No Date, offset, Z or zone option. UTC is an internal carrier only: no user/local shift. Nonexistent or repeated *local* DST times remain valid independent wall-clock values. |
| `{ behavior: "userLocal", dateStyle, timeStyle?, timeZone }` | Valid actual Date instant, including foreign-realm Dates. Explicit supported Intl zone `UTC` or slash-separated IANA-style name. The supplied instant is displayed in that zone; DST rules come from Intl. |

Date strings are strict/canonical, leap/calendar rollover is rejected, and
date construction avoids JavaScript's special 0..99 year interpretation.
Invalid Dates/Date lookalikes fail. The intrinsic Date getTime brand check does
not invoke overridden getTime/valueOf, and requires no circular Utils import.
Milliseconds can be accepted for independent input but these display styles
do not show fractional seconds. Leap seconds and ambiguous local wall-clock to
instant conversion are unsupported. No parsing of user-entered date strings.

For `userLocal`, valid Date instants use JavaScript's finite Date range and the
host's Gregorian Intl representation (including era behavior outside CE).
Actual zone support is checked by constructing Intl; aliases accepted by Intl
are permitted if explicitly supplied. Numeric offsets, bare GMT, Windows zone
names, browser zone defaults and toolkit zone mappings are not supported.
No native current-user timezone lookup is attempted. The integrator must supply
an approved IANA zone from authoritative evidence; LCID is not timezone evidence.

```ts
I18n.formatDate("2024-02-29", "en-GB", {
  behavior: "dateOnly", dateStyle: "long"
}); // "29 February 2024"
I18n.formatDate("2024-03-10T02:30:00", "en-GB", {
  behavior: "timeZoneIndependent", dateStyle: "long", timeStyle: "short"
}); // 10 March 2024, 02:30 wall clock; no DST-gap conversion
I18n.formatDate(new Date("2026-01-01T00:30:00Z"), "en-GB", {
  behavior: "userLocal", dateStyle: "long", timeStyle: "short",
  timeZone: "America/New_York"
}); // 31 December 2025, 19:30 in that explicit zone
```

## Typed display dispatcher

`ValueFormatOptions = { readonly locale: string; readonly nulls:
{ readonly policy: "error" } | { readonly policy: "label"; readonly label: string } }`.
Null is never confused with empty, zero or false; undefined is invalid.
All kinds require the explicit locale/null policy. Supplied configuration is
validated even when the value is null. A null value then uses the null label
(including an empty label) or throws under `policy: "error"`.

`DisplayValue` is this single-value discriminated union:

| Kind | Value | Additional required input |
| --- | --- | --- |
| `text` | `string \| null` | None; literal plain text. |
| `boolean` | `boolean \| null` | `labels: { true: string; false: string }` |
| `number` | `number \| null` | `format: NumberFormatOptions`; delegates to I18n. |
| `date` | `string \| Date \| null` | `format: DateFormatOptions`; delegates to I18n. |
| `reference` | `EntityRef \| null` | `label: { reference: EntityRef; text: string }`; normalized table/ID must exactly match non-null value. No inferred ID/name label. |
| `choice` | `number \| null` | `labels: readonly { value: number; label: string }[]`; exact supplied single-choice mapping. |

Choice keys are unique signed 32-bit integers; at most 256 data entries, no sparse
or accessor arrays. Unknown choices throw, not stringify the number. References
use existing EntityRef GUID/logical-name validation and normalize only for
identity comparison, never mutate caller values. Empty exact labels are valid.
Text, labels and optional reference names are capped at 4096 UTF-16 code units
and reject malformed UTF-16. Unknown properties and label getters fail.
No multi-choice/reference arrays, money/base-currency conversion, server metadata
guesses, file/image rendering, HTML or expressions are supported.

```ts
Utils.formatValue({
  kind: "boolean", value: false, labels: { true: "Ja", false: "Nee" }
}, { locale: "nl-NL", nulls: { policy: "label", label: "(leeg)" } });
// "Nee"
Utils.formatValue({
  kind: "choice", value: 0, labels: [{ value: 0, label: "" }]
}, { locale: "en-US", nulls: { policy: "error" } });
// ""
```

## Verification, handoff and rollback

Focused source suites: `tests/localization-language.test.ts`,
`tests/localization-translation.test.ts`, `tests/localization-format.test.ts`,
`tests/value-format.test.ts`; existing Utils/form suites remain relevant.
Tests assert requested language/value meaning, actual date/DST behavior and
cross-realm Date support. Currency whitespace is normalized where ICU may use
different nonbreaking-space punctuation. There are no live tenant tests.

Local verification on Node 24.22.1:

- The initial `npm run typecheck` detected the expected missing `tsc` in this
  fresh worktree, then `npm ci --no-audit --no-fund` installed locked dependencies.
- `npx vitest run tests/localization-language.test.ts tests/localization-translation.test.ts tests/localization-format.test.ts tests/value-format.test.ts`:
  **160 passed** in four files.
- `npx vitest run tests/forms.test.ts tests/advanced-forms-choices.test.ts tests/advanced-forms-switch.test.ts tests/form-events.test.ts`:
  **214 passed**, including existing Utils regressions.
- `npm run typecheck`, targeted ESLint on all changed TypeScript source/tests,
  `npm run build`, and `git diff --check`: passed.
- `npm run check`: strict types, full lint, production/playground builds and
  NodeNext consumer types passed; full tests **1548 passed, 2 skipped, 1 failed**.
  The sole failure is the existing `tests/documentation.test.ts` implemented-list
  parity check: catalog/count remains 145, while the existing root-exported Utils
  now adds `formatValue` (146 actual). I18n is intentionally not root-wired here.
  This is an explicit parent-owned integration gap, not a bypassed passing check.

SENTINEL/parent: wire root/browser exports and public type exports, reconcile
catalog/count/parity checks, and validate the resulting browser bundle on the
supported model-driven clients. Review approved LCID mappings/zone provenance
with FORGE/AXIOM at integration boundaries. AXIOM/CANVAS: if used in maker
handlers, supply reviewed resources, locale, labels, null/date behavior and zone;
place output through text-only APIs, never HTML. No maker setup is implemented
or required for these pure supplied-input APIs.

Limits remain intentional: no complete LCID database/timezone mapping,
automatic translation discovery, Intl polyfill, HTML sanitizer or platform
date-value adapter. Rendered/input/live-client verification is not claimed.
Rollback is a single local commit revert (only the listed owned source/tests and
this document); no registry, persisted state, deployment or data rollback.
