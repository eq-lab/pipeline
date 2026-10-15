# API Authorization — Password Reset

## Overview

Recovery for the email/password credential in
[api-authorization-email.md](./api-authorization-email.md): a **verified, active**
account gets a single-use link mailed to its address, and following it installs a
new password and ends every session the account holds. The endpoint contract is
in [api-authorization.md](./api-authorization.md#api-contract). There is no
change-password for a signed-in user yet (TD-85).

## Behavior

1. **Request.** `POST /v1/auth/forgot-password` with the address and a Turnstile
   token. Past the captcha and the per-client limit **the answer is always
   `202`**: unknown address, unverified, suspended, inside the cooldown, or
   genuinely sent. The lookup, the link issue and the send all run **after the
   response, off the request path**, so neither the status, the latency, nor a
   provider failure separates a registered address from an unregistered one —
   the leaks TD-96 records for signup. A failed send is logged, not surfaced;
   the user asks again after the cooldown.

   One link per **60 seconds** per account, under the same account-row lock as
   passcodes; a new link supersedes any outstanding one. Requests are also
   limited to **10 per hour per client address**, counted in `login_attempts`
   under its own `password_reset_ip` scope so the budget is never shared with
   sign-in, and answered `429` past it. The count is taken before the address is
   looked up, so a `429` reveals nothing about it. The client address is read
   from `X-Forwarded-For` as for login: with no proxy in front only the
   per-account cooldown applies.

   An unverified account gets no link. It has no password to reset yet; its
   owner resumes signup, which re-issues the passcode.
2. **The link.** `{APP_BASE_URL}/reset-password#token=<token>`, where the token is
   32 bytes from the OS RNG, hex-encoded. The token rides in the URL
   **fragment**, which browsers never send to a server: it stays out of the
   static host's and any CDN's access logs and out of `Referer`. The frontend
   reads it from the fragment and posts it. A link lives
   `PASSWORD_RESET_TTL_MINUTES` (default **30**) and works once. A 256-bit token
   cannot be guessed, so unlike the passcode there is no attempt budget —
   expiry and single use are the controls.
3. **Reset.** `POST /v1/auth/reset-password` with `{ token, password }`. The
   password must meet the signup policy (`400`), checked first so a weak password
   does not burn the link. A malformed or dead token is refused before any
   Argon2 work, so the endpoint cannot be driven to burn CPU. Then, in one
   transaction, the token is consumed by a single conditional `UPDATE` — two
   concurrent submissions of one link cannot both win — and the new hash is
   installed, provided the account is still verified and `Active`. Every
   failure — unknown, expired, used, superseded, account no longer eligible —
   is the same `401`. Success is `204` with no token: the user signs in with the
   new password.
4. **Every session ends.** The reset stamps `accounts.password_changed_at`, and
   `AuthClaims`, which already reads the account on every request, refuses any
   token whose `iat` is earlier than that stamp truncated to the second — `401
   invalid or expired token`, indistinguishable from expiry, so the frontend's
   existing session-expired handling applies. That covers the account's wallet
   sessions too: the account is the principal, and ending everything is the
   point of a reset. The stamp is taken from the API's clock — the clock that
   sets `iat` — so DB/API clock skew cannot reject the token minted at the next
   sign-in. A token minted earlier in the same second as the reset survives;
   refusing the whole second instead would sign out a client that signs in
   straight after resetting.
5. **Notice.** The owner is then mailed that the password changed — how they
   find out if it was not them. A failed send is logged; the reset stands.

## Configuration

`APP_BASE_URL` is the frontend origin reset links point at. Like
`SENDGRID_API_KEY` it is required unless `EMAIL_DEV_LOG=true`, where it falls back
to `http://localhost:5173`. It must be an `http(s)` URL with a host and no query
or fragment; a path prefix is kept and a trailing slash dropped.
`PASSWORD_RESET_TTL_MINUTES` is a whole number from 1 to 1440, default 30. An
invalid value for either refuses boot — mailing broken or week-long links is
worse than not starting.

## Data Model

`otp_codes.purpose` is `EmailVerification` or `PasswordReset`. A reset row stores
`sha256(token)` with no account salt: the 256-bit token has nothing to
brute-force, and a reset must be found by its hash alone (unique partial index),
since the request carries no address. `pending_password_hash` is always `NULL`
on it. The cooldown and supersede rules are counted per purpose, so a reset
never delays a passcode or the reverse.

`accounts.password_changed_at` is `NULL` until the first reset.

## Frontend

Wired by #1359 (`docs/frontend/auth-components.md`, sections `ForgotPasswordModal`,
`ResetLinkSentModal`, `ResetPasswordModal`). Typed wrappers `forgotPassword` / `resetPassword`
live in `packages/frontend/src/api/auth.ts`.

**Request.** `ForgotPasswordModal` posts `{ email, captcha_token }` from its own Turnstile widget
(single-use; reset after every attempt) and, on `202`, shows a "Check your inbox" screen whose copy
is enumeration-safe — "If an account exists for `<email>`, a password reset link is on its way" —
with no resend: "Try again" returns to the request form. A `429` or captcha `403` shows the
backend's message on the form.

**Reset.** The `/reset-password` route reads `token` from the URL fragment on first render, keeps
it only if it is 64 hex characters, and strips the fragment from the address bar. It validates the
new password with the signup policy client-side, posts `{ token, password }`, and on `204` clears
any locally stored session (the backend has already ended it) and offers "Sign in". Every `401`
and a missing or malformed token show one "This link has expired" screen with "Request a new
link", which reopens the request form.

No Figma frames exist for the confirmation or the set-new-password screen (TD-71); both are
derived from the shell's designed siblings.
