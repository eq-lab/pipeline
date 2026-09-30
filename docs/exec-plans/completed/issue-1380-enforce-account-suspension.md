# Issue #1380: Backend: enforce accounts.status = 'Suspended' in authorization

Source: https://github.com/eq-lab/pipeline/issues/1380

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` § "Security Considerations" and
`docs/product-specs/api-authorization.md` — the KYB spec is **not on `main`**; it
rides open PR #1382 on branch `docs/kyb-review-lifecycle`. Read it with
`git show origin/docs/kyb-review-lifecycle:docs/product-specs/kyb-lp-verification.md`.

## Scope

Make `accounts.status = 'Suspended'` actually stop a caller. Today the column is
written by nothing (sibling #1274 adds the write) and read by nothing on the
authorization path: `AuthClaims` (`packages/api/src/auth.rs`) decodes the JWT and
stops there, so a suspended account keeps working for the full 24-hour life of its
stateless token, and — for wallet credentials — keeps working after that too,
because `POST /v1/auth/verify` never looks at the account row either.

In scope:

1. A single pure statement of the policy, in a new `packages/api/src/account_status.rs`.
2. A per-request check inside the `AuthClaims` extractor, so every bearer-protected
   route closes at once and suspension bites on the **next request**, not the next login.
3. A mint-time check on both token paths — `POST /v1/auth/verify` (wallet) gains one;
   `POST /v1/auth/login` (email) already has one and is only re-pointed at the moved
   helper and given a stable error code.
4. A refusal a client can tell apart from "lacks the role": `403 {"error":"account_suspended"}`.
5. `AccountRepo::find_status` — a narrow `SELECT status` so the per-request read does
   not pull the Argon2 hash into memory on every authenticated call.
6. Doc updates: the TD-80 entry, `api-authorization.md`, `lp-onboarding.md`,
   `packages/api/src/auth.rs` module doc.

Out of scope — the rest of TD-80, explicitly, per the Issue:

- Refresh tokens / shortened access-token TTL.
- A `sessions` table, logout, "sign out everywhere".
- Password-reset session revocation (there is no password reset yet either — TD-85).
- An admin endpoint to set `Suspended`. It stays a manual `UPDATE`, plus #1274's write.

Out of scope — sibling sub-issues of #1376, do not touch:

- #1274 — the KYB state machine and the `Suspended` **write** itself.
- #1377 — `notify_on_review` and the narrowed write freeze.
- #1378 — decision emails.
- #1379 — ungating `link-address`.

Out of scope — frontend. Nothing in `packages/frontend` needs to change for this to
work (see "What else starts working"), but a suspended *mid-session* LP currently
sees generic error copy. See Open Questions.

## The decision: check in the extractor, and at both mints

**Chosen: shape 1 (the `AuthClaims` extractor), hardened into a pair — extractor
check *and* token-issue check on every mint path.** Rejecting shape 2 (LP routes only).

### What the extractor check actually costs

Counted, not hand-waved:

- **19 handlers take `AuthClaims` today**, across 6 route modules and 18 distinct
  route entries (`/v1/loan-book/{loan_id}/transfers` shares a path across `GET`/`POST`):
  - `routes/lps.rs` — 8: `list_lps`, `get_lp`, `review_document`, `get_my_lp`,
    `upsert_my_lp`, `upload_my_documents`, `delete_my_document`, `link_address`
  - `routes/loan_book.rs` — 4: `submit_loan`, `resubmit_loan`, `review_submission`,
    `complete_disbursement`
  - `routes/collateral_valuation.rs` — 2: `submit_assay`, `submit_offtake`
  - `routes/loan_transfers.rs` — 2: `get_loan_transfers`, `upsert_loan_transfers`
  - `routes/lp_ledger.rs` — 2: `get_lp_ledger`, `record_deposit`
  - `routes/ramp.rs` — 1: `review_ramp_event`
- That is 19 of roughly 48 handlers in the API. **The API's actual traffic is in the
  other 29**: `/v1/stats*`, `/v1/dashboard/*`, `/v1/pnl`, `/v1/positions/history`,
  `/v1/portfolio`, `/v1/analytics/requests`, `/v1/capital-allocation`,
  `/v1/financial-position`, `/v1/withdrawal-queue`, the voucher routes, the KYC
  routes and the webhook. None of them takes `AuthClaims`, so none of them pays
  anything here. The "hot path of every authenticated endpoint" is entirely
  staff-facing (trustee/originator writes) plus the LP owner's own `/v1/lps/me*`.
- **Every one of those 19 handlers already performs at least one database query**,
  most of them several. The extractor adds one primary-key lookup
  (`SELECT status FROM accounts WHERE id = $1`) on a table whose size is the number
  of registered accounts — hundreds to low thousands at LP scale — served by the
  `accounts_pkey` btree from `20260922000001_accounts_email_password_auth.sql`. The
  planner cost is noise; the real cost is one pool checkout plus one round trip,
  sub-millisecond against a co-located Postgres.
- **Worst relative case is the best argument.** `GET /v1/lps/me` is the closest thing
  to a hot authenticated path — the LP app calls it after sign-in and on every session
  restore. It already does one `lps` lookup, one `kyb_documents` listing, and **one S3
  presign per document**. One extra PK read is a rounding error against that. The
  multipart upload route (`POST /v1/lps/me/documents`) writes to object storage; same
  conclusion.
- **Pool pressure** rises by one connection-hold per authenticated request. Across 19
  low-frequency routes this is not a capacity concern; it is worth one sentence and
  no more.

### Why not shape 2 (LP routes only)

- It does not close the gap this repo actually has. `accounts.status` is not
  KYB-specific: `docs/product-specs/lp-onboarding.md` § 110 and
  `docs/product-specs/operations-console.md` § 18 both describe a **single team member
  suspending an operator account immediately** for suspected compromise or staff
  offboarding. Those accounts hold `trustee` / `originator` roles and their live
  surface is `loan_book`, `collateral_valuation`, `ramp`, `lp_ledger`,
  `loan_transfers` — every module shape 2 leaves open. An incident-response lever
  that works on LP routes only is not an incident-response lever.
- It is not even cheaper by much. The `/v1/lps` group has 8 authenticated handlers;
  only 5 of them route through `my_lp`, so the trustee-side three (`list_lps`,
  `get_lp`, `review_document`) would each need the check repeated by hand — four
  edit sites instead of one, for three quarters of the reads.
- It puts the rule in the place a future route forgets to repeat it, which is exactly
  the failure mode that produced this Issue: `lps.owner_account_id`-based
  authorization was centralised and `accounts.status` was not.

### The shapes considered and rejected, so the binary is not false

- **Token-issue check only (no extractor read).** Insufficient on its own by
  definition: it does nothing about the up-to-24-hour window after a *live* session's
  account is suspended, which is the entire complaint. Kept as the *second* half of
  the chosen pair, not as an alternative to the first.
- **Carry `status` in the JWT claims.** A snapshot taken at mint time — identical to
  today's 24-hour staleness, with extra claim surface. Rejected.
- **Short-TTL in-process cache of the status.** Reintroduces a staleness window (the
  exact bug), adds invalidation state, is per-replica so it does not even behave
  consistently across instances, and buys nothing measurable against a sub-millisecond
  PK read. Rejected — and the rejection is the point: a cache here would quietly
  recreate TD-80 in miniature.
- **Shorten the token TTL instead.** That is the refresh-token work, explicitly out of
  scope, and it still leaves a window.
- **Per-request memoisation via `parts.extensions`.** Genuinely unnecessary today: no
  handler takes `AuthClaims` twice and none re-reads `accounts`, so there is nothing to
  deduplicate. Noted as the obvious extension point if a future `AuthAccount` extractor
  wants the row rather than just the status — do not build it now.

### Chosen behaviour, precisely

| Path | Condition | Response |
|---|---|---|
| Any bearer route (the extractor) | account row resolves, `status != 'Active'` | `403 {"error":"account_suspended"}` |
| Any bearer route (the extractor) | token decodes but `account_id` resolves to no row | `401 {"error":"invalid or expired token"}` — fail closed |
| Any bearer route (the extractor) | the status read errors | `500` via `ApiError::Internal` — fail closed |
| `POST /v1/auth/login` | account suspended | `403 {"error":"account_suspended"}` (today: `"account is suspended"`) |
| `POST /v1/auth/verify` (wallet) | account suspended | `403 {"error":"account_suspended"}` (new) |
| `POST /v1/auth/verify-otp` | account suspended | unchanged: the uniform `401 "invalid or expired code"` (see Open Questions) |

Distinguishable from a role failure: every role guard answers
`403 {"error":"this endpoint requires the \`trustee\` role"}` (`routes/common.rs:51`,
`routes/lps.rs:1043`, and six more). `account_suspended` is a bare machine code, the
same convention as the existing `403 email_not_verified` on login, which the frontend
already string-matches.

`403` rather than `401` because the caller *is* authenticated — the credential is
valid and the principal is known; it is the principal that may not act. This also
matches what the spec already states for login.

## Assumptions and Risks

- **#1274 is the only producer of `Suspended` and is not merged.** Nothing writes the
  column today, so this change is inert on `main` until #1274 lands (or an operator
  runs the manual `UPDATE`). It is independently correct and independently
  mergeable — but it cannot be demonstrated end-to-end without one of those two. The
  manual verification below uses the `UPDATE`.
- **The KYB spec is on an unmerged branch.** `docs/product-specs/kyb-lp-verification.md`
  does not exist on `main`; its Security Considerations bullet says suspension "is only
  meaningful once request authorization reads that column — see TD-80". Do **not**
  create or edit that file on this branch — it would collide with PR #1382. At
  implementation time: if #1382 has merged and the file is on `main`, update the
  bullet's tail (step 8b); if not, say in the PR description that #1382's bullet needs
  the one-line follow-up.
- **`docs/exec-plans/tech-debt-tracker.md` contains a duplicated block.** The file has
  **two** `## Post-MVP` sections (lines 1462 and 1499) and consequently **two
  byte-identical TD-80 "Email/password sessions cannot be revoked" entries** (lines
  1471 and 1508), plus a third, unrelated frontend `TD-80: Wallet-namespace labels
  diverge three ways` at line 1268 in `## Known Gaps`.
  - **The live entry is the one at line 1508**, inside the second `## Post-MVP` block —
    that is the block that continues through TD-97 (the SendGrid entries from #1368,
    the most recent work). The first block is a stale merge artifact: it stops at a
    TD-82 that is itself a duplicate of the frontend TD-82 at line 1290, and its TD-81
    carries superseded wording ("No rate limiting on signup / resend-otp" vs. the live
    "No rate limiting on the unauthenticated auth endpoints").
  - Because the two TD-80 bodies are identical, an `Edit` anchored on the TD-80 text
    alone will be **ambiguous and will fail**. Anchor the edit on enough following
    context to be unique — include the live block's next heading,
    `### TD-81: No rate limiting on the unauthenticated auth endpoints`.
  - Do **not** renumber anything, do not delete the stale block, and do not close
    TD-80. Log the duplication instead (step 9).
- **The extractor's failure mode moves earlier.** With a DB read in the extractor, a
  Postgres outage turns an authenticated request into a `500` before the handler runs.
  Not a regression in outcome — all 19 handlers already hit the DB and would have
  failed anyway — but it must fail **closed**: never wave a request through because the
  status could not be read.
- **Suspending a wallet-credentialed account now locks out a trustee/originator.** That
  is the intended behaviour and the whole point of the operator flow, but it is a real
  operational lever with no admin UI and no "unsuspend" endpoint. Reversal is a manual
  `UPDATE accounts SET status = 'Active'`. Call this out in the PR description.
- **`auth_users.account_id` is `NOT NULL` with an FK**, and the migration backfilled an
  account for every pre-existing wallet row, so no wallet credential can reach the
  extractor without an `accounts` row. The `None` branch is therefore defensive, not a
  live path — keep it anyway, failing closed.
- **Testability is limited by the repo's own rule** (no test may reach a real Postgres,
  no `DATABASE_URL`/`POSTGRES_URL`). The DB read in the extractor is consequently not
  unit-testable. The plan's response is to make the *decision* a pure function and the
  extractor a three-line caller, so the untested surface is wiring only. See Test
  Strategy — this is stated honestly there, not glossed.
- **No per-route OpenAPI churn.** Adding `403 account_suspended` to all 19 `#[utoipa::path]`
  blocks would be a large, low-value diff. State it once in `auth.rs`'s module doc and
  once in `api-authorization.md` instead, as a property of the bearer scheme.

## Open Questions

1. **Should `POST /v1/auth/verify-otp` surface suspension, or keep its uniform `401`?**
   It already refuses a suspended account via `gate_token_issue(&account, false)` but
   maps every failure to the shared `"invalid or expired code"` — a deliberate choice to
   stop the endpoint being an enumeration oracle. By the time that gate runs the caller
   has already matched the passcode hash, so a distinct `403 account_suspended` would
   leak nothing they do not already know (the same reasoning that justifies login's
   `403 email_not_verified`). **The plan's default is to change nothing here**, because
   the uniform `401` was a considered decision and a suspended account reaching
   verify-otp is close to unreachable (suspension arrives via KYB `Failed`, which
   requires an already-verified account). Confirm, or say to surface it.
2. **Does `POST /v1/auth/login`'s suspended message get the new code?** The plan
   unifies it to `account_suspended` so the condition has one spelling across the
   extractor and both mints. This does **not** break the frontend: `useEmailAuthFlow.ts`
   routes any login `403` that is not `email_not_verified` to the "This account is
   suspended. Contact support." copy, so it is message-agnostic. The only trace of the
   old string is an input fixture at `packages/frontend/src/components/EmailAuthFlow.test.tsx:211`
   (`new ApiError(403, "account is suspended")`), which the plan updates for accuracy.
   Confirm that touching one frontend test fixture from a backend issue is acceptable,
   or say to leave login's message as-is and accept two spellings.
3. **Should a follow-up frontend issue be filed for mid-session suspension?** After this
   lands, an LP suspended while signed in gets `403 account_suspended` from
   `GET /v1/lps/me` and every other authenticated call, and the LP app will render it
   as a generic request failure with a stale session still in `localStorage`. The
   correct behaviour — clear the session and show the suspended copy — is frontend work
   and out of scope here. Should the manager file it as a new sub-issue, or is the
   generic failure acceptable until the LP-side UI work is filed?
4. **Merge ordering against #1274.** This can merge before #1274 (it is inert but
   correct) or after. There is no window either way — #1274 without #1380 is today's
   status quo, #1380 without #1274 is a gate nothing trips. Confirm there is no
   preference; the plan assumes independent merge.

## Implementation Steps

### 1. `shared::account_repo` — one predicate, one narrow read

`packages/shared/src/account_repo.rs`:

- Add a free function beside `Account`, so the rule has exactly one statement that both
  a loaded `Account` and a bare column value can use:

  ```rust
  /// The only `accounts.status` value that may act. Anything else — including a
  /// value the CHECK constraint does not know about — is refused, so an
  /// unrecognised status fails closed.
  pub fn is_active_status(status: &str) -> bool {
      status == "Active"
  }
  ```

- Change `Account::is_active` to delegate: `is_active_status(&self.status)`.
- Add the narrow read used by the extractor:

  ```rust
  /// Just the status, for the per-request authorization check. Deliberately not
  /// `find`: that pulls `password_hash` into memory, and the hot path has no
  /// business holding credential material it will not use.
  pub async fn find_status(&self, id: Uuid) -> Result<Option<String>, sqlx::Error> {
      let row: Option<(String,)> = sqlx::query_as("SELECT status FROM accounts WHERE id = $1")
          .bind(id)
          .fetch_optional(&self.pool)
          .await?;
      Ok(row.map(|r| r.0))
  }
  ```

No migration. `accounts.status` is `NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Suspended'))`
and `accounts.id` is the primary key (btree), both from
`packages/shared/migrations/20260922000001_accounts_email_password_auth.sql`.

### 2. New module `packages/api/src/account_status.rs`

Register it in `packages/api/src/lib.rs` as `pub mod account_status;` (alphabetically
first, before `pub mod auth;`).

Contents — all pure, no IO, no `AppState`:

```rust
//! The single statement of the `accounts.status` authorization policy.
//! Spec: docs/product-specs/api-authorization.md § Security Considerations.

pub const ACCOUNT_SUSPENDED: &str = "account_suspended";

/// Why an account may not be handed a token. Moved here from
/// `routes::auth::password` so the wallet and email mints state one rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenRefusal { Suspended, EmailNotVerified }

/// Why an authenticated request may not proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestRefusal { Suspended, UnknownAccount }

pub fn gate_token_issue(account: &Account, require_verified_email: bool) -> Option<TokenRefusal>;

/// The per-request gate. `None` is a token naming an account that no longer
/// resolves — refused, because failing open on a missing principal is the one
/// outcome that must never happen.
pub fn gate_request(status: Option<&str>) -> Option<RequestRefusal>;

impl From<TokenRefusal> for ApiError;    // Suspended -> Forbidden(ACCOUNT_SUSPENDED)
                                          // EmailNotVerified -> Forbidden("email_not_verified")
impl From<RequestRefusal> for ApiError;  // Suspended -> Forbidden(ACCOUNT_SUSPENDED)
                                          // UnknownAccount -> Unauthorized("invalid or expired token")
```

`gate_token_issue` moves **verbatim** from `packages/api/src/routes/auth/password.rs:152-168`
(the `TokenRefusal` enum and the function). Delete both from `password.rs`; do not leave a
re-export, so there is one import path.

### 3. The `AuthClaims` extractor reads the status

`packages/api/src/auth.rs`:

- Keep `extract_claims` exactly as it is — it stays synchronous, so the `&mut Parts`
  borrow never crosses an `await`.
- Rewrite the `FromRequestParts` body to decode first and read second:

  ```rust
  fn from_request_parts(
      parts: &mut Parts,
      state: &Arc<AppState>,
  ) -> impl Future<Output = Result<Self, Self::Rejection>> {
      let decoded = extract_claims(parts, state);
      let state = state.clone();
      async move {
          let AuthClaims(claims) = decoded?;
          let status = state.account_repo.find_status(claims.account_id).await?;
          if let Some(refusal) = gate_request(status.as_deref()) {
              return Err(refusal.into());
          }
          Ok(AuthClaims(claims))
      }
  }
  ```

  `?` on the `sqlx::Error` uses the existing `From<sqlx::Error> for ApiError`, so a read
  failure becomes `500` and never a pass.

- Update the `AuthClaims` doc comment and the module header: the extractor now also
  rejects with `403 account_suspended` when the token's `account_id` names a suspended
  account, and every bearer-protected route inherits that without any change of its own.
  Delete the module header's implication that validation is signature + expiry only.

No handler signature changes. All 19 call sites keep `AuthClaims(claims): AuthClaims`.

### 4. Wallet login refuses a suspended account

`packages/api/src/routes/auth/wallet.rs`, in `verify`, after `clear_nonce` and before
minting:

```rust
let status = state.account_repo.find_status(user.account_id).await?;
if let Some(refusal) = gate_request(status.as_deref()) {
    return Err(refusal.into());
}
```

Reuse `gate_request`, not `gate_token_issue`: a wallet-only account has
`email_verified_at IS NULL` by construction, so the email-verification arm must not
apply here. Add a short comment saying exactly that, and add
`(status = 403, description = "The account behind this wallet is suspended")` to the
`#[utoipa::path]` responses for `/v1/auth/verify`.

Deliberately **not** checked in `challenge`: it mints nothing, so the second read would
buy no security — only a slightly earlier refusal, at the cost of doubling the read on
the login flow. A suspended operator therefore signs a message and is refused at
`verify`. Note this in the handler comment so it reads as a decision, not an omission.

### 5. Email login re-points at the moved helper

`packages/api/src/routes/auth/password.rs`:

- Import `gate_token_issue` / `TokenRefusal` from `crate::account_status`.
- In `login`, replace the hand-rolled match arms with `Err(refusal.into())` using the new
  `From<TokenRefusal> for ApiError`. Net behaviour change: the suspended message becomes
  `account_suspended` instead of `account is suspended`; `email_not_verified` is byte-identical.
- Leave `verify_otp`'s `gate_token_issue(&account, false).is_some()` → shared `401` exactly
  as it is (Open Question 1).
- Update the `login` `#[utoipa::path]` `403` description to name both codes.

### 6. Frontend fixture accuracy (one line, optional per Open Question 2)

`packages/frontend/src/components/EmailAuthFlow.test.tsx:211` — change the mocked
rejection from `new ApiError(403, "account is suspended")` to
`new ApiError(403, "account_suspended")`. The assertion (the rendered copy) does not
change; only the fixture's fidelity to what the API now returns. No production frontend
code changes.

### 7. Tests

See Test Strategy. New file `packages/api/tests/account_status.rs`; edits to
`packages/api/tests/auth_signup.rs`.

### 8. Docs

a. `docs/product-specs/api-authorization.md`

   - The paragraph at line 75 currently reads "Tokens cannot be revoked … suspending an
     account takes up to 24 hours to bite. See TD-80." Rewrite: tokens still cannot be
     revoked individually — no refresh token, no session table, no logout, and a password
     reset still does not end a live session — **but suspension is no longer a token
     property**. `accounts.status` is read on every bearer-authenticated request, so
     `Suspended` takes effect on the caller's next request, whatever their token's
     remaining life. TD-80 stays open for the revocation half.
   - The "To protect a new endpoint" paragraph: add that `AuthClaims` also answers
     `403 {"error":"account_suspended"}` for a suspended principal, so a new route
     inherits the rule by taking the extractor and needs no check of its own.
   - The API contract table: `POST /v1/auth/verify` gains `403` for a suspended account;
     `POST /v1/auth/login`'s `403` for a suspended one is now spelled `account_suspended`.
   - The Security Considerations bullet at line 198 ("no refresh or revocation list, so
     privilege changes take effect on the next login") — narrow it: *role* changes still
     take effect on the next login (roles are a claim); *suspension* takes effect on the
     next request.

b. `docs/product-specs/kyb-lp-verification.md` — **only if PR #1382 has merged** and the
   file is on `main`. Its Security Considerations bullet ends "…which is only meaningful
   once request authorization reads that column — see TD-80." Replace the tail: request
   authorization now reads it on every authenticated request, so a terminal refusal ends
   the applicant's access from its next call. If the file is not on `main`, change
   nothing and say so in the PR description.

c. `docs/product-specs/lp-onboarding.md` line 189 — "Email sessions cannot currently be
   revoked … suspending an account does not take effect immediately. Tracked as TD-80."
   Split it: session revocation (password reset, logout) is still missing and still TD-80;
   suspension now does take effect immediately, on the next request, for wallet and email
   credentials alike.

d. `packages/frontend/src/api/README.md` lines 82–83 — note the `account_suspended` code
   on login's `403` alongside `email_not_verified`.

### 9. Tech debt

- **Edit the live TD-80 only** — `docs/exec-plans/tech-debt-tracker.md` **line 1508**, in
  the second `## Post-MVP` block. Anchor the edit so it cannot match the stale duplicate
  at line 1471: include the following heading
  `### TD-81: No rate limiting on the unauthenticated auth endpoints` in the match, which
  appears only in the live block.

  Change the **Gap** and **Impact** to record the split, and do **not** close the entry:
  - Gap: still no refresh token, no `sessions` table, no logout endpoint; an issued token
    still cannot be invalidated before it expires.
  - Impact: a password reset still does not end an attacker's existing session — that half
    is untouched. **Closed by #1380:** suspension no longer waits for the token to expire.
    `AuthClaims` reads `accounts.status` on every bearer request, and both mints refuse a
    suspended account, so `Suspended` bites on the next request.
  - Suggested fix: unchanged, minus the `accounts.sessions_valid_after` sentence's
    suspension justification — the remaining case for it is password-reset and
    sign-out-everywhere revocation.

- Do **not** renumber, do **not** delete the stale block, do **not** touch the unrelated
  frontend TD-80 at line 1268.

- Log the tracker's own corruption in `docs/exec-plans/known-bugs.md` (per AGENTS.md:
  discovered, unrelated, do not fix inline) as **BUG-24** under `## Open`, in the file's
  documented `### BUG-<N>` format — the highest existing id is BUG-23, so re-check before
  writing in case another branch claimed 24 first. Location
  `docs/exec-plans/tech-debt-tracker.md`, symptom "two `## Post-MVP` sections (lines 1462
  and 1499) with byte-identical duplicate TD-80/TD-81/TD-82 entries; the first block is a
  stale merge artifact whose TD-81 carries superseded wording and whose TD-82 duplicates a
  frontend entry", root cause "a merge that appended rather than reconciled the backend
  Post-MVP block", workaround "treat the second block (line 1499 onward, running through
  TD-97) as live; anchor any edit on the live block's unique neighbouring headings".

### 10. Lint

`cargo clippy --all -- -D warnings` (Rust changed) and `npx tsx scripts/lint-docs.ts`
(docs and one TS fixture changed). Both must pass before the PR.

## Test Strategy

The repo forbids any test that reaches a real Postgres — no `DATABASE_URL`, no
`POSTGRES_URL`, no env-var gate — and forbids inline `#[cfg(test)] mod tests` in `src/`.
That has a direct consequence here, stated plainly: **the DB read itself is not
testable.** The plan's answer is to push every judgement into pure functions so the
untestable remainder is three lines of wiring per call site, and to verify that wiring
by hand.

### Pure unit tests — `packages/api/tests/account_status.rs` (new)

Follows `packages/api/tests/auth_signup.rs`: a local `fn account(...) -> Account`
constructor building the struct literally, no pool, no network.

`gate_request` (the extractor's decision):

- `an_active_account_may_act` — `gate_request(Some("Active")) == None`
- `a_suspended_account_is_refused` — `Some("Suspended")` → `Some(RequestRefusal::Suspended)`
- `an_unrecognised_status_is_refused` — `Some("Frozen")`, `Some("active")`, `Some("")` all
  refuse. The lowercase case matters: it pins that the comparison is exact, so a status
  the CHECK constraint does not know about fails **closed** rather than falling through.
- `a_token_naming_no_account_is_refused` — `None` → `Some(RequestRefusal::UnknownAccount)`

`gate_token_issue` (moved from `auth_signup.rs`, keep all four cases, retarget the import):

- suspended + verified + `require_verified_email = true` → `Suspended`
- suspended + unverified + `require_verified_email = false` → `Suspended` (suspension is
  checked on both mint paths, which is what lets wallet `verify` reuse it)
- active + unverified + `true` → `EmailNotVerified`
- active + unverified + `false` → `None`

The refusal → HTTP mapping (pure; `ApiError::into_response` is synchronous, so assert the
status code without reading the body):

- `a_suspended_request_is_a_403` — `ApiError::from(RequestRefusal::Suspended)` matches
  `ApiError::Forbidden(msg)` with `msg == ACCOUNT_SUSPENDED`, and
  `.into_response().status() == StatusCode::FORBIDDEN`
- `an_unknown_account_is_a_401` — `RequestRefusal::UnknownAccount` →
  `ApiError::Unauthorized(_)`, `StatusCode::UNAUTHORIZED`
- `suspension_is_distinguishable_from_a_role_refusal` — the load-bearing assertion of this
  Issue: build the role refusal the guards actually produce
  (`ApiError::Forbidden(format!("this endpoint requires the \`{TRUSTEE_ROLE}\` role"))`)
  and assert its message differs from `ACCOUNT_SUSPENDED` while both are `403`. This is
  what stops a future edit collapsing the two into one indistinguishable string.
- `the_suspended_code_is_the_stable_wire_contract` — `ACCOUNT_SUSPENDED == "account_suspended"`,
  with a comment pointing at `useEmailAuthFlow.ts` and `api-authorization.md`.

### Pure unit tests — `packages/shared/tests/account_status.rs` (new)

- `only_active_may_act` — `is_active_status` over `"Active"` (true) and `"Suspended"`,
  `"active"`, `"ACTIVE"`, `""`, `"Deleted"` (all false).
- `the_account_helper_agrees_with_the_free_function` — an `Account` literal with each
  status returns the same answer from `Account::is_active`, pinning the delegation so the
  two cannot drift.

### Edited — `packages/api/tests/auth_signup.rs`

Retarget the `gate_token_issue` / `TokenRefusal` import from
`pipeline_api::routes::auth::password` to `pipeline_api::account_status`, and **remove** the
four `gate_token_issue` cases (lines ~100–137) now that they live in `account_status.rs`.
Leave the signup-classification, email-normalisation and login-limit tests untouched.

### Edited — `packages/api/tests/auth_router.rs`

No change expected; it builds the merged auth router and the OpenAPI bundle. Re-run it —
it is the cheap canary for a broken `#[utoipa::path]` edit in step 4 or 5.

### Not covered by tests, and verified by hand instead

Named explicitly rather than implied:

1. That `AuthClaims` actually calls `find_status` with `claims.account_id`.
2. That `find_status`'s SQL is correct.
3. That wallet `verify` refuses before minting.

Manual verification (a human, against their own local stack — no test may do this):

```bash
# 1. Sign in normally (email or wallet) and keep the token.
# 2. Suspend the account behind it, in the local dev Postgres:
#      UPDATE accounts SET status = 'Suspended' WHERE id = '<account_id>';
# 3. Replay any authenticated request with the SAME token — no re-login:
curl -i -H "Authorization: Bearer $TOKEN" localhost:8080/v1/lps/me
#    expect: HTTP/1.1 403  {"error":"account_suspended"}
# 4. Try to mint a fresh token:
curl -i -sX POST localhost:8080/v1/auth/login -H 'content-type: application/json' \
     -d '{"email":"…","password":"…"}'
#    expect: HTTP/1.1 403  {"error":"account_suspended"}
#    (wallet: complete the challenge/verify pair — expect 403 at /v1/auth/verify)
# 5. Confirm a role refusal is still distinct, on a trustee route with a
#    non-trustee ACTIVE token:
#    expect: HTTP/1.1 403  {"error":"this endpoint requires the `trustee` role"}
# 6. Restore: UPDATE accounts SET status = 'Active' WHERE id = '<account_id>';
#    the same token from step 1 works again immediately — proving the check is
#    per-request, not per-token.
```

Step 6 is the one that demonstrates the actual claim of this Issue: no re-login, no
waiting out a TTL. Record the outcome in the PR description.

## Docs to Update

- `docs/product-specs/api-authorization.md` — revocation paragraph (line ~75), the
  "protect a new endpoint" paragraph, the API contract rows for `/v1/auth/verify` and
  `/v1/auth/login`, and the Security Considerations "short lifetime" bullet (line ~198).
- `docs/product-specs/lp-onboarding.md` line 189 — split revocation from suspension.
- `docs/product-specs/kyb-lp-verification.md` § Security Considerations — **only if PR
  #1382 has merged**; otherwise note the follow-up in the PR description.
- `docs/exec-plans/tech-debt-tracker.md` — the **live** TD-80 at line 1508 only; record
  what #1380 closed and what remains. Do not close, do not renumber.
- `docs/exec-plans/known-bugs.md` — new entry for the tracker's duplicated `## Post-MVP`
  block.
- `packages/api/src/auth.rs` — module doc and the `AuthClaims` doc comment.
- `packages/frontend/src/api/README.md` lines 82–83 — the `account_suspended` code.

No generated docs change: the OpenAPI bundle is built from the `#[utoipa::path]`
annotations, and only the two auth-route blocks gain a line.

## What else starts working as a side effect

Worth stating, because this Issue reads as KYB-specific and is not:

- **Operator suspension becomes real.** `docs/product-specs/lp-onboarding.md` § 110 and
  `docs/product-specs/operations-console.md` § 18 both promise that a single team member
  can suspend an account immediately — for suspected compromise or staff offboarding —
  and that suspended accounts cannot log in. Until now that promise had no enforcement
  anywhere in the API. After this, the manual `UPDATE accounts SET status = 'Suspended'`
  is a working incident-response lever that cuts a compromised staff session off at its
  next request.
- **Wallet-credentialed accounts become suspendable at all.** `POST /v1/auth/verify`
  never read `accounts`, so a suspended trustee or originator could keep signing in
  indefinitely — the suspension column simply did not exist on that path. This is the
  larger of the two gaps and is not mentioned in the Issue's framing.
- **Every future bearer-protected route inherits the rule.** Because the check sits in
  the extractor, a route added next quarter is covered by taking `AuthClaims`, with
  nothing to remember.
- **Half of TD-80 closes.** The "suspending an account takes up to 24 hours to bite" half
  is gone. The "a password reset does not end an attacker's existing session" half is
  untouched and stays open, along with logout and sign-out-everywhere.

What does **not** start working, so the PR description does not overclaim: there is still
no admin endpoint to suspend an account (it is a manual `UPDATE`, plus #1274's write);
there is still no password reset (TD-85), so the reset-revocation case remains hypothetical;
and roles still live on the wallet credential rather than the account (TD-84), so
suspension and role-holding remain governed by two different tables.
