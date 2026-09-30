# Issue #1378: Backend: KYB decision emails to the LP

Source: https://github.com/eq-lab/pipeline/issues/1378

Part of epic #1376 (KYB review lifecycle). Branch `feat/1378-kyb-decision-emails`, draft PR #1385.

Spec of record: `docs/product-specs/kyb-lp-verification.md` § "Review Notifications". **PR #1382 has
merged** (`d509486`); the file is on `main` and in the working tree. Read it there — the
`git show origin/docs/kyb-review-lifecycle:…` instruction the first revision carried is obsolete.

That spec plus the Issue body is the design of record. Its decisions were settled with the user and
are **not** open for re-litigation:

- Exactly **one** email per trustee decision, and only when the LP's `notify_on_review` is `true`.
- The recipient is the **owning account's verified address** (`accounts.email`), falling back to
  `lps.contact_email` only when that account has none. See Assumptions for the rationale; the spec
  states it in § "Review Notifications" ¶3 and § "Security Considerations" bullet 2.
- **Nothing else notifies.** Per-document reviews deliberately do not.
- Delivery is **best-effort**: the decision is committed first, and a send failure is logged, never
  propagated. A trustee's verdict must not fail because SendGrid is unreachable.
- An email outbox with worker-driven retries is out of scope for this epic; the consequence is
  logged as tech debt instead.

---

## Hard dependencies and merge order

**This issue cannot land alone.** It hooks into an endpoint and reads a column that neither exist
on `main` today.

| Must land first | Why | Plan |
|---|---|---|
| **#1274** — KYB state machine | Creates `POST /v1/lps/{id}/kyb` (the handler this issue extends), the `KybDecision` enum, `LpRepo::decide_kyb`, and the `ChangesRequested` status | `git show origin/feat/1274-kyb-state-machine:docs/exec-plans/active/issue-1274-kyb-state-machine.md` |
| **#1377** — `notify_on_review` | Creates `lps.notify_on_review` and the `LpRow.notify_on_review` field this issue gates on | `git show origin/feat/1377-notify-on-review:docs/exec-plans/active/issue-1377-notify-on-review.md` |

**Order: #1274 → #1377 → #1378 — unchanged.** #1377's plan already recommends #1274 first and itself
second; this issue is strictly last because it consumes the output of both. Both are still
**unmerged**. `feat/1378-kyb-decision-emails` is rebased onto current `main` and **must be rebased
onto both siblings** before implementation — do not start writing code against `main`'s
`routes/lps.rs`, because the handler being edited does not exist there.

### #1379 has merged — compose with it, do not re-plan it

`167caf5` ("Backend: ungate `POST /v1/lps/me/link-address` from `kyb_status`") is on `main` and in
this branch. It touched both files this issue also edits. Re-verified against the files as they now
stand:

- **`with_documents` is unchanged in shape.** It is still one `async fn` at
  `packages/api/src/routes/lps.rs:1104` that reads `state.kyb_document_repo.list_for_lp(lp.id)`
  itself, presigns each row with the `tracing::warn!` degrade-to-`null`, and returns
  `LpResponse::new(lp, documents)`. The split in step 4 applies verbatim.
- **There is now a fifth `with_documents` call site.** `link_address` ends with
  `Ok(Json(with_documents(&state, row).await?))` (`lps.rs:771`), beside the four at `:419`, `:500`,
  `:566` and `:626`. This is exactly why step 4 keeps `with_documents`'s signature unchanged: every
  one of those five, plus the two #1274 adds, compiles untouched.
- **`packages/shared/src/lp_repo.rs` changed around `link_address` / `allows_address_write` only.**
  Nothing this issue reads moved: `LpRow.legal_name`, `LpRow.contact_email` and
  `LpRow.owner_account_id` are still on the row (`lp_repo.rs:137-151`), and `LpRow` still gains
  `kyb_decision_reason` from #1274 and `notify_on_review` from #1377.
- **The module header changed.** `routes/lps.rs`'s **Owner** paragraph and freeze rule 1 now
  describe #1379's address rule. Step 6 edits the **Trustee** paragraph (`lps.rs:23-25`) and must
  still leave the numbered rules alone.
- **`packages/api/tests/lps.rs` gained a `// ── Settlement address (Issue #1379) ──` section** at
  the end, with four OpenAPI-shape tests. Append this issue's tests after it in their own section;
  do not touch that one.

### #1274's plan changed materially — two consequences here

Re-read it at `git show origin/feat/1274-kyb-state-machine:docs/exec-plans/active/issue-1274-kyb-state-machine.md`.

- **There is no audit record anywhere.** The `tracing::info!` line its first revision proposed is
  deleted, for `decide_kyb` and for `review_document` alike, and no tech-debt entry is filed about
  the gap. `kyb_decided_by` / `kyb_decided_at` / `kyb_decision_reason` on the row are the whole
  record of a verdict. **This plan never depended on that log line and does not now.** The
  `tracing::warn!` in step 5 is a delivery-failure log, not an audit record, and TD-98 must not be
  written as if it degrades one — it records that a *lost email* leaves only a log line, which is
  true whether or not the verdict itself is logged.
- **`review_document` now requires the LP to be `UnderReview`.** That narrows when a per-document
  review can happen; it does not change this issue, which still adds **no** notification to
  `review_document`. Manual check 7 (reviewing a document sends no email) must now be run on an LP
  that is `UnderReview`, or the request is refused before it could have mailed anything and the
  check proves nothing.

### Exactly what this issue's diff assumes already exists

From **#1274**, in `packages/api/src/routes/lps.rs`:

- `pub enum KybDecision { Passed, ChangesRequested, Failed }` and `KybDecisionRequest`.
- The route `POST /v1/lps/{id}/kyb` registered in `router()`, and the `decide_kyb` handler with the
  shape its plan specifies: trustee check → `resolve_kyb_decision` → `lp_repo.find(id)` → transition
  check → `pass_blockers` on `Passed` → `lp_repo.decide_kyb(...) -> bool` → **re-read with
  `lp_repo.find(id)`** → `with_documents(...)`.
- That re-read is the hook point: it already produces the fresh `LpRow` this issue needs.

From **#1274**, in `packages/shared`:

- `LpRepo::decide_kyb` is a *conditional `UPDATE`* — it returns `bool` and does **not** return the
  document rows. The rejected-document list is therefore a **separate read**; see step 3.
- `KybStatus::ChangesRequested` exists, and `impl FromStr for DocumentStatus` exists.

From **#1377**, in `packages/shared/src/lp_repo.rs`:

- `LpRow.notify_on_review: bool`, populated by every `SELECT` including `find`.

Also from **#1274**, on `LpRow`: `kyb_decision_reason: Option<String>`, populated by every `SELECT`.
That field — not the request body — is what the email quotes.

Already on `main` and unchanged by either sibling (each re-verified in the working tree):

- `packages/shared/src/email/mod.rs` — the `EmailSender` trait, `OutboundEmail` (derives
  `PartialEq`), and the two renderers this issue's three follow the shape of.
- `packages/api/src/lib.rs:121` — `AppState.email_sender: Arc<dyn EmailSender>`, already wired and
  already constructed in `main.rs:79`/`166`.
- `packages/api/src/lib.rs:112` — **`AppState.account_repo: AccountRepo`**, already on the state.
  The recipient change needs no new wiring.
- `packages/shared/src/account_repo.rs` — `AccountRepo::find(id: Uuid) -> Result<Option<Account>,
  sqlx::Error>`, and `Account { email: Option<String>, email_verified_at: Option<DateTime<Utc>>, … }`
  with `Account::is_email_verified()`. `accounts.email` is `TEXT UNIQUE` **nullable** by migration
  (`20260922000001_accounts_email_password_auth.sql:85`) — a wallet-only account never sets one.
- `packages/shared/src/lp_repo.rs:151` — `LpRow.owner_account_id: Uuid`, already on the row, so the
  account lookup needs no extra join and no new repo method.
- `packages/shared/src/kyb_document_repo.rs` — `KybDocumentRow` (carries `original_filename`,
  `status`, `reject_reason`) and `KybDocumentRepo::list_for_lp`.

---

## Scope

One notification, hung off one existing handler.

**In scope:**

1. **Three renderers in `packages/shared/src/email/mod.rs`**, beside
   `render_verification_email` / `render_duplicate_signup_email` and in exactly their shape (free
   functions returning an owned `OutboundEmail`, plain-text body, no I/O):
   - `render_kyb_passed_email` — carries the decision's optional `reason`, because a trustee may
     write an approval note and #1274 stores it on all three verdicts
   - `render_kyb_changes_requested_email` — carries the decision's optional `reason` **and** the
     rejected documents with their individual `reject_reason`s
   - `render_kyb_failed_email` — carries the optional `reason`, and says **nothing** about the
     account
   plus one small borrowed input struct, `RejectedDocument<'a>`.
2. **Three pure functions in `packages/api/src/routes/lps.rs`** — `kyb_decision_email` (total over
   `KybDecision`), `rejected_documents` (filters `&[KybDocumentRow]` down to the rejected ones), and
   `decision_recipient` (picks the account's verified address over `lps.contact_email`). All `pub`,
   in the `// ── Compute (pure) ──` section, so `packages/api/tests/lps.rs` can drive them with no
   HTTP and no DB.
3. **A best-effort send at the tail of `decide_kyb`**, after the decision is committed and after
   the re-read, gated on `row.notify_on_review`, and preceded by **one conditional read of the
   owning account** for its verified address.
4. **A small split of `with_documents`** into `with_documents` (unchanged signature) and
   `with_documents_rows`, so the document rows read for the email are reused for the response
   instead of read twice.
5. **A tech-debt entry** recording that a lost decision email has no retry and no record.

**Out of scope — each is a sibling sub-issue of #1376, do not touch:**

- **#1274** — the state machine and the verdict endpoint itself. This issue adds a tail to its
  handler and changes nothing about the decision, its validation, or its SQL.
- **#1377** — the `notify_on_review` column and the narrowed freeze. This issue *reads* the flag and
  never writes it.
- **#1379** — ungating `POST /v1/lps/me/link-address`. **Merged** (`167caf5`); compose with it, do
  not re-plan it. See "Re-verified against `main`" above.
- **#1380** — making `accounts.status = 'Suspended'` actually gate requests. This issue must not
  anticipate it in copy; see the `Failed` body in step 2.
- **An email outbox table with worker-driven retries.** Explicitly out of scope for the epic; it
  goes in the tech-debt tracker, not in this branch.
- **Notifying on a per-document review.** `review_document` is not touched. The spec's reason is
  deliberate and is quoted in the code's doc comment so a future reader does not "fix" the omission.
- **Any migration.** This issue adds no column and no table.
- **Any frontend change.** No DTO field is added or removed; `LpResponse` is untouched.
- **Any new configuration.** The emails carry no deep link into the app, because no app base URL is
  configured anywhere (`EmailConfig` knows only SendGrid credentials) and the two existing emails
  link nowhere either. Adding an `APP_URL` for this would be a new deployment variable for a
  cosmetic gain, and the Issue's own requirement is that the `ChangesRequested` email be actionable
  *without* opening the app.

---

## Assumptions and Risks

- **The spec is merged and already carries both of this revision's decisions.** PR #1382 landed as
  `d509486`. § "Review Notifications" ¶3 already names the account's verified address as the
  recipient with the contact address as fallback, and § "Security Considerations" bullet 2 already
  records that the contact address is unverified and why the emails avoid it. **Do not add a second
  bullet saying the same thing** — see Docs to Update. Read the section from the working tree before
  implementing and confirm nothing drifted.

- **`password.rs:235` is the right shape for *ordering* and the wrong shape for *error handling*;
  copy only half of it.** The Issue cites it as the pattern, and its commit-before-send ordering is
  what to follow. But that call site is literally
  `state.email_sender.send(&render_duplicate_signup_email(&email)).await?` — it **propagates** with
  `?`, and so does `issue_and_send_passcode` at `password.rs:509`. Both are already logged as tech
  debt for exactly that reason (**TD-96**, **TD-97**). This issue must **not** reproduce the `?`.
  The correct shape is:

  ```rust
  if let Err(e) = state.email_sender.send(&email).await {
      tracing::warn!(lp = row.id, error = %e, "could not send the KYB decision email");
  }
  ```

  A coder reading `password.rs:235` and copying it verbatim is the single most likely way to ship
  this issue wrong, because it would make a trustee's verdict return `500` on a SendGrid outage
  *after* the verdict is already committed — the worst of both worlds.

- **The send is inline and blocking, so a dead provider adds up to 10s to the trustee's response.**
  `SendGridEmailSender` builds its `reqwest::Client` with `Duration::from_secs(10)`. The Issue says
  to send inline, so that latency is accepted rather than engineered away with `tokio::spawn` —
  spawning would detach the log from the request span and make the ordering untestable for no
  correctness gain. Folded into the tech-debt entry, since an outbox fixes the latency and the
  retry gap in one change.

- **The rejected-document read is after the commit, and `ChangesRequested` unfreezes the record.**
  `decide_kyb` is a conditional `UPDATE` that returns only a `bool`, so the documents are read
  separately. Reading them *after* the commit is the honest choice — the email should describe the
  record as of the decision. The consequence: between the commit and that read, the now-unfrozen
  owner could delete a rejected document, and the email would omit it. The window is milliseconds,
  the LP is the same party that would have deleted it, and the app shows the authoritative list.
  Accepted; do not add a transaction to close it.

- **`Passed` re-reads documents twice.** #1274's handler already reads `list_for_lp` for
  `pass_blockers` *before* deciding; this issue reads them again *after*. Those are two different
  facts (pre-decision eligibility vs. post-decision content) and must not be collapsed into one
  read. The other two decisions read once. One extra query on a rare, staff-triggered action.

- **`legal_name` and `original_filename` are LP-supplied text going into an email body.** Both reach
  only an address belonging to the LP's own side — its owner account's verified address, or the
  contact address it supplied — so this is self-directed. `validate_profile` trims and bounds
  `legal_name` to 200 characters but permits embedded newlines, and `truncate_filename` bounds a
  filename to 255. The body is `text/plain` and `SendGridEmailSender::payload` serialises subject
  and body as **JSON values**, not as raw SMTP headers, so there is no header-injection surface —
  a newline cannot forge a `Bcc:`. A newline in `legal_name` can make the body read oddly; that is
  cosmetic and self-inflicted. Do not add escaping or a second validation pass for it.

- **The recipient is the owning account's verified address, with `lps.contact_email` as the
  fallback.** This reverses the first revision, which sent to `contact_email` outright. The reason
  is not convenience, it is trust: `contact_email` is a **required field of `POST /v1/lps/me`**, an
  owner-controlled **full-replace** endpoint, and **nothing verifies it** — `validate_profile` only
  trims it and bounds it to `MAX_CONTACT_EMAIL_LEN`. A decision message carries the trustee's
  free-text reason for refusing a legal entity plus every per-document rejection reason. That is not
  content to deliver to an address chosen by whoever last saved the profile, especially when
  delivery failures are logged rather than propagated, so a misdirected message leaves no trace.
  `accounts.email` is the address an OTP was delivered to and verified against.

- **The fallback is a real path, not a theoretical one.** `accounts.email` is `TEXT UNIQUE`
  **nullable** (`20260922000001_accounts_email_password_auth.sql:85`) and
  `Account::email` is `Option<String>`, documented "`None` for a wallet-only account that never
  registered an email". A wallet-registered owner reaches KYB with no account email at all, and
  `contact_email` is then the only address Pipeline holds for it. Falling back is what keeps that
  owner notified.

- **"Verified" is read as `email_verified_at.is_some()`, and the caller applies it.** The spec says
  "the verified address of the owning account". `Account` distinguishes *having* an email from
  having *verified* one, so the plan gates on `Account::is_email_verified()` rather than on
  `email.is_some()` alone. In practice the two coincide — an account with an unverified email cannot
  log in, so it cannot hold the JWT that registered the LP — but if they ever diverged, an
  unverified account address is exactly the kind of address the bullet above says not to trust. The
  check costs one `&&` and lives at the **call site**, where the `Account` is in hand, which is what
  keeps `decision_recipient` a two-argument pure function over `(account_email, contact_email)`.

- **The account lookup is one extra read, and it is conditional.** Answering the question the Issue
  comment asks: it does **not** fold into an existing one. #1274's `decide_kyb` repo method returns
  `bool` (its `RETURNING owner_account_id` is consumed inside the transaction to suspend the account
  on `Failed` and never surfaces to the route), and nothing else in the handler touches `accounts` —
  `require_trustee` reads the *trustee's* claims, not the LP owner's account. So the handler adds
  `state.account_repo.find(row.owner_account_id)`, using the `owner_account_id` already on the
  re-read `LpRow` — no join, no new repo method, no new `AppState` field. Put the read **inside** the
  `if row.notify_on_review` block so an LP that opted out costs zero extra queries; the flag is off
  by default, so that is the common case. One `SELECT` by primary key on a rare, staff-triggered
  action is not worth engineering away.

- **A failed account lookup must not fail the request, and must not silently retarget.** The read
  sits after a committed verdict on a best-effort path. On `Err`, log and **skip the send** rather
  than falling back to `contact_email`: the fallback exists for an account that *has* no address,
  not for a database that did not answer, and quietly redirecting a trustee's refusal reasons to an
  unverified address on a transient error is the exact failure this change exists to prevent. On
  `Ok(None)` — an LP whose `owner_account_id` has no `accounts` row — do the same. That case is
  unreachable: the column is `UUID NOT NULL REFERENCES accounts(id)`
  (`20260922000001_accounts_email_password_auth.sql:140`/`:147`). Handle it anyway, with the same
  log-and-skip, rather than with an `expect`.

- **The `Failed` email says nothing about the account, and that is deliberate — do not "fix" it.**
  #1274 writes `accounts.status = 'Suspended'` in the same transaction as a `Failed` verdict, so it
  is tempting to tell the LP its account is blocked. **Nothing gates on that column until #1380
  lands.** The spec says so outright (§ "Security Considerations" bullet 3: it "today means nothing:
  no request authorization reads that column, and neither does the wallet sign-in path"). A
  suspended owner can still mint fresh tokens and keep using the API. So the claim would be true of
  the stored record and false of the observable behaviour — and telling someone their account is
  blocked when it is not is a customer-facing falsehood, not a harmless over-share. The copy stays
  at "this decision is final". A test pins the absence (Test Strategy), so a later edit that adds
  the sentence fails rather than ships. When #1380 lands, whoever closes it may revisit the copy.

- **Nothing is test-covered end to end, by repo rule.** No test may reach a real Postgres or read
  `DATABASE_URL`/`POSTGRES_URL`, and there is no HTTP-level test harness for these routes. The
  `notify_on_review` gate, the account read, the `send` call, and the swallow-on-error are therefore
  **not** unit tested — which is exactly why the renderers, the selector, the filter and the
  recipient chooser are pure functions that are. The handler tail must stay thin enough that reading
  it is verification: it reads a row, calls four pure functions, and sends. Manual checks are in
  Test Strategy.

- **A `LoggingEmailSender` deployment logs the full body.** `EMAIL_DEV_LOG=true` prints `to`,
  `subject` and `body` at `info`. A `ChangesRequested` body now carries the trustee's free-text
  reason and per-document rejection reasons. That is pre-existing behaviour of the dev sender and
  dev-only; noted so it is not discovered as a surprise.

---

## Open Questions

_None._

All three questions the first revision raised were answered by the user on the Issue
(2026-09-30, "All three open questions answered. Releasing the park."). Recorded here so the
resolutions are not re-litigated, and each is pinned by a test:

1. **Does a `Passed` decision's `reason` go into the email? — Yes.** #1274 stores
   `kyb_decision_reason` on all three verdicts, so dropping it on approval would silently discard a
   note the trustee deliberately wrote. `render_kyb_passed_email` takes `reason: Option<&str>` and
   the `Passed` arm of `kyb_decision_email` passes it through. The reason stays an `Option`, so the
   `Passed` body must read well both with one and without — see step 2.

2. **Does the `Failed` email mention account suspension? — No.** The copy stays at "this decision is
   final". See the Assumptions bullet "The `Failed` email says nothing about the account" for why,
   and Test Strategy for the assertion that keeps it that way.

3. **Does the copy need a separate product pass? — No.** The three message bodies ship in the PR and
   are read there before merge. There is **no copy-review gate**; do not add one, and do not wait on
   one.

---

## Implementation Steps

### 0. Rebase first — done

```bash
git fetch origin
git rebase origin/feat/1274-kyb-state-machine   # or onto main, once both siblings have merged
```

Then confirm, before writing anything, that **all four** of these exist. Each is a symbol this
issue's diff names, and each comes from a sibling that is still unmerged as of this revision:

| Symbol | Where | From |
|---|---|---|
| `pub enum KybDecision` (and the route `POST /v1/lps/{id}/kyb` in `router()`) | `packages/api/src/routes/lps.rs` | #1274 |
| `async fn decide_kyb(…)` — the *handler*, not `LpRepo::decide_kyb` | `packages/api/src/routes/lps.rs` | #1274 |
| `LpRow.kyb_decision_reason: Option<String>` | `packages/shared/src/lp_repo.rs` | #1274 |
| `LpRow.notify_on_review: bool` | `packages/shared/src/lp_repo.rs` | #1377 |

If **any** is missing, the prerequisite has not landed — **stop and report**. Do not invent a
`KybDecision`, a handler, a `kyb_decision_reason` column or a `notify_on_review` flag; a
locally-invented version of any of them will conflict with the sibling on merge and this issue has
no value without them.

Everything else this issue touches is already on `main` and needs no rebase to reach: `AppState`'s
`account_repo` and `email_sender`, `AccountRepo::find`, `LpRow.owner_account_id`, `with_documents`,
and `KybDocumentRepo::list_for_lp`.

### 1. `packages/shared/src/email/mod.rs` — the borrowed input — done

Add above the renderers:

```rust
/// One rejected KYB document as a decision email names it. Borrowed and narrow
/// on purpose: the renderers stay pure and unit-testable with no `KybDocumentRow`
/// and no DB fixture (spec § Review Notifications).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RejectedDocument<'a> {
    pub filename: &'a str,
    pub reason: Option<&'a str>,
}
```

Deliberately **not** `&KybDocumentRow` and deliberately **not** carrying a status: `email` must not
grow a dependency on `kyb_document_repo`, and the filtering belongs to the caller that holds the
rows. This mirrors #1377's `StoredProfile<'a>`, and for the same reason.

`reason` is `Option` even though `resolve_document_review` refuses a rejection without a non-empty
reason — the column is nullable, a row could predate that rule, and a renderer that panics or
prints `None` on it would be worse than one that says so.

### 2. `packages/shared/src/email/mod.rs` — the three renderers — done

Same shape as the two existing ones: free `pub fn`, owned `OutboundEmail` out, `format!` body, no
`async`, no I/O, no config.

```rust
pub fn render_kyb_passed_email(
    to: &str,
    legal_name: &str,
    reason: Option<&str>,
) -> OutboundEmail;

pub fn render_kyb_changes_requested_email(
    to: &str,
    legal_name: &str,
    reason: Option<&str>,
    rejected: &[RejectedDocument<'_>],
) -> OutboundEmail;

pub fn render_kyb_failed_email(
    to: &str,
    legal_name: &str,
    reason: Option<&str>,
) -> OutboundEmail;
```

Drafted copy. **There is no separate copy-review gate** — these three bodies ship in PR #1385 and
are read there before merge (Open Question 3, answered). Quote them in the PR body so the reviewer
does not have to reconstruct them from `format!` strings.

**Passed** — carries the reason when the trustee wrote one (Open Question 1, answered: **yes**).

- Subject: `Your Pipeline KYB review is complete`
- Body, with a reason:
  ```
  The KYB review for {legal_name} is complete and the entity has been approved.

  {reason}

  Nothing further is needed from you.
  ```
- Body, without one — the reason paragraph is omitted **whole**, leaving:
  ```
  The KYB review for {legal_name} is complete and the entity has been approved.

  Nothing further is needed from you.
  ```

Both must read as finished prose. The no-reason body is the common case (a trustee approving a
clean submission has nothing to add), so it is the one that must not look truncated — which is why
the reason sits *between* two sentences that stand on their own rather than being appended after
the closing line. Build the body by joining present paragraphs with `\n\n`, not by interpolating a
possibly-empty string into a fixed template: the latter is how a dangling blank line gets shipped.

Trim the reason and treat whitespace-only as absent, exactly as the other two renderers do.

Do not name what approval unlocks. Linking a settlement address is no longer gated on `Passed`
(#1379, merged) — `Passed` *fixes* an address already held and still permits a first write — so
copy saying "you can now link a settlement address" would be wrong today, not merely stale.

**ChangesRequested**

- Subject: `Your Pipeline KYB submission needs changes`
- Body:
  ```
  The KYB review for {legal_name} was returned for correction.

  {reason}                                        ← the whole paragraph omitted when None

  These documents need to be replaced:

  - {filename} — {reason}                         ← "no reason was recorded" when None
  - ...
                                                  ← the whole block omitted when empty

  Delete each of them, upload a corrected file, and submit for review again.
  ```
  When there is **neither** a reason **nor** a rejected document — reachable, since `reason` is
  optional and a trustee may return a record without having rejected any individual file — the body
  falls back to a single paragraph:
  ```
  The KYB review for {legal_name} was returned for correction. Sign in to review
  your submission and send it back for review.
  ```
  This case must be handled explicitly, not left to produce an empty-bodied email.

**Failed** — says **nothing** about the account (Open Question 2, answered: **no**).

- Subject: `Your Pipeline KYB application was not approved`
- Body:
  ```
  The KYB review for {legal_name} is complete and the entity was not approved.

  {reason}                                        ← the whole paragraph omitted when None

  This decision is final. If you believe it is a mistake, reply to this message
  or contact Pipeline.
  ```

**This copy is complete as written — do not add a sentence about the account.** The temptation is
real: #1274 sets `accounts.status = 'Suspended'` in the same transaction, so "your account has been
suspended" looks like a true and helpful thing to say. It is not true of anything the LP can
observe. Nothing reads that column until **#1380** lands — not request authorization, not the
wallet sign-in path — so a refused owner can still sign in and keep using the API. The spec states
this outright (§ "Security Considerations" bullet 3). Shipping the sentence would tell a customer
its account is blocked when it demonstrably is not. "This decision is final" is the claim that is
true on the day this ships, and it is the one that stays true after #1380 too. A test asserts the
absence (Test Strategy), so a later edit that adds it fails rather than ships.

Trim `reason` and treat a whitespace-only reason as absent, so a trustee submitting an empty
textarea does not produce a blank paragraph. (#1274's `resolve_kyb_decision` already collapses blank
to `None` before storage; the renderer repeats it because it takes an `Option<&str>` from anywhere.)
The same trim applies to all three renderers, `Passed` included.

Keep the module's single spec-pointer header convention (AGENTS.md § Lint & style): the file's header
comment currently reads `// spec: docs/product-specs/api-authorization-email.md#email-delivery,
Issue #1368`. Extend it to also point at `docs/product-specs/kyb-lp-verification.md#review-notifications,
Issue #1378`. Add doc comments on the new public items and **no** inline comments.

### 3. `packages/api/src/routes/lps.rs` — pure compute — done

In the `// ── Compute (pure) ──` section, both `pub`:

```rust
/// The rejected documents of an LP, in the order they were uploaded.
///
/// `list_for_lp` returns newest-first; the email reads better oldest-first, and
/// a deterministic order is what lets the tests assert on the body.
pub fn rejected_documents(docs: &[KybDocumentRow]) -> Vec<RejectedDocument<'_>>
```

Filters on `row.status == DocumentStatus::Rejected.as_str()` — a string compare, not a
`DocumentStatus::from_str` parse, because this runs after the decision is committed on a best-effort
path where there is nothing sensible to do with a parse error. Maps to
`RejectedDocument { filename: &row.original_filename, reason: row.reject_reason.as_deref() }`, then
reverses (or sorts by `id` ascending) to undo `list_for_lp`'s ordering.

```rust
/// The one email a trustee decision sends (spec § Review Notifications).
///
/// Total over [`KybDecision`], so adding a fourth verdict is a compile error
/// rather than a silently unsent notification. Nothing else in the LP group
/// notifies — in particular `review_document` does not, because a trustee
/// working through a set produces a verdict per file within minutes and the LP
/// can act on none of them until the record reopens.
pub fn kyb_decision_email(
    to: &str,
    legal_name: &str,
    decision: KybDecision,
    reason: Option<&str>,
    rejected: &[RejectedDocument<'_>],
) -> OutboundEmail
```

A `match` on `decision` with three arms, each calling the matching renderer. All three take
`reason`; `Passed` and `Failed` ignore `rejected`. No `_ =>` arm.

```rust
/// Where a KYB decision email goes: the owning account's verified address,
/// falling back to the LP's contact address when the account has none
/// (spec § Review Notifications, § Security Considerations).
///
/// `lps.contact_email` is a required field of the owner-controlled full-replace
/// profile endpoint and nothing verifies it, so it is the fallback and never the
/// preference. A wallet-registered account may never have set an email, which is
/// what the fallback exists for.
pub fn decision_recipient<'a>(account_email: Option<&'a str>, contact_email: &'a str) -> &'a str
```

Three things about this signature are load-bearing:

- **It returns `&str`, not `Option<&str>`.** `lps.contact_email` is `TEXT NOT NULL`
  (`20260915000001_kyb_lps_and_documents.sql:33`) and `validate_profile` refuses an empty one, so a
  registered LP always has a contact address. **The "neither is present" case is not reachable**,
  and returning a plain `&str` is what makes it unrepresentable rather than a branch someone has to
  guess at. Answering the Issue comment's question directly: it is not reachable, and the plan does
  not test it because there is nothing to test.
- **It takes `Option<&str>`, not `&Account`.** The verified-vs-merely-present judgement stays at the
  call site (`account.email.as_deref().filter(|_| account.is_email_verified())`), so this function
  needs no `Account`, no `shared::account_repo` import in the pure section, and no fixture.
- **A blank account address is treated as absent.** Return the fallback when `account_email` is
  `None` *or* trims to empty. `accounts.email` has no non-empty `CHECK`, and an email addressed to
  `""` is a delivery failure with no useful log. The function never invents a recipient beyond
  that: if `contact_email` itself were blank, it is still what comes back, the send fails, and the
  failure is logged like any other — which is the honest outcome, not a silent skip.

Add `use shared::email::{OutboundEmail, RejectedDocument};` to the imports.

### 4. `packages/api/src/routes/lps.rs` — split `with_documents` — done

`with_documents` currently reads the rows itself and then presigns. Split the read off so the rows
read for the email are reused:

```rust
async fn with_documents(state: &AppState, lp: LpRow) -> Result<LpResponse, ApiError> {
    let rows = state.kyb_document_repo.list_for_lp(lp.id).await?;
    with_documents_rows(state, lp, rows).await
}

/// `with_documents` for a caller that has already read the rows. The presigning
/// and its degrade-to-`null` behaviour are unchanged.
async fn with_documents_rows(
    state: &AppState,
    lp: LpRow,
    rows: Vec<KybDocumentRow>,
) -> Result<LpResponse, ApiError>
```

`with_documents`'s signature and behaviour are unchanged, so every existing call site — including
both handlers #1274 adds — compiles untouched. Move the existing body (the presign loop and its
`tracing::warn!` degrade) into `with_documents_rows` verbatim; do not restate its doc comment in
both places.

### 5. `packages/api/src/routes/lps.rs` — the handler tail — done

In #1274's `decide_kyb`, after `lp_repo.decide_kyb(...)` returned `true` and after the re-read:

```rust
let row = state.lp_repo.find(id).await?.ok_or_else(/* Internal, as #1274 specifies */)?;
let docs = state.kyb_document_repo.list_for_lp(id).await?;

if row.notify_on_review {
    match state.account_repo.find(row.owner_account_id).await {
        Ok(Some(account)) => {
            let account_email = account
                .email
                .as_deref()
                .filter(|_| account.is_email_verified());
            let to = decision_recipient(account_email, &row.contact_email);
            let rejected = rejected_documents(&docs);
            let email = kyb_decision_email(
                to,
                &row.legal_name,
                decision,
                row.kyb_decision_reason.as_deref(),
                &rejected,
            );
            if let Err(e) = state.email_sender.send(&email).await {
                tracing::warn!(lp = id, error = %e, "could not send the KYB decision email");
            }
        }
        Ok(None) => tracing::warn!(
            lp = id,
            "no account for this LP's owner — KYB decision email not sent"
        ),
        Err(e) => tracing::warn!(
            lp = id,
            error = %e,
            "could not read the owning account — KYB decision email not sent"
        ),
    }
}

Ok(Json(with_documents_rows(&state, row, docs).await?))
```

Seven things are load-bearing:

- The block sits **after** `decide_kyb` succeeded and after the re-read. The decision is already
  committed; nothing below it can undo one.
- `if let Err(e) = … { warn! }` — **never** `?`. See Assumptions. That now applies to the account
  read as well as to the send: **neither** may propagate.
- The account read is **inside** the `notify_on_review` block, so an LP that opted out costs no
  extra query. The flag is off by default, so that is the common path.
- **Neither error arm falls back to `contact_email`.** The fallback is for an account that *has* no
  address; a transient `Err` is not that, and quietly retargeting a trustee's refusal reasons to an
  unverified address would defeat the whole point of the recipient change. Both arms log and skip.
- The verified check is `.filter(|_| account.is_email_verified())` at the call site — not inside
  `decision_recipient`, which stays a two-argument pure function. An account with an email it never
  verified is treated as having none.
- `reason` comes from the **re-read row's** `kyb_decision_reason`, not from the request body. The row
  is what was stored (trimmed, blank collapsed to `None` by `resolve_kyb_decision`), and the email
  must say what the record says. It is passed on **all three** verdicts, `Passed` included — the
  `match` in `kyb_decision_email` decides what each does with it.
- The email is built and sent **before** `with_documents_rows` consumes `row` and `docs`, so the
  borrows end cleanly and no clone is needed. `account` is a local and is dropped with the block.

`decision` here is #1274's `KybDecision` (the request enum), not the `KybStatus` it maps to — the
three-variant enum is what makes the `match` in `kyb_decision_email` total.

Nothing else in the handler changes: no status code, no response body, no OpenAPI annotation. The
notification is invisible to the HTTP contract, which is the point of best-effort delivery. In
particular, **no audit record is written here** — #1274's revised plan removed the `tracing::info!`
verdict line it once proposed, and this issue must not reintroduce one under another name. The two
`warn!`s above are delivery diagnostics, nothing more.

### 6. Module header — done

`routes/lps.rs`'s header lists the rules governing the group. Add the notification in one or two
sentences to the **Trustee** paragraph (currently `lps.rs:23-25`, "`GET /v1/lps` lists, …"): a
decision on `POST /v1/lps/{id}/kyb` mails the LP when its `notify_on_review` is set, best-effort, at
the owning account's verified address and only falling back to `lps.contact_email` when that account
has none; `POST /v1/lps/{id}/documents/{doc}/review` deliberately does not notify.

The recipient rule belongs in the header rather than only on the function, because it is the part a
future reader is most likely to "simplify" back to `row.contact_email` — the LP row is right there
and the account read looks redundant.

Do **not** touch the two numbered freeze rules — #1274 rewrites rule 1 and #1377 narrows it, and
#1379 has already rewritten the surrounding address prose; editing any of it here creates a conflict
for no benefit. Rewrite existing comments only, add no new inline ones (AGENTS.md § Lint & style).

### 7. Tech debt — done, as TD-99

**TD-98 is still the right entry and still the right number** — re-verified against the tracker in
the working tree. The highest number in the file is **TD-97**, unchanged since this plan was
drafted; #1379 edited TD-57 in place and added nothing new.

**Where it goes — and the anchoring hazard.** The first revision said "under **Known Gaps**". That
was wrong and is corrected here: `## Known Gaps` ends at `### TD-93`, and TD-96/TD-97 — the two
entries TD-98's "one fix covers all three" sentence refers to — live at the **end of the file**,
under the second `## Post-MVP`. Append TD-98 **at the end of the file**, immediately after the
TD-97 block, keeping it beside its siblings.

**The file has a duplicated `## Post-MVP` section** — two of them, and `### TD-80` / `### TD-82`
each name three different entries across the file (tracked as issue **#1390**). So:

- **Anchor the edit on a unique neighbouring subtitle**, not on a heading level or a section name.
  `### TD-97: A failed send burns the passcode and the cooldown` occurs exactly once; append after
  its block. Do not anchor on `## Post-MVP`, which is ambiguous.
- **This PR must not deduplicate the tracker.** Fixing the duplication is #1390's job. A cleanup
  here would bury a two-line addition inside a large unrelated diff, and would conflict with #1390.

The entry text:

```
### TD-98: A lost KYB decision email is lost silently and forever

- **Date:** 2026-09-29
- **Location:** `packages/api/src/routes/lps.rs` (`decide_kyb`), `packages/shared/src/email/`
- **Gap:** The decision email is sent inline and best-effort: the verdict commits first, and a send
  failure — or a failure to read the owning account for its address — is swallowed with a
  `tracing::warn!`. There is no retry, no outbox row, and no flag on `lps` recording that a
  notification was owed and never delivered — the only trace is a log line. Deliberate for epic
  #1376 (the verdict must not depend on SendGrid), and an outbox was explicitly ruled out of that
  epic's scope. The verdict itself is not logged either (#1274 writes no audit record), so the
  `warn!` is the only line about the decision that ever appears.
- **Impact:** An LP that opted in to be told the outcome of its review can be told nothing, and
  neither the LP nor a trustee can see that it happened. `ChangesRequested` is the costly case: the
  record is sitting unfrozen waiting for a correction the LP does not know was asked for, and the
  cycle stalls until someone opens the app. The inline send also puts SendGrid's 10s client timeout
  on the trustee's request latency.
- **Suggested fix:** A durable outbox table written in the same transaction as the decision, drained
  by a worker with retry and a dead-letter state. One change covers TD-96 and TD-97 as well — the
  auth emails have the same shape of problem from the other direction (they propagate where they
  should swallow), and an outbox removes the choice.
```

Re-check `grep -c '^### TD-98' docs/exec-plans/tech-debt-tracker.md` before writing — it must be `0`.
If another branch has since claimed 98, take the next free number; the entry, not the number, is the
point. Do not renumber anything that is already there.

### 8. Lint — done

`cargo clippy --all -- -D warnings` must pass. No TypeScript change; run `npx tsx scripts/lint-docs.ts`
because `docs/exec-plans/tech-debt-tracker.md` is touched.

---

## Test Strategy

**Pure unit tests only.** No test may read `DATABASE_URL`, `POSTGRES_URL`, or any env var, and none
may reach a real Postgres or the network. Rust tests live in `packages/<pkg>/tests/<topic>.rs` —
never an inline `#[cfg(test)] mod tests` inside `src/`. Every piece of logic this issue adds is a
pure function precisely so that rule costs nothing here.

### New file: `packages/shared/tests/email_kyb_decision.rs`

Header comment pointing at `docs/product-specs/kyb-lp-verification.md#review-notifications` and
Issue #1378, mirroring `email_sendgrid.rs`. Drives the three renderers directly — no `mockito`, no
sender.

`render_kyb_passed_email` — **note the reversal**: it now takes and prints the reason.

- `to` is echoed verbatim into `OutboundEmail.to`.
- The subject is non-empty and the body names the `legal_name`.
- **Reason present → the body contains it**, and still contains the approval sentence and the
  closing line. This is the assertion that pins Open Question 1's resolution; a `Passed` renderer
  that drops the reason must fail here.
- **Reason `None` → the body is coherent**: no `"\n\n\n"`, no trailing blank line, no leading blank
  line, and the closing line still present.
- A whitespace-only reason behaves identically to `None`.
- The reason appears **before** the closing line, not after it — assert on `find` positions, since
  containment alone passes for a body that appends the note after "Nothing further is needed".

`render_kyb_changes_requested_email`:

- Reason present, one rejected document present → the body contains the reason, the filename, and
  that document's reject reason.
- **Reason `None`, documents present** → the body contains every filename and reject reason and does
  not contain an empty dangling paragraph (assert the body has no `"\n\n\n"` and does not start with
  a blank line).
- **Reason present, documents empty** → the reason appears and no "documents need to be replaced"
  heading does.
- **Reason `None` and documents empty** → the fallback single-paragraph body, asserted by its
  distinguishing phrase. This is the case most likely to ship as an empty email.
- A whitespace-only reason behaves identically to `None`.
- Three rejected documents → all three filenames and all three reasons appear, **in the order
  given**, and the assertion checks order (`find` positions ascending), not just containment.
- A rejected document with `reason: None` → the body still lists the filename and says a reason was
  not recorded; it must not print `None`.
- Nothing about a *verified* or *provided* document can appear — the renderer only ever sees
  rejected ones, so this is asserted at the `rejected_documents` level instead (below).

`render_kyb_failed_email`:

- Reason present → it appears; the body states the decision is final.
- Reason `None` → the body is still coherent (no blank paragraph, finality statement still present).
- **The body says nothing about the account** — pins Open Question 2's resolution. Assert the
  absence of `"suspend"` and `"account"` (case-insensitively, on the lowercased body) in **both**
  the reason-present and reason-absent cases. Give the test a name that says why
  (`failed_email_never_claims_the_account_is_suspended`) and let its assertion message point at
  #1380, so whoever trips it reads the reason instead of deleting the test. Feed it a `reason` that
  does not itself contain either word, or the assertion is testing the fixture.

Cross-cutting, one test per renderer or one table-driven test:

- Every rendered `to` equals the input address exactly.
- Every subject is distinct across the three, so a recipient can tell the outcome from the inbox
  list alone.
- No body contains the literal `"{"` or `"}"` — catches a `format!` placeholder that was written as
  plain text.

### Extend: `packages/api/tests/lps.rs`

Add a local fixture helper (no DB, no sqlx — `KybDocumentRow` is a plain struct with public fields
and `chrono` is available to this crate's tests):

```rust
fn doc(id: i64, filename: &str, status: DocumentStatus, reject_reason: Option<&str>) -> KybDocumentRow
```

filling `file_ref`, `size_bytes`, `content_type` with constants, the timestamps with
`chrono::Utc::now()`, and `lp_id` with a constant.

`rejected_documents`:

- Empty slice → empty vec.
- All `Verified` → empty vec.
- A mix of `Provided`, `Verified`, `Rejected`, `NotProvided` → exactly the `Rejected` ones, and
  **none of the others' filenames** appear in the result (assert the negative explicitly — a filter
  with an inverted predicate passes a containment-only test).
- Input in `list_for_lp`'s newest-first order → output is oldest-first. Assert on the filename
  sequence, not on ids alone.
- A `Rejected` row with `reject_reason: None` → `RejectedDocument.reason == None`, not `Some("")`.
- The borrowed `filename` is the row's `original_filename` verbatim, including a name with a space
  and a name with a non-ASCII character.

`kyb_decision_email`:

- `KybDecision::Passed` → equals `render_kyb_passed_email(to, legal_name, reason)` for the same
  inputs (compare the whole `OutboundEmail`; it derives `PartialEq`). Pass a **non-empty `reason`**
  and a non-empty `rejected` slice deliberately: the test must prove the reason is **passed
  through** and the filenames are **ignored**. Assert the body contains the reason and contains no
  supplied filename — one assertion for each half.
- `KybDecision::ChangesRequested` → equals `render_kyb_changes_requested_email(...)` for the same
  inputs.
- `KybDecision::Failed` → equals `render_kyb_failed_email(...)`, and the body contains no filename
  even when `rejected` is non-empty.
- All three produce a non-empty `to`, `subject` and `body`.

`decision_recipient`:

- Account address present → it is returned, and the contact address is **not**. Use two visibly
  different addresses so an inverted branch cannot pass.
- Account address `None` → the contact address is returned. This is the wallet-registered-owner
  path, not a curiosity.
- Account address `Some("")` and `Some("   ")` → the contact address is returned. A stored blank is
  treated as absent.
- The returned `&str` is the *same* string content as whichever input it chose, unmodified — no
  trimming of the chosen address, no lowercasing, no normalisation. The function chooses; it does
  not edit.
- **No "neither is present" test.** `lps.contact_email` is `TEXT NOT NULL` and `validate_profile`
  refuses an empty one, so the case is unreachable, and the `&str` return type makes it
  unrepresentable rather than untested. Record that in a one-line comment on the test module's
  section header, not as a `#[should_panic]` or an ignored test.
- One test wiring it to the renderer: `kyb_decision_email(decision_recipient(None, "ops@acme.example"),
  …).to == "ops@acme.example"` — proves the chosen address reaches `OutboundEmail.to` rather than
  being computed and dropped.

**No OpenAPI assertions.** This issue adds no schema and no route; if a new entry appears in
`LpsDoc`, something was implemented that this plan does not describe.

### Not covered, by rule — verify by hand before marking PR #1385 ready, and say so in the PR body

None of the above touches the gate, the **account read**, the send, or the swallow. With a local API
against a local DB and `EMAIL_DEV_LOG=true` (so the body is logged rather than mailed — note that
the dev sender logs `to`, which is what makes checks 8 to 11 observable at all):

1. LP with `notify_on_review = false`, trustee posts each of the three decisions → **no** email log
   line for any of them.
2. LP with `notify_on_review = true`, decision `ChangesRequested` with a reason and two `Rejected`
   documents (one with a reason, one forced to `NULL` by hand) → exactly **one** log line, carrying
   the reason, both filenames, and the recorded rejection reason.
3. Same LP, decision `Passed` **with a reason** → one email, and **the reason is in the body**. Then
   `Passed` with no reason → one email that still reads as finished prose, with no dangling blank
   line. These two are the resolution of Open Question 1 and the reversal of the first revision, so
   run both and paste both bodies into the PR.
4. Same LP, decision `Failed` with a reason → one email whose body says **nothing** about the
   account, and `accounts.status` is `Suspended` in the database (#1274's behaviour, re-checked here
   only to confirm the email did not disturb the transaction). The contrast is the point: the record
   says suspended, the message does not, and that is deliberate until #1380.
5. Decision `ChangesRequested` with **no** reason and **no** rejected document → one email carrying
   the fallback paragraph, not an empty body.
6. Point `SENDGRID_BASE_URL` at a closed port with `EMAIL_DEV_LOG` unset, then post a decision →
   the endpoint still answers **`200`** with the updated LP, and a `warn` line records the failure.
   **This is the check that matters most**; it is what distinguishes this implementation from a
   verbatim copy of `password.rs:235`.
7. Review an individual document → **no** email. Requires an LP that is `UnderReview` with
   `notify_on_review = true`, because #1274 now refuses `review_document` in any other status — run
   it in the wrong status and the request 409s before reaching any code that could have mailed, and
   the check proves nothing. The spec's "nothing else notifies" is a negative requirement and is
   otherwise untested.

**The recipient — checks 8 to 11, the substance of this revision.** Nothing about the address
selection is reachable from a unit test beyond `decision_recipient` itself, so run all four:

8. LP whose owner account has a **verified** email that differs from `lps.contact_email` → the
   message goes to `accounts.email`, and `contact_email` appears nowhere in the log line. This
   inverts the first revision's check 8; a run that still delivers to `contact_email` means the
   handler never got the account read.
9. LP owned by a **wallet-registered** account (`accounts.email IS NULL`) → the message goes to
   `lps.contact_email`. Build this one by hand if no wallet signup flow is convenient: set
   `accounts.email = NULL` on a test account that owns an LP.
10. Owner account with an email but `email_verified_at IS NULL` → the message goes to
    `contact_email`, not to the unverified account address.
11. Stop Postgres between the verdict and the notification, or point `account_repo` at a dropped
    `accounts` table, so the account read fails → the endpoint still answers **`200`** and a `warn`
    line says the email was not sent. It must **not** fall back to `contact_email` on this path.
    Hard to stage cleanly; at minimum, read the two error arms and confirm neither can reach
    `decision_recipient`.

---

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` — no change. The security bullet this revision was
  asked to add is already in the file.** PR #1382 merged as `d509486` and carried both halves of the
  recipient decision with it. Verified in the working tree:
  - § "Review Notifications" ¶3 already says each decision "sends one email to the **verified
    address of the owning account**, falling back to the LP's contact address when that account has
    none (a wallet-registered account may never have set an email)", and gives the rationale in the
    same paragraph.
  - § "Security Considerations" bullet 2 is already **"The LP contact address is unverified, and
    decision emails avoid it."** — it records that `contact_email` is a required field of the
    owner-controlled full-replace endpoint, that nothing proves the owner holds it, that decision
    messages therefore go to the account's verified address with the contact address as a fallback,
    and that a misdirected message would leave no trace because delivery failures are logged rather
    than propagated.

  That is exactly the bullet this revision was asked to write, already written. **Do not add a
  second one.** Re-read both sections before implementing and confirm nothing drifted; if anything
  has, amend in place rather than appending. The email *copy* remains an implementation detail and
  does not belong in the spec.
- **`docs/exec-plans/tech-debt-tracker.md`** — add TD-98 (step 7). This is the Issue's own
  instruction: log the consequence rather than build retries. Anchor on the unique `### TD-97:`
  subtitle, and **do not deduplicate the file's two `## Post-MVP` sections or its repeated TD-80 /
  TD-82 headings** — that is issue #1390's work, and folding it in here would bury a two-line
  addition in an unrelated diff and conflict with #1390.
- **`docs/exec-plans/active/issue-1378-kyb-decision-emails.md`** — this plan. Append a decision-log
  entry for anything decided during implementation that differs from it, in particular the final
  copy of the three bodies. The three Open Questions are already resolved above and need no further
  record.
- **No user-docs change.** `docs/user-docs/` describes the app's surfaces; a transactional email
  sent on an opt-in preference that has no UI yet (the LP-side toggle issue is not yet filed) has
  nothing to document there. Whoever files that UI issue documents the preference and the emails
  together.
- **No frontend change and no generated docs.** `packages/frontend/src/api/lps.ts` gains nothing —
  no DTO field is added.
- Run `npx tsx scripts/lint-docs.ts` (the tech-debt tracker is under `docs/`).

---

## Decision Log (implementation, 2026-10-01)

- **The tech-debt entry landed as TD-99, not TD-98.** #1274 merged first and took `### TD-98`
  ("The KYB transition and review SQL predicates are not integration-tested"). Re-verified at
  implementation time: `grep -c '^### TD-98'` was `1`, `'^### TD-99'` was `0`. Appended at the end
  of the file after the TD-98 block, beside TD-96/TD-97. The tracker's duplicated `## Post-MVP`
  sections and repeated TD-80/TD-82 headings were left untouched (#1390).
- **`kyb_decision_email` is fed `req.decision`, not the handler's `decision` local.**
  `resolve_kyb_decision` returns `(KybStatus, Option<&str>)` — the plan's step 5 snippet assumed
  `decision` was the `KybDecision`. `req.decision` is the three-variant `KybDecision` the plan's
  totality argument depends on, it is `Copy`, and `req` is still in scope, so the `match` stays
  total with no signature change.
- **`ChangesRequested` with a reason and no rejected document closes on "Sign in to review your
  submission and send it back for review."** The plan's template put "Delete each of them, upload a
  corrected file, and submit for review again." outside the omitted-when-empty block, which would
  have told the LP to delete a list it was never shown. The closing line now varies with the list:
  the delete-and-replace instruction when there are rejected documents, the sign-in instruction
  when there are none. The neither-reason-nor-document fallback is unchanged — one paragraph
  joining the opening sentence and the sign-in instruction, so the reason-absent case still reads
  as finished prose.
- **A blank `RejectedDocument.reason` is treated as unrecorded,** the same as `None`, by the same
  trim the decision reason gets. The column is nullable with no non-empty `CHECK`.
- **No doc comments on the new items.** `AGENTS.md` § Lint & style allows one spec-pointer header
  per file and nothing else, so the rationale the plan wanted as `///` prose lives in the module
  header's Trustee paragraph (recipient rule, best-effort delivery, "`review_document`
  deliberately does not notify"), in the spec, and here.
- **`packages/shared/src/email/mod.rs`'s spec pointer now names both specs** on one line and drops
  the `Issue #…` tails, per the bare-pointer rule.
- **No spec change.** `docs/product-specs/kyb-lp-verification.md` § "Review Notifications" ¶3 and
  § "Security Considerations" bullet 2 were re-read in the working tree and carry both halves of the
  recipient decision verbatim. Nothing had drifted; nothing was appended.
- **`cargo nextest` deadlocks in the implementation shell.** Compilation finishes, then every
  `--list --format terse` child hangs and the run never reaches the test phase (reproduced four
  times, sandboxed and not; a lister invoked directly returns instantly). The suite was run with
  `cargo test --workspace` instead. Worth a look if it recurs, but it is an environment problem,
  not a repo one, so nothing was filed.
