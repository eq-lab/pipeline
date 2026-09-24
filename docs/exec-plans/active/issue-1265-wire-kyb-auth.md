# Issue #1265: KYB: wire auth screens (sign-in, create-account, OTP) to backend auth

Source: https://github.com/eq-lab/pipeline/issues/1265

## Scope

Replace the mock behavior of `SignInModal`, `CreateAccountModal`, and `OtpModal` with real calls to the #1266 endpoints, and introduce the LP app's first email-account session.

In scope:

- Typed API functions for `POST /v1/auth/signup`, `/verify-otp`, `/resend-otp`, `/login` (contract: `packages/api/src/routes/auth/password.rs`; stage OpenAPI `https://api.pipeline.stage.eqlab.net/api-docs/openapi.json`).
- A session store for the issued JWT (`{ token, expires_in }`): save, read, expire, clear, and a React hook/context that exposes `isAuthenticated`. This is the "authenticated?" axis that #1282 is blocked on.
- Cloudflare Turnstile widget for signup and resend (`VITE_TURNSTILE_SITE_KEY`, already in `.env.example` and marked "wired in #1265").
- An orchestrating flow component/hook (`useEmailAuthFlow`) that sequences sign-in -> create-account -> OTP, handles `403 email_not_verified` from login by routing into OTP (with a resend), and wires "Continue with wallet" to the existing `ConnectWalletModal` open action.
- Turning the OTP hook from a mock (`MOCK_VALID_CODE`, `MOCK_VERIFY_DELAY_MS`) into an async verify/resend seam.
- Mounting the wired flow in the `/test` AuthTab (the only current entry point; see Open Questions).

Out of scope:

- Header Sign In / Sign Up buttons and home-page gating states (#1282).
- `/v1/lps/*` KYB data wiring after verification (#1254).
- Password reset: no backend endpoint exists (see Open Questions). `ForgotPasswordModal` stays as shipped in #1280.
- Attaching the JWT as `Authorization: Bearer` to other API calls: only in scope if cheap (see step 3); no current LP endpoint consumer requires it here.
- Backend changes.

## Assumptions and Risks

- The LP frontend has no JWT handling today (`apiFetch` sends no auth header; nothing stores a token). This issue creates the pattern, so it must be designed for #1282/#1254 reuse.
- `apiFetch` throws a plain `Error(message)` without the HTTP status. Routing on `401`/`403 email_not_verified`/`429` needs the status, so `apiFetch` must throw a typed `ApiError { status, message }` (subclass of `Error`, so existing callers are unaffected).
- Signup and resend always return `202`: the UI must not claim the address is new or taken. After signup always go to OTP with "check your inbox".
- OTP codes live 60s and allow one guess; a wrong code burns it. The OTP error state must tell the user to request a new code, and the resend countdown (59s) must match the 60s server cooldown. Resend inside the cooldown silently returns `202` without mailing.
- Login lockout (3 failures / 60s) returns `429`: needs a user-facing message not in Figma.
- `verify-otp` takes only `{ email, code }`; the password is bound server-side to the passcode issued by signup. Login -> `403 email_not_verified` -> resend-otp: resend issues a new passcode. Whether it carries the password submitted at signup is a backend detail to confirm (see Open Questions); otherwise the user's typed login password would not be installed.
- Turnstile needs a site key per environment; tests and local dev need Cloudflare's always-pass test key (`1x00000000000000000000AA`) and the backend's matching test secret.
- Token storage in `localStorage` is readable by XSS. Accepted for now if the wallet path/trustee app does the same; flag in Open Questions.
- Dependency: #1266 is merged and live on stage. #1282 and #1254 depend on this issue.

## Open Questions

All answered by @equilibrium-de on 2026-09-24 (issue comment "Answers from @equilibrium-de"):

1. **Entry point** — yes: `/test` AuthTab only; production header entry stays with #1282.
2. **Post-auth destination** — yes: close modal + set session; routing owned by #1282.
3. **Session storage** — yes: `localStorage` with expiry from `expires_in`.
4. **Forgot password** — split: backend #1358, frontend #1359. `ForgotPasswordModal.onSubmit` stays a stand-in here.
5. **Unverified login** — activate: on `403 email_not_verified` call `resend-otp` and open OTP; a successful verify installs the pending password. Backend already supports this (`resend_otp` re-issues with `latest_pending_password_hash`, `verify-otp` installs it) — no backend change needed.
6. **Copy for non-Figma states** — implementer picks sensible wording; tuned later. Implemented: login 401 → "Incorrect email or password"; login 403 (suspended) → account-suspended message; login 429 → lockout message; OTP verify failure → "Code is incorrect or expired. Request a new one."; network/unexpected errors → generic retry copy.
7. **Turnstile** — site key `0x4AAAAAAFAYwDE0-EKHrVz7` (public), read from `VITE_TURNSTILE_SITE_KEY`, explicit render, invisible size, token sent as `captcha_token`, widget reset after each submit (tokens are single-use), `siteverify` never called from the browser. Site key set in `.env.example` (replacing the "NOT read by any code yet" note) and in the local `.env`. The frontend Docker image injects `VITE_*` vars at container start (`docker/frontend/entrypoint.sh` writes `window.__ENV__`, no build-time `ARG`) — `VITE_TURNSTILE_SITE_KEY` was added there.
8. **Continue with wallet** — yes: close auth modal first.

## Implementation Steps

All 9 steps below are implemented. Deviations from the plan text, noted inline: step 4 used a
hand-written ~90-line `Turnstile.tsx` wrapper (`@marsidev/react-turnstile` was not added as a
dependency — the wrapper's surface is small enough not to need it) and also wired
`VITE_TURNSTILE_SITE_KEY` into `docker/frontend/entrypoint.sh` (runtime env injection, not a
build-time `ARG`) since the frontend Docker image has no build-time `VITE_*` vars at all; step 5
fully removed `MOCK_VALID_CODE`/`MOCK_VERIFY_DELAY_MS` rather than keeping them as a no-`verify`
default, since `/test` no longer mounts `OtpModal` standalone (step 8 replaces it with
`EmailAuthFlow`); step 6 implemented the server-error prop as two props
(`passwordServerError`/`formError` on `SignInModal`, `formError` on `CreateAccountModal`) rather
than one generic `serverError`, since the two cases render in different slots; step 7's screen
union omits `"none"` (`EmailAuthFlow`'s own `open` prop is the on/off axis; `screen` is only the
four in-flow screens) and resolved the "403 email_not_verified -> trigger resend" open question
via a deferred auto-resend (no Turnstile token exists yet at the moment of the `403` — see
`useEmailAuthFlow.ts`'s effect on `[otpCaptchaToken, pendingEmail]`).

1. **Typed API errors** — `packages/frontend/src/api/client.ts`: add `export class ApiError extends Error { status: number }`; throw it in `apiFetch` on non-OK responses (keep `message` from `payload.error`). Handle `202` / empty bodies: return `undefined` when `response.status === 204 || 202` or content-length is 0, instead of `response.json()`. Export from `api/index.ts`. Update `client.test.ts`.
2. **Auth API module** — new `packages/frontend/src/api/auth.ts`: `signup({ email, password, captchaToken })`, `verifyOtp({ email, code })` -> `TokenResponse`, `resendOtp({ email, captchaToken })`, `login({ email, password })` -> `TokenResponse`. Map to snake_case bodies (`captcha_token`), JSON headers, `POST`. Export `TokenResponse` type. Mock-key support comes free via `apiFetch`.
3. **Session store** — new `packages/frontend/src/auth/session.ts`: `saveSession({ token, expires_in })` storing `{ token, expiresAt }` under `pipeline.auth.session`; `readSession()` returns null when missing/expired; `clearSession()`; tiny subscribe/notify for reactivity. New `packages/frontend/src/auth/useAuthSession.ts` (`useSyncExternalStore`) exposing `{ token, isAuthenticated, signOut }`. Optionally add an `authHeaders()` helper for future Bearer use; do not change existing calls.
4. **Turnstile** — add `VITE_TURNSTILE_SITE_KEY` to `packages/frontend/src/lib/env.ts` (`TURNSTILE_SITE_KEY`, default empty). New `packages/frontend/src/components/Turnstile.tsx` wrapping the Cloudflare script (load `https://challenges.cloudflare.com/turnstile/v0/api.js` once, render explicit widget, `onToken`, `reset()` via ref). Decide whether to use the `@marsidev/react-turnstile` package instead — prefer the package if it passes review; otherwise a ~60-line wrapper. Update `.env.example` comment (no longer "not read by any code").
5. **OTP hook becomes async** — `packages/frontend/src/components/useOtpModal.ts`: replace mock timer with `verify?: (code) => Promise<void>` and `resend?: () => Promise<void>` options. On 6 digits: status `verifying`, await `verify`; resolve -> `onVerified`; reject -> `error` with message "Code is incorrect or expired. Request a new one." (pending copy). Resend: enabled when countdown hits 0, calls `resend`, restarts countdown to 59. Remove `MOCK_VALID_CODE`/`MOCK_VERIFY_DELAY_MS` or keep only as the default when no `verify` is passed (keeps /test preview behavior). Expose `onResend` click handler in `OtpModal.tsx` (the resend label becomes a button when enabled) and a slot for the Turnstile widget.
6. **Modals accept async submit + server error** — `SignInModal.tsx` / `CreateAccountModal.tsx`: allow `onSubmit` to return `Promise<void>`; show a submitting state (disable primary button) while pending; add `serverError?: string` prop rendered in the existing field-error styling (login 401 -> password field error; 429 -> form-level). CreateAccountModal gains a Turnstile slot; submit disabled until token present.
7. **Flow orchestrator** — new `packages/frontend/src/components/useEmailAuthFlow.ts` (+ `EmailAuthFlow.tsx` rendering the three modals plus ForgotPassword) managing `screen: none|sign-in|create-account|otp|forgot-password`, the pending email, captcha token, and errors:
   - Create account submit -> `signup` -> screen `otp` (always, 202).
   - OTP verify -> `verifyOtp` -> `saveSession` -> close, call `onAuthenticated`.
   - OTP resend -> `resendOtp` with a fresh Turnstile token.
   - Sign-in submit -> `login` -> `saveSession` -> close; `ApiError 403 email_not_verified` -> screen `otp` + trigger resend (pending open question); `401` -> "Incorrect email or password"; `429` -> lockout message.
   - `onContinueWithWallet` -> close + caller-provided `onConnectWallet` (open `ConnectWalletModal`).
   - Cross-links (`onCreateAccount`, `onSignIn`, `onForgotPassword`, `onBackToSignIn`) live.
   Props: `open`, `initialScreen`, `onClose`, `onAuthenticated`, `onConnectWallet`.
8. **Mount in `/test`** — `packages/frontend/src/routes/test.tsx` AuthTab: replace the separate SignIn/CreateAccount/OTP mounts with `EmailAuthFlow`; show session status (authenticated / expires at / sign out button) so the flow is verifiable end-to-end against stage. Keep Company Docs / Account-in-review previews unchanged.
9. **Remove stale mock remnants** and update `.env.example` frontend section.

## Test Strategy

- Unit (Vitest): `api/auth.test.ts` (request bodies, snake_case, 202 handling, `ApiError` status propagation); `client.test.ts` (ApiError, empty-body 202); `auth/session.test.ts` (save/read/expiry/clear, subscribers); `useOtpModal` tests updated for async verify success/failure, resend enable/restart, no double-submit.
- Component (RTL): `SignInModal`/`CreateAccountModal` submitting + server error rendering; `EmailAuthFlow.test.tsx` with `apiFetch` mocked: signup -> OTP -> verify -> session saved; login 401/403/429 branches; continue-with-wallet calls `onConnectWallet`; cross-link navigation. Mock Turnstile component in tests.
- Update `routes/-test.test.tsx` for the new AuthTab.
- `/test-fast` must pass (lint, typecheck, unit).
- Manual e2e against stage (`VITE_API_BASE_URL=https://api.pipeline.stage.eqlab.net`) via Chrome DevTools MCP: create account with a real inbox, receive code, verify, observe session; login success; wrong password x3 -> lockout; unverified login -> OTP. Requires stage Turnstile site key.
- Figma verification: compare Sign in, Create account (incl. validation error 6585:75897), and OTP (default/enabled/error) states against the KYB Onboarding frame https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81556 — wiring must not regress shipped visuals; new submitting/server-error states follow existing error styling.

## Docs to Update

- `docs/product-specs/api-authorization-email.md`: add a "Frontend" section (session storage, expiry handling, 403 routing to OTP, captcha placement).
- `packages/frontend/src/api/README.md`: document `ApiError` and the auth module.
- `.env.example`: `VITE_TURNSTILE_SITE_KEY` now read.
- `docs/user-stories/epic-1247/` (if present): add/adjust auth stories for the QA pass (#1255).
- `ARCHITECTURE.md` frontend section if it enumerates state/auth modules.
