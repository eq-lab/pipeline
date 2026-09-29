# Issue #1378: Backend: KYB decision emails to the LP

Source: https://github.com/eq-lab/pipeline/issues/1378

Part of epic #1376 (KYB review lifecycle). Branch `feat/1378-kyb-decision-emails`, draft PR #1385.

Spec of record: `docs/product-specs/kyb-lp-verification.md` § "Review Notifications". The file is
**not on `main`** — it is on branch `docs/kyb-review-lifecycle` (open PR #1382). Read it with:

```bash
git show origin/docs/kyb-review-lifecycle:docs/product-specs/kyb-lp-verification.md
```

That spec plus the Issue body is the design of record. Its decisions were settled with the user and
are **not** open for re-litigation:

- Exactly **one** email per trustee decision, to `lps.contact_email`, and only when the LP's
  `notify_on_review` is `true`.
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

**Order: #1274 → #1377 → #1378.** #1377's plan already recommends #1274 first and itself second;
this issue is strictly last because it consumes the output of both. `feat/1378-kyb-decision-emails`
is currently branched off `main` and **must be rebased onto both** before implementation — do not
start writing code against `main`'s `routes/lps.rs`, because the handler being edited does not exist
there.

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

Already on `main` and unchanged by either sibling:

- `packages/shared/src/email/mod.rs` — the `EmailSender` trait, `OutboundEmail`, and the two
  renderers this issue's three follow the shape of.
- `packages/api/src/lib.rs:121` — `AppState.email_sender: Arc<dyn EmailSender>`, already wired and
  already constructed in `main.rs:79`/`166`.
- `packages/shared/src/kyb_document_repo.rs` — `KybDocumentRow` (carries `original_filename`,
  `status`, `reject_reason`) and `KybDocumentRepo::list_for_lp`.

---

## Scope

One notification, hung off one existing handler.

**In scope:**

1. **Three renderers in `packages/shared/src/email/mod.rs`**, beside
   `render_verification_email` / `render_duplicate_signup_email` and in exactly their shape (free
   functions returning an owned `OutboundEmail`, plain-text body, no I/O):
   - `render_kyb_passed_email`
   - `render_kyb_changes_requested_email` — carries the decision's optional `reason` **and** the
     rejected documents with their individual `reject_reason`s
   - `render_kyb_failed_email`
   plus one small borrowed input struct, `RejectedDocument<'a>`.
2. **A pure selector and a pure filter in `packages/api/src/routes/lps.rs`** —
   `kyb_decision_email` (total over `KybDecision`) and `rejected_documents` (filters
   `&[KybDocumentRow]` down to the rejected ones). Both `pub`, in the `// ── Compute (pure) ──`
   section, so `packages/api/tests/lps.rs` can drive them with no HTTP and no DB.
3. **A best-effort send at the tail of `decide_kyb`**, after the decision is committed and after
   the re-read, gated on `row.notify_on_review`.
4. **A small split of `with_documents`** into `with_documents` (unchanged signature) and
   `with_documents_rows`, so the document rows read for the email are reused for the response
   instead of read twice.
5. **A tech-debt entry** recording that a lost decision email has no retry and no record.

**Out of scope — each is a sibling sub-issue of #1376, do not touch:**

- **#1274** — the state machine and the verdict endpoint itself. This issue adds a tail to its
  handler and changes nothing about the decision, its validation, or its SQL.
- **#1377** — the `notify_on_review` column and the narrowed freeze. This issue *reads* the flag and
  never writes it.
- **#1379** — ungating `POST /v1/lps/me/link-address`.
- **#1380** — making `accounts.status = 'Suspended'` actually gate requests.
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

- **The spec is unmerged.** PR #1382 carries § "Review Notifications". If it changes before merge,
  re-read it. This branch must not duplicate or fork the spec file — see Docs to Update.

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
  only the LP's own `contact_email`, so this is self-directed. `validate_profile` trims and bounds
  `legal_name` to 200 characters but permits embedded newlines, and `truncate_filename` bounds a
  filename to 255. The body is `text/plain` and `SendGridEmailSender::payload` serialises subject
  and body as **JSON values**, not as raw SMTP headers, so there is no header-injection surface —
  a newline cannot forge a `Bcc:`. A newline in `legal_name` can make the body read oddly; that is
  cosmetic and self-inflicted. Do not add escaping or a second validation pass for it.

- **The recipient is `lps.contact_email`, not the account's login email.** They are different
  identities by design (the spec keeps the LP's contact address on the LP row). Sending to the
  account address instead would be a privacy change, not a convenience.

- **Nothing is test-covered end to end, by repo rule.** No test may reach a real Postgres or read
  `DATABASE_URL`/`POSTGRES_URL`, and there is no HTTP-level test harness for these routes. The
  `notify_on_review` gate, the `send` call, and the swallow-on-error are therefore **not** unit
  tested — which is exactly why the renderers, the selector and the filter are pure functions that
  are. The handler tail must stay thin enough that reading it is verification. Manual checks are in
  Test Strategy.

- **A `LoggingEmailSender` deployment logs the full body.** `EMAIL_DEV_LOG=true` prints `to`,
  `subject` and `body` at `info`. A `ChangesRequested` body now carries the trustee's free-text
  reason and per-document rejection reasons. That is pre-existing behaviour of the dev sender and
  dev-only; noted so it is not discovered as a surprise.

---

## Open Questions

1. **Should a `Passed` decision's `reason` appear in the email?** #1274 stores `kyb_decision_reason`
   on all three verdicts ("`reason` is optional on every trustee decision"), but the spec attaches a
   reason only to `ChangesRequested` and `Failed` ("`ChangesRequested` and `Failed` carry an
   optional free-text reason"), and Issue #1378's template list gives `Passed` no reason either.
   This plan therefore **drops it on `Passed`** — a trustee's approval note would be silently
   discarded rather than delivered. Confirm that is wanted, or say the approval email should carry
   it when present (a one-line change to `render_kyb_passed_email`'s signature).

2. **Should the `Failed` email tell the LP its account has been suspended?** #1274 sets
   `accounts.status = 'Suspended'` in the same transaction as a `Failed` verdict, and the spec calls
   the refusal terminal for that applicant. But suspension does not *bite* until #1380 lands
   (TD-80), so at this issue's ship time the statement would be true of the stored record and not
   yet of the observable behaviour. This plan keeps the copy to "this decision is final" and says
   nothing about the account. Confirm, or specify the wording — telling someone their account is
   suspended is a customer-facing claim with more weight than the rest of this copy, and it is not
   the planner's call to draft it.

3. **Is the drafted copy acceptable as-is, or does it need a product/marketing pass?** The three
   bodies below are written to match the voice of the two existing emails, and they are the entire
   user-visible output of this issue. If someone owns transactional copy, this is the moment to
   route it there rather than after the PR is open.

---

## Implementation Steps

### 0. Rebase first

```bash
git fetch origin
git rebase origin/feat/1274-kyb-state-machine   # or onto main, once both siblings have merged
```

Then confirm, before writing anything: `POST /v1/lps/{id}/kyb` is registered in `router()`,
`KybDecision` exists in `routes::lps`, and `LpRow` has `notify_on_review`. If any is missing, the
prerequisite has not landed — stop and report rather than inventing it.

### 1. `packages/shared/src/email/mod.rs` — the borrowed input

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

### 2. `packages/shared/src/email/mod.rs` — the three renderers

Same shape as the two existing ones: free `pub fn`, owned `OutboundEmail` out, `format!` body, no
`async`, no I/O, no config.

```rust
pub fn render_kyb_passed_email(to: &str, legal_name: &str) -> OutboundEmail;

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

Drafted copy (see Open Question 3):

**Passed**

- Subject: `Your Pipeline KYB review is complete`
- Body:
  ```
  The KYB review for {legal_name} is complete and the entity has been approved.

  Nothing further is needed from you.
  ```

Do not name what approval unlocks (linking a settlement address): #1379 is about to change that
gate, and copy that goes stale in the next PR is worse than copy that says less.

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

**Failed**

- Subject: `Your Pipeline KYB application was not approved`
- Body:
  ```
  The KYB review for {legal_name} is complete and the entity was not approved.

  {reason}                                        ← the whole paragraph omitted when None

  This decision is final. If you believe it is a mistake, reply to this message
  or contact Pipeline.
  ```

Trim `reason` and treat a whitespace-only reason as absent, so a trustee submitting an empty
textarea does not produce a blank paragraph. (#1274's `resolve_kyb_decision` already collapses blank
to `None` before storage; the renderer repeats it because it takes an `Option<&str>` from anywhere.)

Keep the module's single spec-pointer header convention (AGENTS.md § Lint & style): the file's header
comment currently reads `// spec: docs/product-specs/api-authorization-email.md#email-delivery,
Issue #1368`. Extend it to also point at `docs/product-specs/kyb-lp-verification.md#review-notifications,
Issue #1378`. Add doc comments on the new public items and **no** inline comments.

### 3. `packages/api/src/routes/lps.rs` — pure compute

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

A `match` on `decision` with three arms, each calling the matching renderer. `Passed` ignores
`reason` and `rejected`; `Failed` ignores `rejected`. No `_ =>` arm.

Add `use shared::email::{RejectedDocument, OutboundEmail};` to the imports.

### 4. `packages/api/src/routes/lps.rs` — split `with_documents`

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

### 5. `packages/api/src/routes/lps.rs` — the handler tail

In #1274's `decide_kyb`, after `lp_repo.decide_kyb(...)` returned `true` and after the re-read:

```rust
let row = state.lp_repo.find(id).await?.ok_or_else(/* Internal, as #1274 specifies */)?;
let docs = state.kyb_document_repo.list_for_lp(id).await?;

if row.notify_on_review {
    let rejected = rejected_documents(&docs);
    let email = kyb_decision_email(
        &row.contact_email,
        &row.legal_name,
        decision,
        row.kyb_decision_reason.as_deref(),
        &rejected,
    );
    if let Err(e) = state.email_sender.send(&email).await {
        tracing::warn!(lp = id, error = %e, "could not send the KYB decision email");
    }
}

Ok(Json(with_documents_rows(&state, row, docs).await?))
```

Four things are load-bearing:

- The block sits **after** `decide_kyb` succeeded and after the re-read. The decision is already
  committed; nothing below it can undo one.
- `if let Err(e) = … { warn! }` — **never** `?`. See Assumptions.
- `reason` comes from the **re-read row's** `kyb_decision_reason`, not from the request body. The row
  is what was stored (trimmed, blank collapsed to `None` by `resolve_kyb_decision`), and the email
  must say what the record says.
- The email is built and sent **before** `with_documents_rows` consumes `row` and `docs`, so the
  borrows end cleanly and no clone is needed.

`decision` here is #1274's `KybDecision` (the request enum), not the `KybStatus` it maps to — the
three-variant enum is what makes the `match` in `kyb_decision_email` total.

Nothing else in the handler changes: no status code, no response body, no OpenAPI annotation. The
notification is invisible to the HTTP contract, which is the point of best-effort delivery.

### 6. Module header

`routes/lps.rs`'s header lists the rules governing the group. Add the notification in one sentence
to the **Trustee** paragraph: a decision on `POST /v1/lps/{id}/kyb` mails the LP when its
`notify_on_review` is set, best-effort, and `POST /v1/lps/{id}/documents/{doc}/review` deliberately
does not.

Do **not** touch the two numbered freeze rules — #1274 rewrites rule 1 and #1377 narrows it; editing
either here creates a conflict for no benefit. Rewrite existing comments only, add no new inline
ones (AGENTS.md § Lint & style).

### 7. Tech debt

Append to `docs/exec-plans/tech-debt-tracker.md` under **Known Gaps**, as **TD-98** (TD-97 is the
current highest in that section):

```
### TD-98: A lost KYB decision email is lost silently and forever

- **Date:** 2026-09-29
- **Location:** `packages/api/src/routes/lps.rs` (`decide_kyb`), `packages/shared/src/email/`
- **Gap:** The decision email is sent inline and best-effort: the verdict commits first and a send
  failure is swallowed with a `tracing::warn!`. There is no retry, no outbox row, and no flag on
  `lps` recording that a notification was owed and never delivered — the only trace is a log line.
  Deliberate for epic #1376 (the verdict must not depend on SendGrid), and an outbox was explicitly
  ruled out of that epic's scope.
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

Adjust the number if the tracker moved between planning and implementation — the entry, not the
number, is the point.

### 8. Lint

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

`render_kyb_passed_email`:

- `to` is echoed verbatim into `OutboundEmail.to`.
- The subject is non-empty and the body names the `legal_name`.
- The body carries no reason text at all (pins Open Question 1's resolution, whichever way it lands).

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
- The body says nothing about account suspension (pins Open Question 2's resolution).

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

- `KybDecision::Passed` → the subject equals `render_kyb_passed_email(...)`'s subject, and the body
  contains neither the supplied `reason` nor any supplied filename. Pass a non-empty `reason` and a
  non-empty `rejected` slice deliberately, so the test proves they are *ignored* rather than merely
  absent.
- `KybDecision::ChangesRequested` → equals `render_kyb_changes_requested_email(...)` for the same
  inputs (compare the whole `OutboundEmail`; it derives `PartialEq`).
- `KybDecision::Failed` → equals `render_kyb_failed_email(...)`, and the body contains no filename
  even when `rejected` is non-empty.
- All three produce a non-empty `to`, `subject` and `body`.

**No OpenAPI assertions.** This issue adds no schema and no route; if a new entry appears in
`LpsDoc`, something was implemented that this plan does not describe.

### Not covered, by rule — verify by hand before marking PR #1385 ready, and say so in the PR body

None of the above touches the gate, the send, or the swallow. With a local API against a local DB
and `EMAIL_DEV_LOG=true` (so the body is logged rather than mailed):

1. LP with `notify_on_review = false`, trustee posts each of the three decisions → **no** email log
   line for any of them.
2. LP with `notify_on_review = true`, decision `ChangesRequested` with a reason and two `Rejected`
   documents (one with a reason, one forced to `NULL` by hand) → exactly **one** log line, to
   `lps.contact_email`, carrying the reason, both filenames, and the recorded rejection reason.
3. Same LP, decision `Passed` with every document `Verified` → one email, no reason text.
4. Same LP, decision `Failed` with a reason → one email, and `accounts.status` is `Suspended`
   (#1274's behaviour, re-checked here only to confirm the email did not disturb the transaction).
5. Decision `ChangesRequested` with **no** reason and **no** rejected document → one email carrying
   the fallback paragraph, not an empty body.
6. Point `SENDGRID_BASE_URL` at a closed port with `EMAIL_DEV_LOG` unset, then post a decision →
   the endpoint still answers **`200`** with the updated LP, and a `warn` line records the failure.
   **This is the check that matters most**; it is what distinguishes this implementation from a
   verbatim copy of `password.rs:235`.
7. Review an individual document on an LP with `notify_on_review = true` → **no** email. The spec's
   "nothing else notifies" is a negative requirement and is otherwise untested.
8. An LP whose `contact_email` differs from its owner account's login email → the message goes to
   `contact_email`.

---

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` — no change, and do not add the file to this
  branch while PR #1382 is open.** § "Review Notifications" already specifies exactly what this
  issue implements: one email per trustee decision, gated on the preference, `ChangesRequested`
  carrying the reason plus the per-document rejections, nothing else notifying, best-effort
  delivery with no retry. The email *copy* is an implementation detail and does not belong in the
  spec. If #1382 has merged by implementation time, re-read the section from `main` and confirm
  nothing drifted; if it is still open, this branch must not fork the file.
- **`docs/exec-plans/tech-debt-tracker.md`** — add TD-98 (step 7). This is the Issue's own
  instruction: log the consequence rather than build retries.
- **`docs/exec-plans/active/issue-1378-kyb-decision-emails.md`** — this plan. Append a decision-log
  entry for anything decided during implementation that differs from it, in particular how the three
  Open Questions were resolved and the final copy of the three bodies.
- **No user-docs change.** `docs/user-docs/` describes the app's surfaces; a transactional email
  sent on an opt-in preference that has no UI yet (the LP-side toggle issue is not yet filed) has
  nothing to document there. Whoever files that UI issue documents the preference and the emails
  together.
- **No frontend change and no generated docs.** `packages/frontend/src/api/lps.ts` gains nothing —
  no DTO field is added.
- Run `npx tsx scripts/lint-docs.ts` (the tech-debt tracker is under `docs/`).
