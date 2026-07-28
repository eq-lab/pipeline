# Issue #949: Loan review: add ChangesRequested status (non-final, with reason)

Source: https://github.com/eq-lab/pipeline/issues/949

## Scope

Extend the loan-submission trustee review workflow with a third review outcome,
`ChangesRequested`, that is **non-final** (a submission in `ChangesRequested` can
be reviewed again) and, like `Rejected`, **requires a non-empty `reason`**.

In scope:

1. Add `ChangesRequested` to `SubmissionStatus` (shared) and `ReviewDecision` (API).
2. New forward-only migration extending the two CHECK constraints on
   `submitted_loans` (`status` allowed values and `submitted_loans_reason_ck`).
3. `resolve_review()` maps `ChangesRequested` to a reason-required rule identical
   to `Rejected`.
4. `SubmittedLoanRepo::review()` (and the handler's 404/409 logic) allow a review
   transition from `InReview` **or** `ChangesRequested`; `Approved`/`Rejected`
   remain terminal.
5. utoipa/OpenAPI docs (`ReviewRequest`, `ReviewDecision`, `list_submissions`
   status filter, `review_submission` responses) reflect the new value.
6. Product spec update in `docs/product-specs/api-authorization.md`.
7. Pure unit tests in `packages/api/tests/loan_submission.rs`.

Out of scope (per issue body):

- Frontend Trustee Origination UI changes to display `ChangesRequested` — tracked
  as a separate dependent frontend issue. The existing normalization logic (#892)
  maps any status outside `InReview`/`Approved`/`Rejected` to `Approved` for
  display and would misrepresent `ChangesRequested` until that issue lands.
- Originator edit/resubmit of `loan_data` while in `ChangesRequested`.
- Multi-round audit trail / reason history (single `reason` column is retained).

## Assumptions and Risks

- **Single `reason` column, no history.** Each review UPDATE overwrites `reason`
  (`SET reason = $3`). Moving `ChangesRequested → Approved` clears the reason to
  NULL (approval carries none); `ChangesRequested → Rejected` replaces it with the
  rejection reason; `ChangesRequested → ChangesRequested` replaces it with the new
  feedback. Prior `ChangesRequested` feedback is not preserved. This matches the
  existing design and is treated as the intended behavior — see Open Questions.
- **Migration ordering.** Newest migration is `20260727000001_ramp_reviews.sql`;
  today is 2026-07-28, so use `20260728000001_submitted_loans_changes_requested.sql`
  to sort last. Forward-only, idempotent-friendly (drop + re-add the two
  constraints; extend the DEFAULT-bearing column's CHECK).
- **CHECK constraint on `status` cannot be `ALTER`ed in place in Postgres.** Must
  `DROP CONSTRAINT` the anonymous column CHECK. The current `status IN (...)` and
  `reason` checks are declared inline: the `status` one is an unnamed inline CHECK,
  the reason one is the named `submitted_loans_reason_ck`. The unnamed `status`
  CHECK gets a system-generated name (e.g. `submitted_loans_status_check`) — the
  migration must drop it by that generated name (Postgres default naming:
  `<table>_<column>_check`). Verify the exact name against the running DB or use
  a defensive `DO $$ ... $$` block that looks it up; the coder should confirm.
- **`SubmissionStatus::from_str` error string** currently lists only the three
  legacy statuses; must be updated so parse round-trips and the API status filter
  accepts `ChangesRequested`.
- No on-chain component: this is purely the off-chain submission review record.

## Open Questions

_Resolved._ Confirmed with the human reviewer: repeated `ChangesRequested` rounds
are allowed, and overwriting the single `reason` column on each new review
decision (no audit/history of prior feedback text) is acceptable. No history
table is in scope.

## Implementation Steps

1. **`packages/shared/src/submitted_loan_repo.rs`**
   - Add `ChangesRequested` variant to `enum SubmissionStatus` (doc comment: "Sent
     back to the originator with feedback; non-final — may still be reviewed to
     Approved/Rejected. Always carries a `reason`.").
   - Add its arm to `as_str()` → `"ChangesRequested"` and to `from_str()`; update
     the `from_str` error message to include the new value.
   - Update `SubmittedLoanRow.status` / `reason` field doc comments (reason is now
     `Some` iff status is `Rejected` or `ChangesRequested`).
   - `review()`: change the conditional UPDATE guard from
     `WHERE id = $1 AND status = 'InReview'`
     to `WHERE id = $1 AND status IN ('InReview', 'ChangesRequested')`.
     Update the doc comment to describe the two non-terminal source states and the
     reason rule (`Some` iff new_status is `Rejected` or `ChangesRequested`).

2. **New migration `packages/shared/migrations/20260728000001_submitted_loans_changes_requested.sql`**
   - Drop the existing inline `status IN (...)` CHECK (by its generated name; use a
     `DO` block that discovers the constraint name on `submitted_loans` for the
     `status` column to be robust) and add a new CHECK
     `status IN ('InReview', 'Approved', 'Rejected', 'ChangesRequested')`.
   - `ALTER TABLE submitted_loans DROP CONSTRAINT submitted_loans_reason_ck;`
     then re-add:
     ```sql
     ALTER TABLE submitted_loans ADD CONSTRAINT submitted_loans_reason_ck CHECK (
         (status IN ('Rejected', 'ChangesRequested') AND reason IS NOT NULL) OR
         (status NOT IN ('Rejected', 'ChangesRequested') AND reason IS NULL)
     );
     ```
   - Header comment mirroring the existing migrations' style, documenting the new
     lifecycle and the non-final nature of `ChangesRequested`, plus the rollback
     reference SQL.

3. **`packages/api/src/routes/loan_book.rs`**
   - Add `ChangesRequested` variant to `enum ReviewDecision`.
   - `resolve_review()`: fold `ChangesRequested` into the reason-required branch.
     Cleanest shape: match `ReviewDecision::Rejected | ReviewDecision::ChangesRequested`
     into one arm that requires a non-empty trimmed reason, mapping each decision
     to its corresponding `SubmissionStatus` (`Rejected`→`Rejected`,
     `ChangesRequested`→`ChangesRequested`); keep `Approved` unchanged. Update the
     error message ("a non-empty `reason` is required to reject or request changes
     on a submission") and the function doc comment.
   - `ReviewRequest.decision` / `.reason` doc comments: note `ChangesRequested`
     also requires a reason.
   - `review_submission` utoipa doc: update the summary and the `200`/`409`
     descriptions to state that `ChangesRequested` is non-final and re-reviewable;
     the `409` now means "submission already Approved or Rejected (terminal)".
   - Confirm `list_submissions` status-filter description / any inline validation
     accepts `ChangesRequested` (it parses via `SubmissionStatus::from_str`, so
     step 1 covers it — just update the doc string listing valid filter values).

4. **Docs — `docs/product-specs/api-authorization.md`**
   - Update the endpoints table rows (L52–54) for the `status` filter values and
     the `review` body decision values.
   - Update the **Lifecycle** section (L87–96): add the `ChangesRequested` state,
     show it as non-terminal (can transition to `Approved`/`Rejected`/again),
     clarify that only `Approved`/`Rejected` are terminal, and that the `409` fires
     only from a terminal state.
   - Update the `status` and `reason` rows in the `submitted_loans` table (L118–119):
     `reason` present iff `status IN (Rejected, ChangesRequested)`.

## Test Strategy

Pure unit tests in `packages/api/tests/loan_submission.rs` (no DB, per project
convention — DB CHECK constraints are covered by the migration, not tests):

- `changes_requested_without_reason_is_rejected` — `ReviewDecision::ChangesRequested`
  with `reason: None` and with whitespace-only reason both return `Err` from
  `resolve_review`.
- `changes_requested_with_reason_resolves_to_changes_requested` — valid reason
  yields `(SubmissionStatus::ChangesRequested, Some("..."))`.
- Extend `submission_status_round_trips` to include `SubmissionStatus::ChangesRequested`.
- (Optional) assert `"ChangesRequested".parse::<SubmissionStatus>()` succeeds
  alongside the existing `submission_status_rejects_unknown` test.

Note on transition coverage: the `InReview|ChangesRequested → Approved/Rejected`
and terminal-state (`Approved`/`Rejected`) rules live in the SQL `review()` guard,
not in the pure `resolve_review` layer, so they cannot be exercised by DB-free unit
tests. The issue's requested transition-coverage tests are therefore satisfied at
the `resolve_review` level (which decisions are accepted and require reasons); the
terminal-vs-nonterminal guard is enforced and documented in the migration + repo
SQL and asserted by the `WHERE status IN (...)` clause. Call this out to the coder
so no DB-gated test is added (memory rule: tests must not connect to Postgres).

After changes: `cargo clippy --all -- -D warnings` and `cargo test -p pipeline-api`
must pass.

## Docs to Update

- `docs/product-specs/api-authorization.md` — lifecycle, endpoints table, and
  `submitted_loans` column notes (step 4). This is required: the change is
  agent/user-facing API behavior.
- No design-doc or generated-schema updates required beyond the above.
