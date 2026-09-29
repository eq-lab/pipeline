# Issue #1368: Backend: wire SendGrid as the transactional email provider (OTP delivery)

Source: https://github.com/eq-lab/pipeline/issues/1368

## Scope

Replace the unconditional `LoggingEmailSender` with a real SendGrid delivery path, behind
required configuration.

In scope:

1. `SendGridEmailSender` — `POST {base}/v3/mail/send`, bearer `SENDGRID_API_KEY`, `reqwest`
   with an explicit timeout and no retry.
2. An `EmailConfig` parsed from the environment on the **required-not-optional** pattern of
   `KybStorageConfig::from_env` (`packages/api/src/config.rs:524`): a missing
   `SENDGRID_API_KEY` **fails boot**. `EMAIL_DEV_LOG=true` is the single explicit escape
   hatch that selects `LoggingEmailSender`.
3. Wiring at `packages/api/src/main.rs:82`.
4. `.env.example` — replace the "Email delivery is NOT configured yet" block (line 50).
5. `docs/product-specs/api-authorization-email.md` — a delivery section; the spec currently
   describes the whole email flow without ever saying how mail leaves the process.
6. `docs/exec-plans/tech-debt-tracker.md` — **TD-96** and **TD-97** (next free numbers;
   confirmed against the file) for the two accepted consequences of keeping `?` on send.

Explicitly out of scope (decided in the Issue, do not re-open):

- **Send failures keep propagating.** `state.email_sender.send(...).await?` at
  `packages/api/src/routes/auth/password.rs:237` and `:511` stays exactly as written. No
  swallow-and-log, no OTP voiding, no outbox. The two consequences are logged as TD-96/TD-97
  instead of fixed.
- The HTML email template (Figma `6486:82159`). Bodies stay the plain text that
  `render_verification_email` / `render_duplicate_signup_email` already produce.
- Retry/outbox infrastructure, rate limiting, inbound mail, bounce webhooks, suppression-list
  handling.
- DNS work (Domain Authentication, DMARC). Human checklist items in the Issue, not code.

No Figma verification step applies: this issue renders no UI, and the one Figma node it
references is the out-of-scope HTML template.

## Assumptions and Risks

- **A new required env var breaks any environment that does not set it.** After this change
  the API refuses to boot without `SENDGRID_API_KEY` or `EMAIL_DEV_LOG=true`. That is the
  point of the issue, but it means every deploy target and any CI job that boots the API
  binary must be updated out-of-band. The repo contains no compose file and no deploy
  manifest (`SPACES_*`, the closest precedent, appears only in `.env.example` and source), so
  the coder cannot make this change in-repo — flag it in the PR description as a deploy
  prerequisite.
- `packages/api/tests/voucher_signing.rs:115` constructs `AppState` with
  `Arc::new(shared::email::LoggingEmailSender)` directly. It never calls `EmailConfig`, so it
  is unaffected — keep it as-is.
- **Tests must not mutate process env.** `std::env::set_var` is racy under the parallel test
  harness and is `unsafe` on 2024-edition toolchains. The config parser is therefore designed
  around an injected lookup (see step 2) so every config test is pure.
- Error reporting must never carry the message body: the verification body contains the live
  passcode. A SendGrid error must surface status + response text only.
- `mockito` is already a `shared` dev-dependency (`packages/shared/Cargo.toml`) and is used
  this way in `packages/shared/tests/metadata_fetcher.rs`. A local mock server is not a live
  SendGrid call and satisfies the "no live provider, no database" rule.
- SendGrid returns `202 Accepted` with an empty body on success. Treat any 2xx as success
  rather than matching `202` exactly.

## Open Questions

_Both resolved by the user on 2026-09-28; recorded here as settled decisions._

- **`SENDGRID_FROM` is required, with no code default.** Anything not in `EMAIL_DEV_LOG`
  mode is sending real mail and must state its sender. A hardcoded default would bake the
  production address into every environment, and a wrong sender fails silently — SendGrid
  accepts the call and the mail is spam-foldered. Missing or blank after `trim()` → `Err`,
  exactly as step 2 already specifies.
- **The PR merges before the deploy secret exists.** The user sets `SENDGRID_API_KEY` on the
  API environment ahead of the next deploy. The PR description must therefore carry the
  deploy prerequisite prominently: a deploy landing between merge and secret will fail to
  boot. That is the intended fail-loud behavior of this issue, not a regression.

## Implementation Steps

1. **Turn the email seam into a module directory.**
   - `git mv packages/shared/src/email.rs packages/shared/src/email/mod.rs`.
   - Add `packages/shared/src/email/sendgrid.rs` and `packages/shared/src/email/config.rs`.
   - `mod.rs` declares `mod config; mod sendgrid;` and re-exports `pub use
     config::EmailConfig; pub use sendgrid::SendGridEmailSender;` so existing import paths
     (`shared::email::{EmailSender, LoggingEmailSender, OutboundEmail,
     render_verification_email, render_duplicate_signup_email}`) keep working with **zero**
     caller edits. `packages/shared/src/lib.rs` already has `pub mod email;` — unchanged.
   - Rewrite the module header in `mod.rs`: the current one says no provider is wired and that
     signup passcodes go to the log. That is now false. Per AGENTS.md, the replacement is at
     most a 2–3 line spec-pointer header (point at
     `docs/product-specs/api-authorization-email.md` and Issue #1368). Strip the per-item doc
     comments on `OutboundEmail`, the renderers and `LoggingEmailSender` while moving the
     file — comment-less code, one header per file, nothing else. This applies to every new
     file in this issue too.

2. **`packages/shared/src/email/config.rs` — configuration.**
   - ```rust
     pub enum EmailConfig {
         DevLog,
         SendGrid { api_key: String, from: String, base_url: String },
     }
     ```
   - `pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self>` holds
     all the logic; `pub fn from_env() -> anyhow::Result<Self>` is a one-line wrapper over
     `|k| std::env::var(k).ok()`. This is what makes the config tests pure.
   - Rules, in this order:
     - `EMAIL_DEV_LOG` truthy (`1` | `true` | `yes`, case-insensitive — match the existing
       idiom at `packages/shared/src/sumsub/config.rs` and `packages/api/src/main.rs`) →
       `DevLog`, and **no other var is read or required**.
     - Otherwise `SENDGRID_API_KEY` and `SENDGRID_FROM` are required and must be non-empty
       after `trim()`. Missing or blank → `Err`, with a message naming the variable and
       stating that `EMAIL_DEV_LOG=true` is the development alternative (mirror the wording
       shape of `KybStorageConfig::from_env`'s `required` closure).
     - `SENDGRID_BASE_URL` defaults to `https://api.sendgrid.com`; strip any trailing `/` so
       `{base}/v3/mail/send` never doubles the slash. `https://api.eu.sendgrid.com` is then a
       pure config change for EU residency.
   - `pub fn sender(self) -> std::sync::Arc<dyn EmailSender>` — `DevLog` →
     `Arc::new(LoggingEmailSender)`; `SendGrid { .. }` → `Arc::new(SendGridEmailSender::new(..))`.
     Log one line at INFO on the chosen mode (mode and base URL only — never the key).

3. **`packages/shared/src/email/sendgrid.rs` — the sender.**
   - ```rust
     pub struct SendGridEmailSender { http: reqwest::Client, base_url: String, api_key: String, from: String }
     ```
   - `pub fn new(base_url: String, api_key: String, from: String) -> Self` builds the
     `reqwest::Client` with `.timeout(Duration::from_secs(10))` and no retry layer. A signup
     request blocks on this call, so it must fail fast — same reasoning as the
     `with_backoffs(vec![])` loan-metadata fetcher at `packages/api/src/main.rs`.
   - A **pure** `pub(crate)`-or-`pub fn payload(&self, email: &OutboundEmail) ->
     serde_json::Value` (make it reachable from `tests/` — so `pub`, re-exported from
     `mod.rs`, or expose it as a free `pub fn` taking `from`) producing the v3 body:
     ```json
     {
       "personalizations": [{ "to": [{ "email": "<email.to>" }] }],
       "from": { "email": "<self.from>" },
       "subject": "<email.subject>",
       "content": [{ "type": "text/plain", "value": "<email.body>" }]
     }
     ```
     Plain text only — `text/plain`, single content entry. Isolating this as a pure function
     is what lets the payload be unit-tested without a server.
   - `#[async_trait] impl EmailSender for SendGridEmailSender`: `POST {base_url}/v3/mail/send`,
     `.bearer_auth(&self.api_key)`, `.json(&payload)`. On a 2xx → `Ok(())`. Otherwise read the
     status and the response text and `anyhow::bail!` with **status + response body only**.
     Never include `OutboundEmail.body` (it holds the live passcode) or the API key in any
     error, log or `context`. A transport error (`reqwest::Error`) gets `.context("sendgrid
     /v3/mail/send request failed")` — also without the message body.

4. **Wire it — `packages/api/src/main.rs`.**
   - Replace `let email_sender: Arc<dyn EmailSender> = Arc::new(LoggingEmailSender);` (line 82)
     with `let email_sender = EmailConfig::from_env()?.sender();`.
   - Move it up next to `let kyb_storage = KybStorageConfig::from_env()?;` so all
     boot-required configuration fails together, before the server binds.
   - Update the import: `use shared::email::{EmailSender, LoggingEmailSender};` →
     `use shared::email::EmailConfig;` (drop `EmailSender`/`LoggingEmailSender` if the
     inferred `Arc<dyn EmailSender>` no longer needs them; keep whatever `AppState`'s field
     type requires and let clippy decide).
   - `AppState.email_sender: Arc<dyn EmailSender>` at `packages/api/src/lib.rs:121` is
     unchanged.

5. **`.env.example`.** Replace the five-line "Email delivery is NOT configured yet" block at
   line 50 with a configured block in the surrounding style (a short rationale comment, then
   the vars):
   - State that `SENDGRID_API_KEY` is **required and fails boot when absent** — deliberately
     *not* the Turnstile/JWT degrade-gracefully pattern immediately above it, because
     degrading here means silently logging passcodes in production.
   - `EMAIL_DEV_LOG=true` — the one escape hatch, for local dev and tests; selects
     `LoggingEmailSender`, which writes the passcode to the log at INFO.
   - `SENDGRID_FROM=no-reply@pipeline.one`.
   - `SENDGRID_BASE_URL=https://api.sendgrid.com` (commented) with a note that
     `https://api.eu.sendgrid.com` pins an EU subuser.
   - Note that delivery also needs Domain Authentication on `pipeline.one`; an unauthenticated
     sender gets spam-foldered, and a spam-foldered passcode with a 60-second TTL is
     indistinguishable from an outage.

6. **Tech debt — append to `docs/exec-plans/tech-debt-tracker.md`** (end of "Known Gaps",
   after TD-95, using the file's documented format, `**Date:** 2026-09-28`):
   - **TD-96: A SendGrid send failure re-opens the signup enumeration oracle.**
     Location `packages/api/src/routes/auth/password.rs:237` (the `NotifyExistingOwner` arm).
     Gap: that arm runs only for addresses holding a *verified* account, and the send is
     propagated with `?`. Impact: a SendGrid rejection of that one recipient (suppression
     list, prior hard bounce) returns `500` where an unregistered address returns `202` — the
     exact "is this address a Pipeline customer?" signal the always-`202` contract exists to
     suppress. Dead code until #1368; provider-triggerable now. Suggested fix:
     swallow-and-log on that arm, or a durable outbox.
   - **TD-97: A failed send burns the passcode and the cooldown.**
     Location `packages/api/src/routes/auth/password.rs:511` (`issue_and_send_passcode`). Gap:
     the `otp_codes` row is written — starting the 60s cooldown — *before* the send. Impact:
     if the send fails the code exists, the cooldown runs, no mail arrives, and `resend-otp`
     answers `202` and mails nothing for the next minute. That is TD-87's dead end, now
     provider-triggerable. Suggested fix: void the OTP row on send failure and swallow-and-log,
     or a durable outbox.
   - Both entries should cross-reference each other and note that one fix covers both.
   - Note in TD-96/TD-97 the sharpened relation to TD-81/TD-86 (unlimited `signup` /
     `resend-otp` now burns send quota and sender reputation, not just CPU) — a mention, not a
     new TD.

7. **Product spec — `docs/product-specs/api-authorization-email.md`.** Add a short
   **"Email delivery"** section after "Bot defense" (which ends around line 105, before
   "Data Model"), in the spec's existing prose voice:
   - SendGrid v3 `mail/send`, one recipient per call, plain text, 10s timeout, no retry.
   - `SENDGRID_API_KEY` is required and **absent means the API does not boot** — contrast it
     explicitly with the `TURNSTILE_SECRET_KEY` paragraph directly above, and say why the two
     differ: an unset captcha secret degrades to open signup, which is loud; an unset mail
     provider degrades to passcodes in the application log, which is silent.
   - `EMAIL_DEV_LOG=true` as the one explicit escape hatch; `SENDGRID_FROM`,
     `SENDGRID_BASE_URL` (EU residency is config, not code).
   - Delivery requires Domain Authentication / DMARC on `pipeline.one`.
   - A send failure surfaces as `500` to the caller, and reference **TD-96 / TD-97** for the
     two consequences that are accepted rather than fixed.

8. **Lint.** `cargo clippy --all -- -D warnings` must pass. No TypeScript changes, so no
   `lint-docs` requirement from code — but run `npx tsx scripts/lint-docs.ts` anyway, since
   this PR edits three docs.

## Test Strategy

New file **`packages/shared/tests/email_sendgrid.rs`** — external test file per the repo
rule; no `#[cfg(test)] mod tests` inside `src/`. No database, no `DATABASE_URL`/`POSTGRES_URL`
or any other env read, no live SendGrid call, no `std::env::set_var`.

Payload construction (pure, no server):

1. `render_verification_email` → payload has exactly one personalization with one `to`
   matching the recipient, `from.email` equal to the configured sender, `subject` equal to the
   rendered subject, and a single `content` entry with `type == "text/plain"` and `value`
   equal to the rendered body verbatim (the passcode survives unmangled).
2. `render_duplicate_signup_email` → same shape; asserts the notice path builds an identical
   envelope, only the copy differs.

Transport, against a `mockito::Server` (pattern: `packages/shared/tests/metadata_fetcher.rs`):

3. Happy path — mock `POST /v3/mail/send` returning `202` with an empty body, asserting
   `Matcher::Exact("Bearer test-key")` on the `authorization` header and
   `application/json` on `content-type`; `send` returns `Ok(())` and the mock asserts it was
   hit exactly once (no retry).
4. Non-2xx — mock returns `403` with a SendGrid-shaped error body; `send` returns `Err`, the
   error text contains the status, and — asserted explicitly — does **not** contain the
   passcode from the message body, nor the API key.
5. Base-URL joining — construct the sender with a `base_url` carrying a trailing slash and
   assert the mock on `/v3/mail/send` (not `//v3/...`) is still hit.

Config parse (pure, via the injected lookup — never the process environment):

6. `EMAIL_DEV_LOG=true` with **no** `SENDGRID_API_KEY` → `Ok(EmailConfig::DevLog)`. Also cover
   `1` and `YES`, and that `EMAIL_DEV_LOG=false` does *not* select it.
7. No `SENDGRID_API_KEY` and no `EMAIL_DEV_LOG` → `Err` — this is the "missing key is a boot
   error" case the Issue names explicitly. Assert the message names `SENDGRID_API_KEY`.
8. `SENDGRID_API_KEY` present but empty/whitespace → `Err`.
9. Missing `SENDGRID_FROM` (with a key present) → `Err`.
10. Key + from, no `SENDGRID_BASE_URL` → `SendGrid` with `base_url == "https://api.sendgrid.com"`.
11. Explicit `SENDGRID_BASE_URL=https://api.eu.sendgrid.com` → honored verbatim, confirming EU
    residency is config rather than a code change.

Regression: `cargo test -p shared` and `cargo test -p api` both stay green;
`packages/api/tests/voucher_signing.rs` keeps constructing `LoggingEmailSender` directly and
must not need an edit.

## Docs to Update

- `docs/product-specs/api-authorization-email.md` — new "Email delivery" section (step 7).
- `docs/exec-plans/tech-debt-tracker.md` — TD-96, TD-97 (step 6).
- `.env.example` — replace the line-50 block (step 5).
- `packages/shared/src/email/mod.rs` — the module header currently asserts no provider is
  wired; it must stop saying that (step 1).
