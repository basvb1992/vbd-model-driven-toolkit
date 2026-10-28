# Environment reads and prepared app launching

The environment/launcher subset introduced in 0.2.0 continues in the broader
0.5.0 core. See [core usage](core-usage.md) for prepared-profile form/grid
handlers and native navigation. Record bindings in app-window profiles,
arbitrary external app-window destinations and workflow
execution remain out of scope. The bundle is installed in BvB for testing;
consumer environment bindings and form/ribbon wiring are not automatically installed.

## Same-window profile requests

The 0.5.0 `Launch.openProfile(options)` path supports only a registered
modelDrivenApp profile with `presentation: "sameWindow"`. Supply the existing
configurationName/profileKey and optional ReadContext/ttlMs, plus an optional
trusted `SameWindowHost`. Its `navigateSameWindow(url)` method may return void
or Promise<void>; it must request navigation in the same window, not a popup.
An explicit adapter is trusted application code, never loaded from JSON.

Profile/environment/origin validation is shared with preparation. Scope,
registry revision, environment generation and freshness are rechecked before
dispatch. The receipt is status=requested, outcome=unknown,
presentation=sameWindow: neither host completion nor URL construction proves
that the app loaded or that access was granted. A host failure may occur after
the native request; no rollback or automatic retry is implied.

The default adapter uses standard `location.assign` in the current top-level
browser only. An embedded form/webresource frame is rejected; it never
reaches into a parent DOM or silently redirects another frame. Embedded hosts
need an explicit reviewed adapter implementing their supported navigation path.
This deliberately does not use openUrl as an asynchronous popup workaround.

New-window profiles still require prepareProfile/openPrepared and active user
activation. openProfile rejects them before any environment reads; preparing a
sameWindow profile also fails before reads. Existing prepared-profile form/grid
registrations remain newWindow-only, rather than automatically changing their
click behavior.

```typescript
await VBD.Launch.openProfile({
  configurationName: "workspace", profileKey: "sameWindowWorkspace",
  host: reviewedSameWindowNavigationHost
});
```

Declare that profile with sameWindow presentation and its required text
environment bindings, using the existing Config registration contract. This
does not create apps, grant access, or install consumer configuration.

## Context and permissions

In an online model-driven app, environment reads lazily use supported
`Xrm.Utility.getGlobalContext()` and `Xrm.WebApi.retrieveMultipleRecords`.
The caller's current identity and Dataverse permissions apply. No token, tenant
URL, password, or framework service is configured by the toolkit.

For testing or an approved integration, supply a typed `ReadContext` with
`getScope()` and `retrieveMultipleRecords(table, query, maximumPageSize)`.
Scope includes HTTPS root environmentUrl, userId GUID, languageId, and online.
Context functions are trusted application code, never functions from JSON config.
Offline/malformed contexts fail explicitly. No cross-environment authentication
or privilege elevation is provided.

## Environment signatures

All reads return promises. Common options are optional context and cacheTtlMs.
Required getters reject missing/invalid values; nothing silently becomes a
default JavaScript value.

| API | Current input / result |
| --- | --- |
| VBD.Environment.get | `(schemaName, { type, ...typeOptions })` returns `ResolvedValue<unknown>`; JSON requires a runtime predicate. |
| VBD.Environment.getOptional | Same plus required `absence: "definition" / "value" / "either"`; only the selected missing cases return undefined. |
| VBD.Environment.getText | `(schemaName, { trim?, allowEmpty?, ...common })`; returns string; defaults preserve whitespace and reject empty. |
| VBD.Environment.getNumber | `(schemaName, { min?, max?, ...common })`; finite invariant decimal/exponent input; empty, hex, comma decimals, NaN and infinity fail. |
| VBD.Environment.getBoolean | `(schemaName, common?)`; case-insensitive trimmed true/false and yes/no only; false is not absence. |
| VBD.Environment.getJson | `(schemaName, { validate: runtimeTypeGuard, ...common })`; parse and run the guard once; a generic annotation alone is insufficient. |
| VBD.Environment.getDefinition | `(schemaName, { context? })`; identity/schema/type only, no default/current values, including for protected types. |
| VBD.Environment.getMany | `(requests, { concurrency?, ...common })`; requests contain schemaName/type/type options; returns a keyed map only when the batch succeeds. |
| VBD.Environment.preload | Same requests/options; returns `{ resolved }`, not values or a promise to retain every item indefinitely. |
| VBD.Environment.invalidate | `(schemaNameOrNames?, { context? })`; removes selected scope cache entries and returns their count; expires prepared launches conservatively. |

`ResolvedValue<T>` contains value, schemaName, type, observed current/default
source, fetchedAt, expiresAt, and cached. Do not log or persist the returned
value. Fresh JSON is parsed/validated on each read so caller mutation cannot
alter cached state.
Guards must synchronously return Boolean true. Async/thenable outcomes are
rejected without waiting for their settlement or leaving an unhandled rejection.

Example from trusted caller code:

```typescript
const enabled = await VBD.Environment.getBoolean("vbd_EnableAdvancedCommands");
const optional = await VBD.Environment.getOptional("vbd_OptionalSetting", {
  type: "text",
  absence: "either"
});
```

Schema names may belong to any publisher and must be 1-128 letter/digit/
underscore characters, starting with a letter. Names cannot inject query text.
Define variables and grant access in the consuming solution before using them;
the toolkit does not provision them automatically.

## Resolution and protected data

1. Select definition identity/schema/type only.
2. Reject Secret or Data source value reads before selecting any current/default.
3. Accept at most one current candidate. A non-null current value wins, including
   an empty string. Only absent/null current permits a default read.
4. Check declared/requested type, bounds, and the caller's runtime validation.

Multiple candidates or a partial continuation page fail as ambiguous. There is
no newest-record guess, automatic layer selection, or implicit fallback to a
different resolution strategy. The platform effective-value function is not
used by this explicit-provenance resolver; do not assume semantic equivalence
for layered configurations.

Optional reads never hide access, transport, ambiguity, type, empty-value, or
validation failures. Recognizable access errors have ACCESS_DENIED; other
platform errors retain their cause under DATA_READ_FAILED. No native cause,
value, URL, or stack is sent by diagnostic reporting.
Absence means no definition/value visible to the caller. A backend-filtered
row or field cannot be distinguished from absence without additional authorized
evidence; this is not a global presence or effective-access certification.

Secret values are never requested. A Secret accidentally stored as Text is not
made secure by this toolkit: client-readable configuration is not a secret store.

## Cache and batch limits

- Memory only; no sessionStorage/localStorage or persistent record cache.
- Scope is normalized environment/user/language; default TTL 60000 ms, maximum
  300000 ms, and zero explicitly bypasses caching.
- At most 128 entries and 2097152 UTF-16 code units of cached values. Each
  service value is limited to 1048576 code units.
- At most 64 active loads; identical in-flight value reads share a request.
  Failures/invalid conversions are not retained.
- At most 100 unique batch requests; concurrency defaults to 4, range 1-8.
  Started work settles before a failed batch rejects. Its structured cause
  identifies the failed schema; no success-shaped partial map is returned.
- Invalidation during a read or a changed scope rejects stale results. An
  explicit invalidation conservatively expires all prepared tokens, although
  selected cache removal is limited to the requested scope/names.
- Scope/generation are rechecked after conversion as well as after service
  reads, including cache hits. A batch binds one scope for its whole invocation.

TTL is a freshness policy, not proof that an administrator has not changed a
value. Invalidate deliberately when configuration changes. Capacity eviction can
remove preloaded items before TTL; preload reports resolution, not guaranteed
retention.

## App link and launch contracts

| API | Current signature / behavior |
| --- | --- |
| VBD.Links.app | `({ environmentUrl, appId? / appName?, allowedOrigins })`; exactly one identity, explicit HTTPS root, exact approved origin. |
| VBD.Launch.getProfile | `({ configurationName, profileKey })`; returns an unresolved independent registered profile copy. |
| VBD.Launch.prepareProfile | `({ configurationName, profileKey, context?, ttlMs? })`; resolves required text bindings and returns an opaque frozen token. |
| VBD.Launch.openPrepared | `(originalToken, { width?, height?, host? })`; synchronous; no destination override or reads. |
| VBD.Windows.open | `({ url, allowedOrigins, width?, height?, host? })`; direct synchronous approved app-link request; not arbitrary external/record URLs. |

Origins are canonical HTTPS roots, including any explicitly approved port.
Credentials, root paths other than `/`, query strings/fragments in base origins,
backslashes, deceptive hosts, and unapproved origins fail.
App IDs must be GUIDs; unique names are letter/digit/underscore identifiers.
The resulting `/main.aspx` URL contains only appid or appname. No form/record
data, token, or extra query is forwarded.

Prepared tokens expose only an ID/expiry. Destination, policy, scope, revision
and freshness remain private in memory. Copies/forgeries do not work. Tokens
expire after the requested TTL (default 60000 ms, maximum 300000), capped by the
oldest source freshness. Registry replacement, scope changes, invalidation,
clock rollback, expiry, or capacity eviction require preparation again.
Only the newest 128 prepared tokens are retained.

## Caller-owned setup and click wrapper

After loading the built browser bundle and supplying the reviewed configuration:

```javascript
VBD.Config.register("workspace", approvedConfiguration);
let preparedWorkspace;

async function prepareWorkspace() {
  preparedWorkspace = await VBD.Launch.prepareProfile({
    configurationName: "workspace",
    profileKey: "customerWorkspace"
  });
}

function openWorkspace() {
  return VBD.Launch.openPrepared(preparedWorkspace, {
    width: 1200,
    height: 900
  });
}
```

Run preparation during your supported initialization. Wire your own synchronous
click wrapper deliberately; never await preparation/save/confirmation before
opening inside the same handler. If not ready/expired, show the error and have
the user click again after preparation. These caller-owned wrappers remain
supported; 0.3.0 also offers [native entry-point parameters](core-usage.md)
for prepared profiles. No registration/deployment happens automatically.
Calls before preparation fail with CONFIG_NOT_READY.

Window requests require observable active navigator.userActivation (or an
explicit trusted WindowHost). They use `_blank` and `noopener,noreferrer`.
Pixel width/height are optional hints, each integer 100-4096; the browser can
still choose a tab. No opener, named reuse, blank reservation, or silent same-tab
fallback is provided.

Every successful invocation returns requested/unknown, even when a handle is
null or non-null. It does not certify popup creation, target loading, app access,
record save, offline support, or a separate sign-in identity. Existing SSO/cookies
can be shared. Native record forms should use the future supported form adapters,
not this app-link path.

## Verification boundary

Typed fixtures and browser-bundle integration cover resolution, cache/races,
origin policy, token validity, synchronous requests and error semantics.
Actual tenant data/access and managed/unmanaged installation remain unverified.
The [feature specification](feature-spec.md) records a controlled Chrome
156.0.4314.50 run: trusted active click, exact approved destination, no reads
during opening, null opener/empty referrer, and rejection after activation
expired without another open. The destination and Xrm data were synthetic/routed,
not a real Dynamics app or tenant authorization check.
