# Issue #1274: Backend: KYB state machine — submit for review + trustee verdict endpoints

Source: https://github.com/eq-lab/pipeline/issues/1274

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` § "KYB Review Lifecycle" — currently on
branch `docs/kyb-review-lifecycle` (open PR #1382), not yet on `main`.
Read it with `git show origin/docs/kyb-review-lifecycle:docs/product-specs/kyb-lp-verification.md`.

## Scope

Give `kyb_status` its lifecycle. Today nothing writes it past `NotStarted`, so the
freeze shipped in #1267 is inert and `link-address`'s `WHERE kyb_status = 'Passed'`
is unreachable.

In scope:

1. **Migration** — `lps.kyb_status` CHECK gains `'ChangesRequested'`; new columns
   `kyb_submitted_at`, `kyb_decided_by`, `kyb_decided_at`, `kyb_decision_reason`.
   No history table: only the latest decision is retained.
2. **State machine** in `shared::lp_repo::KybStatus` — add `ChangesRequested`;
   `OWNER_WRITABLE` becomes `[NotStarted, InProgress, ChangesRequested]` (`Failed`
   leaves the set and becomes terminal); a pure, total transition predicate.
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
   points 1–2, and the "#1274's job, so this gate is inert" sentence).

Out of scope — each is a sibling sub-issue of #1376, do not touch:

- `notify_on_review` and the narrowed write freeze on `POST /v1/lps/me` → **#1377**
- Decision emails → **#1378**
- Ungating `POST /v1/lps/me/link-address` from `kyb_status` → **#1379**
- Making `accounts.status = 'Suspended'` actually gate requests → **#1380**
  (this issue owns the *write*, not the enforcement)
- LP-app and Trustee-dashboard UI (trustee verdict buttons are #1271 under #1269)
- Review history / audit-log rows per decision; pagination or a status filter on
  `GET /v1/lps` (the review queue is that listing filtered client-side)

## Assumptions and Risks

- **Spec is unmerged.** PR #1382 carries the spec this plan implements. If it
  changes before merge, re-read it. Do not re-litigate its decisions — they were
  settled with the user.
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
- **`lps_stellar_address_passed_ck`** (`stellar_address IS NULL OR kyb_status = 'Passed'`)
  means no LP that has linked an address can leave `Passed`. No legal transition
  does, so the constraint is consistent — but it will make #1379 (ungating
  link-address) need its own migration. Not this issue's job; note it in the PR.
- **Ordering against #1379.** The moment `Passed` becomes reachable,
  `link-address` stops being dead code with its old `WHERE kyb_status = 'Passed'`
  predicate as the only path. The issue explicitly says not to leave a window.
  See Open Questions.
- **No integration coverage.** Repo rules forbid tests that reach a real Postgres,
  so the SQL predicates (the actual enforcement) are not test-covered. Everything
  test-covered here must therefore be a pure function, and the SQL must be a
  faithful restatement of it. This duplication is deliberate; keep the pure
  function the single place the policy is *stated*.
- **Reason length is unbounded.** `kyb_decision_reason` is `TEXT`; the JSON route
  carries axum's default 2MB body limit (only the upload route is raised), so the
  blast radius is small — but bound it anyway, mirroring `MAX_LEGAL_NAME_LEN`.

## Open Questions

1. **Merge ordering with #1379.** This issue makes `Passed` reachable while
   `link-address` still gates on `kyb_status = 'Passed'`. Should #1274 and #1379
   land in one PR, or is "#1274 merges first, #1379 immediately after, no deploy
   in between" acceptable? The window is a *stricter-than-intended* gate (an LP
   that passed KYB can link; one that has not, cannot), not a security hole — so
   shipping #1274 alone looks safe to me, but the issue's wording ("do not leave a
   window") suggests the user may want them co-merged.
2. **Is `kyb_decided_by` deliberately absent from the response DTOs?** The issue
   lists `kyb_submitted_at`, `kyb_decided_at`, `kyb_decision_reason` for
   `LpResponse` and only the two timestamps for `LpSummary` — `kyb_decided_by` is
   stored but never read back. That is defensible (the operator id is staff-internal
   and the LP owner reads the same DTO), and I will implement exactly the listed
   fields. Confirm the trustee dashboard (#1271) does not need the deciding
   operator surfaced.
3. **Status code for a failed *invariant* vs. a failed *transition*.** The issue
   fixes `409` for an illegal transition. I plan to use `409` for the document
   invariants too (no documents / a `Rejected` document on submit; a non-`Verified`
   document on `Passed`) — they are state conflicts, not malformed requests — with
   `400` reserved for a malformed body (unknown `decision`, over-long `reason`).
   Flag if the frontend contract wants `422` for the invariants instead.

## Implementation Steps

### 1. Migration

Add `packages/shared/migrations/20260929000001_kyb_review_lifecycle.sql`.

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

  `NotStarted | InProgress | ChangesRequested -> UnderReview`;
  `UnderReview -> Passed | ChangesRequested | Failed`; everything else `false`,
  including self-transitions. `InProgress` is unreachable as a *target* but stays
  a legal value and a legal *source* of submit (spec: "treated as writable, like
  `NotStarted`").
- Add `pub const ALL: [KybStatus; 6]` so tests can assert the transition table is
  total without re-listing the variants.
- Add `pub fn submittable_strs() -> Vec<&'static str>` — the statuses that may
  submit — for binding into the submit UPDATE, mirroring `owner_writable_strs`.
  Do **not** reuse `owner_writable_strs` here even though the sets currently
  coincide: they answer different questions and will diverge under #1377.
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

bound to the returned `owner_account_id`. Commit. Assert in a debug comment —
not a runtime branch — that `decision` is one of the three verdicts; the route
layer is what constrains it, via the request enum.

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
7. Re-read and answer `Json(with_documents(...))`, same as above.

Both handlers get `#[utoipa::path(...)]` annotations documenting 200/400/401/403/
404/409 as applicable, `security(("bearer_auth" = []))`, `tag = "Lps"`; add both
to `LpsDoc`'s `paths(...)` and `KybDecision` / `KybDecisionRequest` to its
`components(schemas(...))`.

### 7. DTOs

- `LpResponse` gains `kyb_submitted_at: Option<String>`,
  `kyb_decided_at: Option<String>`, `kyb_decision_reason: Option<String>`;
  timestamps through `iso_utc`, exactly as `address_linked_at` is done.
- `LpSummary` gains `kyb_submitted_at: Option<String>` and
  `kyb_decided_at: Option<String>` — the trustee review queue is `GET /v1/lps`
  filtered on `UnderReview` client-side, so these are what order it.
- Update the `/// \`NotStarted\` | \`InProgress\` | …` doc comments on
  `LpResponse::kyb_status` and `LpRow::kyb_status` to include `ChangesRequested`.

### 8. Comment cleanup (do not skip)

`routes/lps.rs` module header currently says the write gate "reads `kyb_status`
and never writes it — transitions are #1274's job, so this gate is inert until
that lands", and that `Failed` is where "the LP reopens with some documents
approved". Both are false after this change. Rewrite point 1 to name the two
endpoints that now move the status, and point 2 to say `ChangesRequested` is the
reopening state. Keep within the repo's comment budget (AGENTS.md § Lint & style:
at most one 2–3-line spec-pointer header per file, plus the existing doc comments
on public items — add no new inline comments).

### 9. Lint

`cargo clippy --all -- -D warnings` must pass. No TypeScript changes, so
`lint-docs.ts` is only needed if a doc under `docs/` is touched (step 10).

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
- New: `submit_is_allowed_only_from_the_three_open_statuses` — for every pair in
  `ALL × ALL`, assert `may_transition_to(UnderReview)` is true exactly for
  `NotStarted`, `InProgress`, `ChangesRequested`.
- New: `a_verdict_is_reachable_only_from_under_review` — `UnderReview` reaches
  `Passed`, `ChangesRequested`, `Failed` and nothing else; no other status reaches
  any of them.
- New: `no_status_transitions_to_itself`.
- New: `the_transition_table_is_total` — iterate `ALL × ALL` and assert the legal
  set is exactly the six pairs of the spec's table, as one literal list. This is
  the test that makes a future edit to the table deliberate.
- New: `in_progress_is_a_legal_value_but_no_transition_produces_it`.
- New: `submittable_strs_matches_the_submittable_statuses`, mirroring the
  existing `owner_writable_strs` test — it is bound into SQL, so it needs the
  same pinning.
- New (`packages/shared/tests/` — same file or alongside):
  `DocumentStatus::from_str` round-trips every stored spelling and rejects junk.

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

Not covered, by rule and stated as such in the PR: the SQL predicates in
`submit_for_review` / `decide_kyb`, the `Failed` → `Suspended` transaction, and
the migration itself. Verify those by hand against a local DB before marking the
PR ready — at minimum: submit from each status, a verdict from each status,
`Passed` with an unverified document, and that `Failed` leaves
`accounts.status = 'Suspended'` and the LP unwritable.

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md`** — no content change needed:
  PR #1382 already specifies this lifecycle exactly. If #1382 has merged by
  implementation time, re-read it from `main` and confirm nothing drifted; if it
  has not, this branch must not duplicate the spec file.
- **`docs/exec-plans/active/issue-1274-kyb-state-machine.md`** — this plan;
  append a decision log entry for anything decided during implementation that
  differs from it.
- **`docs/exec-plans/tech-debt-tracker.md`** — confirm TD-80 (suspension must
  actually gate requests) exists and points at #1380; add it if missing, since
  this issue is what makes the `Suspended` write real while enforcement lands
  separately. Add an entry for the untested SQL predicates if the coder judges
  the gap worth tracking.
- **No frontend or user-docs changes.** `packages/frontend/src/api/lps.ts` gains
  nothing here; the LP-side submit UI and the trustee verdict buttons (#1271) are
  separate issues.
- If any `docs/` file is touched, run `npx tsx scripts/lint-docs.ts`.
