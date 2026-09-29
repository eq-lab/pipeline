# Issue #1361: KYB auth: surface Turnstile load failures and auto-resend errors

Source: https://github.com/eq-lab/pipeline/issues/1361

## Scope

Make the Create account screen explain why Sign Up remains disabled after valid credentials when Turnstile has not supplied a token, and let the user retry a failed challenge without reloading. Surface failures in the OTP auto-resend path and allow an immediate manual retry when no code was sent. Distinguish an invalid OTP from a network or server failure. Preserve captcha gating and the existing email/password policy. The invalid `size: "invisible"` option mentioned in the issue was already fixed in #1357; keep the current `size: "flexible"`.

## Assumptions and Risks

- Issue #1361's `frontend` scope belongs to epic #1247. The epic's Create account and OTP Figma frames describe normal and validation states, but no captcha load/error or resend-failure state. Use the existing modal typography and error treatment for those new states, then compare the normal screens with the Figma frames.
- `signup` and `resend-otp` require a Turnstile token. A missing `VITE_TURNSTILE_SITE_KEY` is a deployment configuration fault, not a signal to bypass the gate. The stage image's runtime `window.__ENV__` and the Cloudflare widget hostname/mode need checking as part of verification. The backend `TURNSTILE_SECRET_KEY` must match the public widget configuration.
- The Turnstile script can fail before or after loading, including an exception from `render` or a widget error callback. A pending script that never settles needs a finite timeout; a failed script element and cached promise must be cleared before retry. Avoid setting component state after the modal unmounts.
- The normal OTP countdown is an affordance; allowing an immediate retry after a failed auto-resend must not bypass the backend's 60-second send cooldown. The API may answer `202` without sending if an outstanding code is still in its cooldown window.

## Open Questions

_None_

## Implementation Steps

1. Extend `packages/frontend/src/components/Turnstile.tsx` with explicit loading, ready, and error reporting, plus token-expiry handling. Reject script errors and a finite load timeout, clear the failed module promise and script element, and catch `render` failures. Add a retry path that starts a fresh script/widget attempt and preserves `reset`/`remove` cleanup.
2. In `packages/frontend/src/components/EmailAuthFlow.tsx` and `useEmailAuthFlow.ts`, track the signup and OTP captcha states separately. Clear stale tokens when a challenge expires or fails. Show an accessible loading caption, error, and retry control in the Create account slot through `CreateAccountModal.tsx`; show a visible unavailable state when the site key is absent. Keep Sign Up disabled until both credential rules and a fresh token pass. Provide analogous OTP captcha feedback so Resend does not silently stall.
3. Replace the `403 email_not_verified` auto-resend `.catch(() => {})` in `useEmailAuthFlow.ts` with error state passed to `OtpModal.tsx`/`useOtpModal.ts`. On failure, say the code was not sent and permit immediate manual retry even during the initial countdown; after a successful resend, restore the countdown. Clear this state on screen close/change and avoid stale async results changing a reopened flow.
4. In `useOtpModal.ts`, map `verifyOtp` `401` to the invalid/expired code copy and network or `5xx` failures to the existing network error copy. Preserve the entered code for a retry and keep the verify error separate from resend and captcha errors.
5. Add `docs/user-stories/epic-1247/1361-kyb-auth-captcha-errors.md` with steps for valid credentials awaiting captcha, script/widget failure and retry, absent site key, auto-resend failure and immediate retry, and OTP `401` versus network errors. Link it from `docs/user-stories/index.md`.

## Test Strategy

Add focused regression tests in `Turnstile.test.tsx` for script rejection, timeout, render exception, retry, token expiry, and cleanup. Extend `EmailAuthFlow.test.tsx`/`useEmailAuthFlow.test.ts` and `CreateAccountModal.test.tsx` to prove a valid form reports captcha loading/failure, never submits without a token, and enables Sign Up after a retry yields one. Extend `OtpModal.test.tsx` and flow tests for failed auto-resend, immediate retry during countdown, successful retry restarting the timer, and distinct `401`/network/`5xx` verify errors. Run frontend unit/type/lint checks and `npx tsx scripts/lint-docs.ts`. Inspect the stage runtime site key and verify the browser flow with the configured Turnstile widget. Compare the unaffected normal Create account/OTP states to epic #1247's Figma frames `6486:81615`, `6486:81640`, and the OTP frames referenced by `docs/frontend/auth-components.md`.

## Docs to Update

- `docs/product-specs/api-authorization-email.md` — captcha availability, OTP resend failure, OTP error semantics, and current flexible Turnstile size (updated during planning).
- `docs/frontend/auth-components.md` — component/flow behavior for loading, error, retry, expiry, and resend failure (updated during planning).
- `docs/user-stories/epic-1247/1361-kyb-auth-captcha-errors.md` and `docs/user-stories/index.md` — implement with the code for the epic QA pass.
