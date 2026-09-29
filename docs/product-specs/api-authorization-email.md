# API Authorization — Email and Password

## Overview

The LP-facing self-serve credential. Companion to
[api-authorization.md](./api-authorization.md), which covers the wallet-signature
credential, the shared JWT, and the `accounts` data model — read that first. Both
credentials resolve to the same `accounts` principal and issue the same token.

Registration here is **open**: no invitation, no allow-list. That is the
deliberate difference from operator accounts in
[lp-onboarding.md](./lp-onboarding.md), which are invitation-gated with
mandatory 2FA and two-person activation. An account created here holds no roles.

## Behavior

1. **Signup.** The LP posts an address, a password, and a Turnstile token.
   The server verifies the captcha, then creates an unverified account and
   emails a six-digit passcode.

   **The response is `202` in every case** — address free, address held by an
   unverified account, or address held by a verified one. A response that varied
   would make the endpoint an oracle for enumerating Pipeline's LP customer
   list. What differs is only what is emailed: a passcode for the first two
   cases (the second being the resume path for someone who closed the OTP
   screen), and for the third a notice to the address's *owner* that someone
   tried to register it. The caller learns nothing either way.
2. **Verify.** The LP posts the passcode. Codes live **60 seconds** and allow
   **one guess** — a wrong code burns it, and the caller needs a fresh one.
   Issuing a new code supersedes any outstanding one. On success the address is marked verified, **the password
   that was submitted alongside this code is installed**, and a JWT is issued —
   all in one transaction. Every failure — unknown address, no outstanding code,
   wrong code, expired, used, out of attempts — returns the same `401` and the
   same message.

   Expiry, single-use and the attempt cap are enforced in **single SQL
   statements**, not by reading the row and deciding in code. A
   read-check-then-write loses the race each control exists to stop: concurrent
   guesses all observe the same count and all pass a cap of 5. The same applies
   to the resend cooldown, which runs under a row lock on the account.
3. **Resend.** Captcha-gated and limited to one passcode per **60 seconds** per
   account, enforced server-side from the stored `created_at`. The frontend's
   59-second countdown is an affordance, not the control. Signup applies the
   same limit on its re-issue path, or it would simply be the way around it.
   Both answer `202` and skip the send silently rather than returning `429`: a
   `429` could only ever fire for an address holding an unverified account, so
   it would reopen the very oracle the `202` closes. The outstanding code stays
   live, so "check your inbox" is true either way.
4. **Login.** Address and password. An unknown address is still verified against
   a throwaway Argon2id hash so both paths cost the same work — without that,
   response latency reveals which corporate addresses are registered. A verified
   account gets a JWT; an unverified one gets `403 email_not_verified`, which is
   not a leak (the caller already proved the password) and is what the frontend
   needs to route back into the OTP screen.

Passwords are **Argon2id** (OWASP defaults: m=19 MiB, t=2, p=1), one random salt
each, stored as PHC strings. The server re-enforces the frontend's policy — at
least 8 characters, a digit, and a special character — rather than trusting it,
and hashes the submitted password *before* branching on whether the address is
known, so the Argon2 cost cannot be timed to tell the two apart.

**A password is never written to an unverified account.** Signup stores it on the
passcode it issues, and only verifying *that* passcode installs it. Writing it
straight onto the account is an account takeover: a stranger re-submits a
pending address with their own password, the real owner's already-mailed code is
still live, and the owner's own verification hands over an account whose
password the stranger chose. Binding the password to the code means a
verification can only ever install what was submitted with that same code.

**Sign-in is limited to 3 attempts per 60 seconds**, counted per submitted
address *and* per client address, independently. Per-address alone does nothing
against credential stuffing, which walks many addresses from one client;
per-client alone does nothing against a distributed attack on one address.

The counter is bumped on every attempt and cleared on success, so only failures
accumulate — two mistypes followed by the right password leave no trace. Once the
limit is hit the address is refused for the rest of the window even with the
correct password; that is the point, and it is also a way for someone else to
lock an address out for up to a minute. That cost is accepted: the alternative
is leaving the only unauthenticated password endpoint unbounded.

Counting is a single conditional `UPSERT` per key, not a read followed by a
write, and not an in-process counter. In-process would be per-replica, making the
real limit N×3 with nothing in the code to say so.

The client address is read from `X-Forwarded-For`. With no proxy in front, that
header is absent and **only the per-address limit applies** — the socket peer is
deliberately not used as a fallback, since behind a proxy it is the proxy.

The "someone tried to sign up with your address" notice is throttled per account
on the same 60-second window as passcodes. Unthrottled it is an open relay for
mailing any address Pipeline already has on file.

## Bot defense

`signup` and `resend-otp` require a **Cloudflare Turnstile** token, verified
server-side against `challenges.cloudflare.com/turnstile/v0/siteverify` with a
5-second timeout. Verification **fails closed**: a provider outage returns `503`
rather than admitting the request, since an attacker able to break the verify
call would otherwise have disabled the control.

`TURNSTILE_SECRET_KEY` follows the same degrade-gracefully pattern as the JWT
keys — absent, the API boots with the check disabled and logs a warning. **That
is a development affordance; provisioning the secret is a production deploy
requirement**, because unset means open signup rather than a safe default.

Captcha is the second layer, not the first. It does not bound credential
stuffing against `login`, which carries no captcha, and it does not bound a
distributed signup flood. Per-IP and global rate limiting is not yet
implemented — see TD-81.

## Email delivery

SendGrid v3 `mail/send`: one recipient per call, `text/plain` only, 10s timeout, no retry.
`SENDGRID_API_KEY` is required and, unlike `TURNSTILE_SECRET_KEY` above, does not degrade
gracefully — absent (with `EMAIL_DEV_LOG` unset), the API refuses to boot, since silently
logging live passcodes in production is worse than refusing to start. `EMAIL_DEV_LOG=true`
is the dev/test escape hatch; `SENDGRID_FROM` is required alongside the key (no default);
`SENDGRID_BASE_URL` (EU residency) is config, not code. Also requires Domain
Authentication/DMARC on `pipeline.one`, or mail is spam-foldered. A send failure surfaces
as `500`; see **TD-96** / **TD-97** for the accepted consequences of not swallowing it.

## Data Model

Adds `otp_codes` to the `accounts` model in
[api-authorization.md](./api-authorization.md): the outstanding
email-verification passcodes, stored as `sha256(account_id ‖ ":" ‖ code)`. The
hash stops a casual DB read from handing over live codes; it is *not*
brute-force resistant over a six-digit space, so the 60-second expiry and the
single-guess budget are the real controls. Together with the resend cooldown
they bound an attacker to one guess per minute against a 10⁶ space.

The cost lands on real users: a single mistyped digit kills the code, and the
replacement cannot be sent until the cooldown elapses — up to 60 seconds during
which `resend-otp` answers `202` and mails nothing. That silence is deliberate
(saying otherwise would reveal that the address has a pending account), but it
means a fumbled digit looks like a broken product. See TD-87.

The TTL deliberately equals the resend cooldown. Shorter, and a caller would be
holding a dead code while still being refused a new one; the invariant is
asserted in `packages/api/tests/otp.rs`. It is a tight window for a user who has
to switch to an inbox and back — if delivery latency makes it unusable in
practice, raise the TTL rather than lowering the cooldown, since the cooldown is
what bounds outbound mail.

## Frontend

Issue #1265 wires the auth modals to these endpoints (see
`docs/frontend/auth-components.md`). Issue #1362 adds the LP header's
"Sign In"/"Sign Up" entry via `AuthFlowProvider` and an authenticated account
link. `/test?tab=auth` keeps an independent flow. Typed wrappers are in
`packages/frontend/src/api/auth.ts`; see its README for request shapes.

**Session storage.** `login`/`verify-otp` saves `{ token, expiresAt }` under
`pipeline.auth.session`, deriving expiry from `expires_in`. `readSession()`
clears expired sessions; there is no refresh endpoint. `useAuthSession()`
(`useSyncExternalStore`) exposes `{ token, isAuthenticated, signOut }` within
the current tab, without cross-tab `storage` support. The LP header (#1362)
and account data flows (#1371, #1373) reuse this session.

**403 `email_not_verified` routing.** On `login`'s `403 email_not_verified`,
the frontend calls `resend-otp` (reusing the pending signup passcode's
password per the backend behavior above) and opens the OTP screen — the user
verifies with the code just re-issued, which installs the original password.

**Error copy** (none of these states are in Figma): login `401` → "Incorrect
email or password"; login `403` (suspended) → "This account is suspended.
Contact support."; login `429` → "Too many attempts. Try again in a minute.";
OTP verify failure (any of unknown/wrong/expired/used/out-of-attempts code) →
"Code is incorrect or expired. Request a new one."; network/unexpected errors
→ "Network error — check your connection and try again."

**Captcha availability.** Sign Up becomes actionable once the email and password
meet their rules. Submitting without a Turnstile token stays on the form, explains
whether verification is still loading, failed, or unavailable, and makes no API
request. If the challenge requires user interaction, the widget remains available
to complete it. A script, widget, or challenge failure surfaces an error and a
retry action. An expired token also shows a retry action. Retrying loads or
renders a fresh challenge without reloading. An absent site key shows an unavailable
state. None of these states bypasses the API's captcha verification.

After login returns `403 email_not_verified`, the OTP screen attempts one
captcha-gated resend when its token is ready. If that attempt fails, the OTP
screen says the code was not sent and offers an immediate retry during the normal
countdown. A `202` retry only means the request was accepted: the backend may still
be in its cooldown after a failed send and skip delivery. The screen says to retry
after the restarted countdown if no code arrives. Leaving OTP discards the old
captcha token before another auto-resend. Wrong or expired OTP responses use the
OTP error copy above; network and server failures use the network error copy.

**Turnstile.** `Turnstile.tsx` loads Cloudflare's script once and renders the
widget explicitly at `size: "flexible"`; the widget's configured mode determines
visibility. `VITE_TURNSTILE_SITE_KEY` supplies the public key. The token goes to
the API as `captcha_token`; the widget resets after signup and resend because
tokens are single-use. Only the API calls `siteverify`.

The frontend Docker entrypoint injects `VITE_TURNSTILE_SITE_KEY` into runtime
`window.__ENV__`, not a build-time Docker argument.
