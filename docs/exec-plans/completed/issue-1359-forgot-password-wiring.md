# Issue #1359: KYB: wire Forgot Password screen to backend reset

**Status: implemented (2026-10-15)** — all steps below and the Test Strategy are complete;
frontend lint/build/test and `lint-docs` green (154 files, 2456 tests). See PR #1549.

Source: https://github.com/eq-lab/pipeline/issues/1359

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247).
Backend: #1548 (merged 2026-10-15) — `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`,
spec [`api-authorization-password-reset.md`](../../product-specs/api-authorization-password-reset.md).
Branch: `feat/1359-forgot-password-wiring`, PR #1549.

Figma: the only designed frame is Forgot Password `6704:107100` (already built by #1280). The V1.0
section `6486:81556` was re-enumerated live on 2026-10-15: there is still **no** "check your email"
confirmation and **no** "set a new password" frame (TD-71). Both are built here as stand-ins
derived from the existing `AuthModalShell` screens — the convention the epic already uses for
undesigned states (TD-72, the OTP success stand-in approved 2026-09-18).

## Scope

In scope — frontend only:

- `forgotPassword` / `resetPassword` typed wrappers in `packages/frontend/src/api/auth.ts`.
- `ForgotPasswordModal` gains the captcha slot/status/retry and `formError` props `CreateAccountModal`
  has, and an async `onSubmit` that drives a submitting state.
- `useEmailAuthFlow`: a forgot-password submit that posts `{ email, captcha_token }` and advances to a
  new `"reset-link-sent"` screen; its own Turnstile ref/token/status (the screen is never mounted
  with signup or OTP, but naming it after signup would mislead).
- `ResetLinkSentModal` (new): the enumeration-safe "Check your inbox" confirmation.
- `/reset-password` route (new) + `ResetPasswordModal` + `useResetPasswordForm` + `useResetPasswordFlow`:
  reads `token` from the URL fragment, posts it with the new password, and renders the form / expired-link /
  done views. A successful reset clears any local session (the backend ends every session).
- `/test?tab=auth`: the stand-in line goes; triggers for the two new screens.
- Docs: `auth-components.md`, the password-reset spec's Frontend section, the api README, TD-71/TD-85,
  user stories `docs/user-stories/epic-1247/1359-forgot-password-wiring.md` + index row, #1280's story 4.

Out of scope:

- Any backend change. `#1358` stays open for its owner — #1548 shipped it without a reference.
- Change-password for a signed-in user (TD-85), per-session logout (TD-80).
- Designer frames for the two new screens — TD-71 stays open, re-pointed at the stand-ins.

## Assumptions and Risks

- **Always `202`.** The request endpoint never reveals whether the address exists, so the confirmation
  copy must not either: "If an account exists for `<email>`, a password reset link is on its way." No
  "email not found" branch, no resend button — "Didn't get it? Try again" returns to the request screen,
  which mounts a fresh Turnstile widget (tokens are single-use, and the backend has a 60 s per-account
  cooldown it enforces silently).
- **The token rides in the fragment** (`{APP_BASE_URL}/reset-password#token=<64 hex>`). The route reads
  `window.location.hash` once on mount into state and then strips the fragment with
  `history.replaceState`, so the token does not linger in the address bar or in a shared screenshot.
  A missing or malformed token (not 64 hex characters, the backend's `is_well_formed_reset_token`) shows
  the expired-link view without a request.
- **Every `reset-password` failure is one `401`** (unknown, expired, used, superseded, account no longer
  eligible) → the expired-link view with "Request a new link". `400` means the backend policy rejected
  a password the client accepted → shown under the field verbatim. Anything else → the generic network
  copy. The client validates with the same `meetsPasswordPolicy` signup uses, so `400` is a mismatch
  signal, not a normal path.
- **A reset ends every session, including this browser's.** On `204` the route calls `clearSession()`
  so the stale token is not kept around to trip the `401` → "session expired" toast on the next call.
- **`useAuthFlow()` throws outside its provider** — the route is always under `AuthFlowProvider` in
  production; tests mock `@/auth` as `-account.test.tsx` does.
- **Turnstile height** on the Forgot Password frame: same divergence `CreateAccountModal` carries —
  the widget sits inside the 32 px column gap after the email field; Figma has no slot for it.
- Diagnostics: `/test` has no API mock for auth, so its forgot-password submit test can only assert the
  no-captcha behaviour (stays on the modal, no request). The real round trip is covered in
  `EmailAuthFlow.test.tsx` with `@/api` mocked.

## Open Questions

_None_ — the one judgment call (build the undesigned screens as derived stand-ins rather than block on
design) follows the epic's recorded convention and is logged on the Issue (2026-10-15 comment).

## Implementation Steps

### 1. `packages/frontend/src/api/auth.ts`, `index.ts`, `README.md`, `auth.test.ts` — done

`forgotPassword({ email, captchaToken })` → `POST /v1/auth/forgot-password` `{ email, captcha_token }`,
resolves `undefined` on `202`. `resetPassword({ token, password })` → `POST /v1/auth/reset-password`
`{ token, password }`, resolves `undefined` on `204`. Barrel exports; README rows; request-shape tests.

### 2. `useAuthCredentialsForm.ts` — done

Export `meetsPasswordPolicy` (unchanged body) for the reset form.

### 3. `ForgotPasswordModal.tsx` + `useForgotPasswordForm.ts` — done

Props: `onSubmit?: (payload) => void | Promise<void>`, `formError?`, `captchaStatus?`, `onCaptchaRetry?`,
`turnstileSlot?`. The hook returns `isSubmitting` (promise-aware, same as `useAuthCredentialsForm`).
Render order inside the form: email field → `turnstileSlot` → captcha status block → `formError` →
submit (`disabled={!isValid || isSubmitting}`) → footer. Copy for the loading state: "Verification is
loading. You can complete it before requesting a link."

### 4. `ResetLinkSentModal.tsx` (new) — done

Shell: heading "Check your inbox", description "If an account exists for `<email>`, a password reset
link is on its way. Follow it to set a new password." (`that address` when no email is known),
`showImagePanel={false}`, `showCloseButton={false}`, `onBack` → sign-in, `align="center"` — the OTP
frame's chrome (`6486:81665`), the closest designed sibling. Body: primary "Back to sign in" and the
caption "Didn't get it? " + "Try again" button (→ forgot-password). `testId="reset-link-sent-modal"`.

### 5. `useEmailAuthFlow.ts` + `EmailAuthFlow.tsx` — done

- `EmailAuthScreen` += `"reset-link-sent"`.
- State: `forgotCaptchaToken`, `forgotCaptchaStatus`, `forgotFormError`, `forgotTurnstileRef`; cleared
  on close like the signup trio; `goToForgotPassword()` clears the error.
- `handleForgotPasswordSubmit({ email })`: no token → the status-dependent message (`loading` →
  not-ready copy, otherwise `undefined` because the captcha block already explains) and return; else
  `forgotPassword`, then `setPendingEmail(email)` + `setScreen("reset-link-sent")`; on failure
  `forgotFormError` from `describeApiError` and re-throw; `finally` reset the widget + clear the token.
- `EmailAuthFlow` drops `onForgotPasswordSubmit`; feeds `ForgotPasswordModal` its slot/status/error;
  renders `ResetLinkSentModal` with `email={flow.pendingEmail}`, `onBackToSignIn={flow.goToSignIn}`,
  `onTryAgain={flow.goToForgotPassword}`, `onDismiss={flow.dismiss}`.

### 6. `ResetPasswordModal.tsx` + `useResetPasswordForm.ts` (new) — done

Props: `open`, `onDismiss`, `view: "form" | "expired" | "done"`, `onSubmit?(password) => void | Promise<void>`,
`formError?`, `passwordServerError?`, `onPasswordEdit?`, `onSignIn?`, `onRequestNewLink?`.
`testId="reset-password-modal"`, `align="center"`, image panel + close button as the Forgot Password frame.

- `form`: heading "Set a new password", description "Choose a new password for your account.", one
  password `TextField` (`autoComplete="new-password"`, placeholder "New password"), policy-validated on
  blur/submit with `PASSWORD_POLICY_ERROR_MESSAGE`; `formError` block; submit "Save new password".
- `expired`: heading "This link has expired", description "Password reset links work once and expire
  after a short while. Request a new one to continue.", primary "Request a new link", caption
  "Remembered it? " + "Back to sign in".
- `done`: heading "Password updated", description "Your password has been changed and every other
  session was signed out. Sign in with your new password to continue.", primary "Sign in".

### 7. `useResetPasswordFlow.ts` (new) + `routes/reset-password.tsx` (new) — done

`readResetToken(hash)` → the `token` param of the fragment if it is 64 hex chars, else `undefined`.
`useResetPasswordFlow()`: `token` from `window.location.hash` on first render, `history.replaceState`
strips the fragment in an effect; `view` starts `"expired"` without a token; `submit(password)` →
`resetPassword` → `clearSession()` + `"done"`; `401` → `"expired"`; `400` → `passwordServerError`;
else `formError`; re-throws so the form's submitting state releases. The route renders
`ResetPasswordModal open` over an empty `<main>`; `onDismiss` → `/`; `onSignIn` → `/` +
`openAuthFlow("sign-in")`; `onRequestNewLink` → `/` + `openAuthFlow("forgot-password")`.
`routeTree.gen.ts` regenerates on build.

### 8. `routes/test.tsx` — done

Drop `resetLinkRequested` / `onForgotPasswordSubmit`. Add "Open Reset-link-sent screen"
(`openAuthFlow("reset-link-sent")`) and an "Open Reset Password screen" link to
`/reset-password#token=<64 zeros>` (a well-formed token the backend will refuse with `401`, so the
page demonstrates the form and then the expired-link view against a live API).

### 9. Docs — done

See **Docs to Update**.

## Test Strategy

- `api/auth.test.ts`: both wrappers POST the snake_case body and resolve `undefined` on `202`/`204`.
- `ForgotPasswordModal.test.tsx`: captcha status block + retry, `formError` alert, submit disabled while
  a pending `onSubmit` promise is outstanding, existing presentational tests unchanged.
- `ResetLinkSentModal.test.tsx`: copy with and without an email, both buttons, back arrow, no close
  button, no image panel.
- `ResetPasswordModal.test.tsx`: the three views' copy; policy error on blur/submit; valid submit calls
  `onSubmit` once; `passwordServerError` renders under the field; `formError` alert; `onSignIn` /
  `onRequestNewLink` / footer link.
- `routes/-reset-password.test.tsx` (`@/auth` and `useNavigate` mocked, `resetPassword` mocked): no
  fragment → expired view, no request; malformed token → expired; well-formed token → form, fragment
  stripped; `204` → done view and the stored session is cleared; `401` → expired; `400` → message under
  the field; `onSignIn` navigates home and opens sign-in; "Request a new link" opens forgot-password.
- `EmailAuthFlow.test.tsx`: forgot submit posts `{ email, captchaToken }` and shows "Check your inbox"
  with the email; a rejected request shows the error and stays; "Try again" returns to the request
  screen; "Back to sign in" returns to sign-in; the removed `onForgotPasswordSubmit` test goes.
- `routes/-test.test.tsx`: the stand-in test becomes "submit without a captcha token stays on the modal";
  new triggers render.
- Gate: `yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/auth-components.md` — `### ForgotPasswordModal` (wired; props; captcha slot),
  new `### ResetLinkSentModal`, new `### ResetPasswordModal` (+ route + hooks), `### EmailAuthFlow`
  (screen list, props, forgot-password bullet), intro paragraph.
- `docs/product-specs/api-authorization-password-reset.md` — `## Frontend` replaced with the shipped
  behaviour. (`api-authorization-email.md` is at the 200-line limit — not touched.)
- `packages/frontend/src/api/README.md` — auth module section.
- `docs/exec-plans/tech-debt-tracker.md` — TD-71 (stand-ins shipped, designer frames still wanted),
  TD-85 impact line.
- `docs/user-stories/epic-1247/1359-forgot-password-wiring.md` + `docs/user-stories/index.md` row;
  `1280-kyb-forgot-password.md` story 4 amended.
