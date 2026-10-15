# User Stories: #1359 — KYB: wire Forgot Password screen to backend reset

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1359](https://github.com/eq-lab/pipeline/issues/1359)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#forgotpasswordmodal),
[docs/product-specs/api-authorization-password-reset.md](../../product-specs/api-authorization-password-reset.md)

`ForgotPasswordModal` posts to `POST /v1/auth/forgot-password`, a "Check your inbox" screen follows,
and the emailed link lands on `/reset-password`, which posts to `POST /v1/auth/reset-password`.
Production entry: the Sign in modal's "Forgot password?" link (header "Sign In"). Diagnostics:
`/test?tab=auth` has "Open Forgot Password screen", "Open Reset-link-sent screen", and a link to
`/reset-password` with a well-formed token the API refuses.

These stories need `VITE_API_BASE_URL` pointed at a live API with `TURNSTILE_SECRET_KEY`,
`APP_BASE_URL` (pointing at the frontend origin under test) and SendGrid configured, and a
`VITE_TURNSTILE_SITE_KEY` in the frontend `.env`. Stories 4–6 need a real inbox for a verified test
account and are flagged; everything else is browser-drivable.

**Tech debt to be aware of:** no Figma frames exist for "Check your inbox" or "Set a new password"
(TD-71) — their layout and copy are implementer-derived stand-ins. Do not file them as visual bugs.
The Turnstile widget sits in the Forgot Password column with no Figma slot, as on Create account.

---

## Story 1: Requesting a reset link reaches "Check your inbox" without revealing whether the address exists

**Persona:** LP who forgot their password.

**Pre-conditions:** Signed out. Header "Sign In" → "Forgot password?".

**Steps:**

1. Type any well-formed address that is **not** registered, e.g. `nobody-123@example.com`.
2. Wait for the Turnstile widget to settle (what shows depends on the widget mode).
3. Click "Send Reset Link" and watch the Network tab.

**Expected outcomes:**

- One `POST /v1/auth/forgot-password` with `{ email, captcha_token }` answers `202`.
- The modal becomes "Check your inbox" with the line "If an account exists for
  `nobody-123@example.com`, a password reset link is on its way. Follow it to set a new password."
- The flow stays open (no dialog closes), there is no × button, there is a back arrow.
- Nothing on screen distinguishes this from a registered address.

---

## Story 2: "Try again" and "Back to sign in" from "Check your inbox"

**Persona:** LP who mistyped their address.

**Pre-conditions:** "Check your inbox" open (Story 1).

**Steps:**

1. Click "Try again".
2. Observe the Forgot Password form, then click "Back to sign in".
3. Repeat Story 1, then click the back arrow top-left.

**Expected outcomes:**

- "Try again" returns to "Reset your password" with an empty email field and a fresh Turnstile
  widget; only one dialog is visible.
- "Back to sign in" and the back arrow both open the Sign in screen in place.
- Escape on "Check your inbox" closes the flow entirely.

---

## Story 3: Submitting without a captcha token makes no request

**Persona:** LP on a slow connection.

**Pre-conditions:** Forgot Password screen open; block `challenges.cloudflare.com` in DevTools
(Network → request blocking) before opening it, or reload with the site key removed.

**Steps:**

1. Type a well-formed email and click "Send Reset Link".

**Expected outcomes:**

- No `POST /v1/auth/forgot-password` is made.
- With the script blocked: "Verification failed to load. Try again." and a "Retry verification"
  button; retrying with the block lifted loads the widget and a subsequent submit succeeds.
- With no site key: "Verification is unavailable. Please contact support."; submit stays inert.

---

## Story 4: The emailed link opens the set-new-password form and a reset signs in with the new password *(needs a real inbox)*

**Persona:** Verified LP who forgot their password.

**Pre-conditions:** A verified, active account whose inbox you can read. Signed out.

**Steps:**

1. Request a link for that address (Story 1) and open the "Reset your Pipeline password" email.
2. Follow the link. Note the address bar.
3. Type a policy-valid new password (e.g. `NewPass1!`) and click "Save new password".
4. Click "Sign in" and sign in with the **new** password; then sign out and try the **old** one.

**Expected outcomes:**

- The link is `<frontend origin>/reset-password#token=<64 hex>`; after the page renders, the
  `#token=…` fragment is gone from the address bar (Back/Forward do not restore it).
- The "Set a new password" dialog shows one password field and a disabled "Save new password"
  until the policy is met.
- One `POST /v1/auth/reset-password` with `{ token, password }` answers `204`; the dialog becomes
  "Password updated" with a "Sign in" button; `localStorage` has no `pipeline.auth.session`.
- "Sign in" lands on `/` with the Sign in modal open. The new password signs in; the old one is
  refused with "Incorrect email or password".
- A "Your Pipeline password was changed" email arrives.

---

## Story 5: A reset ends the sessions the account already held *(needs a real inbox)*

**Persona:** LP signed in on a second browser.

**Pre-conditions:** Signed in on browser B with the account from Story 4.

**Steps:**

1. On browser A, complete Story 4.
2. On browser B, trigger any authenticated call (open `/account`, or reload).

**Expected outcomes:**

- Browser B is signed out and shows the "Your session expired. Sign in again to continue." toast
  with a Sign in action; wallets stay connected.

---

## Story 6: A used, expired or tampered link shows the expired-link screen *(needs a real inbox for the first case)*

**Persona:** LP who follows an old link.

**Pre-conditions:** The link from Story 4 (already used), or none.

**Steps:**

1. Open the used link again, type a valid password, click "Save new password".
2. Open `/reset-password` with no fragment.
3. Open `/reset-password#token=abc`.
4. Open `/reset-password#token=` + 64 zeros (the `/test?tab=auth` link), submit a valid password.

**Expected outcomes:**

- Case 1: the request answers `401` and the dialog becomes "This link has expired" with "Request a
  new link" and "Remembered it? Back to sign in".
- Cases 2 and 3: "This link has expired" immediately, with **no** request in the Network tab.
- Case 4: the form renders (well-formed token), then `401` → "This link has expired".
- "Request a new link" lands on `/` with the Forgot Password modal open; "Back to sign in" lands on
  `/` with the Sign in modal open; × and Escape land on `/` with no modal.

---

## Story 7: Policy and network errors stay on the form

**Persona:** LP on the reset form.

**Pre-conditions:** `/reset-password` with a well-formed token (the `/test` link is enough).

**Steps:**

1. Type `short`, blur the field; then type `longenough` (no digit, no special) and submit.
2. Type `NewPass1!`, set DevTools to Offline, submit; go back online.

**Expected outcomes:**

- Step 1: "At least 8 characters, including a number and a special character" under the field,
  "Save new password" disabled, no request.
- Step 2: "Network error — check your connection and try again." as an alert; the form stays, the
  button re-enables, and the typed password is kept.

---

## Story 8: Rate limit surfaces the backend message

**Persona:** Tester hammering the request form.

**Pre-conditions:** API behind a proxy that sets `X-Forwarded-For` (staging). Forgot Password open.

**Steps:**

1. Submit a well-formed email eleven times within an hour (reload between attempts as needed for a
   fresh captcha token).

**Expected outcomes:**

- The eleventh `POST /v1/auth/forgot-password` answers `429`; the form shows "too many reset
  requests — try again later" and stays open. Earlier attempts show "Check your inbox" regardless
  of the per-account 60 s cooldown (the backend skips the send silently).
