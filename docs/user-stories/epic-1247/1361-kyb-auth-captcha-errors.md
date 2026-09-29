# User Stories: #1361 — KYB auth CAPTCHA and resend recovery

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1361](https://github.com/eq-lab/pipeline/issues/1361)
Spec: [Email authorization](../../product-specs/api-authorization-email.md#frontend), [auth components](../../frontend/auth-components.md#emailauthflow)

## Story 1: Valid credentials while verification is pending

Open Create account and enter a valid email and policy-valid password. Sign Up becomes enabled. If Turnstile has not produced a token, the form says verification is loading. Clicking Sign Up does not call signup and shows a pending-verification message. Complete the challenge and click again; signup sends a fresh token and opens OTP after the API returns `202`.

## Story 2: Verification fails or is unconfigured

Block the Turnstile script or make widget rendering fail. The form shows a failure and Retry verification. Clicking Retry starts a fresh challenge without a page reload; signup remains blocked until a token arrives. Expire an issued token and confirm a subsequent Sign Up click makes no request until a new token arrives. With the site key absent, the form states verification is unavailable and makes no signup request.

## Story 3: OTP auto-resend fails

Sign in to an unverified account and make the automatic resend return an error. The OTP screen says the code was not sent and offers Resend immediately, even while the initial countdown would otherwise be running. A failed retry stays actionable. A `202` retry restores the countdown and says the request was accepted; it tells the user to retry after the countdown if no code arrives, since a failed send may have burned the server cooldown. If CAPTCHA is still loading or unavailable, the screen explains that state rather than silently doing nothing. Closing or leaving OTP ignores late auto-resend results.

## Story 4: New flows cannot use an old CAPTCHA or signup result

From OTP, return to Sign In after the widget has produced a token. Sign in to an unverified account again. Before the new OTP widget produces a token, no automatic resend request is made; when it does, the request uses only that new token. Start signup, close the flow while its request is pending, then reopen Create account. A late success from the old request neither opens OTP nor resets the newly mounted widget.

## Story 5: OTP verification errors

Enter six digits and make verification return `401`. The screen says the code is incorrect or expired. Repeat with a network error and a server `5xx`; the screen shows the network error copy in each case and preserves the entered digits so the user can retry.
