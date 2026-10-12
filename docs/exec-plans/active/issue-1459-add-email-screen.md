# Issue #1459: Add email screen for a wallet-connected visitor — email + password, then OTP, then session

Source: https://github.com/eq-lab/pipeline/issues/1459

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419).
Depends on: #1458 (merged — `openAddEmail()` seam, `AccountEmailCard`'s `Add email` row,
`AccountUploadRow`'s wallet-only intercept).

Figma (desktop, verified live via the local Dev Mode MCP on 2026-10-12):

- Default, `Save` disabled: `7129:15702` — https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7129-15702&m=dev
- Enabled: `7129:15921` — https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=7129-15921&m=dev
- Back arrow instance: `7129:15704` at (20, 20)
- Next screen (unchanged): `6486:81665` / `6486:81848` / `6486:81863` (`OtpModal`)
- Validation error: **no Add email frame exists.** Reuse `CreateAccountModal`'s validation-error
  treatment, frame `6585:75897` (#1281) — identical `TextField` invalid rendering and identical
  policy copy, because both screens drive the same `useAuthCredentialsForm({ passwordRule: "policy" })`.

## Scope

In scope — frontend only, no backend change:

- A new `"add-email"` member of `EmailAuthScreen` and a new presentational `AddEmailModal`.
- `useEmailAuthFlow` wiring: the add-email submit reuses the **existing** `signup` handler, captcha
  token, and OTP hand-off; the OTP back arrow learns to return to the screen it came from.
- `EmailAuthFlow` renders the new modal and feeds its Turnstile slot.
- `AuthFlowProvider.openAddEmail()` re-points from `open("create-account")` to `open("add-email")`.
- A `/test?tab=auth` trigger for the new screen.
- Docs: `docs/frontend/auth-components.md` (new `### AddEmailModal` section + `EmailAuthFlow` /
  `AuthFlowProvider` updates), `docs/frontend/account-page.md` (two forward-references to #1459
  resolved), `docs/user-stories/epic-1419/1459-add-email-screen.md` + its index row.

Out of scope:

- Any change to `AccountEmailCard`, `AccountUploadRow`, `AccountPage`, or `AccountListRow` — #1458
  already wired `openAddEmail()` at both call sites and this issue only re-points its implementation.
- Any backend change. `POST /v1/auth/signup` / `verify-otp` / `resend-otp` are used exactly as
  `CreateAccountModal` uses them today (`docs/product-specs/api-authorization-email.md`).
- Linking the connected wallet to the account. The wallet is display-only; nothing about it is read
  by, or sent to, this flow (resolved in the Issue's 2026-10-12 comment and in
  `account-page.md#wallet-only-variant-1458`).
- Home state 7 for a wallet-only visitor (#1460) and `deriveHomeState`.

## Assumptions and Risks

- **This is the create-account registration with different chrome.** Same `signup` → OTP →
  `verify-otp` → `saveSession` path. The only new code is a screen; no new network call, no new
  state machine, no new session handling.
- **There is no duplicate-email error to render.** `signup` answers `202` in every case by design
  (enumeration resistance — see the product spec's "Signup" clause), so registering an
  already-taken address advances to OTP and no passcode arrives; the address's owner gets a notice
  instead. `CreateAccountModal` behaves identically today. Likewise `signup` has no `429`: the
  lockout the Issue mentions belongs to `login`, which this screen never calls. In practice the only
  error surfaces on this screen are the generic `formError` (any non-`202`/network failure) and the
  captcha status/retry block — exactly `CreateAccountModal`'s set. Do **not** invent
  duplicate-email or lockout copy.
- **Turnstile has no Figma slot on either frame.** `signup` requires a token, so the widget must
  render. Placing it where `CreateAccountModal` places it (after the password field, inside the
  32px fields group) is the precedent. Risk: if the Cloudflare widget mode is Managed/Non-interactive
  it occupies height and the column stops matching Figma's 438px. Mitigation: same divergence already
  shipped on `CreateAccountModal`; ux-tester should Figma-compare with the widget in its normal
  invisible/resolved state. Note it in the docs rather than hiding it.
- **Reusing `signup`'s single captcha token across two screens is safe** because `screen` is one
  value — `"create-account"` and `"add-email"` are never mounted simultaneously, so the shared
  `signupTurnstileRef` / `signupCaptchaToken` cannot be double-claimed. Do not add a third token.
- **After OTP success the provider may open `CompanyDocsModal`.** `AuthFlowProvider`'s `token`
  effect fires on the new session, `GET /v1/lps/me` returns `404` for a brand-new account, and
  `setup.open` becomes `true`. That is existing #1265/#1278 behaviour for every signup, but the
  Issue's stated end-state does not mention it — see **Open Questions**.
- Nothing navigates. `AuthModalShell` portals a `fixed inset-0` overlay onto `document.body`, so
  `/account` stays mounted underneath and "back returns to `/account`" is just `onClose`.
- `AuthModalShell`'s body-scroll-lock and capture-phase Escape are not stack-safe (TD-58/TD-61
  caveats). This screen does not stack: it swaps inside the single `screen` state like every other
  `EmailAuthFlow` screen.

## Open Questions

- After a successful OTP on the **Add email** path, `AuthFlowProvider` will auto-open
  `CompanyDocsModal` over `/account` (new account → `GET /v1/lps/me` 404 → `setup.open = true`),
  the same as after a header Sign Up. The Issue's end-state says only "the flow closes, the header
  shows the account icon, `AccountEmailCard` renders the session email". Should the Add email path
  keep that auto-open (consistent with create-account — the planner's default, and what this plan
  implements unless told otherwise), or land the visitor on `/account` with no modal?

## Implementation Steps

All paths are under the worktree `/Users/luiza/Projects/pipeline-feat-add-email-screen`.

### 1. `packages/frontend/src/components/AddEmailModal.tsx` (new)

One spec-pointer header: `// spec: docs/frontend/auth-components.md#addemailmodal`. No other comments.

Props — the `CreateAccountModal` subset that this screen actually uses:

```ts
export interface AddEmailModalProps {
  open: boolean;
  onBack: () => void;
  onSubmit?: (credentials: { email: string; password: string }) => void | Promise<void>;
  formError?: string;
  captchaStatus?: TurnstileStatus;
  onCaptchaRetry?: () => void;
  turnstileSlot?: ReactNode;
}
```

No `onContinueWithWallet`, no `onSignIn`, no `onDismiss` separate from `onBack` — the frame has no
wallet button, no OR divider, no footer line, and no close icon.

Shell call — every prop below is read off the Figma metadata for `7129:15702`
(`Image` slot `hidden="true"`, `Close Icon` `hidden="true"`, `Container` centred at y=239 in a
916px frame, `arrow-left` at (20, 20)):

```tsx
<AuthModalShell
  open={open}
  onDismiss={onBack}
  onBack={onBack}
  heading="Add email"
  description="Enter your corporate email and create a password"
  headingId="add-email-modal-heading"
  testId="add-email-modal"
  showImagePanel={false}
  showCloseButton={false}
  align="center"
>
```

Form — the `<form data-node-id="7129:15702">` wrapper carries `mt-6 flex w-full flex-col gap-12`:

- `mt-6` + the shell column's own `gap-6` = the frame's **48px** heading→fields gap
  (`Container` is `gap-[48px]`; `OtpModal` uses the same `mt-*` technique for its 32px gap).
- `gap-12` = the frame's **48px** fields→`Save` gap.
- Add `pb-16` to reproduce the Container's `pb-[64px]`; with `align="center"`/`my-auto` this is what
  makes the rendered column centre where Figma's 438px container centres (86 + 48 + 144 + 48 + 48
  + 64 = 438). `OtpModal` already does this.

Children of the form, in order:

1. Fields group — `<div className="flex w-full flex-col gap-8">` (Figma `7129:15912`,
   `gap-[32px]`), containing:
   - `TextField type="email" autoComplete="email" placeholder="Enter corporate email"` wired to
     `email` / `setEmail` / `handleEmailBlur` / `emailError`.
   - `TextField type="password" autoComplete="new-password" placeholder="Password"` wired to
     `password` / `setPassword` / `handlePasswordBlur` / `passwordError`. The eye toggle is
     `TextField`'s own (Figma `button-icon` `7129:15999`, 32×32) — do not add one.
   - `{turnstileSlot}` then the captcha status / `Retry verification` block, copied verbatim from
     `CreateAccountModal` (same strings, same `role="status"`/`role="alert"` split, same
     `--color-pipeline-ink-muted` / `--color-pipeline-negative-strong` tokens).
   - The `formError` `role="alert"` paragraph, verbatim from `CreateAccountModal`.
2. `Save` submit:

```tsx
<Button
  type="submit"
  variant="primary-blue"
  disabled={!isValid || isSubmitting}
  className="!w-full !min-w-0 disabled:opacity-[0.32]"
>
  Save
</Button>
```

`Button`'s `primary-blue` is already `h-12` (48px) + `--radius-pipeline-button`; the Figma button is
`h-[48px]`, `fill/brand` `#000080`, `radius/radius-s` `4`, `opacity-32` when disabled — resolved via
`get_variable_defs`, not codegen literals. No style overrides beyond the two width bangs and the
disabled opacity, identical to `CreateAccountModal`.

Form state: `useAuthCredentialsForm({ open, onSubmit, passwordRule: "policy" })` — the same hook,
the same policy (`>= 8 chars + digit + special`), the same `PASSWORD_POLICY_ERROR_MESSAGE`
("At least 8 characters, including a number and a special character") and `EMAIL_ERROR_MESSAGE`,
and therefore the same validation-error rendering as frame `6585:75897`.

### 2. `packages/frontend/src/components/useEmailAuthFlow.ts`

- Extend the union: `export type EmailAuthScreen = "sign-in" | "create-account" | "forgot-password" | "otp" | "add-email";`
- Rename the state `createAccountFormError` → `signupFormError` (4 references repo-wide:
  this file ×3, `EmailAuthFlow.tsx` ×1, `useEmailAuthFlow.test.ts` ×1). It now serves both signup
  screens; keeping the old name would be misleading.
- Add state `const [otpBackScreen, setOtpBackScreen] = useState<EmailAuthScreen>("sign-in");`,
  reset to `"sign-in"` inside the existing `open === true` reset effect.
- Extract the body of `handleCreateAccountSubmit` into a private
  `submitSignup(origin: "create-account" | "add-email", { email, password })`. It is byte-identical
  except that, on success, it calls `setOtpBackScreen(origin === "add-email" ? "add-email" : "sign-in")`
  before `setScreen("otp")`. Keep every existing guard untouched: the `captchaToken` pre-check and
  its status-dependent message, `flowGenerationRef` comparison, `clearOtpCaptcha()`,
  `setPendingEmail(email)`, the `finally` that resets the widget and clears the token, and the
  re-`throw` (which is what drives `isSubmitting` back to `false` in `useAuthCredentialsForm`).
- Export `handleCreateAccountSubmit` (→ `submitSignup("create-account", …)`) and
  `handleAddEmailSubmit` (→ `submitSignup("add-email", …)`).
- Add `goToAddEmail()` alongside the existing `goTo*` helpers: bump `flowGenerationRef`, clear the
  auto-resend flag/result, `clearOtpCaptcha()`, `clearSignInErrors()`, `setSignupFormError(undefined)`,
  `setScreen("add-email")`.
- Add `goBackFromOtp()`: `otpBackScreen === "add-email" ? goToAddEmail() : goToSignIn()`. Export it;
  leave `goToSignIn` exported and unchanged for the cross-links.

Rationale for reusing the signup machinery rather than adding parallel state: `screen` is a single
value, so only one signup screen can be mounted; a second captcha token would be dead state and a
second error field would duplicate `CreateAccountModal`'s copy. Record this in the docs.

### 3. `packages/frontend/src/components/EmailAuthFlow.tsx`

- Render `<AddEmailModal open={open && flow.screen === "add-email"} onBack={flow.dismiss} … />`.
  `onBack` is `flow.dismiss` (not a `goTo*`): the Issue's "back closes the flow and returns to
  `/account`". Escape does the same via `AuthModalShell`'s `onDismiss`.
- Feed it `formError={flow.signupFormError}`, `captchaStatus={flow.signupCaptchaStatus}`,
  `onCaptchaRetry={flow.retrySignupCaptcha}`, and
  `onSubmit={flow.handleAddEmailSubmit}`.
- Widen the signup Turnstile gate so the shared widget mounts for this screen too:
  `open && (flow.screen === "create-account" || flow.screen === "add-email")`, still with
  `ref={flow.signupTurnstileRef}` / `onToken={flow.onSignupToken}` /
  `onStatusChange={flow.onSignupCaptchaStatus}`. (The widget remounts across a screen swap, which
  is correct — tokens are single-use.)
- Point `CreateAccountModal`'s `formError` at `flow.signupFormError` (rename only).
- Change `OtpModal`'s `onBack={flow.goToSignIn}` → `onBack={flow.goBackFromOtp}`.

### 4. `packages/frontend/src/auth/AuthFlowProvider.tsx`

One line: `const openAddEmail = useCallback(() => open("add-email"), [open]);`. Nothing else —
`AuthFlowContext`'s signature is unchanged and `AccountEmailCard` / `AccountPage` are untouched,
as #1458's doc note promised.

### 5. `packages/frontend/src/routes/test.tsx`

Add a fifth trigger in the existing `<div className="flex gap-2">` button row:
`<Button variant="secondary" className="w-fit" onClick={() => openAuthFlow("add-email")}>Open Add email screen</Button>`.
No new state — `openAuthFlow` already takes any `EmailAuthScreen`. Update the tab's intro paragraph
to name the screen.

### 6. Docs

- `docs/frontend/auth-components.md`:
  - New `### AddEmailModal` section placed after `### CreateAccountModal` — frame ids, the
    composition list above, the `48px / 32px / 48px / 64px-pb` geometry and how `mt-6` + `gap-12` +
    `pb-16` produce it, the shell prop set, the `passwordRule: "policy"` reuse, the
    "validation-error frame is `6585:75897`, borrowed from Create account" note, the Turnstile
    placement divergence, and the explicit "no duplicate-email / no lockout branch exists on
    `signup`" statement.
  - `### EmailAuthFlow`: widen the `initialScreen` union, document `submitSignup`'s shared body,
    `otpBackScreen` / `goBackFromOtp`, the shared signup captcha token, and the
    `createAccountFormError` → `signupFormError` rename.
  - `### AuthFlowProvider`: replace the "`openAddEmail()` is implemented today as
    `open("create-account")` … #1459's to add" paragraph with the shipped behaviour.
  - `### Diagnostics preview seam`: add the new trigger to the enumeration.
- `docs/frontend/account-page.md`: resolve the two forward references — the `Add email` row
  paragraph (line ~132) and the ownership table row at line ~496 ("The Add email screen itself and
  the OTP hand-off | #1459") — to point at `auth-components.md#addemailmodal`.
- `docs/user-stories/epic-1419/1459-add-email-screen.md` (new) — see **Test Strategy**.
- `docs/user-stories/index.md`: add the `#1459` row to the epic-1419 table.
- Run `npx tsx scripts/lint-docs.ts` (currently 0 errors / 47 warnings — do not add errors). The
  200-line spec cap applies only to `docs/product-specs/`, so growing `auth-components.md` is fine.
- No `docs/product-specs/` change: backend behaviour is unchanged, and
  `api-authorization-email.md` already describes every endpoint this screen calls.

## Test Strategy

New: `packages/frontend/src/components/AddEmailModal.test.tsx` — mirror
`CreateAccountModal.test.tsx`'s structure.

- Renders the heading `Add email` and the description `Enter your corporate email and create a
  password`; `add-email-modal` testid present.
- **No** image panel, **no** `Close` button, **a** `Back` button (`aria-label="Back"`); exactly two
  inputs; no "Continue with wallet", no "OR", no "Already have an account?" footer.
- `Save` is disabled with empty fields and stays disabled for a valid email + weak password
  (`"short1"`); enables for a valid email + `"Password1!"`.
- Password policy error copy appears on blur with a weak non-empty password and the email error
  copy appears on blur with `"nope"` — the `6585:75897` treatment.
- Eye toggle flips the password input `type` (`TextField` behaviour, assert it is reachable here).
- `onBack` fires from the arrow **and** from Escape.
- `formError` renders in a `role="alert"`; the captcha `loading` / `error` / `expired` /
  `unavailable` branches render their copy and `Retry verification` calls `onCaptchaRetry`.
- Submitting while `onSubmit` is pending keeps `Save` disabled (`isSubmitting`).

`packages/frontend/src/components/useEmailAuthFlow.test.ts`:

- `initialScreen: "add-email"` starts on that screen.
- `handleAddEmailSubmit` with a signup captcha token calls `signup` once, then `screen === "otp"`
  and `pendingEmail` is the submitted address.
- Without a token it does not call `signup` and sets the not-ready `signupFormError`.
- A rejected `signup` sets `signupFormError` and rethrows; the token is cleared either way.
- `goBackFromOtp()` returns to `"add-email"` after the add-email submit, and to `"sign-in"` after
  the create-account submit and after the `403 email_not_verified` sign-in path (regression guard).
- Rename assertion for `signupFormError`.

`packages/frontend/src/components/EmailAuthFlow.test.tsx`:

- `initialScreen="add-email"` renders exactly one `role="dialog"` and it is `add-email-modal`.
- Full happy path with mocked `signup`/`verifyOtp`: submit → OTP screen shows
  `We’ve sent a passcode to <email>` → six digits → `saveSession` called with the submitted email →
  `onClose` fired.
- OTP back arrow from the add-email path returns to `add-email-modal`, not `sign-in-modal`
  (and the existing create-account→OTP→back→sign-in test still passes).
- Swap invariant: moving `add-email` ↔ `otp` never leaves two dialogs mounted and keeps
  `document.body.style.overflow === "hidden"` — the same assertion the existing swap tests make.

`packages/frontend/src/auth/AuthFlowProvider.test.tsx`: there is **no** `openAddEmail` test today —
add one. The file mocks `EmailAuthFlow` and renders `initialScreen` into
`email-auth-flow-screen`, so: add an `Open Add Email` button to the local `ConsumerButtons` helper
(`const { open, close, openAddEmail } = useAuthFlow()`), click it, and assert
`email-auth-flow-screen` has text `add-email`. Leave the existing
`open("create-account")` case asserting `create-account` — it is the regression guard that this
issue re-pointed only `openAddEmail`, not `open`.

`packages/frontend/src/routes/-test.test.tsx`: `?tab=auth` renders an `Open Add email screen`
trigger and clicking it opens `add-email-modal`.

`packages/frontend/src/components/account/AccountPage.test.tsx`: unchanged — it mocks
`useAuthFlow()`, so re-pointing `openAddEmail` cannot regress it. Confirm it still passes rather
than editing it.

Edge cases to assert explicitly: an already-registered address still advances to OTP (mock `signup`
resolving `202`) and renders no "email taken" copy; a `429` is **not** special-cased on this screen.

Commands (run in the worktree): `yarn workspace @pipeline/frontend test`, then the repo's lint +
build, then `npx tsx scripts/lint-docs.ts`.

Figma verification (required — the Issue carries Figma links): after implementation, render
`/test?tab=auth` → `Open Add email screen` at 1728×916 and compare against `7129:15702` (empty,
`Save` at 32% opacity) and `7129:15921` (filled, solid `#000080` `Save`). Check: heading Besley
48/56 `#262524`; description Graphik 16/22 `#262524`, 8px below the heading; 400px column; fields
400×56, white fill, 4px radius, 12px horizontal padding, placeholder `rgba(56,55,53,0.6)`, 32px
apart; 48px heading→fields and fields→`Save`; `Save` 400×48, 4px radius; back arrow 24×24 with its
glyph at (20, 20); content column vertically centred; no image pane, no close icon.

## Docs to Update

- `docs/frontend/auth-components.md` — new `### AddEmailModal`; updates to `### EmailAuthFlow`,
  `### AuthFlowProvider`, `### Diagnostics preview seam`.
- `docs/frontend/account-page.md` — resolve the two #1459 forward references.
- `docs/user-stories/epic-1419/1459-add-email-screen.md` — new.
- `docs/user-stories/index.md` — new epic-1419 row.
- No `docs/product-specs/` change (no behaviour change behind the API).
- `docs/exec-plans/tech-debt-tracker.md` — only if the Turnstile-widget height divergence is left
  unresolved; log it there rather than fixing it inline.
