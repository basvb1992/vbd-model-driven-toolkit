# R2 native form UX: bounded source contracts

Parent integration: [issue #19](https://github.com/basvb1992/vbd-model-driven-toolkit/issues/19).
This pro-code lane adds exactly `Choices.setOptions`, `Choices.filterOptions`,
`Choices.restoreOptions`, and `Forms.switchForm`. Existing APIs, including the
attribute-based `Choices.getOptions`, are unchanged. Shared root type exports,
catalog status/counts and versioning remain parent-owned.

## Signatures and types

These are namespace members; `input` is a supplied native form context or an
original toolkit-created `OperationContext`, not an execution context, copied
context, global form fallback, grid, or Quick View attribute.

```ts
Choices.setOptions(
  input: unknown, controlName: string, options: readonly ChoiceOption[],
  settings?: ChoiceMutationOptions
): ChoiceMutationResult;
Choices.filterOptions(
  input: unknown, controlName: string, allowedValues: readonly number[],
  settings?: ChoiceMutationOptions
): ChoiceMutationResult;
Choices.restoreOptions(
  input: unknown, controlName: string, token: ChoiceBaselineToken,
  settings?: ChoiceMutationOptions
): ChoiceRestoreResult;
Forms.switchForm(
  input: unknown, formId: string, settings?: FormSwitchOptions
): Promise<FormSwitchResult>;

interface ChoiceOption { value: number; text: string }
interface ChoiceMutationOptions { excludedValuePolicy?: "reject" | "clear" }
// Opaque, nonconstructible branded interface; only original returned objects work.
interface ChoiceBaselineToken { /* private unique-symbol brand */ }
interface ChoiceMutationResult {
  status: "applied";
  baseline: ChoiceBaselineToken;
  clearedValues: number[];
}
interface ChoiceRestoreResult { status: "restored"; clearedValues: number[] }
interface FormSwitchOptions { dirtyPolicy?: "reject" | "save" }
type FormSwitchResult = {
  status: "requested" | "alreadyCurrent";
  formId: string;
};
```

Choice types are exported from `src/lookups.ts` (defined in
`src/choices-options.ts`); switch types are exported from `src/forms.ts`.
No additional public lifecycle, lookup, Fields, or lock APIs are introduced.

## Choices: explicit control scope, not metadata

- The target must be an explicitly named native control whose documented
  `getControlType()` is `choice` or `choices`, paired with attribute type
  `optionset` or `multiselectoptionset`, respectively. Its native attribute
  must be the same object returned by the supplied form's `getAttribute`.
- **Only a singly bound attribute is supported.** Its native `controls`
  collection must contain exactly this control. Body/header/process duplicates
  are rejected with `UNSUPPORTED_SURFACE` before mutation. There is no implicit
  all-controls or attribute-name scope; additional settings such as `scope`
  are invalid. This avoids silently updating one of several displays or
  clearing a shared attribute behind another display.
- Identities are signed Int32 integers, without string/boolean/null coercion.
  Lists contain 0–1000 entries with unique numeric identities. Labels contain
  0–8192 characters; empty and repeated labels are valid. Array order is the
  complete requested display order; there is no separate per-option index.
- `setOptions` can reorder/relabel/remove **currently native control options**,
  but cannot introduce identities missing from that snapshot. It creates no
  server choices and promises no server validation change.
- `filterOptions` validates every allowed identity against the current native
  control snapshot, then keeps its native order/labels, not caller-list order.
  Empty allow-lists are supported subject to the selected-value policy.
- Baselines come exclusively from **control** `getOptions`, never attribute
  metadata or the old attribute-based toolkit getter. Pre-existing filters are
  therefore part of the baseline. A native blank entry with a numeric identity
  and empty label is preserved exactly. A host returning a nonnumeric blank
  identity (`null`, `""`, etc.), duplicate identities, extra descriptor fields
  or other out-of-contract data is rejected with `DATA_RESPONSE_INVALID`
  before writing; no blank identity/order is guessed.
- Selection schema: single choice is an Int32 or `null`; multi-choice is
  `null` or a unique Int32 array of 0–1000 values. `0` is a selection, not empty.
  `false`, strings, fractions, and duplicate multi-values are invalid native
  responses. Legitimate `null` and `[]` remain distinct when no clear is needed.
- Default `excludedValuePolicy: "reject"` rejects a requested display that
  excludes a current selected value, with `INVALID_ARGUMENT` and retained
  `excludedValues`. There is **no implicit clear**.
- Explicit `"clear"` clears an excluded single value to `null`; for multi-choice
  it removes only excluded values, preserving remaining selection order
  (including `[]` when all are removed). `clearedValues` reports those identities.
  `"preserve"` and `"report"` are **not implemented** and are rejected.
- Restore uses that same policy against the **current** selection and the
  captured baseline. It does not resurrect selections cleared earlier, restore
  old field values, or replace a legitimate current selection. New selections
  outside the baseline require rejection or explicit clearing.
- All context/capability/data/selection checks precede the first setter.
  The implementation uses native `clearOptions` and indexed `addOption`, with
  `setValue` only for explicit clearing. It verifies exact resulting option
  content/order and selection, and rechecks the original native binding/methods
  after setters. There is no automatic save or `fireOnChange`.

### Baseline ownership and partial failures

The original frozen token is bound to the original form/control/attribute
objects, names, types, bound collection and method identities. Replaced or
reconfigured handles, copied/forged tokens, foreign forms/controls, consumed
tokens and tokens superseded by another toolkit writer cannot restore.

There is **one active token per weakly held control**. A new successful or
attempted mutating operation supersedes its predecessor; a rejected preflight
does not. Tokens are weakly registered and hold only a weak reference to the
control, so caller-retained tokens do not root detached hosts. Successful
restoration consumes the token. This is not a stack of historical undo handles.

Restore compares current native option identity/label/order with the last
confirmed result. Drift raises `RESOURCE_CONFLICT` without writes; a newer
toolkit writer invalidates the old token even if it writes identical content.
The platform exposes no option revision/event: an external change-and-revert
to identical content cannot be detected. Coordinate native writers; do not
treat an optimistic snapshot as an exclusive host-wide lock.

Any attempted native setter that throws, or a failed post-write verification,
raises `PARTIAL_FAILURE`, even if the first setter might have mutated before
throwing. Its retained cause includes `baseline`, `baselineOptions`,
`beforeOptions`, `intendedOptions`, `beforeValue`, `intendedValue`,
`completed` setter calls, `attempted`, `outcome: "uncertain"` and the underlying
cause. Completed calls are not transaction or persistence proof.
The token's outcome is then uncertain and further restore attempts conflict;
there is no guessed automatic rollback or success fallback. Inspect/reconcile
the native state and retained baseline before taking a fresh snapshot. A
failed restore likewise reports partial progress, not successful restoration.

```ts
// Native form supplied by your registered maker adapter; identity 0 must exist.
const changed = VBD.Choices.filterOptions(formContext, "statuscode", [0]);
// Later, in the same original control lifecycle and with no competing writer:
VBD.Choices.restoreOptions(formContext, "statuscode", changed.baseline);

// Clearing is a distinct, explicit data-value mutation. No automatic save/event:
VBD.Choices.setOptions(formContext, "statuscode", [
  { value: 0, text: "" }
], { excludedValuePolicy: "clear" });
```

## switchForm: permitted native navigation requests

- Requires a supplied real form context/owned `OperationContext` and supported
  global client capabilities; it never falls back to `Xrm.Page` or guesses roles.
  The implemented subset is **desktop Web (`getClient() === "Web"`, form
  factor 1), saved Update forms (`getFormType() === 2`)**.
- Create/QuickCreate (both type 1), undefined, read-only, disabled, bulk edit,
  mobile/tablet/phone and other clients are rejected as `UNSUPPORTED_SURFACE`.
  An empty update record ID is `UNSAVED_RECORD`.
- Form/record IDs are bounded GUIDs, normalized to lowercase without braces.
  The native selector collection is bounded to 100 items. All item IDs must be
  valid and unique, with no duplicate objects. The current item must be
  non-null and the identical object in that collection, with a matching ID.
  Single-form selectors returning null are unsupported, not inferred.
- Only the requested ID in the native permitted-items collection can be
  navigated. Missing targets are `FORM_TARGET_MISSING`; malformed or duplicate/
  inconsistent native outcomes are `DATA_RESPONSE_INVALID`. The target must
  support native `navigate`. UI visibility is not guessed access authorization.
- An already-current target returns `"alreadyCurrent"` without native
  `navigate` or save, even when dirty. This is not a record transition.
- Dirty defaults to `"reject"` (`DIRTY_FORM`). `"save"` permits awaiting the
  **existing `Forms.save`** only when dirty. It does not bypass that save's
  reentry guard, validation or errors. A clean form does not get saved.
- After await, the implementation resolves the supplied native form again and
  rechecks the native data/entity/UI/selector/collection/current/target objects,
  record/table/current-form IDs, native method identities, supported client/
  form type, target membership and new dirty edits. Changed identity/lifecycle
  rejects (including `RESOURCE_CONFLICT`), missing/unsupported surfaces keep
  their explicit errors, and new dirty edits cause `DIRTY_FORM`.
- One switch request is allowed per original form at a time, including
  synchronous native reentry. Concurrent requests raise `RESOURCE_BUSY`;
  the guard releases in `finally` on every success/error path.
- No implicit discard, unsupported dirty flag, QuickCreate callback,
  automatic second save, or data-write rollback. Native navigation throws
  remain explicit `SDK_OPERATION_FAILED` with cause; a request may already
  have reached the host. Do not retry blindly.
- `"requested"` only means native `navigate()` returned. It proves neither
  destination OnLoad, record save, transition completion nor continued access.
  The supported API cannot authenticate a detached form object whose old
  getters still expose entirely unchanged state; invoke only within the
  original host lifecycle, not from retained cross-page/timer contexts.

```ts
// targetFormId comes from the current permitted selector, not an environment ID.
const result = await VBD.Forms.switchForm(formContext, targetFormId, {
  dirtyPolicy: "save" // optional; default rejects dirty forms
});
if (result.status === "requested") {
  // Observe destination OnLoad separately; do not assume completion here.
}
```

## Evidence and handoff

Microsoft Learn pages checked directly on **2026-10-28**:

- [clearOptions](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/clearoptions),
  [addOption](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/addoption),
  [removeOption](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/removeoption):
  choice/choices native display operations; `addOption` accepts `{text,value}` and index.
- [Control getOptions](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/getoptions):
  includes blank entries and excludes removed options.
- [getControlType](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/getcontroltype),
  [getAttributeType](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/attributes/getattributetype)
  and [getAttribute](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/getattribute):
  native control/type/binding discriminators.
- [formSelector](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/formcontext-ui-formselector):
  permitted forms; no QuickCreate/mobile collection; null current item with one form.
- [Form-item getId](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/formcontext-ui-formselector/getid),
  [navigate](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/formcontext-ui-formselector/navigate):
  native IDs and navigation; dirty navigation can prompt; destination OnLoad is separate.
- [getFormType](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/formcontext-ui/getformtype):
  QuickCreate returns Create type 1.

Local test fixtures are confined to `tests/advanced-forms*.test.ts`. They verify
native receivers, schemas/bounds, single/multi/null selections, explicit clearing,
exact restoration, token integrity/drift/competing writers, partial failures,
selector restrictions, save/lifecycle races, reentry and guard cleanup.

Verification commands:

```text
npm ci --no-audit --no-fund
npx vitest run tests/advanced-forms-choices.test.ts tests/advanced-forms-switch.test.ts tests/forms.test.ts tests/form-events.test.ts
npm run typecheck
npx eslint src/forms.ts src/lookups.ts src/choices-options.ts tests/advanced-forms-choices.test.ts tests/advanced-forms-switch.test.ts
npm run build
npm run typecheck:package
```

Final outcomes: **214 tests passed across four files**, strict typecheck passed,
targeted ESLint passed, build passed, and the existing NodeNext package-consumer
typecheck passed. The initial typecheck failed because `tsc` was absent; locked
installation was then used, without dependency or lockfile changes. No shared
documentation/export-count tests are repaired in this lane.

**SENTINEL:** local mocks/types/build are not live UI proof. Check actual native
control discriminators/blank-option shape, single/multi rendering and native
value/event behavior, selector availability, save handlers, post-save races and
destination OnLoad in a separately authorized desktop Web client session.
Legacy/alternate control discriminators, multi-bound controls and unsupported
form/client types are intentionally not promised. No custom DOM/UI/PCF is used.
**AXIOM/CANVAS:** wire an existing supported form adapter to pass the real native
form/owned context; choose clearing/saving explicitly and handle errors. No maker
configuration, authentication, Dataverse call or deployment was performed here.

Rollback: revert the single bounded source commit and rebuild the parent bundle.
Already-cleared values or explicitly saved records are not reverted by source
rollback; native partial mutations require inspection/reconciliation. No durable
metadata, release or environment assets are changed.
