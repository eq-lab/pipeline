# User stories — #1368 Backend: wire SendGrid as the transactional email provider (OTP delivery)

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1368](https://github.com/eq-lab/pipeline/issues/1368)
Spec: [docs/product-specs/api-authorization-email.md](../../product-specs/api-authorization-email.md#email-delivery)

This issue is backend infrastructure — no UI changes. Stories verify observable API
behavior (boot, dev-log mode, delivery, and failure handling) rather than a rendered page;
`/v1/auth/signup` and `/v1/auth/resend-otp` are exercised with `curl` or an HTTP client
against a running `pipeline-api` instance, not a browser.

Story 3 needs a real SendGrid account and a throwaway test inbox; everything else runs
against a local instance with the environment varied per story.

---

## Story 1 — Missing `SENDGRID_API_KEY` fails boot

**Setup:** Start `pipeline-api` with `EMAIL_DEV_LOG` unset and no `SENDGRID_API_KEY` (all
other required config present).

**Action:** Run the binary.

**Expected outcomes:**

- The process exits non-zero before binding to a port — no requests are ever served.
- The startup error names `SENDGRID_API_KEY` and mentions `EMAIL_DEV_LOG=true` as the
  local-development alternative.

---

## Story 2 — `EMAIL_DEV_LOG=true` boots without any SendGrid variable and logs the passcode

**Setup:** Start `pipeline-api` with `EMAIL_DEV_LOG=true` and no `SENDGRID_API_KEY`,
`SENDGRID_FROM`, or `SENDGRID_BASE_URL` set.

**Action:** `POST /v1/auth/signup` with a fresh test email, a policy-valid password, and a
Turnstile token (or with `TURNSTILE_SECRET_KEY` unset, per the bot-defense spec).

**Expected outcomes:**

- The API boots successfully.
- The response is `202 Accepted`.
- The API log contains an INFO line with the six-digit passcode and the test email — no
  outbound HTTP call to SendGrid is made.

---

## Story 3 — A real SendGrid key delivers the passcode to an inbox

**Setup:** Start `pipeline-api` with `EMAIL_DEV_LOG` unset, a real `SENDGRID_API_KEY`, and
`SENDGRID_FROM=no-reply@pipeline.one` (Domain Authentication configured on `pipeline.one`).

**Action:** `POST /v1/auth/signup` with a throwaway test address you can read, a
policy-valid password, and a valid Turnstile token.

**Expected outcomes:**

- The response is `202 Accepted`.
- Within the passcode's 1-minute TTL, an email from `no-reply@pipeline.one` with subject
  "Your Pipeline verification code" arrives at the test inbox, plain text, containing a
  six-digit code.
- The same code, submitted to `POST /v1/auth/verify-otp` for that email, verifies
  successfully.

---

## Story 4 — A SendGrid send failure surfaces as `500`, not a swallowed error

**Setup:** Start `pipeline-api` with `EMAIL_DEV_LOG` unset and a `SENDGRID_API_KEY` that
SendGrid will reject (e.g. revoked, or `SENDGRID_FROM` pointed at an address without Domain
Authentication so SendGrid's API rejects the sender).

**Action:** `POST /v1/auth/signup` with a fresh test email, a policy-valid password, and a
valid Turnstile token.

**Expected outcomes:**

- The response is `500`, not `202` — the send failure propagates rather than being
  swallowed.
- The response body and the API log do not contain the six-digit passcode or the
  `SENDGRID_API_KEY` value — only the SendGrid response status and error text appear.
- Per TD-97, the OTP row was still written before the failed send: a `resend-otp` for the
  same address within the next 60 seconds also answers without issuing a fresh code
  (the cooldown is already running).
