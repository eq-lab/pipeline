# User Stories: #1265 — KYB: wire auth screens to backend auth

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1265](https://github.com/eq-lab/pipeline/issues/1265)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#emailauthflow),
[docs/product-specs/api-authorization-email.md](../../product-specs/api-authorization-email.md#frontend)

`SignInModal`, `CreateAccountModal`, and `OtpModal` are wired to the real
`packages/api/src/routes/auth/password.rs` endpoints via `EmailAuthFlow`, reachable only from
`/test?tab=auth` — there is no production entry point yet (#1282). These stories require
`VITE_API_BASE_URL` pointed at a live API with `TURNSTILE_SECRET_KEY` configured (e.g.
`https://api.pipeline.stage.eqlab.net`) and a `VITE_TURNSTILE_SITE_KEY` set in the frontend's
`.env` — against a bare `localhost:8080` API with no Turnstile secret configured, captcha is
disabled server-side and signup/resend still work, but the widget itself needs a real site key to
produce a token at all. Stories 1, 5, and 6 need a real inbox to read the emailed passcode and are
flagged accordingly — out of scope for an agent with no email access; everything else is fully
browser-drivable.

Styling-only assertions (spacing, colors) are out of scope here — visual fidelity is verified
separately by the QA agent's Figma comparison against the KYB Onboarding frame. Copy for states
not in Figma (401/429/OTP-error/network) is implementer-chosen — see the spec doc — not
Figma-verified.

---

## Story 1: Creating an account sends a real passcode email and reaches the OTP screen

**Persona:** New LP registering for the first time.

**Pre-conditions:** `/test?tab=auth`, API pointed at a live backend, access to a real inbox for a
throwaway test address.

**Steps:**

1. Click "Open Create Account modal".
2. Enter the test email and a policy-valid password (e.g. `Test1234!`).
3. Wait briefly for the Turnstile widget to acquire a token (what shows, if anything, depends on the widget mode in the Cloudflare dashboard).
4. Click "Sign Up".

**Expected outcomes:**

- The button is disabled until both fields validate; it may additionally stay disabled for a
  moment while the Turnstile widget is still acquiring its first token.
- On click, the modal transitions directly to the OTP screen ("Check your inbox — We've sent a
  passcode to `<the typed email>`") — `signup` always answers `202`, so there is no "email taken"
  branch to observe here.
- Within a minute, a six-digit passcode email arrives at the test inbox.

---

## Story 2: Session status reflects an authenticated session, and Sign out clears it

**Persona:** Any LP, immediately after Story 1 or Story 6's flow completes verification.

**Pre-conditions:** OTP screen open with a genuinely outstanding passcode (from Story 1 or Story
6), or a pre-existing valid session already in `localStorage`.

**Steps:**

1. Enter the six-digit passcode from the inbox and let it auto-submit.
2. Observe the `/test?tab=auth` page (the modal closes back to it).
3. Click "Sign out".

**Expected outcomes:**

- After a valid code, the modal closes with no error; the session status line
  (`data-testid="auth-session-status"`) reads "Authenticated — expires `<a future date/time>`".
- A "Sign out" button is visible only while authenticated.
- Clicking "Sign out" flips the status line back to "Not authenticated" and hides the button
  immediately (no reload needed).
- Reloading the page while authenticated keeps the status "Authenticated…" (the session survives
  in `localStorage`, per the frontend spec).

---

## Story 3: An incorrect password shows a password-field error, not a generic one

**Persona:** Returning LP who mistypes their password.

**Pre-conditions:** `/test?tab=auth`, a verified test account already exists on the target API
(e.g. from a prior run of Story 1/6), not authenticated.

**Steps:**

1. Click "Open Sign In modal".
2. Enter the known verified email and a deliberately wrong password.
3. Click "Sign In".

**Expected outcomes:**

- The modal stays open (no navigation, no session created).
- "Incorrect email or password" appears in the password field's error slot (same visual treatment
  as the client-side "Enter the correct password" validation error).
- The session status line still reads "Not authenticated".

---

## Story 4: Three failed logins in a row show a lockout message

**Persona:** Returning LP who repeatedly mistypes their password.

**Pre-conditions:** Same as Story 3.

**Steps:**

1. Open Sign In, submit the known email with a wrong password. Observe the field error.
2. Repeat two more times in quick succession (within ~60s of the first attempt).

**Expected outcomes:**

- The first two failures each show the password-field "Incorrect email or password" error.
- The third failure instead shows a form-level alert (`role="alert"`) reading "Too many attempts.
  Try again in a minute." — a lockout, not a credentials error, even if the third attempt used the
  *correct* password.

---

## Story 5: Signing in before verifying re-sends a passcode and opens OTP

**Persona:** LP who signed up but never finished verifying, now trying to sign in directly.

**Pre-conditions:** A test account exists whose email was never verified (e.g. abandon Story 1
right after the passcode email arrives, without entering the code), access to that inbox.

**Steps:**

1. Click "Open Sign In modal".
2. Enter that unverified email and the password used at signup.
3. Click "Sign In".
4. Check the inbox.

**Expected outcomes:**

- The modal transitions to the OTP screen ("Check your inbox — We've sent a passcode to
  `<email>`") rather than showing an error — this is the `403 email_not_verified` → auto-resend
  path, not a rejection.
- A fresh passcode email arrives (superseding the original signup one).
- Entering that fresh code verifies successfully and installs the password submitted at signup —
  the one just typed while signing in, since it is the same password bound to the original
  passcode's re-issue.

---

## Story 6: Resend re-issues a code and restarts the countdown

**Persona:** LP on the OTP screen who lost or never received the code.

**Pre-conditions:** OTP screen open with a genuinely outstanding passcode (e.g. from Story 1
before entering a code), access to that inbox.

**Steps:**

1. Wait for the "Resend in 00:59" countdown to reach zero (becomes a "Resend" button).
2. Click "Resend".
3. Check the inbox.

**Expected outcomes:**

- Before the countdown reaches zero, the resend line is plain text, not a button.
- Once "Resend" is clickable and clicked, the countdown restarts at "Resend in 00:59".
- A new passcode email arrives (the original code entered after this point is invalid — issuing a
  new code supersedes the outstanding one, per the backend spec).

---

## Story 7: An incorrect OTP code shows the error state and does not verify

**Persona:** LP on the OTP screen who mistypes the code.

**Pre-conditions:** OTP screen open with a genuinely outstanding passcode.

**Steps:**

1. Type any six digits that do not match the real code (e.g. `000000` unless that happens to be
   correct).

**Expected outcomes:**

- A brief loading spinner (`role="status"`) appears while the request is in flight.
- The screen then shows the error caption (`role="alert"`) "Code is incorrect or expired. Request
  a new one." and the OTP boxes render in their invalid style.
- The session status line still reads "Not authenticated" — no session was created.
- Per the backend's one-guess-per-code rule, the original code is now burned too; only "Resend"
  recovers from here.

---

## Story 8: "Continue with wallet" closes the auth flow and opens the wallet connect screen

**Persona:** LP who decides to use a wallet instead of email/password.

**Pre-conditions:** `/test?tab=auth`, Sign In or Create Account screen open.

**Steps:**

1. Click "Continue with wallet".

**Expected outcomes:**

- The auth modal (Sign In or Create Account) closes.
- The `ConnectWalletModal` full-viewport screen opens in its place (EVM/Soroban tabs, wallet
  rows) — the same modal `TopBar`'s "Connect Wallet" button opens elsewhere in the app.
- No auth-flow dialog remains open behind it.

---

## Story 9: Cross-links between Sign in / Create account / Forgot password still swap, never stack

**Persona:** LP browsing between the auth screens before committing to one.

**Pre-conditions:** `/test?tab=auth`, no screen open.

**Steps:**

1. Click "Open Sign In modal".
2. Click "Create account" (footer link).
3. Click "Log in" (footer link).
4. Click "Forgot password?" (footer link).
5. Click "Back to sign in".

**Expected outcomes:**

- After each click, exactly one dialog is present (`getAllByRole("dialog")` length 1 in
  automated terms) — the previous screen is fully replaced, never stacked underneath.
- The heading updates correctly at each step: "Create account" → "Sign in" → "Reset your
  password" → "Sign in".
- No console errors; body scroll stays locked throughout (page behind the modal does not scroll).

---

## Story 10: Forgot Password still submits as a stand-in (not wired by this issue)

**Persona:** LP who forgot their password.

**Pre-conditions:** Forgot Password screen open (via Story 9 or the standalone trigger).

**Steps:**

1. Enter any well-formed email.
2. Click "Send Reset Link".

**Expected outcomes:**

- The modal closes.
- The `/test` page shows "Reset link requested — #1358/#1359 wire this to a real password-reset
  endpoint."
- No `POST` request is made to any reset-password endpoint — deliberately out of scope for #1265
  (see #1358/#1359).
