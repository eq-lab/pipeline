# Issue #1274: Backend: KYB state machine — submit for review + trustee verdict endpoints

Source: https://github.com/eq-lab/pipeline/issues/1274

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` §§ "KYB Review Lifecycle", "Review
Notifications", "Settlement Address" — **merged to `main`** (PR #1382, commit
`d509486`). Read it from the working tree. The `docs/kyb-review-lifecycle` branch
is gone, so the earlier `git show origin/docs/kyb-review-lifecycle:…` instruction
in this plan is dead; ignore any surviving trace of it.

**Revised 2026-09-30**, after the review of #1382 and after #1379 landed on its own
branch. Three things changed and are folded in below:

- This branch **rebases on top of #1379** (PR #1386, in review, merges first). Read
  "Rebasing over #1379" under Assumptions and Risks before touching
  `packages/shared/src/lp_repo.rs` or `packages/api/src/routes/lps.rs`.
- `review_document` gains an `UnderReview` precondition — scope item 7, step 7.
- The trustee verdict must reach the audit log — scope item 8, step 8.

## Scope

Give `kyb_status` its lifecycle. Today nothing writes it past `NotStarted`, so the
freeze shipped in #1267 is inert, every status but `NotStarted` is unreachable, and
the settlement-address rule #1379 just rewrote has nothing to bite on. This issue is
what makes all of it live.

In scope:

1. **Migration** — `lps.kyb_status` CHECK gains `'ChangesRequested'`; new columns
   `kyb_submitted_at`, `kyb_decided_by`, `kyb_decided_at`, `kyb_decision_reason`.
   No history table: only the latest decision is retained.
2. **State machine** in `shared::lp_repo::KybStatus` — add `ChangesRequested`;
   `OWNER_WRITABLE` becomes `[NotStarted, InProgress, ChangesRequested]` (`Failed`
   leaves the set and becomes terminal); a pure, total transition predicate. The
   submittable set is `[NotStarted, ChangesRequested]` — **not** the owner-writable
   set: the merged spec says `InProgress` "is treated as writable, like
   `NotStarted`, but nothing produces it and **nothing transitions out of it**",
   and the Issue body says submit is "allowed from `NotStarted` and
   `ChangesRequested` only". Adding the variant also forces a new arm in #1379's
   `allows_address_write` match (step 2).
3. **`POST /v1/lps/me/submit`** (owner) → `200 LpResponse`. From `NotStarted` /
   `ChangesRequested` only; refused unless ≥1 document and zero `Rejected`
   documents, naming the offending ids; sets `kyb_submitted_at`.
4. **`POST /v1/lps/{id}/kyb`** (trustee) → `200 LpResponse`. From `UnderReview`
   only; `{ decision: Passed | ChangesRequested | Failed, reason?: string }`;
   `Passed` refused unless every document is `Verified`; `reason` optional on all
   three; records `kyb_decided_by` / `kyb_decided_at` / `kyb_decision_reason`.
   `Failed` also sets `accounts.status = 'Suspended'` **in the same transaction**.
5. **Response shape** — `LpResponse` gains `kyb_submitted_at`, `kyb_decided_at`,
   `kyb_decision_reason`; `LpSummary` gains `kyb_submitted_at`, `kyb_decided_at`.
   `writable` is already derived from `OWNER_WRITABLE` and needs no change beyond
   the set itself moving.
6. Rewrite the now-false doc comments that justify `Failed` staying writable
   (`lp_repo.rs` module + `allows_owner_writes`, `routes/lps.rs` module header
   points 1–2, and the "#1274's job, so this gate is inert" sentence). After the
   rebase this also covers the sentences #1379 added, which assert the opposite
   half of the same rule — see "Rebasing over #1379".
7. **`review_document` gains a precondition: the LP must be `UnderReview`.**
   Today the handler enforces only `require_trustee` — there is no LP-status check
   at all. Combined with "a `Verified` document can never be deleted", a trustee
   (or a stray call) can verify a document on an LP still at `NotStarted`,
   permanently pinning that file into a record its owner is still assembling and
   closing the only correction path there is (delete-then-upload). Submitting is
   what declares the set ready to judge. Refuse with `409` when the LP is not
   `UnderReview`; the judgement goes in the pure-function layer, not an ad-hoc
   read (spec § KYB Review Lifecycle, ¶2: "Review runs only while the LP is
   `UnderReview`"). This lands here rather than in a sibling because it is a
   transition-adjacent invariant and this issue owns `routes/lps.rs`'s status rules.
8. **The trustee verdict reaches the audit log.** "Only the latest decision is
   retained; there is no review history" is a statement about the `lps` row, not an
   exemption from `docs/product-specs/audit-logging.md` § Scope, which requires an
   operator action in the Operations Console to be recorded with the actor, the
   target resource, and the outcome. See step 8 — the honest finding is that no
   such store exists in this repo, so the step proposes the smallest thing that is
   not a lie, and Open Question 2 asks whether that is acceptable.

Out of scope — each is a sibling sub-issue of #1376, do not touch:

- `notify_on_review` and the narrowed write freeze on `POST /v1/lps/me` → **#1377**
- Decision emails → **#1378**
- Ungating `POST /v1/lps/me/link-address` from `kyb_status` → **#1379**, which has
  **already landed** on `feat/1379-ungate-link-address` (PR #1386) and merges before
  this branch. Do not re-do, re-litigate, or revert any of it; do not add a
  `guard_writable` call to `link_address`. Only reconcile it — see "Rebasing over
  #1379".
- Making `accounts.status = 'Suspended'` actually gate requests → **#1380**
  (this issue owns the *write*, not the enforcement)
- LP-app and Trustee-dashboard UI (trustee verdict buttons are #1271 under #1269)
- Review **history** — no per-decision table on the `lps` side, no endpoint to read
  past decisions, and no backfill; pagination or a status filter on `GET /v1/lps`
  (the review queue is that listing filtered client-side). Scope item 8 adds an
  audit record of the verdict, which is a different thing: an operator-action trail,
  not a queryable review history. Building the append-only operator-action store
  itself (a table, plus mirroring to the third-party sink) is **out of scope** and
  stays a follow-up of `audit-logging.md`.

## Assumptions and Risks

- **Spec is merged** (PR #1382, `d509486`) and is the authority. Re-read it from
  the working tree, not from a branch ref. Do not re-litigate its decisions — they
  were settled with the user. Two places where this plan as first written drifted
  from the merged text, both corrected below: `InProgress` is **not** a submit
  source (§ KYB Review Lifecycle: "nothing transitions out of it"), and the verdict
  **is** an audited operator action (same §, last ¶ of the decision-retention
  paragraph).
- **`Failed` becomes terminal and frozen.** `lps.owner_account_id` is UNIQUE, so a
  `Failed` LP is permanently dead by design; the account is suspended alongside it
  and reversal is manual DB intervention. #1267 documented the opposite rule, so
  every comment stating "`Failed` stays open" is now wrong and must be rewritten,
  not left standing.
- **`Failed` leaving `OWNER_WRITABLE` silently changes three other call sites**:
  `LpRepo::upsert_by_owner_account_id`, `KybDocumentRepo::insert` and
  `KybDocumentRepo::delete` all bind `owner_writable_strs()` into SQL. That is the
  intended behaviour (a failed LP freezes wholesale) but it is a behaviour change
  reached indirectly — call it out in the PR description.
- **`lps_stellar_address_passed_ck` is already gone.** #1379's migration
  `20260929000003_drop_lps_stellar_address_passed_ck.sql` drops it, and that
  migration is on the branch this one rebases onto. So the constraint is not a
  consideration here any more: do **not** re-add it, do not reason about it, and do
  not touch that file. The settlement-address rule now lives only in
  `LpRepo::link_address`'s `WHERE` predicate.
- **Ordering against #1379 — settled: #1379 first, then #1274.** Recorded on the
  Issue: #1379's predicate (`kyb_status <> 'Failed' AND (stellar_address IS NULL OR
  kyb_status <> 'Passed')`) is vacuously permissive while `Passed` is unreachable,
  so taking it first leaves a zero-width window. The reverse order has an
  irreversible cost: the old predicate was one-shot (`stellar_address IS NULL`), so
  an address typo'd during the window could never be corrected through the API once
  the LP reached `Passed`. This branch therefore assumes #1379 is in its history and
  must not be merged before it.
- **No integration coverage.** Repo rules forbid tests that reach a real Postgres,
  so the SQL predicates (the actual enforcement) are not test-covered. Everything
  test-covered here must therefore be a pure function, and the SQL must be a
  faithful restatement of it. This duplication is deliberate; keep the pure
  function the single place the policy is *stated*.
- **Reason length is unbounded.** `kyb_decision_reason` is `TEXT`; the JSON route
  carries axum's default 2MB body limit (only the upload route is raised), so the
  blast radius is small — but bound it anyway, mirroring `MAX_LEGAL_NAME_LEN`.

### Rebasing over #1379

#1379 (`feat/1379-ungate-link-address`, PR #1386) edits the same two files this
issue edits and merges first. Read it before writing any code:

```bash
git diff main...origin/feat/1379-ungate-link-address --stat
git diff main...origin/feat/1379-ungate-link-address -- \
    packages/shared/src/lp_repo.rs packages/api/src/routes/lps.rs
```

What it added: `KybStatus::allows_address_write(has_address)`; a three-clause
`WHERE` in `LpRepo::link_address`; a status pre-check at the top of the
`link_address` handler; migration `20260929000003_drop_lps_stellar_address_passed_ck.sql`;
`packages/shared/tests/settlement_address.rs`; four tests in
`packages/api/tests/lps.rs`; a widened TD-57 in the tech-debt tracker; a
user-stories doc under `docs/user-stories/epic-1376/` plus its index row.

**Overlapping hunks, and what the rebase must preserve:**

1. `packages/shared/src/lp_repo.rs` module header — #1379 rewrote ¶1 ("`link_address`
   … is not gated on reaching `Passed`"). This issue rewrites the *same paragraph
   region* for the `Failed`-is-terminal rule. Keep both facts; do not drop #1379's
   sentence while rewriting around it.
2. `KybStatus` enum body — this issue inserts the `ChangesRequested` variant.
   #1379's `allows_address_write` matches the variants exhaustively
   (`NotStarted | InProgress | UnderReview => true`), so **adding the variant breaks
   the build until `ChangesRequested` is classified there**. Classify it `true`: it
   is a non-terminal status, and the spec says the address is settable "at any
   status short of a terminal verdict". Do not collapse the arm to a `_` wildcard —
   #1379's own test asserts that a new status must stop the match from compiling
   until it is classified on purpose.
3. `KybStatus::OWNER_WRITABLE` / `allows_owner_writes` — this issue removes `Failed`.
   That is one half of the crossing #1379 documented, so its `allows_address_write`
   doc comment ("the two policies cross at `UnderReview` and again, in the opposite
   direction, at `Failed`") becomes **false** and must be rewritten in the same PR,
   not left standing. After this issue the true statement is: the two policies still
   cross at `UnderReview` (address open, profile frozen) and at `Passed` with no
   address yet (one address write allowed, profile frozen), but `Failed` now closes
   **both** — for independent reasons, which is the point worth keeping: the address
   closure rests on `stellar_address` being UNIQUE across LPs and must not be
   restated as "because the record is frozen", and the freeze must not be restated
   as "because the address is closed". Owner-writable now *implies*
   address-writable; they are still two policies because they answer different
   questions and #1377 narrows the freeze again. The two doc comments must end up
   agreeing.
4. **`packages/shared/tests/settlement_address.rs` will fail** after the
   `OWNER_WRITABLE` change — `the_policy_is_independent_of_the_write_freeze` asserts
   `KybStatus::Failed.allows_owner_writes()` is **true**, and
   `the_policy_is_total_and_classifies_every_status_deliberately` hard-lists the five
   statuses and matches them exhaustively in its local `expected` helper. Update both
   (add `ChangesRequested` to the list and to `expected`; replace the `Failed`
   "reverse crossing" assertion with the `Passed`-with-no-address crossing, which is
   the one that survives and still proves the two policies are independent). Rewrite,
   do not delete — the same rule this plan already applies to
   `kyb_status.rs::a_failed_lp_reopens`.
5. `packages/api/src/routes/lps.rs` module header ¶ "Two rules govern every owner
   write" — #1379 appended a sentence to point 1 and left the "transitions are
   #1274's job, so this gate is inert until that lands" clause in place. This issue
   deletes that clause and rewrites point 2. Keep #1379's settlement-address
   sentences.
6. `link_address` handler and its doc comment — **do not touch**. #1379 documented in
   the doc comment that `link_address` must not gain a `guard_writable` call, because
   the address is exempt from the freeze at `UnderReview` and closed at `Failed` on
   its own rule. Removing `Failed` from `OWNER_WRITABLE` does not change that: the
   exemption is still load-bearing at `UnderReview`, and the `Failed` closure is
   still the predicate's own, not the freeze's.
7. Migration stamp — `20260929000003` is taken by #1379. See step 1.
8. `docs/exec-plans/tech-debt-tracker.md` TD-57 — #1379 widened it and already says
   "#1274 is what will make `kyb_status` reachable at all, so the gap goes live once
   both have landed". That sentence becomes true when this merges; it needs no edit.
9. `docs/user-stories/index.md` — #1379 created the `## Epic #1376` table and one row.
   Append this issue's row below it (step 11).

## Open Questions

1. **Should the trustee-only `GET /v1/lps/{id}` carry `kyb_decided_by`?** It is
   deliberately absent from `LpResponse` for now, and that part is settled: the same
   DTO is served to the LP owner through `GET /v1/lps/me`, so putting it there would
   hand the applicant the individual operator's identity on every refusal. What is
   still open is whether the trustee read should surface it — which needs either a
   second DTO or a conditional field, i.e. real design, not a one-line addition.
   Awaiting the user. **The column is not in doubt**: `kyb_decided_by` is written and
   stored either way (steps 1, 4, 6), so this question blocks nothing in the plan and
   the answer is an additive change whenever it arrives. Related: the trustee
   dashboard #1271 is the consumer that would need it.
2. **Is a structured log line an acceptable audit record for the verdict, for now?**
   `audit-logging.md` § Scope requires operator actions to be written to the
   append-only store with actor, target, and outcome. **That store does not exist in
   this repo**: there is no audit table in `packages/shared/migrations/`, no writer
   anywhere in `packages/`, no sink integration, and `audit_log.rs` serves an
   unrelated substrate (indexed on-chain `contract_logs`) — its own module comment
   says operator actions "are not persisted in a queryable store today". Building the
   store is a multi-issue piece of work and plainly outside this issue. Step 8
   therefore proposes the smallest thing that is not a lie — one `tracing::info!`
   event carrying actor, target, outcome, and reason-presence — plus a tech-debt
   entry saying the verdict is not in an append-only store. Confirm that is the right
   trade for now, or say the audit store must be built first and this issue blocks
   on it. Note the honest caveat, which is why this is a question and not a decision:
   `packages/api/src/main.rs` uses a bare `tracing_subscriber::fmt::init()`, so the
   line lands in plaintext stdout with no JSON encoding and no mirroring — it is a
   trail only to the extent the deployment's log shipping is one.

Settled since the first draft, recorded here so they are not reopened:

- **Merge ordering with #1379** — resolved on the Issue: #1379 first, then #1274,
  never the reverse. See Assumptions and Risks.
- **`409` vs `422` for a failed invariant** — resolved on the Issue: `409` throughout
  for state conflicts, `400` for a malformed body. House convention (`ApiError::Conflict`
  used 12 times for state conflicts, `UnprocessableEntity` once, for a refused
  computation).

## Implementation Steps

### 1. Migration

Add `packages/shared/migrations/20260930000001_kyb_review_lifecycle.sql`.

**Re-stamped.** The plan originally reserved `20260929000001`; #1379's branch now
holds `20260929000003`, and since #1379 merges first, a `…0929000001` file would sort
*before* a migration already applied in any environment that took #1379. That is not
a breakage — `sqlx` 0.8.6's `Migrator::run` applies any version absent from
`_sqlx_migrations` regardless of order, and only errors when an *applied* migration
is missing from the source (`validate_applied_migrations` → `VersionMissing`) — but
it makes the directory stop reflecting apply order, which is the only thing the file
name is for. Use `20260930000001`. Re-check before writing the file, since the
sibling branches move:

```bash
git log --all --diff-filter=A --name-only --pretty=format: -- \
    'packages/shared/migrations/*' | grep -E '2026(09|10)' | sort -u
```

Follow the house style of `20260924000001_kyb_documents_untyped_and_storage.sql`:
a module comment stating the intent, inverse SQL in a comment (migrations are
forward-only), and every statement written to survive a re-run
(`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` first).

```sql
ALTER TABLE lps DROP CONSTRAINT IF EXISTS lps_kyb_status_check;
ALTER TABLE lps ADD CONSTRAINT lps_kyb_status_check
    CHECK (kyb_status IN ('NotStarted', 'InProgress', 'UnderReview',
                          'ChangesRequested', 'Passed', 'Failed'));

ALTER TABLE lps
    ADD COLUMN IF NOT EXISTS kyb_submitted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kyb_decided_by      TEXT,
    ADD COLUMN IF NOT EXISTS kyb_decided_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS kyb_decision_reason TEXT;
```

Verify the CHECK's real constraint name first (`\d lps`, or read
`20260915000001_kyb_lps_and_documents.sql` line 36–37 — it is an inline
unnamed CHECK, so Postgres named it `lps_kyb_status_check`). If the drop-by-name
is uncertain, drop by looking it up; do **not** leave the old CHECK in place, or
`'ChangesRequested'` will be rejected at write time.

All four columns are nullable with no backfill: an LP that has never been
submitted has no submission time, and `NULL` is the honest value.

### 2. `shared::lp_repo::KybStatus`

In `packages/shared/src/lp_repo.rs`:

- Add the `ChangesRequested` variant, plus its `as_str` and `FromStr` arms, and
  update the `FromStr` error string to list all six spellings.
- `OWNER_WRITABLE: [KybStatus; 3] = [NotStarted, InProgress, ChangesRequested]`.
- Rewrite the `allows_owner_writes` doc comment: `UnderReview`, `Passed` **and
  `Failed`** are frozen; `ChangesRequested` is the only thing that reopens a
  record; `Failed` is terminal and suspends the owning account, which is why the
  UNIQUE-`owner_account_id` argument for keeping it open no longer applies.
  Update the module header the same way.
- Add the transition predicate as a **pure associated function**, the single
  statement of the epic's table:

  ```rust
  /// Whether `self` may move to `to` (spec § KYB Review Lifecycle).
  pub fn may_transition_to(self, to: KybStatus) -> bool
  ```

  `NotStarted | ChangesRequested -> UnderReview`;
  `UnderReview -> Passed | ChangesRequested | Failed`; everything else `false`,
  including self-transitions and **including `InProgress -> UnderReview`**.

  **Corrected from the first draft**, which had `InProgress` as a legal submit
  source. The merged spec is explicit: `InProgress` "remains a legal value of the
  column and is treated as writable, like `NotStarted`, but nothing produces it and
  **nothing transitions out of it** — it is unreachable", and the Issue body says
  submit is "allowed from `NotStarted` and `ChangesRequested` only". So `InProgress`
  is writable *and* unsubmittable: no row has ever held it, so nothing is stranded,
  and if one somehow did, its owner can still edit the record — the owner-writable
  and submittable sets are genuinely different sets, which is the whole reason the
  next bullet refuses to reuse `owner_writable_strs`. Consequence for the handler:
  a submit from `InProgress` is a `409`, worded from the status like every other
  refused transition.
- Add `pub const ALL: [KybStatus; 6]` so tests can assert the transition table is
  total without re-listing the variants.
- Add `pub const SUBMITTABLE: [KybStatus; 2] = [NotStarted, ChangesRequested]` and
  `pub fn submittable_strs() -> Vec<&'static str>` — for binding into the submit
  UPDATE, mirroring `OWNER_WRITABLE` / `owner_writable_strs`. The two sets do **not**
  coincide (`InProgress` is writable but not submittable), so reusing
  `owner_writable_strs` here would be an outright bug, not merely a conflation.
  Keep `may_transition_to(UnderReview)` and `SUBMITTABLE` consistent — assert it in
  a test rather than deriving one from the other, so a future edit to either is
  caught.
- Add the `ChangesRequested` arm to #1379's `allows_address_write` (→ `true`) and
  reconcile its doc comment with `allows_owner_writes`' — see "Rebasing over #1379",
  points 2 and 3. This is compulsory: the match is exhaustive over the variants, so
  the crate does not build until the new variant is classified.
- Extend `LpRow` with `kyb_submitted_at: Option<DateTime<Utc>>`,
  `kyb_decided_by: Option<String>`, `kyb_decided_at: Option<DateTime<Utc>>`,
  `kyb_decision_reason: Option<String>`, and add the four columns to **every**
  `SELECT` list in the file (`find_by_owner_account_id`, `list`, `find`).
  Factor the repeated column list into a `const COLUMNS: &str` the way
  `kyb_document_repo.rs` and `account_repo.rs` already do — four SELECTs drifting
  apart is the predictable failure here.

### 3. `shared::kyb_document_repo`

- Add `impl FromStr for DocumentStatus` (and the matching error string), so the
  route layer can turn a stored `status` string into the enum the pure
  invariant checks take.

### 4. Repo methods — the transitions

In `packages/shared/src/lp_repo.rs`, both conditional on the current status in
SQL rather than on a prior read, following the `link_address` /
`SubmittedLoanRepo::review` pattern already in the codebase.

```rust
/// Move the LP to `UnderReview`. Returns `false` when the row was not in a
/// submittable status or the document invariants did not hold — the caller
/// has already read the documents to build the precise refusal message, and
/// this predicate is what actually enforces it.
pub async fn submit_for_review(&self, id: i64) -> Result<bool, sqlx::Error>
```

```sql
UPDATE lps
   SET kyb_status = 'UnderReview', kyb_submitted_at = now(), updated_at = now()
 WHERE id = $1
   AND kyb_status = ANY($2)
   AND EXISTS     (SELECT 1 FROM kyb_documents WHERE lp_id = $1)
   AND NOT EXISTS (SELECT 1 FROM kyb_documents WHERE lp_id = $1 AND status = 'Rejected')
```

`$2` binds `KybStatus::submittable_strs()` — **not** `Self::writable_statuses()` /
`owner_writable_strs()`, which the other three UPDATEs in this file bind. The sets
differ by `InProgress` (writable, not submittable), so reusing the writable list here
would let an unsubmittable status through. See step 2.

```rust
/// Record a trustee verdict on an LP sitting at `UnderReview`. `Failed` also
/// suspends the owning account, in the same transaction: the two facts are
/// worthless apart, and an account left Active after a terminal refusal could
/// keep using the API.
pub async fn decide_kyb(
    &self,
    id: i64,
    decision: KybStatus,
    reason: Option<&str>,
    decided_by: &str,
) -> Result<bool, sqlx::Error>
```

Implementation: `self.pool.begin()`, then

```sql
UPDATE lps
   SET kyb_status = $2, kyb_decided_by = $3, kyb_decided_at = now(),
       kyb_decision_reason = $4, updated_at = now()
 WHERE id = $1
   AND kyb_status = 'UnderReview'
   AND ($2 <> 'Passed'
        OR NOT EXISTS (SELECT 1 FROM kyb_documents
                        WHERE lp_id = $1 AND status <> 'Verified'))
RETURNING owner_account_id
```

If no row comes back, roll back (drop the tx) and return `false`. If
`decision == Failed`, then in the same tx:

```sql
UPDATE accounts SET status = 'Suspended', updated_at = now() WHERE id = $1
```

bound to the returned `owner_account_id`, which is a `Uuid` (`accounts.id` is
`uuid`, so `RETURNING owner_account_id` reads back as `Uuid`, not an integer).
Commit.

This is the one place `lp_repo` writes a table other than `lps`. That is deliberate
and the cost is accepted rather than hidden: atomicity needs one transaction, and
`AccountRepo` has no status-setting method to borrow. Say so in the method's doc
comment, and do not add a second write path from the route layer — two sequential
repo calls would leave a refused LP with an `Active` account whenever the second
fails.

Nothing in the repo layer re-checks that `decision` is one of the three verdicts: the
route layer constrains it via the `KybDecision` request enum, and
`may_transition_to` is checked before the call. Do not add a `debug_assert!` or a
comment saying so (AGENTS.md § Lint & style budget) — state it in the method's doc
comment instead, which is the one place public-item prose is allowed.

Note in the method doc that a `Passed` with zero documents cannot occur: submit
already required ≥1, and `NOT EXISTS (… status <> 'Verified')` is vacuously true
on an empty set. The invariant is carried by submit, not by this predicate.

### 5. Pure compute in `packages/api/src/routes/lps.rs`

All four go in the `// ── Compute (pure) ──` section, `pub` so
`packages/api/tests/lps.rs` can drive them without HTTP or DB — the same shape as
`resolve_document_review` / `validate_profile`.

```rust
/// The trustee verdict in `POST /v1/lps/{id}/kyb`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub enum KybDecision { Passed, ChangesRequested, Failed }

#[derive(Debug, Deserialize, ToSchema)]
pub struct KybDecisionRequest {
    pub decision: KybDecision,
    #[serde(default)]
    pub reason: Option<String>,
}

pub const MAX_DECISION_REASON_LEN: usize = 2_000;

/// `reason` is optional on every decision (spec). Blank collapses to `None` so
/// a form submitting an empty textarea stores `NULL`, not `""`. Length is
/// counted in characters, matching `validate_profile`.
pub fn resolve_kyb_decision(req: &KybDecisionRequest)
    -> Result<(KybStatus, Option<&str>), String>;

/// Why this LP may not be submitted for review, if it may not. Names the
/// offending document ids (spec: "the refusal names the offending ids").
pub fn submit_blockers(docs: &[(i64, DocumentStatus)]) -> Result<(), String>;

/// Why this LP may not be passed, if it may not — the ids of every document
/// not yet `Verified`.
pub fn pass_blockers(docs: &[(i64, DocumentStatus)]) -> Result<(), String>;
```

`submit_blockers`: empty slice → "this LP has no documents to review"; any
`Rejected` → a message listing those ids, sorted ascending for determinism
(`list_for_lp` returns newest-first, and a test asserting on message text must
not depend on insertion order).

`pass_blockers`: any status other than `Verified` → list those ids, sorted.

Both take `(id, DocumentStatus)` pairs rather than `KybDocumentRow` so the tests
stay pure and cheap to write; the handler maps rows into them with the new
`DocumentStatus::from_str`, treating an unparseable stored status as
`ApiError::Internal` (it cannot occur — the column has a CHECK).

### 6. Routes

Register in `router()`:

```rust
.route("/lps/me/submit", post(submit_my_lp))
.route("/lps/{id}/kyb", post(decide_kyb))
```

Place `/lps/{id}/kyb` beside the existing `/lps/{id}/documents/{doc}/review`, and
`/lps/me/submit` with the other `/me` routes. `/lps/me/*` is declared before
`/lps/{id}` already, so there is no route-matching ambiguity to introduce.

**`submit_my_lp`** (owner, no trustee check):

1. `let lp = my_lp(&claims, &state).await?;`
2. Parse `lp.kyb_status` into `KybStatus` (`ApiError::Internal` on failure, as
   `guard_writable` does).
3. `if !status.may_transition_to(KybStatus::UnderReview)` → `ApiError::Conflict`
   naming the current status, e.g. `"this LP is UnderReview and cannot be
   submitted for review"`.
4. Read `kyb_document_repo.list_for_lp(lp.id)`, map to `(id, DocumentStatus)`,
   `submit_blockers(...)` → `ApiError::Conflict` on `Err`.
5. `lp_repo.submit_for_review(lp.id)` → on `false`, `ApiError::Conflict(
   "this LP is no longer eligible for review")` (lost a race against a concurrent
   upload/review/decision — the SQL predicate is the authority).
6. Re-read with `lp_repo.find(lp.id)` (the same
   "vanished immediately after" `ApiError::Internal` guard `link_address` uses)
   and answer `Json(with_documents(&state, row).await?)`.

**`decide_kyb`** (trustee):

1. `require_trustee(&claims)?;`
2. `resolve_kyb_decision(&req).map_err(ApiError::BadRequest)?`
3. `lp_repo.find(id)` → `404` when absent (message shape as in `get_lp`).
4. Parse the current status; `if !status.may_transition_to(decision)` → `409`
   naming both, e.g. `"an LP in ChangesRequested cannot be moved to Passed"`.
5. When `decision == Passed`: read the documents and `pass_blockers(...)` →
   `409` on `Err`.
6. `lp_repo.decide_kyb(id, decision, reason, &claims.sub)` → `false` ⇒ `409`
   ("this LP is no longer awaiting review"). `claims.sub` is the deciding
   operator, matching what `review_document` records in `reviewed_by`.
7. Emit the audit log line — step 8. After the repo returned `true`, before the
   re-read.
8. Re-read and answer `Json(with_documents(...))`, same as above.

Both handlers get `#[utoipa::path(...)]` annotations documenting 200/400/401/403/
404/409 as applicable, `security(("bearer_auth" = []))`, `tag = "Lps"`; add both
to `LpsDoc`'s `paths(...)` and `KybDecision` / `KybDecisionRequest` to its
`components(schemas(...))`.

A third handler changes in this issue but gains no route: `review_document` — step 7.

### 7. `review_document` gains the `UnderReview` precondition

Spec § KYB Review Lifecycle ¶2. Three parts: a pure predicate, a handler guard, and
the SQL that closes the race.

**Pure predicate** — in `packages/shared/src/lp_repo.rs`, beside its two siblings, so
the three status policies read as one family:

```rust
/// Whether an individual document of this LP may be reviewed now
/// (spec § KYB Review Lifecycle).
pub fn allows_document_review(&self) -> bool {
    matches!(self, KybStatus::UnderReview)
}
```

Written as `matches!` over `UnderReview` alone rather than as the complement of
anything: the rule is "only while under review", and stating it as an exclusion list
would silently admit each new status. Its doc comment carries the *reason* (a
`Verified` document can never be deleted, so verifying early permanently pins a file
into a record its owner is still assembling), because that is what makes the rule
non-obvious. Place it after `allows_owner_writes` and before `allows_address_write`,
and keep all three doc comments mutually consistent (see "Rebasing over #1379").

**Handler guard** — in `review_document` (`packages/api/src/routes/lps.rs`), after
`require_trustee` and the existing ownership check. The handler today reads the
document (`kyb_document_repo.find(doc)`) purely to confirm `d.lp_id == id`, and does
**not** read the LP at all — so **the LP status needs a new read**:
`state.lp_repo.find(id)`. Order it after the document check, so a bad `(id, doc)` pair
keeps its current `404 "no document {doc} for LP {id}"`; the LP is then guaranteed to
exist (the document's `lp_id` is an FK), so a `None` there is `ApiError::Internal`,
not a `404`. Parse `lp.kyb_status` into `KybStatus` with the same
`map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))` shape `guard_writable` uses, and
on `!status.allows_document_review()` return
`ApiError::Conflict(format!("LP {id} is {status} and its documents are not under review"))`.

Do **not** fold this into `guard_writable`: that helper answers the owner-write
question and is the inverse of this one at `UnderReview`.

**SQL** — extend `KybDocumentRepo::review`'s `WHERE` with the LP-status clause, so the
gap between the read and the write cannot be used:

```sql
AND EXISTS (SELECT 1 FROM lps l WHERE l.id = kyb_documents.lp_id
                                  AND l.kyb_status = 'UnderReview')
```

Without it, a trustee's verify can land on an LP that a *second* trustee moved to
`Passed` or `Failed` in between — exactly the pinning the rule exists to prevent, and
now reachable for the first time because this issue is what makes those statuses
reachable. The method signature does not change (`lp_id` comes from the row itself).
Widen the `!reviewed` refusal message accordingly — it can now mean either cause:
`"document {doc} is not awaiting review, or LP {id} is no longer under review"`.

Update the `review_document` doc comment and its `#[utoipa::path]` `409` description
to name the new cause.

### 8. The verdict reaches the audit log

**Finding first, because it changes what this step can honestly be.**
`docs/product-specs/audit-logging.md` § Scope requires an Operations Console operator
action to be recorded in the append-only store with the actor's authenticated session
identifier, the target resource, and the outcome. **There is no such store in this
repo.** Verified:

- No audit table in `packages/shared/migrations/` — nothing creates one.
- No writer: no repo in `packages/shared/src/` writes an operator-action row, and no
  third-party sink or SIEM integration exists in `packages/` or the workspace manifests.
- `packages/api/src/routes/audit_log.rs` is **not** it: `GET /v1/audit-log` reads
  indexed on-chain events from `contract_logs` via
  `ContractLogsRepo::list_audit_log`. Its own module comment says the off-chain
  relayer/operator half is "not persisted in a queryable store today", and the spec's
  § "Trustee dashboard feed" says the same, calling a queryable operator-action table
  a follow-up.
- Logging is `tracing_subscriber::fmt::init()` in `packages/api/src/main.rs` — plain
  text to stdout, no JSON layer, no exporter.

So the machinery cannot carry this, and building it (a migration, a repo, a DTO, sink
mirroring, and a decision about who may read it) is several issues of work with no
spec for the table shape. **Do not invent one here.** The smallest honest option, and
what to implement:

1. Emit exactly one `tracing::info!` from `decide_kyb`'s handler, after the repo
   returns `true` and before the re-read, with the fields the spec names:

   ```rust
   tracing::info!(
       action = "kyb_decision",
       actor = %claims.sub,
       lp_id = id,
       decision = %decision,
       has_reason = reason.is_some(),
       "recorded a KYB verdict"
   );
   ```

   Fields, not an interpolated sentence, so a later JSON layer or log-shipping rule
   picks them up without re-parsing. `has_reason` rather than the reason text: the
   reason is already durable in `lps.kyb_decision_reason`, and a trustee's stated
   grounds for refusing a legal entity do not belong in a plaintext stdout stream
   that nothing governs. `actor` is `claims.sub`, the same value written to
   `kyb_decided_by` and the same one `review_document` writes to `reviewed_by`.
   Log after success only — a refused verdict changed nothing.
2. Log the same way from `review_document` (`action = "kyb_document_review"`, plus
   `document = doc`) — it is the other operator action in this file and is equally
   unrecorded today. Keep it to these two; do not sweep the rest of the codebase.
3. File the gap as a tech-debt entry (step 11), pointing at `audit-logging.md`
   § Scope, and state plainly in the PR description that the verdict is **not** in an
   append-only store and that the log line is not a substitute for one.

`kyb_decided_by` / `kyb_decided_at` in the `lps` row remain the durable record of who
decided and when; they are a current-state column, not an audit trail, which is
exactly why the gap is worth filing rather than papering over. **Open Question 2 asks
the user to confirm this trade** — if the answer is that the audit store must exist
first, this issue blocks on that work and only parts 1–2 above are wasted.

Two comment-budget notes: AGENTS.md § Lint & style forbids new inline comments, so the
reasoning above lives here and in the PR description, not in the source; and these are
`tracing` calls, which the file already uses (`with_documents`, `store_one`), so no new
dependency or import is involved.

### 9. DTOs

- `LpResponse` gains `kyb_submitted_at: Option<String>`,
  `kyb_decided_at: Option<String>`, `kyb_decision_reason: Option<String>`;
  timestamps through `iso_utc`, exactly as `address_linked_at` is done.
- `LpSummary` gains `kyb_submitted_at: Option<String>` and
  `kyb_decided_at: Option<String>` — the trustee review queue is `GET /v1/lps`
  filtered on `UnderReview` client-side, so these are what order it.
- Update the `/// \`NotStarted\` | \`InProgress\` | …` doc comments on
  `LpResponse::kyb_status` and `LpRow::kyb_status` to include `ChangesRequested`.

### 10. Comment cleanup (do not skip)

`routes/lps.rs` module header currently says the write gate "reads `kyb_status`
and never writes it — transitions are #1274's job, so this gate is inert until
that lands", and that `Failed` is where "the LP reopens with some documents
approved". Both are false after this change. Rewrite point 1 to name the two
endpoints that now move the status, and point 2 to say `ChangesRequested` is the
reopening state. Point 2's second sentence is specifically about `Failed` — replace
the example, do not just delete the sentence: the undeletable-`Verified` rule still
matters, it now matters in `ChangesRequested`, and after step 7 it is *also* what the
new review precondition exists to protect. Add the `/me/submit` and `/{id}/kyb`
routes to the audience lists in ¶¶ 1–3 of the header.

Post-rebase, this step also covers the sentences #1379 added — see "Rebasing over
#1379", points 1, 3 and 5. #1379's own additions stay; what must change is the
half-sentence in its `allows_address_write` doc comment that calls `Failed` the
"opposite direction" crossing. Both files' comments must end up telling the same
story about `Failed`: it closes the profile *and* the address, for two independent
reasons, neither expressed in terms of the other.

Keep within the repo's comment budget (AGENTS.md § Lint & style: at most one 2–3-line
spec-pointer header per file, plus the existing doc comments on public items — add no
new inline comments).

### 11. Docs

Everything in § Docs to Update, which names each file and the exact anchoring the
tech-debt tracker needs.

### 12. Lint

`cargo clippy --all -- -D warnings` must pass, and `cargo fmt` must leave the tree
clean. Step 11 touches `docs/`, so `npx tsx scripts/lint-docs.ts` must also pass —
it enforces the reachability of the new user-stories doc from
`docs/user-stories/index.md`.

## Test Strategy

Pure unit tests only — no test may read `DATABASE_URL`, `POSTGRES_URL`, or any
env var, and no test may reach a real Postgres. Rust tests live in
`packages/<pkg>/tests/<topic>.rs`; never an inline `#[cfg(test)] mod tests` in
`src/`. This is why the transition table and both invariant checks are pure
functions rather than logic buried in a repo method.

**`packages/shared/tests/kyb_status.rs`** (extend the existing file; the module
comment's "(Issue #1267)" framing needs updating to name this issue too):

- Update `an_unsubmitted_lp_is_writable` and add `ChangesRequested` to it.
- **Rewrite `a_failed_lp_reopens`** into `a_failed_lp_is_terminal_and_frozen` —
  the current test asserts the exact opposite of the new rule and will fail.
- Update `the_writable_set_is_exactly_the_three_open_statuses` to the new literal
  triple; keep the "make that change deliberately" assertion message.
- `the_gate_is_total_over_every_stored_status` gains `"ChangesRequested"` and
  should iterate `KybStatus::ALL` instead of a hand-written list.
- `the_writable_strings_…` gains a `!contains(Failed)` assertion.
- New: `submit_is_allowed_only_from_not_started_and_changes_requested` — for every
  status in `ALL`, assert `may_transition_to(UnderReview)` is true exactly for
  `NotStarted` and `ChangesRequested`. **`InProgress` must assert `false`** — it is
  writable but not submittable, and the first draft of this plan had it the other way
  round, so pin it with a message saying so.
- New: `a_verdict_is_reachable_only_from_under_review` — `UnderReview` reaches
  `Passed`, `ChangesRequested`, `Failed` and nothing else; no other status reaches
  any of them.
- New: `no_status_transitions_to_itself`.
- New: `the_transition_table_is_total` — iterate `ALL × ALL` and assert the legal
  set is exactly the six pairs of the spec's table, as one literal list. This is
  the test that makes a future edit to the table deliberate.
- New: `in_progress_is_a_legal_value_that_no_transition_produces_or_consumes` —
  nothing in `ALL` reaches `InProgress`, and `InProgress` reaches nothing, while
  `InProgress.allows_owner_writes()` is still `true`. The writable-but-unsubmittable
  pair is the whole content of the spec's "unreachable" paragraph.
- New: `the_submittable_set_agrees_with_the_transition_table` — for every status in
  `ALL`, `SUBMITTABLE.contains(&s) == s.may_transition_to(UnderReview)`. The two are
  written independently (one is bound into SQL, the other is the policy statement),
  so nothing but a test keeps them from drifting.
- New: `only_under_review_admits_a_document_review` — `allows_document_review` is
  true for `UnderReview` and false for the other five (step 7). Assert it against a
  literal list, not against `may_transition_to`: the rule is independent of the
  transition table and must not be derived from it.
- New: `the_three_status_policies_are_independent` — or extend
  `settlement_address.rs`'s `the_policy_is_independent_of_the_write_freeze` (see
  below), whichever keeps the assertions in one place. What must be pinned:
  `UnderReview` freezes owner writes, admits document reviews, and admits an address
  write; `ChangesRequested` is the mirror (writes yes, review no); `Failed` refuses
  all three. Three policies over one enum, each with a different shape — this is the
  test that stops a future reader collapsing them into one predicate.
- New: `submittable_strs_matches_the_submittable_statuses`, mirroring the
  existing `owner_writable_strs` test — it is bound into SQL, so it needs the
  same pinning.
- New (`packages/shared/tests/` — same file or alongside):
  `DocumentStatus::from_str` round-trips every stored spelling and rejects junk.

**`packages/shared/tests/settlement_address.rs`** (#1379's file — it **will not
compile or pass** after the `OWNER_WRITABLE` change; see "Rebasing over #1379",
point 4):

- `the_policy_is_total_and_classifies_every_status_deliberately` — add
  `KybStatus::ChangesRequested` to the hard-listed status array *and* to the local
  `expected` helper's match (→ `true`). The helper matches exhaustively on purpose,
  so it stops compiling until the new status is classified; that is the test working,
  not the test being in the way.
- `the_policy_is_independent_of_the_write_freeze` — its second assertion
  (`!Failed.allows_address_write(true) && Failed.allows_owner_writes()`, "Failed is
  the reverse crossing") is now **false** and must be rewritten, not deleted. The
  crossing that survives is `Passed` with no address linked: the profile is frozen
  while one address write is still allowed. Keep the `UnderReview` assertion as is,
  and keep the test's point — that neither policy is expressible in terms of the
  other — while recording in the assertion message that after this issue
  owner-writable *implies* address-writable, so the containment is one-directional
  rather than a two-way crossing.

**`packages/api/tests/lps.rs`** (extend):

- `resolve_kyb_decision`: each of the three decisions with no reason succeeds and
  yields `None`; with a reason yields the trimmed `Some`; a whitespace-only
  reason collapses to `None` (not `Some("")`); an over-long reason is `Err`;
  length is counted in **characters, not bytes** (mirror the existing
  `the_length_limits_count_characters_not_bytes` test with a Cyrillic/CJK string);
  each decision maps to the right `KybStatus`.
- `submit_blockers`: empty slice → `Err`; one `Provided` → `Ok`; a mix containing
  `Rejected` → `Err` whose message contains every rejected id and no
  non-rejected id; ids appear ascending regardless of input order; `Verified`
  alone → `Ok`; `NotProvided` present → `Ok` (it is a legacy CHECK member that no
  row carries — assert the chosen behaviour explicitly either way so it is a
  decision, not an accident).
- `pass_blockers`: all `Verified` → `Ok`; any `Provided` or `Rejected` → `Err`
  naming exactly those ids; empty slice → `Ok` (documented as unreachable because
  submit required ≥1 — assert it so the vacuous-truth reasoning is pinned).
- OpenAPI assertions, following the existing `openapi_json()` helper:
  `POST /v1/lps/me/submit` and `POST /v1/lps/{id}/kyb` are present; the decision
  request schema exposes `decision` as required and `reason` as optional; the
  `KybDecision` enum lists exactly `Passed`, `ChangesRequested`, `Failed` (and
  **not** `UnderReview` — a trustee cannot re-submit); `LpResponse` exposes
  `kyb_submitted_at`, `kyb_decided_at`, `kyb_decision_reason` and `LpSummary`
  exposes the two timestamps.
- Step 7's precondition, at the OpenAPI level: the `409` on
  `POST /v1/lps/{id}/documents/{doc}/review` names the not-under-review cause, the
  way #1379's `link_address_409_no_longer_requires_passed_kyb` asserts on its own
  `409` description. That description is the only part of step 7 reachable from a
  pure test in this file — the guard itself needs the handler, so its judgement is
  covered in `packages/shared/tests/kyb_status.rs` via `allows_document_review`, and
  its wiring is a manual check below. Do not reshape the handler to make it unit
  testable; the pure predicate is the seam, exactly as for `guard_writable`.
- `kyb_status` doc-comment drift: the `LpResponse::kyb_status` schema description
  lists the legal values, so assert the OpenAPI copy contains `ChangesRequested`.
  Cheap, and it catches the one of the several `NotStarted | InProgress | …`
  comments most likely to be missed.

Not covered, by rule and stated as such in the PR: the SQL predicates in
`submit_for_review` / `decide_kyb` / `KybDocumentRepo::review`, the
`Failed` → `Suspended` transaction, the audit log line, and the migration itself.
Verify those by hand against a local DB before marking the PR ready — at minimum:

- submit from each of the six statuses (only `NotStarted` and `ChangesRequested`
  succeed; `InProgress` must be refused);
- a verdict from each status (only `UnderReview` succeeds);
- `Passed` refused while any document is not `Verified`;
- `Failed` leaves `accounts.status = 'Suspended'` **and** the LP unwritable **and**
  `POST /v1/lps/me/link-address` refused (#1379's predicate, now reachable for the
  first time);
- a document review refused at `NotStarted` and at `Passed`, accepted at
  `UnderReview` (step 7, both the handler guard and the SQL clause — force the SQL
  path by moving the LP out of `UnderReview` with a direct `UPDATE` between the two
  requests);
- one `kyb_decision` log line present in the API's stdout after a verdict, carrying
  the actor and the decision (step 8).

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md`** — **no change.** The spec merged
  with PR #1382 and already specifies this lifecycle, the review precondition, and
  the audit obligation. Read it; do not edit it, and do not duplicate it into this
  branch. (#1379 also touched one line of it, which the rebase carries in.)
- **`docs/user-stories/epic-1376/1274-kyb-state-machine.md`** — **new, and required**:
  ISSUE_PROTOCOL § 6 makes a user-stories doc part of "done" for an implementation
  issue, committed in the same PR. This was missing from the first draft of the plan.
  Follow `docs/user-stories/epic-1376/1379-ungate-link-address.md` (#1379's, on its
  branch) for structure — persona, steps, expected outcome, concrete enough for an
  agent to execute against the running app. Stories to cover: an owner submits a
  complete set and sees the record freeze; a submit refused for a rejected document,
  naming it; a trustee verdict of each of the three kinds; `ChangesRequested`
  reopening the record and a resubmit; `Failed` freezing it terminally and suspending
  the account; a document review refused while the LP is not `UnderReview`.
- **`docs/user-stories/index.md`** — add one row to the `## Epic #1376 — KYB review
  lifecycle` table, below #1379's row. `lint-docs.ts` enforces reachability, so the
  doc without the row fails lint.
- **`docs/exec-plans/active/issue-1274-kyb-state-machine.md`** — this plan; append a
  decision-log entry for anything decided during implementation that differs from it.
- **`docs/exec-plans/tech-debt-tracker.md`** — two entries, and **read this whole
  bullet before editing the file**:
  - The file has a **duplicated `## Post-MVP` section** (filed as **#1390**), so
    `### TD-80` and `### TD-82` each name three different entries and `### TD-81`
    likewise. **Anchor every edit on a unique neighbouring subtitle**, never on a
    `TD-<n>` heading or a line number, and **do not deduplicate the file in this PR**
    — that is #1390's job and mixing it in would make this diff unreviewable.
  - The first draft of this plan said to "confirm TD-80 (suspension must actually
    gate requests) exists". **It does not.** `### TD-80` in `## Known Gaps` is
    "Wallet-namespace labels diverge three ways across the app"; the two Post-MVP
    `TD-80`s are "Email/password sessions cannot be revoked", whose *Impact* merely
    mentions suspension taking up to 24h to bite. Enforcement of suspension is
    **#1380**, an open issue — not tech debt — so do not file an entry for it.
  - **New entry: the verdict is not written to an append-only audit store** (step 8).
    Location `packages/api/src/routes/lps.rs` — `decide_kyb`, `review_document`.
    Gap: `audit-logging.md` § Scope requires operator actions to be recorded with
    actor, target, and outcome in the append-only store; no such store exists in the
    repo (no table, no writer, no sink), and `GET /v1/audit-log` serves only indexed
    on-chain `contract_logs`. This issue ships a `tracing::info!` line instead, which
    a plaintext stdout subscriber neither structures nor mirrors. Impact: a trustee's
    verdict on a legal entity is reconstructable only from `lps`' current-state
    columns, which the next decision overwrites. Suggested fix: persist the
    operator-action half of the audit log to a queryable table and mirror it, the
    follow-up `audit-logging.md` § "Trustee dashboard feed" already names.
  - **New entry: the SQL predicates carrying this issue's policy are untested**, if
    the coder judges the gap worth tracking (the repo's no-DB-in-tests rule is the
    cause, so it may be better stated once, elsewhere, than per issue).
  - Numbering: the highest existing entry is `### TD-97`, so new entries start at
    **TD-98**. Verify with
    `grep -o '^### TD-[0-9]*' docs/exec-plans/tech-debt-tracker.md | grep -o '[0-9]*' | sort -n | tail -1`
    before writing, since the number moves as siblings land.
- **No frontend or user-docs changes.** `packages/frontend/src/api/lps.ts` gains
  nothing here; the LP-side submit UI and the trustee verdict buttons (#1271) are
  separate issues. #1271 does need to know that `KYB Pending` now means `UnderReview`
  and that `ChangesRequested` needs a rendering — that is a note for its planner, not
  a change here.
- `docs/` is touched, so `npx tsx scripts/lint-docs.ts` must pass.
