# Password reset by emailed link (backend)

No GitHub Issue yet. Closes the reset half of TD-85 and the password-reset half of TD-80.
Branch: `feature/forgot-password`, cut from `main` at `45845a4e`.

Spec: [`api-authorization-password-reset.md`](../../product-specs/api-authorization-password-reset.md),
with endpoint rows and the `accounts.password_changed_at` column in
[`api-authorization.md`](../../product-specs/api-authorization.md).

## Scope

In scope, agreed with the requester on 2026-10-14:

- `POST /v1/auth/forgot-password` — captcha-gated, always `202`, mails a single-use link.
- `POST /v1/auth/reset-password` — consumes the link and installs a new password, `204`.
- Revoke every existing session on reset.
- A "your password was changed" notice after a successful reset.
- A per-client-address limit on `forgot-password`.
- The link TTL as an env var (`PASSWORD_RESET_TTL_MINUTES`, default 30).

Out of scope: frontend wiring (no Figma for the post-submit or set-new-password screens, TD-71),
authenticated change-password (TD-85), per-session logout (TD-80).

## Decisions

| # | Decision | Why |
| --- | --- | --- |
| 1 | Reuse `otp_codes` with purpose `PasswordReset`; widen its CHECK. | The cooldown, supersede and row-lock logic already exist there (`OtpRepo::issue_for`), and TD-85 asked for exactly this. |
| 2 | Token = 32 OS-RNG bytes, hex; store `sha256(token)` unsalted, unique partial index on it. | The request carries no address, so the row must be found by hash alone. A 256-bit token has nothing to brute-force, so there is no attempt budget. |
| 3 | Link `{APP_BASE_URL}/reset-password#token=…`. | The fragment never reaches a server, so it stays out of access logs and `Referer`. |
| 4 | `APP_BASE_URL` required unless `EMAIL_DEV_LOG=true` (falls back to `http://localhost:5173`). | Same rule as `SENDGRID_API_KEY`: mailing broken links is worse than refusing to boot. |
| 5 | The `forgot-password` lookup, issue and send run in a spawned task after the `202`. | Otherwise latency (the SendGrid round trip) and a send failure (`500`, TD-96) would separate registered addresses from unregistered ones. |
| 6 | Only verified, active accounts with an email get a link. | An unverified account has no password yet and resumes signup instead. A suspended account could not sign in anyway. |
| 7 | Per-client limit: 10 per hour, `login_attempts` scope `password_reset_ip`. | Its own scope so it never shares a budget with sign-in. `429` is safe because the count is taken before the lookup. |
| 8 | Reset checks policy, then token shape, then that the token is live, then hashes, then consumes and installs in one transaction. | A weak password does not burn the link. A dead token costs no Argon2 work. Consumption is a conditional `UPDATE`, so concurrent replays cannot both win. |
| 9 | Session cut-off: `accounts.password_changed_at`, set from the API clock. `AuthClaims` refuses `iat < floor(changed_at)` with a `401`. | `AuthClaims` already reads the account on every request. Using the clock that sets `iat` avoids DB/API skew. A strict `<` keeps a sign-in in the same second as the reset valid. |
| 10 | Reset returns `204` and issues no token. | Keeps the reset path from becoming a second way to mint a session. The user signs in normally. |
| 11 | Both reset emails log on failure and are never surfaced. | Forgot: see 5. Changed: the reset already committed, so a `500` would be a lie. |

## Implementation

- `packages/shared/migrations/20261014000001_password_reset.sql`
- `packages/shared/src/otp_repo.rs` — `issue_for`, `issue_password_reset`, `is_live_password_reset`
- `packages/shared/src/account_repo.rs` — `AccountSession`, `find_session`, `reset_password_consuming_token`
- `packages/shared/src/login_attempt_repo.rs` — `AttemptScope::PasswordResetIp`
- `packages/shared/src/email/mod.rs` — `render_password_reset_email`, `render_password_changed_email`
- `packages/api/src/password_reset.rs` — token, hash, limits, eligibility, `PasswordResetConfig`
- `packages/api/src/routes/auth/password_reset.rs` — the two handlers
- `packages/api/src/account_status.rs` / `auth.rs` — `gate_session`, `RequestRefusal::IssuedBeforePasswordChange`
- `packages/api/src/main.rs`, `lib.rs` — config wiring, `AppState::password_reset`

## Test Strategy

Pure unit tests, the repo's convention (CI has no Postgres):

- `packages/api/tests/password_reset.rs` — token shape and entropy, hash vector, malformed tokens,
  eligibility, per-client limit, every config rule, link format.
- `packages/api/tests/account_status.rs` — `gate_session`: no reset, before / same second / after the
  reset, suspended, unknown, and the `401` mapping.
- `packages/api/tests/auth_router.rs` — both routes are in the router and the OpenAPI bundle.
- `packages/shared/tests/email_password_reset.rs` — both templates.

**Manual verification (2026-10-15, local Postgres 17 via Swagger).** The migration applied on boot
over a DB at `20261005000001`. A full forgot → reset round trip passed: the link was mailed (dev log), the reset returned `204`, the
old token got `401` on `GET /v1/lps/me`, the old password was refused and the new one accepted, a
replayed link got `401`, and the "password changed" notice was logged. Unknown email → `202`, junk
token → `401`, weak password → `400`.

## Deploy notes

- Set `APP_BASE_URL` in every environment that sends real mail, or the API refuses to boot.
- The frontend must add a `/reset-password` route that reads `token` from the URL fragment.
