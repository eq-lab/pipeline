# KYB auth components

LP-facing email+password authentication modals for epic #1247 (KYB login flow). This is a new
area doc — `dashboard-components.md` is already 117 KB and epic #1247 adds four more screens
(#1251 Company Docs, #1253 Account-in-review) beyond #1249 (Create-account), #1250 (OTP), and
#1280 (Forgot Password), all documented below — same reasoning as `wallet-flows.md` /
`trustee-flows.md`. #1252 (Owners) shipped and was later retired — see `### OwnersModal` below.
#1265 wired `SignInModal`/`CreateAccountModal`/`OtpModal` to the real backend auth endpoints via
a new orchestrator, `EmailAuthFlow` — see `### EmailAuthFlow`, `### Turnstile`, and `### Session
module` below.

#1253's Issue body also named a "review banner" deliverable. It does not exist in the
source-of-truth Figma section — see `### AccountInReviewModal` below and TD-69
(`docs/exec-plans/tech-debt-tracker.md`). Nothing is built for it here.

**Production entry point shipped by #1362.** `TopBar`'s right slot now opens these modals
directly — "Sign In" / "Sign Up" (signed out) via the app-wide `AuthFlowProvider`, see
`### AuthFlowProvider` below and `dashboard-components.md#topbar`. The modals are also still
reachable from the `/test?tab=auth` diagnostics route (see
`dashboard-components.md#diagnostics-route`), which keeps its own independent `EmailAuthFlow`
instance (decision recorded in `### Diagnostics preview seam` below) — the two never share state.
`ConnectWalletModal`'s own entry point is unchanged: wallet connection is not in the header at
all as of #1362 — see `dashboard-components.md#topbar` ("Where wallet-connect entry points still
live").

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

**Close-icon color (#1315).** The × renders `--color-pipeline-on-dark` (white) whenever
`showImagePanel` is not explicitly `false` — it otherwise sat over `RightImagePanel`'s dark hero
photo as `--color-pipeline-ink` (dark), nearly invisible on the two-pane modals (`SignInModal`,
`CreateAccountModal`, `ForgotPasswordModal`). The hover background swaps to a white-alpha
`rgba(255,255,255,0.16)` to suit the dark ground. When `showImagePanel={false}` (`OtpModal`,
`CompanyDocsModal`, `AccountInReviewModal` — the close button renders over the light content pane
in all three), the × keeps the original ink color and `rgba(56,55,53,0.08)` hover unchanged.

**Optional props (added by #1250, backward-compatible)** — all five default to today's behaviour,
so `SignInModal` renders byte-identical without passing any of them:

| Prop | Default | Effect |
| --- | --- | --- |
| `description?: string` | `undefined` | Renders a `<p>` (`--text-pipeline-body` / full ink) below the `<h2>`, in a `flex flex-col gap-2` wrapper so the two sit 8px apart while the heading block keeps the column's 24px gap above `children`. |
| `showImagePanel?: boolean` | `true` | `false` omits `<RightImagePanel />` entirely (no hero photo/logo/headline). |
| `showCloseButton?: boolean` | `true` | `false` omits the `×` close button. |
| `onBack?: () => void` | `undefined` | When set, renders a back `<button aria-label="Back">` (24×24 arrow-left icon, Figma node `6486:81678`) at `top-4 left-4` (glyph lands at (20, 20)) — the mirror of the close button. Rendered **after** `{children}` and `<RightImagePanel />` in DOM order, so the shell's auto-focus-first-descendant effect still lands on content, not the back button. |
| `align?: "start" \| "center"` | `"start"` | `"center"` appends `my-auto` to the content column (vertical centering via margin, not `justify-center` on the parent, so `overflow-y-auto` stays scroll-safe on short viewports). |
| `stepLabel?: { current: number; total: number }` | `undefined` | Added by #1251. Renders a non-focusable `Step {current}` (ink) + `/{total}` (ink-muted) badge at `top-4 left-4` — a step indicator, not navigation (no progress bar, no logo, no back arrow). **Currently unused** — `CompanyDocsModal` was its only consumer, at `{ current: 1, total: 2 }`, alongside #1252's retired Owners screen at `{ current: 2, total: 2 }`; the V1.0 redesign (#1278) found the `Step` group `hidden="true"` in both of `CompanyDocsModal`'s frames (a leftover from the retired two-step Company Docs + Owners flow) and dropped the prop rather than render a stale badge. The prop itself stays on the shell for a future step-based flow. **Mutually exclusive with `onBack`** — both occupy `top-4 left-4` and no Figma frame in this epic shows both together; passing both is undefined layout, not validated at runtime. |
| `icon?: React.ReactNode` | `undefined` | Added by #1253. Renders as the **first** child of the content column, above the heading block, wrapped in `<div className="mb-2 flex w-full justify-center">`. The `mb-2` turns the column's 24px `gap-6` into the frame's 32px icon-to-heading gap — the same technique `CompanyDocsModal`/`OwnersModal` use with `mt-2` on their children wrapper. `AccountInReviewModal` is the only consumer so far. |
| `headingAlign?: "start" \| "center"` | `"start"` | Added by #1253. `"center"` appends `text-center` to the heading wrapper (both the `<h2>` and the description `<p>`) — **horizontal** text alignment, orthogonal to `align`'s *vertical* `my-auto` centering of the whole column. Named `headingAlign` rather than `align` because that name is already taken. |

The OTP screen (`OtpModal`, below) hides both the image pane and the close button and uses the
back arrow as its only dismiss affordance, since Figma hides the shell's Close Icon instance for
that frame. See tech debt **TD-61** for the vertical-centering divergence: every KYB Figma frame
centres its content column, but `SignInModal`/`CreateAccountModal` still top-align pending a
design decision — `OtpModal`, `AccountInReviewModal`, and `ForgotPasswordModal` all opt into
`align="center"`.

### Shared form parts

`packages/frontend/src/components/AuthModalParts.tsx`. `ContinueWithWalletButton` (Figma node
`6486:81624`, the 24×24 wallet glyph + `Button variant="secondary"` white-fill override) and
`OrDivider` (Figma node `6486:81625`) are shared verbatim between `SignInModal` and
`CreateAccountModal` — confirmed byte-identical instances across both frames during #1249
planning. `packages/frontend/src/components/useAuthCredentialsForm.ts` (renamed from
`useSignInModal.ts` in #1249) is the shared credential-form state/validation hook consumed by
both modals. Email validation and the field-reveal timing are shared unchanged; the **password
rule now diverges** via an opt-in `passwordRule?: "non-empty" | "policy"` option (added by
#1281), defaulting to `"non-empty"` so `SignInModal` renders byte-identical without passing it.
See "SignInModal" → **Validation** and "CreateAccountModal" → **Validation error** below for the
two rules.

### SignInModal

`packages/frontend/src/components/SignInModal.tsx` + `useAuthCredentialsForm.ts`. The
email+password sign-in screen. **Wired to `POST /v1/auth/login` by #1265** via `EmailAuthFlow`
(below) — `SignInModal` itself stays presentational: `onSubmit` may return `void | Promise<void>`
and, while that promise is pending, `useAuthCredentialsForm` reports `isSubmitting` and the
submit button is disabled (in addition to the existing validity gate). Two additional optional
props surface server-side rejection without any new markup: `passwordServerError?: string`
(rendered in the password field's existing error slot — used for login `401`) and `formError?:
string` (a `role="alert"` caption above the submit button — used for `429` lockout and any other
non-field-specific failure). No captcha — `login` carries none server-side. Both errors are owned
by `EmailAuthFlow`, which clears them whenever the fields are edited (an `onCredentialsEdit?: () =>
void` prop that `SignInModal` fires on every email/password keystroke) or the screen navigates away
from and back to sign-in, so a stale rejection from a previous attempt never lingers.

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
5. **"Forgot password?"** — a real `<button type="button" onClick={onForgotPassword}>` since
   #1280: that screen now exists and is the button's destination. #1248 shipped this as inert
   text specifically because "it has no destination frame … and no sub-issue" — both conditions
   are now false. `onForgotPassword` defaults to a no-op (undefined ⇒ harmless click); the
   `/test` preview wires it to open `ForgotPasswordModal` (see "ForgotPasswordModal" below).
6. **"New here? Create account"** — inert text in #1248; since #1315, "Create account" is a real
   `<button type="button" onClick={onCreateAccount}>` mirroring the `onForgotPassword` pattern
   (same inline-text-button styling, `onCreateAccount` defaults to a no-op). `CreateAccountModal`'s
   "Already have an account? Log in" got the mirror-image `onSignIn` seam in the same issue. Both
   seams are diagnostics-only — the `/test?tab=auth` preview swaps `SignInModal` for
   `CreateAccountModal` (and back) the same way it already swapped Sign In for Forgot Password
   (#1280); wiring a production entry point remains #1265's job.

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

**Validation** (presentational only — **sign-in specifically** has no password-complexity rule,
free-mail domains allowed; `CreateAccountModal` diverges — see its own **Validation error**
section below):

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
(also a repo first — see `ui-components.md#textfield`). Since #1280, "Forgot password?" is a
focusable `<button>`; since #1315, "Create account" is a focusable `<button>` too.

### CreateAccountModal

`packages/frontend/src/components/CreateAccountModal.tsx` + `useAuthCredentialsForm.ts`. The
email+password create-account screen. **Wired to `POST /v1/auth/signup` by #1265** via
`EmailAuthFlow` (below) — `CreateAccountModal` stays presentational, gaining the same
`isSubmitting`/`formError` seams as `SignInModal` (no password-field server error here — signup
never returns a credential-specific rejection) plus two captcha-related props: `turnstileSlot?:
ReactNode` (rendered below the password field) and `captchaReady?: boolean` (default `true`;
`false` keeps Sign Up disabled even once the fields validate, matching the fact that `signup`
requires a `captcha_token`). This is a thin delta on `SignInModal`, not
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
5. **"Already have an account? Log in"** — inert text through #1249; since #1315, "Log in" is a
   real `<button type="button" onClick={onSignIn}>` (`onSignIn` defaults to a no-op), mirroring
   `SignInModal`'s "Create account" seam. The Figma-exported code emitted `Log in` as
   `Inter:Regular` (an unstyled link run, not a real font switch) and carried a stray
   `href="https://rive.app/login/?redirect=…"` pointing at the design tool's own vendor — both
   were design-file artifacts, never rendered. `Log in`'s weight ships **regular** (token-exact to
   the codegen), even though the sibling "Create account" button in the sign-in frame is Body
   Emphasized — #1315 kept this divergence (not asked to change styling, only to wire the seam);
   flagged here in case the designer intended emphasis and the QA Figma comparison should catch
   it.

**Field set — exactly two inputs.** The Figma frame's `6486:81626` metadata lists a third
`hidden="true"` `input` layer sitting underneath the submit button; it renders in neither
screenshot and is intentionally **not** built. There is no confirm-password, company, or
checkbox field anywhere in the frame. A validation-error frame **was** designed for this screen —
node `6585:75897` (#1281) — see **Validation error** below; it carries the same hidden third
`input` artifact (node `6585:75919`).

**Delta against SignInModal** (five differences between the two frames):

| | SignInModal (#1248) | CreateAccountModal (#1249) |
| --- | --- | --- |
| Heading | `Sign in` | `Create account` |
| Submit label | `Sign In` | `Sign Up` |
| Footer line 1 | `Forgot password?` | absent |
| Footer line 2 | `New here? Create account` | `Already have an account? Log in` |
| Password rule | `non-empty` | `≥8 chars + digit + special` (#1281) |

Token bindings and icon sourcing are identical to `SignInModal` (see above) — no new tokens, no
new glyphs. **Validation rules are no longer identical** — see **Validation error** below.

**Validation error** (#1281). Visual spec (Figma): node
[`6585:75897`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6585-75897&m=dev).
Every pixel of this state is the existing `TextField` invalid rendering (invalid fill
`--color-pipeline-negative-secondary`, invalid value text `--color-pipeline-negative-strong`, the
eye toggle, the absolutely-positioned right-aligned caption) — no new token, no new glyph, no
markup change beyond wiring `onBlur`.

`CreateAccountModal` passes `passwordRule: "policy"` to `useAuthCredentialsForm`. The policy:

```
meetsPasswordPolicy(p) = p.length >= 8 && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)
```

"Special character" is read as "not `[A-Za-z0-9]`" — punctuation, symbols, whitespace, and
non-ASCII all count. There is **deliberately no letter requirement** — the verbatim Figma copy
does not mention one (see TD-73 for the backend-reconciliation risk this creates once real auth
endpoints land). Error copy (verbatim, replaces `SignInModal`'s "Enter the correct password" in
this modal — a signup form has no "correct" password yet):

> At least 8 characters, including a number and a special character

**Reveal timing** mirrors the email field for repo consistency (not specified by the frame):
no error while the password field is empty and untouched; the error appears on blur and then
updates live as the user keeps typing; a submit attempt also reveals it (including for an empty
password). `isValid` (and therefore the disabled `Sign Up` submit) requires the policy to pass,
matching both the error frame (weak password → disabled) and the enabled frame `6486:81640`
(10-char password → enabled).

**Accessibility:** same contract as `SignInModal` — `aria-invalid`/`aria-describedby` on
`TextField`; since #1315, "Log in" is a focusable `<button>` (see composition step 5 above).

### ForgotPasswordModal

`packages/frontend/src/components/ForgotPasswordModal.tsx` + `useForgotPasswordForm.ts`. The
email-only password-reset request screen — presentational only, **no network call**; `onSubmit`
is a no-op seam for #1265, matching the pattern every other screen in this epic uses.

**One frame, one state.** Figma (`6704-107100`, section `6486:81556` "V1.0 — KYB & Wire
transfers") has no `— Enable` and no `— Validation error` companion for this screen, and no
confirmation / "check your email" / "set a new password" frame exists anywhere in the section (a
full child enumeration was done during planning). A flow connector (`6704:107291`) runs
Sign in → Forgot Password; nothing leaves Forgot Password in the design.

Composition inside `AuthModalShell` (heading "Reset your password", `headingId`
`forgot-password-modal-heading`, `testId` `forgot-password-modal`, `align="center"` — the only
non-default shell prop), top to bottom:

1. **Email field** — one `TextField` (`type="email"`, placeholder "Enter corporate email"), no
   label, no helper text, no password field.
2. **Submit** — `Button variant="primary-blue" type="submit"`, full width, label "Send Reset
   Link", disabled at `opacity-[0.32]` until the email is well-formed — same treatment as
   `SignInModal`'s submit.
3. **Footer** — one caption line, centered: `"Remembered it? "` (`--color-pipeline-ink-muted`,
   trailing space is part of the string) + an inline `<button type="button"
   onClick={onBackToSignIn}>Back to sign in</button>` (`--color-pipeline-ink`, **regular**
   weight — Figma renders it without `--font-weight-emphasized`, unlike `SignInModal`'s "Create
   account" span).

**No wallet button and no OR divider.** `AuthModalParts` is not imported — both parts
`SignInModal`/`CreateAccountModal` share are absent from this frame.

**Figma → token mapping.** Every value on the frame maps onto tokens already in
`packages/ui/src/styles/theme.css` (`--color-pipeline-paper`, `--color-pipeline-surface`,
`--color-pipeline-brand`, `--color-pipeline-ink`, `--color-pipeline-ink-muted`,
`--color-pipeline-on-dark`, `--text-pipeline-heading-l`, `--text-pipeline-body`,
`--text-pipeline-caption`, `--radius-pipeline-card`, `--radius-pipeline-button`) — the first
screen in the epic that adds neither a new token nor a new `AuthModalShell` prop.

**Vertical rhythm.** 400px column, centered on both axes in the shell's left half; 32px
heading → field, 32px field → button, 32px button → footer link, 64px below the link (the
column's `padding-bottom`).

**Validation** — identical rule to `useAuthCredentialsForm`'s email check, reused via the shared
`EMAIL_PATTERN`/`EMAIL_ERROR_MESSAGE` exports: format-checked on blur or on submit attempt, no
error while the field is empty, error copy verbatim "Enter the correct email address". All local
state resets when the modal reopens.

**Undesigned states are derived, not invented (TD-72).** The enabled submit is the same button
at full opacity (from Sign in's `— Enable` frame `6486:81576`); the validation-error treatment is
`TextField`'s shipped `invalid`/`error` styling (from Sign in's `— Validation error` frame
`6486:81595`); hover/focus on the two un-inerted links (`SignInModal`'s "Forgot password?" and
this screen's "Back to sign in") have no Figma state and use `hover:underline` plus the shell's
existing focus-visible outline token.

**Out of scope — no designed post-submit state (TD-71).** No confirmation, no reset-link landing
screen, and no "set a new password" screen exist anywhere in the V1.0 Figma section, and no
connector leaves `6704:107100`. The `/test` preview shows a stand-in line and closes the modal —
the same treatment #1250 used for the missing OTP success frame. #1265 cannot wire a real reset
flow until a designer supplies those screens.

**Copy is verbatim** — heading "Reset your password" (note: the component/file name and the
Issue are "Forgot Password"; the rendered heading differs — this is intentional, not a copy
defect), placeholder "Enter corporate email", submit "Send Reset Link", footer "Remembered it? "
+ "Back to sign in".

**Accessibility:** same contract as `SignInModal` — `aria-invalid` on `TextField`'s `<input>`;
both "Back to sign in" and (since #1280) `SignInModal`'s "Forgot password?" are focusable
buttons with the shell's `focus-visible` outline treatment.

### OtpModal

`packages/frontend/src/components/OtpModal.tsx` + `useOtpModal.ts`. The OTP email-verification
screen. **Wired to the real `verify-otp`/`resend-otp` endpoints by #1265** — see "EmailAuthFlow"
below for the orchestration; `OtpModal` itself stays presentational, taking `verify?: (code) =>
Promise<void>` and `resend?: () => Promise<void>` seams (no default mock — an unwired `verify`
rejects immediately, landing in the error state) plus an optional `turnstileSlot` node for the
resend captcha widget.

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
2. **Resend line** — `<p>` (Caption 12/16, `--color-pipeline-ink-muted`) while counting down
   (`Resend in MM:SS`); becomes a real `<button type="button" onClick={onResend}>` (ink color,
   underline on hover) once the countdown reaches zero and no resend is in flight.
3. **`turnstileSlot`** — rendered after the resend line; `EmailAuthFlow` supplies a
   `Turnstile` widget here (see "Turnstile" below) so a resend click always has a fresh captcha
   token.
4. **State-specific tail** — nothing while `idle`; a `role="status"` spinner (24×24 loader icon,
   `animate-spin`) while `verifying`; a `role="alert"` caption ("Code is incorrect or expired.
   Request a new one.", new `--text-pipeline-body-s` token, `--color-pipeline-negative-strong`)
   while `error`; the same slot instead shows "Couldn't resend the code. Try again." when a resend
   attempt rejects and no verify error is active (verify errors take priority over a resend error).

**State machine** (`useOtpModal`) — `idle` → `verifying` → `error`:

- Typing/pasting into `OtpInput` sanitises to digits and caps at `OTP_LENGTH` (6).
- Any edit clears an `error` back to `idle`. A duplicate resubmission of the exact code already
  being verified (`OtpInput` can re-fire `onChange` with the same value on paste) is ignored —
  it does not call `verify` a second time.
- Reaching 6 digits sets `verifying` and awaits `verify(code)`: resolve → `idle` +
  `onVerified?.(code)`; reject → `error`. Editing the code at all while a verify is in flight —
  even without reaching 6 digits again — bumps the internal request id, so the outstanding
  response is dropped via that guard when it eventually settles: no error, no `onVerified`, never
  overwriting the current (edited) state.
- The 59-second resend countdown (`RESEND_COUNTDOWN_SECONDS`) starts on open and ticks once per
  second, independently of the verify/error state. Clicking `Resend` once enabled awaits
  `resend()`: success restarts the countdown to 59s; failure surfaces the resend-error caption and
  leaves the countdown at zero, so `Resend` stays clickable for an immediate retry.
- All state (code, status, countdown, resend-in-flight, resend error) resets whenever `open` flips
  `false → true`.

**Copy** (verbatim, do not paraphrase): title "Check your inbox"; description "We’ve sent a
passcode to user@email.io" (U+2019 apostrophe — not `'` or `&rsquo;`); countdown "Resend in
00:59"; elapsed "Resend"; error caption "Code is incorrect or expired. Request a new one."; resend
error caption "Couldn't resend the code. Try again."

**Accessibility:** the back arrow is the only dismiss (Figma hides the Close Icon instance for
this frame — a non-interactive arrow would trap the preview); on open, focus lands on the OTP
input (rendered before the back button in DOM order), not the back button; the loader and error
caption use `role="status"`/`role="alert"` respectively.

### CompanyDocsModal

**Redesigned 2026-09-22 (#1278) — V1.0 flat upload.** `packages/frontend/src/components/CompanyDocsModal.tsx`
now composes three pieces promoted for #1284's Account-page documents hub rather than owning any
upload machinery itself: `AccountUploadRow`, `AccountRequirementsList`, and `useAccountDocuments`
(all under `@/components/account/`), plus the already-shared `UploadedFileRow` and
`kybFileValidation`. The KYB Company Docs upload step — presentational only, **no network call, no
persistence**. Files live in React state as `File` objects for the lifetime of the mounted
component; `onSubmit` is a seam for #1254 (defaults to a no-op).

Visual specs (Figma, file `A43rjYYjSwdTmiwwf5cx5n`):

- Empty: node `6701-96852`.
- Uploaded: node `6701-96881`.
- Content instance inside the empty frame: `6701:96867`.

Both frames wrap the same `Sign In` component (`8550:10210` content pane / `8550:10546` image
pane) as `SignInModal`/`CreateAccountModal`, with the image pane hidden and the header chrome
empty.

**Designer note — stale `Step 1/2` badge.** The `Step` group (`6701:96870` empty / `6701:96906`
uploaded) is `hidden="true"` in **both** frames — a leftover from the retired two-step Company
Docs + Owners flow (Owners was removed, #1279). A hidden node does not render, so this modal ships
**without** `stepLabel` (see the `AuthModalShell` props table above — the prop is now unused).
Flagged for a designer pass, not treated as a code decision.

**Flat upload, no slots, no typing UI.** Per the epic's 2026-09-21 decision (raw upload,
classify-at-review), the LP picks untyped files; the five company documents and the per-UBO
personal KYC appear only as the bullet requirements list. There is no per-slot structure and no
doc-type or UBO selector anywhere in either frame — this is the same flat-upload pattern #1284's
Account page ships, which is why the two screens now share components.

Composition inside `AuthModalShell` (heading "Finish account setup", description "Upload your
company documents and personal KYC for each shareholder so we can verify your account." —
**changed** from the five-slot modal's "Upload your company documents so we can verify your
account.", `headingId` `company-docs-modal-heading`, `testId` `company-docs-modal`,
`showImagePanel={false}`, `align="center"`, no `stepLabel`, default close button, no `onBack`):

1. A single surface card (`data-node-id="6701:96889"`, `flex flex-col gap-4`,
   `rounded-[var(--radius-pipeline-card)]`, `bg-[color:var(--color-pipeline-surface)]`,
   `px-2 pt-2 pb-4` — confirmed via `get_design_context`, the same fill/radius pair as the
   Account-page card), containing:
   - `<AccountUploadRow>` (`dataNodeId="6701:96891"`) — "Upload documents" /
     "pdf, jpg, png files up to 10MB" / `Upload` button, identical to the Account page's row.
   - `<AccountRequirementsList>` (`dataNodeId="6701:96892"`, `className="px-2"`) — the
     `AccountRequirementsList`'s bottom padding (`pb-6`) is dropped here: `get_design_context` on
     `6701:96892` shows the requirements node itself carries only horizontal `px-2` inset, with the
     card's own `gap-4` supplying the vertical space to the next row, unlike the Account page's
     `AccountDocumentsCard` where the extra `pb-6` is load-bearing (see
     [`account-page.md`](./account-page.md#reuse-verdicts)).
   - When `files.length > 0`, a staged-file `<ul role="list" data-node-id="6701:96893">` of
     `UploadedFileRow`s with **no** `className` override (plain 40px rows, `gap-3` list) — the
     Account page's staged rows pass `p-2` (56px rows, `gap-1` list) instead; `UploadedFileRow`'s
     existing `className` prop already covers this delta with no new prop needed.
2. **Submit** — `Button variant="primary-dark"`, full width, disabled at `opacity-[0.32]` until at
   least one file is staged (**changed** from the five-slot modal's "Continue" label and
   all-five-required rule). `onClick` calls `useAccountDocuments`'s `handleSave`, which invokes
   `onSubmit?.(files)` where `files` is `File[]` — a **breaking prop change** from the retired
   `Record<CompanyDocumentSlotId, File>` shape; the only consumer was `/test?tab=auth`.

**Dismissal keeps staged files.** The × is present and not hidden. Per the epic's 2026-09-21
flow-semantics decision ("closing the docs step means *exit onboarding, keep progress*"), this is
a deliberate reversal of the retired five-slot modal's reset-on-open behaviour: there is no
reset-on-open effect, so `useAccountDocuments` holds the files for the lifetime of the mounted
component — closing and reopening the preview shows them still staged. This is presentational
only (TD-85); real server-side progress needs #1267 + #1273, wired by #1254.

**Submit enables at ≥ 1 file (TD-83).** `useAccountDocuments.canSave` encodes this — the only
non-arbitrary rule the raw-upload model permits, same gap the retired TD-66 described for the
Owners step.

**Upload affordance — per-row file picker, no drag-and-drop.** Neither Figma frame contains a
drop zone or "drag files here" copy; `AccountUploadRow`'s single hidden multi-file
`<input type="file" accept="application/pdf,image/jpeg,image/png" multiple>` triggered by a
`Button variant="secondary" size="compact"` labelled "Upload" is exactly this frame's affordance.

**Validation** (enforced, not decorative, via `kybFileValidation`): reject when the MIME type is
outside `{application/pdf, image/jpeg, image/png}` (falling back to the filename extension when
`file.type` is empty) or when `file.size` exceeds `MAX_FILE_BYTES` (10MB). On rejection the row's
caption recolors to `--color-pipeline-negative-strong` with `role="alert"`, reverting on the next
accepted pick. Neither Figma frame designs a rejection state — tracked as **TD-62**.

**Out of scope.** Any real upload, storage, progress, or retry; the Verified/Invalid/under-review
document states (the Account page owns those); wiring OTP → Company Docs → Account-in-review as a
sequence (#1254's flow orchestration); the LP header entry point (a future Figma); promoting the
shared upload primitives to `@pipeline/ui` (LP-only, following `AuthModalShell`'s placement) or out
of `components/account/` (naming-only cleanup, filed as **TD-84**).

**Accessibility:** `<ul role="list">` for the staged files; the hidden file input is paired with a
labelled `Upload`/`Remove {file.name}` button so the picker and remove affordances stay operable
via the accessibility tree; the rejection caption carries `role="alert"`.

See [`account-page.md`](./account-page.md#reuse-verdicts) for the full Figma → token mapping
(shared with this modal) and the icon sourcing notes.

### Shared file validation

`packages/frontend/src/components/kybFileValidation.ts` — `ACCEPTED_FILE_TYPES`
(`application/pdf`, `image/jpeg`, `image/png`), `MAX_FILE_BYTES` (10MB), `isAcceptedFile`, and
`inferTypeFromName` (MIME fallback from the filename extension when `file.type` is empty). Lifted
out of `useCompanyDocsModal.ts` (#1252) once `OwnersModal` needed the same rules;
`useCompanyDocsModal.ts` re-exports `ACCEPTED_FILE_TYPES`/`MAX_FILE_BYTES` so its documented
public surface is unchanged.

`packages/frontend/src/components/UploadedFileRow.tsx` — the uploaded-file row (40×40
preview-or-glyph-tile leading element, name/`Uploaded` caption text block, 32×32 remove button
in a 40×40 touch-target wrapper with the 22px `cross-circle` glyph), extracted verbatim out of
`DocumentUploadRow`'s file-present branch (its 2026-09-18 origin; `DocumentUploadRow` itself was
deleted by #1278). Takes an optional `className` appended to its root `<li>`. Two current
consumers: `AccountDocumentsCard`'s staged rows (`p-2`, #1293) and `CompanyDocsModal`'s staged rows
(no `className`, plain 40px rows in a `gap-3` list) — `CompanyDocsModal.test.tsx` is the regression
guard for the latter's byte-identical rendered DOM.

### OwnersModal

**Retired 2026-09-21.** The Owners step (#1252) had no counterpart in the V1.0 Figma design
update (epic #1247) — see the 2026-09-21 resolution comment on issue #1279: the design settled on
raw upload / classify-at-review with no owner-document-typing UI on the LP side, so the standalone
Owners screen is gone rather than merged into the Company Docs step. `OwnersModal.tsx`,
`useOwnersModal.ts`, and `OwnersModal.test.tsx` are deleted; the `/test?tab=auth` trigger, its
stand-in confirmation line, and the corresponding user-stories doc
(`docs/user-stories/epic-1247/1252-kyb-owners.md`, now marked superseded) are removed/updated to
match.

`KybInfoBanner.tsx` and `FileDropZone.tsx` — the two presentational pieces this screen introduced
— were retained past #1279's retirement on the expectation that #1284's Account-page documents hub
would consume them. **It did not**: the V1.0 Account frames need a tinted, bordered, 72px two-line
banner with a 32px status icon and an optional trailing button (`AccountStatusBanner.tsx`,
[`account-page.md`](./account-page.md#reuse-verdicts)), and a plain list-item upload row
(`AccountUploadRow.tsx`) rather than a dashed drop zone. **Deleted 2026-09-22 (#1278)** — neither
component gained a consumer across epic #1247's V1.0 slice; #1278 verified no open sub-issue needs
a dashed drop zone or a tooltip info banner and removed both files. `UploadedFileRow.tsx` and
`kybFileValidation.ts`, the other two shared parts this screen used, kept their existing consumer
(`DocumentUploadRow`, later `CompanyDocsModal`) and gained a second one (`AccountDocumentsCard`'s
staged rows, `useAccountDocuments`). See TD-64 through TD-67 in
`docs/exec-plans/tech-debt-tracker.md` for what happened to the Owners-specific tech debt this
screen carried — TD-64/65/67 are resolved by deletion, TD-66 was already resolved by retirement.

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
wiring Company Docs → Account-in-review as a sequence (Owners, the step that used to sit between
them, was retired 2026-09-21), and `Go to app`'s destination (both #1254's flow orchestration —
the `/test` seam keeps this trigger independent, same reasoning as the other pairs in this epic);
the LP header entry point (a future Figma); the review banner (TD-69); `@pipeline/ui` promotion
(LP-only, following `AuthModalShell`'s placement).

**Accessibility:** the icon is `aria-hidden`; the notify button carries `aria-disabled="true"`
(not `disabled`) once notified, keeping it focusable and in the tab order; its wrapper carries
`aria-live="polite"` so the label swap is announced; `Go to app` is a normal focusable button in
both states.

### EmailAuthFlow

`packages/frontend/src/components/EmailAuthFlow.tsx` + `useEmailAuthFlow.ts` (#1265). The
orchestrator that turns `SignInModal`, `CreateAccountModal`, `OtpModal`, and `ForgotPasswordModal`
into one wired flow against `packages/api/src/routes/auth/password.rs`. It is the only consumer
of the four modals' `onSubmit`/`verify`/`resend` network seams; the modals themselves stay
presentational (see their individual sections above).

Props: `open`, `initialScreen?: EmailAuthScreen` (`"sign-in" | "create-account" |
"forgot-password" | "otp"`, default `"sign-in"`), `onClose`, `onAuthenticated?`,
`onConnectWallet?`, `onForgotPasswordSubmit?: (payload: { email: string }) => void`. Internal
`screen` state resets to `initialScreen` whenever `open` transitions `false → true` **or**
`initialScreen` itself changes while already open (a caller re-pointing an already-open flow at a
different screen) — never on the modals' own internal cross-link navigation, which only updates
`screen`, not the `initialScreen` prop. Whenever the flow closes (`open` transitions `true →
false`), `signupCaptchaToken`/`otpCaptchaToken` are cleared and both Turnstile widgets reset —
Turnstile tokens are single-use, so a reopened flow always waits for a fresh token rather than
risking a spent or stale one reaching the backend.

Wiring, screen by screen:

- **Sign in submit** → `login`. Success saves the session (see "Session module" below), closes
  the flow (`onClose`), and calls `onAuthenticated?.()`. `401` → `passwordServerError`
  "Incorrect email or password". `403 email_not_verified` → screen jumps to `otp`, remembers the
  submitted email as `pendingEmail`, and marks an auto-resend pending (see OTP below). `403`
  (any other reason, i.e. suspended) → `formError` "This account is suspended. Contact support."
  `429` → `formError` "Too many attempts. Try again in a minute." Anything else (including a
  non-`ApiError`, i.e. a network failure) → `formError` from the error's own message, or "Network
  error — check your connection and try again." for a non-`ApiError`.
- **Create account submit** → `signup`, using whatever captcha token `CreateAccountModal`'s
  `Turnstile` slot currently holds (`captchaReady` gates the button so a submit without a token
  cannot happen through the UI; the handler also guards it directly). Success sets `pendingEmail`
  and jumps to `otp` — signup always answers `202`, so there is no "email taken" branch to handle
  (see the backend doc's enumeration-resistance rationale). Any failure sets `formError` from the
  error message and, either way, the Turnstile widget is reset and its token cleared (tokens are
  single-use).
- **OTP verify** → `verifyOtp({ email: pendingEmail, code })`. Success saves the session, closes
  the flow, and calls `onAuthenticated?.()` — `OtpModal`'s own `onVerified` seam is unused here
  since `verify` itself performs the side effects. Failure simply rejects; `useOtpModal` renders
  the generic error caption (see "OtpModal" above) since `verify-otp` gives no finer-grained
  reason.
- **OTP resend** (manual, via the `Resend` button) → `resendOtp` with the OTP screen's own
  Turnstile token, then resets that widget. If no token is available yet (the widget hasn't
  yielded one, or the flow was closed and reopened before it did), the handler rejects with the
  same "Verification is still loading — please try again in a moment." message
  `CreateAccountModal` uses, which `OtpModal` surfaces as its resend-error caption rather than
  silently no-opping. **Auto-resend**: on the `403 email_not_verified` path
  above, a pending-auto-resend flag is set instead of calling `resendOtp` immediately (no token
  exists yet at that point — the OTP screen, and its `Turnstile` slot, have not mounted). An
  effect watches the OTP screen's captcha token and, once the widget yields one, fires the
  deferred `resendOtp` exactly once and clears the flag. The Turnstile widget normally
  resolves near-instantly on mount, so in practice the user sees the OTP screen open with the
  fresh code already on its way; the countdown that starts on open (see "OtpModal") correctly
  reflects that a send just happened.
- **Continue with wallet** (from either `SignInModal` or `CreateAccountModal`) → closes the auth
  flow (`onClose`) then calls `onConnectWallet?.()`. The `/test` preview wires this to
  `ConnectWalletModal`.
- **Forgot password submit** → calls `onForgotPasswordSubmit?.(payload)` then closes the flow.
  `ForgotPasswordModal.onSubmit` has no real backend yet (see "ForgotPasswordModal" above; #1358
  ships the backend, #1359 the frontend wiring) — this stays a stand-in, same as before #1265.
- **Cross-links** (`onForgotPassword`, `onCreateAccount`, `onSignIn`, `onBackToSignIn`, OTP's
  `onBack`) all just move `screen` between the four values; OTP's back arrow returns to `sign-in`.

### AuthFlowProvider

`packages/frontend/src/auth/AuthFlowContext.ts` + `AuthFlowProvider.tsx` (#1362), exported from
the `auth/index.ts` barrel alongside `useAuthSession`. The single app-wide `EmailAuthFlow`
instance — mirrors `wallet/ConnectModalProvider.tsx`'s single-instance pattern for
`ConnectWalletModal`. Mounted in `main.tsx` inside `ConnectModalProvider` (needs
`useConnectModal()` for "Continue with wallet") and above `WalletViewProvider`/`RouterProvider`,
so every route renders under it.

`useAuthFlow()` returns `{ open(screen?: EmailAuthScreen), close() }`. `open()` defaults to the
`"sign-in"` screen when called with no argument. Unlike `useConnectModal()` (no-op fallback for
partial test trees), `useAuthFlow()` **throws** when called outside the provider — callers
(`TopBar`, `MobileNavMenu`) are always inside it in production, so a missing provider in a test
tree is a setup bug worth surfacing loudly rather than silently swallowing.

The provider owns `isOpen`/`screen` state and renders one `<EmailAuthFlow open initialScreen={screen}
onClose={close} onConnectWallet={openConnectModal} />`. `onAuthenticated` is intentionally omitted
— per the #1362 Issue comment, a successful sign-in only flips the header's own state (`TopBar`
re-renders from `useAuthSession()`'s reactive session store); there is no navigation or toast.

**Who opens it:** `TopBar`'s "Sign In"/"Sign Up" buttons (signed out) call `open("sign-in")` /
`open("create-account")`; `TopBar`'s account icon (signed in) does not call it at all — it
navigates to `/account`. `MobileNavMenu` mirrors both via `onSignIn`/`onSignUp` props threaded from
`TopBar`. `/test?tab=auth` does **not** use this provider — see `### Diagnostics preview seam`
below.

### Turnstile

`packages/frontend/src/components/Turnstile.tsx` (#1265). A ~90-line wrapper around Cloudflare's
Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js`, loaded once and
memoized module-wide) rather than the `@marsidev/react-turnstile` package — the wrapper's surface
is small enough (explicit `render`/`reset`/`remove`, one `flexible`-sized widget, one callback)
that a dependency did not pay for itself. Props: `onToken: (token: string) => void`; ref handle:
`{ reset: () => void }`. Renders a widget at `size: "flexible"` (fills the slot width). Whether any UI shows is set by the
widget mode in the Cloudflare dashboard (Managed / Non-interactive / Invisible) — `"invisible"` is
not a valid `size` value and makes `turnstile.render` throw. Cloudflare runs its challenge, calling `onToken` once it has one (normally near-instant, occasionally an
interactive challenge if Cloudflare's heuristics flag the client). Renders nothing (`null`) and
never calls `onToken` when `ENV.TURNSTILE_SITE_KEY` is empty, so an unconfigured environment
degrades to "captcha-gated actions stay disabled" rather than throwing. `siteverify` is never
called client-side — only the token is sent to the API, which verifies it server-side (see the
product spec's "Bot defense" section).

### Session module

`packages/frontend/src/auth/session.ts` + `useAuthSession.ts` (#1265). `saveSession({ token,
expires_in })` stores `{ token, expiresAt: Date.now() + expires_in * 1000 }` as JSON under the
`pipeline.auth.session` `localStorage` key and notifies subscribers; `readSession()` returns
`null` (clearing the key) once `expiresAt` has passed, or on any parse/shape failure;
`clearSession()` removes the key. `authHeaders()` returns `{ Authorization: "Bearer <token>" }`
when a live session exists, `{}` otherwise — exported for future `#1282`/`#1254` call sites, not
yet wired into any existing `apiFetch` call. `useAuthSession()` is a `useSyncExternalStore` hook
exposing `{ token, expiresAt, isAuthenticated, signOut }`; reactivity is same-tab only (mirrors
the wallet module's `connectionStore.ts` pattern) — it does not listen for cross-tab `storage`
events, so a sign-out in one tab does not live-update another tab's `isAuthenticated` until that
tab next re-reads the store.

### Diagnostics preview seam

`packages/frontend/src/routes/test.tsx` — the `"auth"` tab (`/test?tab=auth`) renders a session
status line (`useAuthSession`, `data-testid="auth-session-status"`, plus a `Sign out` button once
authenticated), three trigger buttons that open `EmailAuthFlow` on its `sign-in` /
`forgot-password` / `create-account` screen (`openAuthFlow(screen)`, which sets both the
`authFlowScreen` and `authFlowOpen` state read by the flow's `initialScreen`/`open` props), and
two further triggers opening `CompanyDocsModal` (#1278, redesigned from #1251) and
`AccountInReviewModal` (#1253) independently — a sixth trigger, `OwnersModal` (#1252), was retired
2026-09-21 (see `### OwnersModal` above), and there is **no standalone "Open OTP screen" trigger**
any more: the OTP screen is reachable only through `EmailAuthFlow` itself (a successful Create
Account submit, or a Sign In that returns `403 email_not_verified`), both of which need a real
backend round-trip. `CompanyDocsModal.onSubmit` and `AccountInReviewModal.onGoToApp` keep their
stand-in confirmation lines ("Company documents submitted — …", "Go to app — #1254 wires this to
the LP dashboard.") — the shell's body-scroll-lock and capture-phase Escape are not stack-safe
(see the shell caveats above), so these two stay independent of `EmailAuthFlow` and of each other.
This does not touch `TopBar`, `AuthFlowProvider`, `ConnectModalProvider`, or any of the production
`openConnectModal` call sites; `EmailAuthFlow`'s `onConnectWallet` opens `ConnectWalletModal`
directly (a `/test`-local `connectWalletOpen` boolean), independent of those production sites too.
This was an explicit #1362 decision (plan default, confirmed in the Issue comment): `/test`
keeps its own `EmailAuthFlow` instance rather than switching to `useAuthFlow()`, so its tests stay
undisturbed by the production entry point's addition.

**Sign in ↔ Forgot Password ↔ Create Account ↔ OTP swap, never stack (#1280, extended #1315,
folded into `EmailAuthFlow` by #1265).** All four screens are `EmailAuthFlow`'s single
`screen: EmailAuthScreen` state (see "EmailAuthFlow" above), so "two of these open at once" is
unrepresentable — only one of the four modals ever has `open={true}`. This is safe against the
shell's stacking hazards (the un-refcounted body-scroll-lock, the capture-phase Escape collision)
because a swap never stacks two shells: React runs the outgoing tree's effect cleanups before the
incoming tree's effect creates within a single commit, so `document.body.style.overflow` lands on
`"hidden"` throughout and exactly one Escape listener is registered at any moment.
`-test.test.tsx` and `EmailAuthFlow.test.tsx` assert the invariant directly (exactly one `dialog`
role after each swap, scroll-lock survives it) rather than trusting the mechanism. A valid submit
on Forgot Password shows `auth-forgot-password-submitted`: "Reset link requested — #1358/#1359
wire this to a real password-reset endpoint."

**Account-page preview links (#1284).** The same `AuthTab` also renders six plain links, one per
`AccountDocumentsState` id, to `/account?state=<id>` — the dev-only preview seam for
[`account-page.md`](./account-page.md#state-preview-contract). This does not add a new `/test` tab:
the auth tab remains this epic's established discovery surface, and the Account page itself is the
preview surface for its own states.

**Wire transfers (#1283).** The same `AuthTab` also renders a `Wire transfers (#1283)` block: one
`Open Funding details modal` trigger (populated with `FUNDING_DETAILS_PLACEHOLDER` so QA can
Figma-compare a fully populated modal) and the five `AddUsdCard` variants rendered inline, each in
a fixed `w-[313px]` box captioned with its variant id. `onAddFunds` on every card variant opens the
same single `FundingDetailsModal` (no stacking); `onWithdraw`, `onStartVerification`, and
`onViewStatus` each reveal a stand-in confirmation line by `data-testid`, naming #1285 and #1282
respectively as the real owners. Neither surface is mounted anywhere else — see
[`bank-transfers.md`](./bank-transfers.md#test?tab=auth-preview-seam).
