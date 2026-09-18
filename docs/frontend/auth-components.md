# KYB auth components

LP-facing email+password authentication modals for epic #1247 (KYB login flow). This is a new
area doc — `dashboard-components.md` is already 117 KB and epic #1247 adds five more screens
(#1251 Company Docs, #1252 Owners, #1253 Account-in-review) beyond #1249 (Create-account)
and #1250 (OTP), all documented below — same reasoning as `wallet-flows.md` /
`trustee-flows.md`.

#1253's Issue body also named a "review banner" deliverable. It does not exist in the
source-of-truth Figma section — see `### AccountInReviewModal` below and TD-69
(`docs/exec-plans/tech-debt-tracker.md`). Nothing is built for it here.

**No production entry point changes in this epic yet.** These modals are reachable only from the
`/test?tab=auth` diagnostics route (see `dashboard-components.md#diagnostics-route`). `TopBar`'s
"Connect Wallet" button keeps opening `ConnectWalletModal` unchanged. The LP header will get
separate entry buttons once a dedicated Figma for that change ships — tracked on epic #1247, not
this issue.

### AuthModalShell

`packages/frontend/src/components/AuthModalShell.tsx`. The full-viewport two-pane modal frame
shared by the KYB auth screens (Figma component `8550:10210` content pane + `8550:10546` image
pane) — lifted verbatim from `ConnectWalletModal`'s shell (focus trap, capture-phase Escape,
body-scroll lock, `RightImagePanel`) so the two families of modals stay pixel-identical. Renders
a `<h2>` heading (wired to `aria-labelledby`) plus arbitrary `children` in the left pane, and the
hero photo + Pipeline logo + "Access real-world yield on-chain" headline in the right pane
(hidden below `lg`).

`ConnectWalletModal` itself was **not** refactored onto this shell (TD-58,
`docs/exec-plans/tech-debt-tracker.md`) — it is merged, QA-verified, and on the critical connect
path.

Known shell caveats it inherits unchanged (both pre-existing, not introduced by #1248):

- **Unguarded body-scroll-lock.** `document.body.style.overflow` is set to `"hidden"` and reset
  to `""` on cleanup with no reference counter. If `SignInModal` is ever stacked over
  `ConnectWalletModal`, closing the inner one unlocks the body under the outer one. Not triggered
  today — the modal only opens standalone from `/test`.
- **Escape-key capture-phase collision.** Both this shell and `ConnectWalletModal`/
  `FirstConnectionModal` listen for Escape on `document` in the capture phase with
  `e.stopPropagation()`. If two of these modals are ever stacked, use the
  `stopImmediatePropagation` pattern from
  `packages/ui/src/components/ErrorDetailsDialog/useErrorDetailsDialog.ts` (documented at
  `docs/frontend/error-handling.md#nested-dialogs-1037`).

**Accessibility:** `role="dialog" aria-modal="true"`, `aria-labelledby` resolves to the heading
element's id; focus trap (Tab/Shift+Tab cycle among non-`aria-hidden` focusable descendants);
Escape and the × button both dismiss; no scrim click (the panel is full-viewport, matching
`ConnectWalletModal`).

**Optional props (added by #1250, backward-compatible)** — all five default to today's behaviour,
so `SignInModal` renders byte-identical without passing any of them:

| Prop | Default | Effect |
| --- | --- | --- |
| `description?: string` | `undefined` | Renders a `<p>` (`--text-pipeline-body` / full ink) below the `<h2>`, in a `flex flex-col gap-2` wrapper so the two sit 8px apart while the heading block keeps the column's 24px gap above `children`. |
| `showImagePanel?: boolean` | `true` | `false` omits `<RightImagePanel />` entirely (no hero photo/logo/headline). |
| `showCloseButton?: boolean` | `true` | `false` omits the `×` close button. |
| `onBack?: () => void` | `undefined` | When set, renders a back `<button aria-label="Back">` (24×24 arrow-left icon, Figma node `6486:81678`) at `top-4 left-4` (glyph lands at (20, 20)) — the mirror of the close button. Rendered **after** `{children}` and `<RightImagePanel />` in DOM order, so the shell's auto-focus-first-descendant effect still lands on content, not the back button. |
| `align?: "start" \| "center"` | `"start"` | `"center"` appends `my-auto` to the content column (vertical centering via margin, not `justify-center` on the parent, so `overflow-y-auto` stays scroll-safe on short viewports). |
| `stepLabel?: { current: number; total: number }` | `undefined` | Added by #1251. Renders a non-focusable `Step {current}` (ink) + `/{total}` (ink-muted) badge at `top-4 left-4` — a step indicator, not navigation (no progress bar, no logo, no back arrow). `CompanyDocsModal` uses `{ current: 1, total: 2 }`; #1252's Owners screen reuses it verbatim at `{ current: 2, total: 2 }`. **Mutually exclusive with `onBack`** — both occupy `top-4 left-4` and no Figma frame in this epic shows both together; passing both is undefined layout, not validated at runtime. |
| `icon?: React.ReactNode` | `undefined` | Added by #1253. Renders as the **first** child of the content column, above the heading block, wrapped in `<div className="mb-2 flex w-full justify-center">`. The `mb-2` turns the column's 24px `gap-6` into the frame's 32px icon-to-heading gap — the same technique `CompanyDocsModal`/`OwnersModal` use with `mt-2` on their children wrapper. `AccountInReviewModal` is the only consumer so far. |
| `headingAlign?: "start" \| "center"` | `"start"` | Added by #1253. `"center"` appends `text-center` to the heading wrapper (both the `<h2>` and the description `<p>`) — **horizontal** text alignment, orthogonal to `align`'s *vertical* `my-auto` centering of the whole column. Named `headingAlign` rather than `align` because that name is already taken. |

The OTP screen (`OtpModal`, below) hides both the image pane and the close button and uses the
back arrow as its only dismiss affordance, since Figma hides the shell's Close Icon instance for
that frame. See tech debt **TD-61** for the vertical-centering divergence: every KYB Figma frame
centres its content column, but `SignInModal`/`CreateAccountModal` still top-align pending a
design decision — only `OtpModal` opts into `align="center"` so far.

### Shared form parts

`packages/frontend/src/components/AuthModalParts.tsx`. `ContinueWithWalletButton` (Figma node
`6486:81624`, the 24×24 wallet glyph + `Button variant="secondary"` white-fill override) and
`OrDivider` (Figma node `6486:81625`) are shared verbatim between `SignInModal` and
`CreateAccountModal` — confirmed byte-identical instances across both frames during #1249
planning. `packages/frontend/src/components/useAuthCredentialsForm.ts` (renamed from
`useSignInModal.ts` in #1249) is the shared credential-form state/validation hook consumed by
both modals — see the validation rules under "SignInModal" below, which apply unchanged to
`CreateAccountModal`.

### SignInModal

`packages/frontend/src/components/SignInModal.tsx` + `useAuthCredentialsForm.ts`. The
email+password sign-in screen — a presentational component with **no network call**; `onSubmit`
is a seam for #1254 (defaults to a no-op).

Visual specs (Figma):

- Default (empty fields, submit disabled): node `6486:81557`.
- Enabled (both fields filled, submit enabled): node `6486:81576`.
- Validation error (malformed email + empty password): node `6486:81595`.

Composition inside `AuthModalShell` (heading "Sign in", `headingId`
`sign-in-modal-heading`, `testId` `sign-in-modal`), top to bottom, wrapped in the repo's first
`<form onSubmit>` (so Enter submits natively):

1. **"Continue with wallet"** — `Button variant="secondary"`, white fill override (the shared
   `secondary` variant ships transparent), a 24×24 wallet glyph + label. Seam `onContinueWithWallet`
   (defaults to a no-op) — a development annotation on the Figma node confirms the intended
   destination is the existing `ConnectWalletModal`; wiring is #1254's job.
2. **"OR" divider** — a hairline rule each side of a centered `OR` label, `--color-pipeline-ink-subtle`
   for both the rule and the label (confirmed via Figma variable defs: `border-test/primary` /
   `content-test/tertiary` both resolve to `rgba(56,53,56,0.3)` — within one channel unit of the
   repo's existing `ink-subtle` (`rgb(56 55 53 / 0.3)`), so no new token was added).
3. **Fields** — two `TextField`s (`@pipeline/ui`): `type="email"` placeholder
   "Enter corporate email", then `type="password"` placeholder "Password".
4. **Submit** — `Button variant="primary-blue" type="submit"`, label "Sign In" in every state
   (the default-state frame renders the disabled button's label as a single corrupt `C` glyph in
   the design file; treated as a design-file artifact, `get_design_context` confirms the two other
   frames render "Sign In"). Disabled fill is the brand color at `opacity-[0.32]`, confirmed by
   `get_design_context` (`opacity-32` class on the Figma-exported node) rather than a separately
   sampled color.
5. **"Forgot password?"** — renders as inert text (no `<button>`, no handler) — it has no
   destination frame in the "KYB Onboarding" file and no sub-issue.
6. **"New here? Create account"** — also inert text in #1248 and unwired in #1249's
   `CreateAccountModal` counterpart ("Already have an account? Log in") — the cross-link between
   the two modals is #1254's job.

**Figma → token mapping** (confirmed via `get_variable_defs` + `get_design_context`, not
estimated from pixel sampling):

| Element | Token | Figma binding |
| --- | --- | --- |
| Field fill, default | `--color-pipeline-surface` | `fill-test/on-primary` |
| Field fill, invalid | `--color-pipeline-negative-secondary` (new) | `fill/negative-secondary` = `#b2000029` |
| Field/error text, invalid | `--color-pipeline-negative-strong` (new) | `content-test/negative` = `#b20000` |
| Placeholder | `--color-pipeline-ink-muted` | `content-test/secondary` |
| "Forgot password?" | `--color-pipeline-ink` | `content-test/primary` (full ink, **not** muted) |
| "New here?" | `--color-pipeline-ink-muted` | `content-test/secondary` |
| "Create account" | `--color-pipeline-ink`, `--font-weight-emphasized` | `content-test/primary` |
| OR rule + label | `--color-pipeline-ink-subtle` | `border-test/primary` / `content-test/tertiary` |
| Submit label (enabled) | `--color-pipeline-on-dark` | `content-test/primary-on-invert` |

The two new tokens (`--color-pipeline-negative-strong: #b20000`,
`--color-pipeline-negative-secondary: rgb(178 0 0 / 0.16)`) were added to
`packages/ui/src/styles/theme.css` token-exact to the KYB frame rather than reusing the existing
`--color-pipeline-negative: #c0392b` — the two live in different Figma variable namespaces and
render visibly different reds. The divergence is logged as tech debt (TD-59) for a designer
reconciliation pass.

**Vertical rhythm** (400px column, confirmed via `get_design_context` node metadata — not a flat
32px gap): the heading sits 32px above the content; within the content, the wallet button, the OR
divider, and the fields-block are each spaced 16px apart; **inside** the fields-block, the two
fields, the submit button, "Forgot password?", and "New here?" are each spaced 32px apart. The
error caption is absolutely positioned (`top-full`, right-aligned) below its field so it never
shifts the 32px field-to-field rhythm.

**Validation** (presentational only — no complexity rule, free-mail domains allowed):

- Email: format-checked against `local@domain.tld` on blur or on submit attempt. No error while
  the field is empty.
- Password: only checked for emptiness, and only after a submit attempt.
- Submit is disabled until the email is non-empty and well-formed **and** the password is
  non-empty — including while showing a validation error, matching the Figma error frame (its
  submit button is also rendered disabled).
- Error copy is verbatim from the Figma frame: "Enter the correct email address" /
  "Enter the correct password" — reused by #1254 for the server-rejection case.
- All local state resets when the modal reopens (`open` flips `false` → `true`).

**Icons.** The wallet glyph, the eye glyph, and the eye-slashed glyph are the exact Figma-exported
SVG paths (via `get_design_context`, which recovered on retry after initially hanging — see the
exec plan's Figma-access note) — no hand-authored vector paths.

**Accessibility:** first `<form>` element in the repo. `aria-invalid` on `TextField`'s `<input>`
(also a repo first — see `ui-components.md#textfield`). "Forgot password?"/"Create account" are
plain text, not focusable, since they are inert in this issue.

### CreateAccountModal

`packages/frontend/src/components/CreateAccountModal.tsx` + `useAuthCredentialsForm.ts`. The
email+password create-account screen — a presentational component with **no network call**;
`onSubmit` is a seam for #1254 (defaults to a no-op). This is a thin delta on `SignInModal`, not
a new screen family: the Figma frame is an instance of the same `Sign In` component with four
slot overrides, and every other element (`ContinueWithWalletButton`, `OrDivider`, both
`TextField`s, the disabled-submit treatment, the right-hand image pane) is reused verbatim via
`AuthModalShell` and `AuthModalParts`.

Visual specs (Figma):

- Default (empty fields, submit disabled): node `6486:81615`.
- Enabled (both fields filled, submit enabled): node `6486:81640`.

Composition inside `AuthModalShell` (heading "Create account", `headingId`
`create-account-modal-heading`, `testId` `create-account-modal`), top to bottom:

1. **"Continue with wallet"** — shared `ContinueWithWalletButton` (see "Shared form parts").
2. **"OR" divider** — shared `OrDivider`.
3. **Fields** — two `TextField`s: `type="email"` placeholder "Enter corporate email", then
   `type="password"` (`autoComplete="new-password"`, not `current-password`) placeholder
   "Password". Unlike `SignInModal`'s nested fields-group, the fields block here is **flat**
   (`gap-8` directly), matching the Figma frame's flat `6486:81626` node — both render
   identically since the nesting was cosmetic in #1248.
4. **Submit** — `Button variant="primary-blue" type="submit"`, label "Sign Up".
5. **"Already have an account? Log in"** — renders as inert text (no `<a>`, no `href`, no
   handler). The Figma-exported code emits `Log in` as `Inter:Regular` (an unstyled link run, not
   a real font switch) and carries a stray `href="https://rive.app/login/?redirect=…"` pointing
   at the design tool's own vendor — both are design-file artifacts, not rendered. `Log in`'s
   weight is shipped **regular** (token-exact to the codegen), even though the sibling "Create
   account" link in the sign-in frame is Body Emphasized — flagged here in case the designer
   intended emphasis and the QA Figma comparison should catch the divergence.

**Field set — exactly two inputs.** The Figma frame's `6486:81626` metadata lists a third
`hidden="true"` `input` layer sitting underneath the submit button; it renders in neither
screenshot and is intentionally **not** built. There is no confirm-password, company, or
checkbox field anywhere in the frame, and no validation-error frame was designed for this
screen (error styling is inherited from `TextField`/the shared hook, unverified against Figma).

**Delta against SignInModal** (the only four differences between the two frames):

| | SignInModal (#1248) | CreateAccountModal (#1249) |
| --- | --- | --- |
| Heading | `Sign in` | `Create account` |
| Submit label | `Sign In` | `Sign Up` |
| Footer line 1 | `Forgot password?` | absent |
| Footer line 2 | `New here? Create account` | `Already have an account? Log in` |

Token bindings, validation rules, and icon sourcing are identical to `SignInModal` (see above) —
no new tokens, no new glyphs.

**Accessibility:** same contract as `SignInModal` — `aria-invalid`/`aria-describedby` on
`TextField`, inert footer text (not focusable).

### OtpModal

`packages/frontend/src/components/OtpModal.tsx` + `useOtpModal.ts`. The OTP email-verification
screen — presentational only, **no network call**; `onSubmit` is a seam for #1254 (defaults to a
no-op).

Visual specs (Figma):

- Default (empty code, caret in box 1, countdown running): node `6486:81665`.
- Enabled (six digits entered, verifying): node `6486:81848`.
- Error (invalid code, countdown stopped): node `6486:81863`.
- Back arrow affordance: node `6486:81678`.

Composition inside `AuthModalShell` (heading "Check your inbox", description
`` `We’ve sent a passcode to ${email}` ``, `headingId` `otp-modal-heading`, `testId` `otp-modal`,
`showImagePanel={false}`, `showCloseButton={false}`, `align="center"`, `onBack` wired as **both**
`onBack` and `onDismiss` so Escape and the arrow are the same action):

1. **`OtpInput`** (`@pipeline/ui`, see `ui-components.md#otpinput`) — six digits, `invalid` while
   `status === "error"`.
2. **Resend line** — inert `<p>` (Caption 12/16, `--color-pipeline-ink-muted`), never a button
   (same treatment as "Forgot password?" in #1248 — no resend endpoint, no sub-issue owns the
   action; deferred to #1254). Renders `Resend in MM:SS` while counting down, `Resend` once
   elapsed or in the error state.
3. **State-specific tail** — nothing while `idle`; a `role="status"` spinner (24×24 loader icon,
   `animate-spin`) while `verifying`; a `role="alert"` caption ("Enter the correct code", new
   `--text-pipeline-body-s` token, `--color-pipeline-negative-strong`) while `error`.

**State machine** (`useOtpModal`, modelled on `useSignInModal`) — `idle` → `verifying` →
`error`:

- Typing/pasting into `OtpInput` sanitises to digits and caps at `OTP_LENGTH` (6).
- Any edit while `verifying` or `error` cancels the pending mock timer and returns to `idle`
  (the countdown does not restart).
- Reaching 6 digits sets `verifying`, fires `onSubmit?.(code)`, and after
  `MOCK_VERIFY_DELAY_MS` (800ms) resolves the mock: `MOCK_VALID_CODE` (`123456`) returns to
  `idle` and fires `onVerified?.(code)` — the seam the next step (#1251 destination, #1254
  orchestration) attaches to; any other code transitions to `error`. The mock verification
  itself is placeholder logic (TD-60); #1254 replaces it with the real call. There is no
  success frame in #1250's Figma — the `/test` preview renders a stand-in confirmation line.
- The 59-second resend countdown (`RESEND_COUNTDOWN_SECONDS`) starts on open, ticks once per
  second, and runs **independently of the error state** (change request 2026-09-18): the error
  frame's bare `Resend` label is the post-countdown moment, not an error side-effect.
- All state (code, status, countdown) resets whenever `open` flips `false → true`.

**Copy** (verbatim, do not paraphrase): title "Check your inbox"; description "We’ve sent a
passcode to user@email.io" (U+2019 apostrophe — not `'` or `&rsquo;`); countdown "Resend in
00:59"; elapsed/error "Resend"; error caption "Enter the correct code".

**Accessibility:** the back arrow is the only dismiss (Figma hides the Close Icon instance for
this frame — a non-interactive arrow would trap the preview); on open, focus lands on the OTP
input (rendered before the back button in DOM order), not the back button; the loader and error
caption use `role="status"`/`role="alert"` respectively.

### CompanyDocsModal

`packages/frontend/src/components/CompanyDocsModal.tsx` +
`packages/frontend/src/components/useCompanyDocsModal.ts` +
`packages/frontend/src/components/DocumentUploadRow.tsx`. The KYB Company Docs upload step —
presentational only, **no network call, no persistence**. Files live in React state as `File`
objects for the lifetime of the open modal; closing/reopening discards them. `onSubmit` is a seam
for #1254 (defaults to a no-op).

Visual specs (Figma, file `A43rjYYjSwdTmiwwf5cx5n`):

- Empty: node `6486-81679`.
- Uploaded: node `6486-81817`.
- Step-badge chrome: `6486:81697` (empty) / `6486:81835` (uploaded).

Both frames wrap the same `Sign In` component (`8550:10210` content pane / `8550:10546` image
pane) as `SignInModal`/`CreateAccountModal`, with the image pane hidden and the "header/
Navigation/Buttons" chrome reduced to just the `Step 1/2` label — the `Navigation` and `Buttons`
frames it contains are empty and its logo/button-icon instances are hidden.

Composition inside `AuthModalShell` (heading "Finish account setup", description "Upload your
company documents so we can verify your account.", `headingId` `company-docs-modal-heading`,
`testId` `company-docs-modal`, `showImagePanel={false}`, `align="center"`,
`stepLabel={{ current: 1, total: 2 }}`, default close button, no `onBack`):

1. **Five fixed upload rows** (`<ul role="list">`), verbatim labels and order:
   `Certificate of Incorporation`, `Registry of Legal Entities`, `Certificate of Good Standing`,
   `Legal Address`, `Shareholder Register`. Empty-row caption, identical on all five:
   `pdf, jpg, png files up to 10MB`. Uploaded-row caption: `Uploaded`.
2. **Continue** — `Button variant="primary-dark"` (fill `#262524`, **not** `primary-blue` — the
   sign-in submit is navy, this one is not), full width, disabled at `opacity-[0.32]` until all
   five slots hold a file. Removing any file re-disables it. `onClick` calls
   `onSubmit?.(documents)` where `documents` is `Record<CompanyDocumentSlotId, File>` — a no-op
   seam exactly like `SignInModal.onSubmit`/`OtpModal.onSubmit`.

**Upload affordance — per-row file picker, no drag-and-drop.** Neither Figma frame contains a
drop zone or "drag files here" copy. Each row carries its own visually hidden, single-file
`<input type="file" accept="application/pdf,image/jpeg,image/png">` triggered by a
`Button variant="secondary" size="compact"` labelled "Upload" (`border` override using
`--color-pipeline-line` — the shared `secondary`/`compact` combination already matches the
frame's 32px box and border token with no other overrides needed).

**Uploaded-row visual, per file type**, rendered via `UploadedFileRow` (see "Shared file
validation" below — extracted here, second consumer is `OwnersModal`):

- `image/jpeg` / `image/png`: a 40×40 `object-cover` `<img>` from `URL.createObjectURL(file)`,
  revoked on replace/remove/unmount (`useEffect` in `UploadedFileRow`, guarded on
  `typeof URL.createObjectURL === "function"` so SSR/jsdom never throws).
- `application/pdf` (and whenever `URL.createObjectURL` is unavailable): the same brand-tint
  glyph tile as the empty state. Figma's uploaded frame shows a rendered PDF-page thumbnail (a
  mock PNG asset) that this repo cannot reproduce without a PDF renderer — divergence tracked as
  **TD-63**.
- The empty-state glyph tile is `size-10 rounded-[var(--radius-pipeline-card)]`, filled with the
  new `--color-pipeline-brand-secondary` token and the 20px `file-upload` glyph in
  `--color-pipeline-brand`.
- The uploaded row's leading empty→filled transition also swaps the trailing `Upload` button for
  a 32×32 remove `<button>` carrying the 22px `cross-circle` glyph in `--color-pipeline-ink-muted`.

**Validation** (enforced, not decorative):

- Reject when the MIME type is outside `{application/pdf, image/jpeg, image/png}` (falling back
  to the filename extension when `file.type` is empty) or when `file.size` exceeds
  `MAX_FILE_BYTES` (10MB).
- On rejection the slot stays empty and its caption — the same string,
  `pdf, jpg, png files up to 10MB` — recolors to `--color-pipeline-negative-strong` with
  `role="alert"`. It reverts to `ink-muted` on the next accepted file for that slot, or when the
  modal reopens. Neither Figma frame designs a rejection state; this reuses the row's existing
  caption copy rather than inventing new copy or layout — tracked as **TD-62**.

**Figma → token mapping** (confirmed via `get_design_context` + node geometry, not estimated):

| Element | Figma | Repo token |
| --- | --- | --- |
| Row title | Body 16/22, `content-test/primary`, `truncate` | `--color-pipeline-ink` |
| Row caption | Caption 12/16, `content-test/secondary` | `--color-pipeline-ink-muted` |
| Leading tile fill | sampled `rgb(0 0 128 / 0.08)` (Figma codegen is stale here — it emits a `#262524` fill with an `#8FB3A4` glyph, but the rendered frame is navy-tinted; the sampled value matches the screenshot exactly composited over `--color-pipeline-paper`) | **new** `--color-pipeline-brand-secondary` |
| Leading glyph | `content-test/brand` `#000080` | `--color-pipeline-brand` |
| Leading tile radius | `radius/radius-s` 4px | `--radius-pipeline-card` |
| `Upload` button | 32px box, 1px `border-test/secondary` `rgba(56,55,53,0.18)`, radius 4, Body Emphasized ink | `Button variant="secondary" size="compact"` + `border border-[color:var(--color-pipeline-line)]` |
| Remove glyph | 22px `cross-circle`, `#323837` @ 0.6 | `--color-pipeline-ink-muted` (no new token — same one-channel-order artifact #1248 already resolved this way) |
| Continue fill | `fill-test/primary` `#262524` | `Button variant="primary-dark"` |
| Continue label | `content-test/primary-on-invert` | `--color-pipeline-on-dark` (variant default) |
| Continue disabled | `opacity-32` | `disabled:opacity-[0.32]`, same as `SignInModal`/`CreateAccountModal` |
| Step badge | Body Emphasized 16/22; `Step 1` `content-test/primary`, `/2` `rgba(56,55,53,0.6)` | `--color-pipeline-ink` / `--color-pipeline-ink-muted` |

The `--color-pipeline-brand-secondary` token has no Figma variable binding in the file's codegen
— it is sampled from the rendered screenshot, not name-bound. Risk noted here for the next QA
Figma comparison pass.

**Icons.** `file-upload` (20×20) and `cross-circle` (22×22, `fillRule="evenodd" clipRule="evenodd"`
— load-bearing, it knocks the × out of the filled disc) are the exact Figma-exported SVG paths, no
hand-authored vectors.

**Out of scope.** Any real upload, storage, progress, or retry; wiring OTP → Company Docs → Owners
as a sequence (that is #1254's flow orchestration — the `/test` seam deliberately keeps this and
the OTP trigger independent, since the shell's scroll-lock/Escape handling is not stack-safe); the
LP header entry point (a future Figma, per epic #1247 decision 2026-09-17); promoting
`DocumentUploadRow`/`UploadedFileRow` to `@pipeline/ui` (both are LP-only, following
`AuthModalShell`'s placement in `packages/frontend`).

**Accessibility:** `<ul role="list">` of five rows; hidden file inputs each paired with a labelled
`Upload {label}`/`Remove {file.name}` button so the picker and remove affordances stay operable
via the accessibility tree; rejection captions carry `role="alert"`.

### Shared file validation

`packages/frontend/src/components/kybFileValidation.ts` — `ACCEPTED_FILE_TYPES`
(`application/pdf`, `image/jpeg`, `image/png`), `MAX_FILE_BYTES` (10MB), `isAcceptedFile`, and
`inferTypeFromName` (MIME fallback from the filename extension when `file.type` is empty). Lifted
out of `useCompanyDocsModal.ts` (#1252) once `OwnersModal` needed the same rules;
`useCompanyDocsModal.ts` re-exports `ACCEPTED_FILE_TYPES`/`MAX_FILE_BYTES` so its documented
public surface is unchanged.

`packages/frontend/src/components/UploadedFileRow.tsx` — the uploaded-file row (40×40
preview-or-glyph-tile leading element, name/`Uploaded` caption text block, 32×32 remove button
with the 22px `cross-circle` glyph), extracted verbatim out of `DocumentUploadRow`'s
file-present branch (byte-identical rendered DOM — `CompanyDocsModal.test.tsx` is the regression
guard). Two consumers: `DocumentUploadRow` (`CompanyDocsModal`, #1251) and `OwnersModal` (#1252).

### OwnersModal

`packages/frontend/src/components/OwnersModal.tsx` +
`packages/frontend/src/components/useOwnersModal.ts` +
`packages/frontend/src/components/KybInfoBanner.tsx` +
`packages/frontend/src/components/FileDropZone.tsx`. The KYB Owners step — presentational only,
**no network call, no persistence**. Files live in React state as `File` objects for the lifetime
of the open modal; closing/reopening discards them. `onSubmit` is a seam for #1254 (defaults to a
no-op).

**This is a drag-and-drop file uploader, not an owner-details form.** Both Figma frames were read
node-by-node: there is no name field, no role field, no ownership-percentage input, no select, no
"add owner" button, and no per-owner grouping. The entire step is heading → info banner → one
dashed drop zone → a flat list of uploaded files → Submit → Back. The "owners" framing lives only
in the heading and the banner copy.

Visual specs (Figma, file `A43rjYYjSwdTmiwwf5cx5n`):

- Default (no files, Submit disabled): node `6486-81710`.
- Enabled (two files uploaded, Submit enabled): node `6486-81783`.
- Step-badge chrome: `6486:81731` (default) / `6486:81805` (enabled) — both render `Step 2/2`.
- Uploaded-file row (`list-item`): `6486:81799` / `6486:81800`.
- Banner hint tooltip: `6486:82392` — a loose canvas instance parked on the canvas, not a child
  of either frame (see below).

Composition inside `AuthModalShell` (heading "Add company owners", **no** `description`,
`headingId` `owners-modal-heading`, `testId` `owners-modal`, `showImagePanel={false}`,
`align="center"`, `stepLabel={{ current: 2, total: 2 }}`, default close button, no `onBack`).
Unlike `OtpModal`/`CompanyDocsModal`, this screen passes no `description` — the heading instance's
subtitle container is hidden on both frames, and the explanatory line lives in the banner instead.

1. **`KybInfoBanner`** — a white 400×76 card (`min-h-[56px]` plus the natural two-line wrap of its
   copy reproduces the 76px), containing the banner copy
   "Upload ID and proof of address documents for each owner" and a 20px hint glyph. The glyph is
   a `<button aria-label="More information" aria-describedby={tooltipId}>` that shows a
   `role="tooltip"` on `mouseenter` only (hidden on `mouseleave`; hover-only per the 2026-09-18
   user direction — focus deliberately does not trigger it, since the shell's open-time
   auto-focus lands on this button and showed the tooltip on open; keyboard access is part of
   the TD-65 design pass), positioned
   `absolute bottom-full` above the glyph, copy verbatim from node `6486:82392`:

   > You could upload a passport, ID card, or driver’s licence, plus a recent (no older than 90
   > days) utility bill or bank statement as proof of address.

   No arrow/caret (the node has none), and Escape is deliberately **not** wired to close the
   tooltip — the shell owns Escape in the capture phase and would close the modal instead. Node
   `6486:82392` sits loose on the canvas, horizontally centred on the banner's hint glyph but not
   parented to either Owners frame — trigger, offset, and the missing arrow are undesigned,
   tracked as **TD-65**. With no `tooltip` prop, `KybInfoBanner` renders the hint as an inert
   `aria-hidden` glyph (so a future consumer can reuse the banner without a tooltip).
2. **`FileDropZone`** — a dashed drop target: the 24px `file-upload` glyph (a different SVG export
   from the 20px glyph `DocumentUploadRow` ships — do not conflate the two), "Drag and drop your
   files" over "pdf, jpg, png files up to 10MB", and `Button variant="secondary" size="m"`
   labelled "Select files". Implements both drag-and-drop (`onDragEnter`/`onDragOver`/`onDrop`,
   each `preventDefault()`-ing) and a visually hidden
   `<input type="file" multiple accept="application/pdf,image/jpeg,image/png">` behind the
   button — `multiple` is required here, unlike `DocumentUploadRow`'s single-file inputs, since
   the enabled frame shows two files with no per-slot structure.
   - *Drag-over*: the dashed border recolors `--color-pipeline-ink-subtle` → `--color-pipeline-ink`
     while a drag is over the zone. Undesigned (no Figma treatment for this state) — **TD-67**.
   - *Rejection*: same rule as `CompanyDocsModal` — MIME type outside
     `{application/pdf, image/jpeg, image/png}` (falling back to the filename extension) or
     `file.size > MAX_FILE_BYTES`. The rejected file is not added; the subtitle — same string —
     recolors to `--color-pipeline-negative-strong` with `role="alert"`, reverting on the next
     accepted file or modal reopen. A mixed drop adds the accepted files **and** shows the alert.
     Also undesigned — **TD-67**.
3. **File list** — an ordered `{ id: number; file: File }[]` (not a keyed record, since the
   design has no slots and nothing prevents two files sharing a name), rendered as
   `UploadedFileRow` instances inside a conditional `<ul role="list">` (omitted entirely when
   empty, so it contributes no stray gap). Unbounded — no maximum file count.
4. **Submit** — `Button variant="primary-dark"` (not "Continue"), full width, enabled once **at
   least one file is present** (the default frame shows 0 files/disabled, the enabled frame shows
   2 files/solid — with no owner-count input anywhere in the design, this is the only
   non-arbitrary threshold). Removing the last file re-disables it. `onClick` calls
   `onSubmit?.(files)` where `files` is `File[]` — a no-op seam exactly like
   `CompanyDocsModal.onSubmit`. Threshold tracked as **TD-66** for a designer/PM to set a real
   requirement.
5. **`Back`** — plain centered Caption text (12/16, full ink, not muted), not a button. The frame
   already carries the shell's × close affordance top-right; `Back`'s destination (Company Docs,
   Step 1/2) is cross-screen sequencing assigned to #1254, so it ships inert with no handler and
   no unused `onBack` seam prop — the same treatment as "Forgot password?" (#1248) and "Resend"
   (#1250).

**Figma → token mapping** (confirmed via `get_design_context` + `get_variable_defs`, not
estimated):

| Element | Figma | Repo token |
| --- | --- | --- |
| Banner fill | `fill-test/on-primary` `#ffffff` | `--color-pipeline-surface` |
| Banner radius | `radius-16` = 4 (resolved; codegen's `4px`/`16px` fallbacks are unreliable) | `--radius-pipeline-card` |
| Banner text | Body 16/22, `content-test/primary` | `--color-pipeline-ink` |
| Hint glyph | 20px `info`, `#323837` @ 0.3 (one-channel-order artifact #1248/#1251 already resolved) | `--color-pipeline-ink-subtle` — no new token |
| Tooltip fill / text | `fill-test/primary` `#262524` / `content-test/primary-on-invert` | `--color-pipeline-cta` / `--color-pipeline-on-dark` |
| Tooltip radius / pad / width | `radius/radius-m` = 4 / `size-8` / 240 | `--radius-pipeline-card` / `p-2` / `w-60` |
| Drop-zone border | 1px dashed `border-test/primary` `#3835384d` | `--color-pipeline-ink-subtle` |
| Drop-zone radius | `radius/radius-xxs` = 2 | **new** `--radius-pipeline-card-xs` |
| Drop-zone glyph | 24px `file-upload`, `#323837` @ 0.6 | `--color-pipeline-ink-muted` |
| Drop-zone title | Body 16/22, `content-test/primary` | `--color-pipeline-ink` |
| Drop-zone subtitle | Body S 14/18, `text-tertairy` `#7d7d7d` — a misspelled, non-namespaced legacy Figma variable, unlike every other color on both frames | `--color-pipeline-ink-muted` (not a new token — **TD-64**) |
| `Select files` button | 40px box, 1px `border-test/secondary` `rgba(56,55,53,0.18)`, radius 4, Body Emphasized ink | `Button variant="secondary" size="m"` + `border border-[color:var(--color-pipeline-line)]` |
| File-row thumbnail / title / caption / remove glyph | same as `CompanyDocsModal`'s uploaded row | `UploadedFileRow` (shared) |
| Submit fill / label / disabled | `fill-test/primary` `#262524` / `content-test/primary-on-invert` / `opacity-32` | `Button variant="primary-dark"` + `disabled:opacity-[0.32]` |
| `Back` | Caption 12/16, `content-test/primary` (full ink, not muted) | `--color-pipeline-ink` |
| Step badge | Body Emphasized 16/22; `Step 2` ink, `/2` `rgba(56,55,53,0.6)` | shell `stepLabel` (unchanged) |

**Icons.** `info` (20×20) and `file-upload` (24×24 — a different export from the 20×20
`file-upload` glyph `DocumentUploadRow` ships, do not rescale one into the other) are the exact
Figma-exported SVG paths.

**Out of scope.** Any real upload, storage, progress, or retry; wiring Company Docs → Owners →
Account-in-review as a sequence (#1254's flow orchestration — the `/test` seam keeps this trigger
independent of Company Docs, same reasoning as the OTP/Company-Docs pair); the LP header entry
point (a future Figma); promoting any of `OwnersModal`/`KybInfoBanner`/`FileDropZone` to
`@pipeline/ui` (LP-only, following `AuthModalShell`'s placement); associating uploaded files with
individual owners (the design provides no affordance for this — see TD-66).

**Accessibility:** `<ul role="list">` (conditional on `entries.length > 0`); the hidden multi-file
input is unlabelled since its trigger button's visible text ("Select files") is its accessible
name; drop-zone and file-row rejection/remove states reuse `DocumentUploadRow`'s patterns
(`role="alert"`, `aria-label="Remove {file.name}"`); the tooltip uses `role="tooltip"` +
`aria-describedby` and is deliberately not wired to Escape (see above).

### AccountInReviewModal

`packages/frontend/src/components/AccountInReviewModal.tsx`. The KYB post-submission
Account-in-review screen — presentational only, **no network call, no persistence**. The
"notified" confirmation lives in React state for the lifetime of the open modal; closing/reopening
resets it (TD-70). `onNotifyMe`/`onGoToApp` are seams for #1254 (both default to a no-op).

**One screen, two states, not two screens.** The two Figma frames share an identical node tree —
circle → heading → two buttons, full stop — with the only delta being the first button's
treatment before/after being pressed. `AccountInReviewModal` models this as a single `notified`
boolean rather than two components.

Visual specs (Figma, file `A43rjYYjSwdTmiwwf5cx5n`):

- Default (`Notify me` / `Go to app`): node `6486-81745`.
- Notified (`We’ll notify you` / `Go to app`): node `6486-81764`.

Composition inside `AuthModalShell` (heading "Your account is under review", description
"It can take up to 2 weeks. We can notify you when it’s ready.", `headingId`
`account-in-review-modal-heading`, `testId` `account-in-review-modal`, `showImagePanel={false}`,
`align="center"`, `headingAlign="center"`, `icon` set to the 72px circle tile, default close
button, no `stepLabel`, no `onBack`):

1. **72px circle tile** — a fully round `--color-pipeline-fill-muted` badge containing a 36×36
   `ShieldCheckIcon`, `--color-pipeline-ink-subtle`. Passed via the shell's new `icon` prop.
2. **`Notify me` / `We’ll notify you`** — a single `<Button>` element whose `variant`, `className`,
   and children are computed from `notified`, so React reuses the same underlying DOM node and
   the user's focus survives the flip:
   - Default: `variant="primary-dark"`, label `Notify me`, `onClick` sets `notified` and fires
     `onNotifyMe?.()`.
   - Notified: `variant="secondary"` with a `!bg-[--color-pipeline-positive-secondary]` /
     `!text-[--color-pipeline-positive-strong]` override, `aria-disabled="true"` (**not**
     `disabled`, which would drop focus out of the trapped modal and pull in `secondary`'s
     `disabled:opacity-[0.32]`, absent from the frame), no `onClick`, and a
     `<span className="flex items-center gap-2"><CheckIcon />We’ll notify you</span>` child (24px
     check glyph left of the label).
   - The wrapping `<div aria-live="polite">` announces the label change to a screen reader after
     the flip, since the button element itself is reused rather than replaced.
3. **`Go to app`** — a real `<Button variant="secondary">` (unlike the inert *text* affordances
   "Forgot password?"/"Resend"/"Back" elsewhere in this epic — this one is a designed 48px button
   with its own fill), `!bg-[--color-pipeline-fill-muted]` override. `onClick` calls
   `onGoToApp?.()`, independent of `notified` — it renders and behaves identically in both states.

**Figma → token mapping** (confirmed via `get_variable_defs` + `get_design_context`, not
estimated):

| Element | Figma | Repo token |
| --- | --- | --- |
| Circle tile fill | `fill-test/primary` `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` |
| Circle tile radius | `radius/radius-full` on a 72px box | `--radius-pipeline-pill` |
| Shield-check glyph | `#323837` @ 0.3 (one-channel-order artifact, already resolved this way elsewhere in the epic) | `--color-pipeline-ink-subtle` — no new token |
| Title / description | Besley 48/56 / Graphik LC 16/22, both `content-test/primary`, both centered | shell defaults + `headingAlign="center"` |
| `Notify me` fill / label | `fill-test/primary` `#262524` / `content-test/primary-on-invert` | `Button variant="primary-dark"` (defaults) |
| `We’ll notify you` fill | `fill/positive-secondary` `#20800029` | `--color-pipeline-positive-secondary` |
| `We’ll notify you` label + check glyph | `content-test/positive` `#208000` | **new** `--color-pipeline-positive-strong` (TD-68) |
| `Go to app` fill / label | `fill-test/primary` `rgba(191,189,187,0.12)` / `content-test/primary` | `--color-pipeline-fill-muted` / `--color-pipeline-ink` (`Button variant="secondary"` + `!bg-…` override, the #1248 `ContinueWithWalletButton` technique) |

**Icon sourcing.** `ShieldCheckIcon` (36×36) and `CheckIcon` (24×24) are exact Figma-exported SVG
paths, both new glyphs in this repo — `fillRule`/`clipRule` are load-bearing on the shield (the
check is knocked out of the shield body). `get_design_context`'s export of the 24px check carries
a stale `fill="#34C759"` (iOS green) — the rendered instance is the same dark green as its label,
confirmed by sampling the `6486-81764` screenshot. Shipped on `currentColor` at
`--color-pipeline-positive-strong` rather than the exported hex — the same class of stale-export
artifact as #1251's leading-tile fill.

**The "review banner" named in the Issue does not exist here.** Node `6486:81744` (the Issue's
cited node) is a byte-identical loose duplicate of the Owners step's info banner (already shipped
as `KybInfoBanner` in #1252), parked on the canvas inside the Owners column — not a child of
either Account-in-review frame. Neither frame contains a banner node; their whole content column
is icon → heading → two buttons. `KybInfoBanner` is **not** used by this screen. See TD-69 for the
full evidence trail and the only other "under review" candidate found (a superseded draft
dashboard card, out of scope here).

**Out of scope.** Any real "notify me" subscription, polling, or review-status fetch (TD-70);
wiring Owners → Account-in-review as a sequence, and `Go to app`'s destination (both #1254's flow
orchestration — the `/test` seam keeps this trigger independent of Owners, same reasoning as the
other pairs in this epic); the LP header entry point (a future Figma); the review banner (TD-69);
`@pipeline/ui` promotion (LP-only, following `AuthModalShell`'s placement).

**Accessibility:** the icon is `aria-hidden`; the notify button carries `aria-disabled="true"`
(not `disabled`) once notified, keeping it focusable and in the tab order; its wrapper carries
`aria-live="polite"` so the label swap is announced; `Go to app` is a normal focusable button in
both states.

### Diagnostics preview seam

`packages/frontend/src/routes/test.tsx` — the `"auth"` tab (`/test?tab=auth`) renders six
trigger buttons opening `SignInModal` (#1248), `CreateAccountModal` (#1249), `OtpModal` (#1250),
`CompanyDocsModal` (#1251), `OwnersModal` (#1252), and `AccountInReviewModal` (#1253), each with
every seam left at its no-op default except `OtpModal.onVerified`, `CompanyDocsModal.onSubmit`,
`OwnersModal.onSubmit`, and `AccountInReviewModal.onGoToApp`, which show stand-in confirmation
lines. Every trigger is independent of the others — entering a valid OTP code shows "OTP verified
— open the Company Docs step from the button above." rather than auto-opening it, submitting
Company Docs shows "Company documents submitted — open the Owners step from the button above."
rather than auto-opening Owners, and submitting at least one Owners file shows "Owners submitted —
open the Account-in-review screen from the button above." rather than auto-opening it — since the
shell's body-scroll-lock and capture-phase Escape are not stack-safe (see the shell caveats above)
and stacking two of these modals is exactly the untested path a chained transition would exercise.
Clicking `Go to app` on the Account-in-review screen shows "Go to app — #1254 wires this to the LP
dashboard." This does not touch `TopBar`, `ConnectModalProvider`, or any of the six production
`openConnectModal` call sites.
