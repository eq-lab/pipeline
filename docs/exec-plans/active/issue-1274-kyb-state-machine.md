# Issue #1274: Backend: KYB state machine — submit for review + trustee verdict endpoints

Source: https://github.com/eq-lab/pipeline/issues/1274

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` §§ "KYB Review Lifecycle", "Review
Notifications", "Settlement Address" — **merged to `main`** (PR #1382, commit
`d509486`). Read it from the working tree. The `docs/kyb-review-lifecycle` branch
is gone, so the earlier `git show origin/docs/kyb-review-lifecycle:…` instruction
in this plan is dead; ignore any surviving trace of it.

**Revised 2026-09-30** (first revision), after the review of #1382 and after #1379
landed on its own branch: `review_document` gains an `UnderReview` precondition
(scope item 7, step 7), and `InProgress` was corrected out of the submittable set.

**Revised again 2026-09-30** (second revision), after the user answered both open
questions. Three things changed:

- **#1379 has merged** (`167caf5`) and this branch is rebased onto it. Its code is
  in the working tree, so the section below — renamed "Composing with #1379
  (merged)" — now describes **what is in the files**, not a pending merge. It has been re-verified line by line against
  `packages/shared/src/lp_repo.rs`, `packages/api/src/routes/lps.rs` and
  `packages/shared/tests/settlement_address.rs` as they now stand.
- **`kyb_decided_by` stays out of the API entirely** — written to the column, never
  returned, by `/v1/lps/me` or the trustee-only `/v1/lps/{id}`. Open Question 1
  closed.
- **No audit record at all.** The `tracing::info!` step the first revision proposed
  is **deleted**, for `decide_kyb` and for `review_document`, and no tech-debt entry
  is filed about the gap. The verdict has **no history** anywhere. Step 8 is now the
  spec correction this decision forces. Open Question 2 closed.

Both open questions are answered; the Open Questions section below is `_None_` and
records the answers.

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
   points 1–2, and the "#1274's job, so this gate is inert" sentence). Now that
   #1379 is merged this also covers the three sentences it left behind, which assert
   the opposite half of the same rule — see "Composing with #1379 (merged)".
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
8. **The verdict has no history, and the merged spec must be corrected to say so.**
   Decided by the user (Issue comment, 2026-09-30): **no audit record is written at
   all** — not a row, not a log line. The verdict lives only in the `lps` row, in
   `kyb_decided_by` / `kyb_decided_at` / `kyb_decision_reason`. A second verdict
   **overwrites the first with no trace anywhere**: no previous reason, no previous
   decider, no previous time, in any store, on or off this box. That is accepted
   deliberately, not overlooked — write it into the PR description in those words.
   It makes one sentence of the merged spec false (it promises an append-only audit
   store that does not exist and that nothing will now write), so this issue
   corrects that sentence — step 8.

Out of scope — each is a sibling sub-issue of #1376, do not touch:

- `notify_on_review` and the narrowed write freeze on `POST /v1/lps/me` → **#1377**
- Decision emails → **#1378**
- Ungating `POST /v1/lps/me/link-address` from `kyb_status` → **#1379**, **merged to
  `main`** as `167caf5` (PR #1386) and already in this branch's history. Do not
  re-do, re-litigate, or revert any of it; do not add a `guard_writable` call to
  `link_address`. Only reconcile it — see "Composing with #1379 (merged)".
- Making `accounts.status = 'Suspended'` actually gate requests → **#1380**
  (this issue owns the *write*, not the enforcement)
- LP-app and Trustee-dashboard UI (trustee verdict buttons are #1271 under #1269)
- Review **history and any audit record of the verdict** — no per-decision table, no
  endpoint to read past decisions, no backfill, no log line, no entry in an
  operator-action store; pagination or a status filter on `GET /v1/lps` (the review
  queue is that listing filtered client-side). Building the append-only
  operator-action store `audit-logging.md` describes stays a follow-up of that spec
  and is not this issue's, nor is a tech-debt entry about its absence — see scope
  item 8 and step 8: the decision is that the verdict is simply not recorded
  anywhere beyond the `lps` row, and the spec is corrected to match.

## Assumptions and Risks

- **Spec is merged** (PR #1382, `d509486`) and is the authority. Re-read it from
  the working tree, not from a branch ref. Do not re-litigate its decisions — they
  were settled with the user. One place where this plan as first written drifted
  from the merged text, corrected below: `InProgress` is **not** a submit source
  (§ KYB Review Lifecycle: "nothing transitions out of it"). One place where the
  **merged spec itself is wrong** and this issue corrects it: the same §'s
  decision-retention paragraph promises the verdict is written to an append-only
  audit store. There is no such store, and after the user's decision nothing will
  write one — step 8.
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
- **`lps_stellar_address_passed_ck` is gone from `main`.** #1379's migration
  `packages/shared/migrations/20260929000003_drop_lps_stellar_address_passed_ck.sql`
  drops it and is now the newest migration in the directory (verified). So the
  constraint is not a consideration here any more: do **not** re-add it, do not
  reason about it, and do not touch that file. The settlement-address rule now lives
  only in `LpRepo::link_address`'s `WHERE` predicate.
- **Ordering against #1379 — resolved by the merge.** #1379 is in `main` (`167caf5`)
  and in this branch's history, which is the order the Issue settled on and the one
  with no window: its predicate (`kyb_status <> 'Failed' AND (stellar_address IS NULL
  OR kyb_status <> 'Passed')`) was vacuously permissive while `Passed` was
  unreachable, and this issue is what makes `Passed` reachable. Nothing is left to
  sequence; what remains is composition, covered below.
- **No integration coverage.** Repo rules forbid tests that reach a real Postgres,
  so the SQL predicates (the actual enforcement) are not test-covered. Everything
  test-covered here must therefore be a pure function, and the SQL must be a
  faithful restatement of it. This duplication is deliberate; keep the pure
  function the single place the policy is *stated*.
- **Reason length is unbounded.** `kyb_decision_reason` is `TEXT`; the JSON route
  carries axum's default 2MB body limit (only the upload route is raised), so the
  blast radius is small — but bound it anyway, mirroring `MAX_LEGAL_NAME_LEN`.

### Composing with #1379 (merged)

**#1379 is merged** — `167caf5`, PR #1386, on `main`. This branch is rebased onto it,
so **its code is already in the working tree**. Nothing below is a pending merge or a
prediction; every claim here was re-verified against the files as they now stand, and
the line numbers are from that reading. Read the code itself first:

```bash
git show 167caf5 --stat
git show 167caf5 -- packages/shared/src/lp_repo.rs packages/api/src/routes/lps.rs
```

What it put on `main`: `KybStatus::allows_address_write(has_address)`
(`packages/shared/src/lp_repo.rs:92-98`); the
`kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`
predicate in `LpRepo::link_address`; a status pre-check at the top of the
`link_address` handler (`packages/api/src/routes/lps.rs:721-744`); migration
`20260929000003_drop_lps_stellar_address_passed_ck.sql`;
`packages/shared/tests/settlement_address.rs` (five tests); four tests in
`packages/api/tests/lps.rs`; a widened TD-57; a user-stories doc under
`docs/user-stories/epic-1376/` plus its index row.

**Where this issue meets it, and what each contact requires:**

1. `packages/shared/src/lp_repo.rs` module header — #1379 owns ¶1, lines 5–6:
   "The LP links a Stellar account via `link_address`, which is not gated on reaching
   `Passed` (see [`KybStatus::allows_address_write`])." This issue rewrites the *same
   paragraph region* for the `Failed`-is-terminal rule. Keep that sentence; keep
   likewise the `KybStatus` enum doc at lines 25–28 ("there is no longer a DB
   constraint backing it (Issue #1379)"). Do not drop either while rewriting around
   them.
2. `KybStatus` enum body — this issue inserts the `ChangesRequested` variant, and
   **that genuinely breaks the build. Verified**: `allows_address_write`'s match
   (lines 93–97) is

   ```rust
   match self {
       KybStatus::Failed => false,
       KybStatus::Passed => !has_address,
       KybStatus::NotStarted | KybStatus::InProgress | KybStatus::UnderReview => true,
   }
   ```

   — no `_` arm, so a sixth variant is `E0004: non-exhaustive patterns`. Classify
   `ChangesRequested` into the `=> true` arm: it is a non-terminal status, and the
   spec says the address is settable "at any status short of a terminal verdict".
   **Do not collapse the arm to a `_` wildcard.** That exhaustiveness is the design:
   `settlement_address.rs`'s local `expected` helper (below, point 4) is a second
   exhaustive match of the same shape, written so that a new status stops the code
   compiling until someone classifies it on purpose. A `_` in either place silently
   admits every future status and destroys the guarantee.
3. `KybStatus::OWNER_WRITABLE` / `allows_owner_writes` — this issue removes `Failed`,
   and that makes the "crossing" prose #1379 left behind false in **three** places,
   not one. All three must be rewritten in this PR. Verified quotes:
   - `packages/shared/src/lp_repo.rs:88-91`, `allows_address_write`'s doc comment:
     "Deliberately not folded into [`allows_owner_writes`](Self::allows_owner_writes)
     — the two policies cross at `UnderReview` and again, **in the opposite
     direction, at `Failed`**, so neither is expressible in terms of the other."
   - `packages/api/src/routes/lps.rs:33-36`, module header point 1: the address is
     "open at `UnderReview`, where the freeze bites, and **closed at `Failed`, where
     the freeze lifts**."
   - `packages/api/src/routes/lps.rs:700-706`, the `link_address` handler doc
     comment: "…it stays settable while the profile is frozen (e.g. `UnderReview`),
     and in the other direction it stops being settable at `Failed` **exactly where
     the profile reopens**."

   Each says the freeze lifts at `Failed`. After this issue it does not. The true
   statement, and what all three must end up saying: the two policies still cross at
   `UnderReview` (address open, profile frozen) and at `Passed` with no address yet
   (one address write allowed, profile frozen), but `Failed` now closes **both** —
   for independent reasons, which is the point worth keeping. The address closure
   rests on `stellar_address` being UNIQUE across LPs and must not be restated as
   "because the record is frozen"; the freeze must not be restated as "because the
   address is closed". Owner-writable now *implies* address-writable; they are still
   two policies because they answer different questions and #1377 narrows the freeze
   again.
4. **`packages/shared/tests/settlement_address.rs` — it stops compiling before any
   assertion runs, and then one assertion fails.** Verified, in that order:
   - **Compile break.** `the_policy_is_total_and_classifies_every_status_deliberately`
     (line 59) holds a local `fn expected(status, has_address) -> bool` whose match
     (lines 61–65) is exhaustive over the five variants — the same `E0004` as point 2.
     Add a `ChangesRequested` arm (→ `true`), *and* add `KybStatus::ChangesRequested`
     to the hard-listed status array at lines 68–74, which the compiler cannot catch.
     The break is the test working, not the test being in the way.
   - **Assertion failure.** `the_policy_is_independent_of_the_write_freeze` (line 89),
     its second assertion, lines 95–99:

     ```rust
     assert!(
         !KybStatus::Failed.allows_address_write(true) && KybStatus::Failed.allows_owner_writes(),
         "Failed is the reverse crossing: the profile reopens while the \
          address stays closed"
     );
     ```

     `Failed.allows_owner_writes()` turns `false` the moment `Failed` leaves
     `OWNER_WRITABLE`, so the conjunction fails. This is the exact half this issue
     removes. **Rewrite, do not delete** — the crossing that survives is `Passed` with
     no address linked (profile frozen, one address write still allowed). Keep the
     first assertion (line 90–94, `UnderReview`) untouched, and keep the test's point
     — that neither policy is expressible in terms of the other — recording in the new
     assertion message that after this issue owner-writable *implies* address-writable,
     so the containment is one-directional rather than a two-way crossing. Same rule as
     `kyb_status.rs::a_failed_lp_reopens`: rewrite the claim, never quietly drop it.
   - **Missed by the previous revision of this plan, and silent:** the file-level
     `const NON_TERMINAL: [KybStatus; 3]` (lines 8–12) lists `NotStarted`,
     `InProgress`, `UnderReview`. It keeps compiling with a sixth variant — which is
     the problem. `an_unlinked_lp_may_set_an_address_at_any_non_terminal_status`
     (line 15) and `a_linked_address_may_be_replaced_until_the_decision_is_final`
     (line 25) both iterate it, so `ChangesRequested` would go uncovered by both with
     nothing to say so. Widen it to `[KybStatus; 4]` and add the variant.
   - `the_two_terminal_statuses_close_the_address_differently` (line 35) is
     **unaffected** and still true — `Passed` and `Failed` remain the only two
     terminal statuses. Leave it alone.
   - The module comment (lines 1–4) names Issue #1379 only; add this issue alongside,
     since the file now also pins this issue's half of the rule.
5. `packages/api/src/routes/lps.rs` module header ¶ "Two rules govern every owner
   write" (lines 27–39) — #1379 appended the settlement-address sentences to point 1
   and left the "transitions are #1274's job, so this gate is inert until that lands"
   clause standing. This issue deletes that clause and rewrites point 2. Keep #1379's
   settlement-address sentences — **except** their closing clause "closed at `Failed`,
   where the freeze lifts", which point 3 above requires rewriting.
6. `link_address` handler — **body unchanged; its doc comment is not.** The previous
   revision of this plan said "do not touch" without qualification; that is right
   about the code and wrong about the prose, which carries the third copy of the false
   crossing (lines 700–706, quoted in point 3). Correct that clause, and keep #1379's
   "Do not add a `guard_writable` call here; that would remove the exemption the rule
   depends on" **verbatim** — it is still load-bearing, because the exemption it
   protects is the `UnderReview` one, which this issue does not change, and the
   `Failed` closure is still the address predicate's own rather than the freeze's.
   The handler body (lines 721–744) needs no edit: `ChangesRequested` lands in
   `allows_address_write`'s `true` arm, so the pre-check passes, and the two-branch
   `409` message match (lines 736–745) is only reachable for `Failed` or
   `Passed`-with-an-address — its `_ =>` "has passed KYB" wording never sees the new
   status.
7. Migration stamp — **re-verified**: `20260929000003` is #1379's and is now the
   newest file in `packages/shared/migrations/` on `main`; `20260930000001`, which
   step 1 reserves, is unused on every branch (`git log --all --diff-filter=A`,
   checked 2026-09-30). Re-run that check in step 1 anyway, since siblings move.
8. `docs/exec-plans/tech-debt-tracker.md` TD-57 (line 901) — #1379 widened it, and its
   Impact ¶ already reads "#1274 is what will make `kyb_status` reachable at all, so
   the gap goes live once both have landed". That sentence becomes true when this
   merges. **It needs no edit** — do not re-widen or restate it.
9. `docs/user-stories/index.md` — #1379 created `## Epic #1376 — KYB review lifecycle`
   (line 203) with its own row (line 207) as the table's only entry. Append this
   issue's row below it (step 11).

## Open Questions

_None._ Both questions that parked this plan were answered by the user on the Issue
(2026-09-30, "Both open questions answered. Releasing the park."). The answers are
recorded below with the rest of the settled decisions so none of them is reopened.

- **`kyb_decided_by` in the API — answered: it stays out entirely.** The column is
  written (steps 1, 4), and **neither** `GET /v1/lps/me` **nor** the trustee-only
  `GET /v1/lps/{id}` returns it. No step may expose it in `LpResponse`, in
  `LpSummary`, or in a second DTO. Reason: adding a field later is cheap, removing one
  a client already reads is not, and the trustee UI that might want it (#1271) does
  not exist yet. `/me` is served from the same DTO, so exposing it there would also
  hand an applicant the individual operator's identity on every refusal.
- **An audit record for the verdict — answered: none at all.** Not the
  `tracing::info!` line the previous revision proposed, not a store, and not a
  tech-debt entry about the absence. The verdict is recorded only in the `lps` row,
  and a second verdict overwrites the first with no trace anywhere. Accepted
  deliberately. Step 8 is now the spec correction this forces; the previous step 8
  (the log line, for `decide_kyb` and for `review_document` alike) is deleted, along
  with its tech-debt entry and its manual-verification item.
- **Merge ordering with #1379** — resolved, and now moot: #1379 merged first
  (`167caf5`) and is in this branch's history. See Assumptions and Risks.
- **`409` vs `422` for a failed invariant** — resolved on the Issue: `409` throughout
  for state conflicts, `400` for a malformed body. House convention (`ApiError::Conflict`
  used 12 times for state conflicts, `UnprocessableEntity` once, for a refused
  computation).

## Implementation Steps

### 1. Migration

Add `packages/shared/migrations/20260930000001_kyb_review_lifecycle.sql`.

**Re-stamped.** The plan originally reserved `20260929000001`; `20260929000003` is
#1379's and is now **on `main`** and the newest file in the directory (re-verified
2026-09-30), so a `…0929000001` file would sort *before* a migration already applied
in every environment that has taken `main`. That is not
a breakage — `sqlx` 0.8.6's `Migrator::run` applies any version absent from
`_sqlx_migrations` regardless of order, and only errors when an *applied* migration
is missing from the source (`validate_applied_migrations` → `VersionMissing`) — but
it makes the directory stop reflecting apply order, which is the only thing the file
name is for. Use `20260930000001` — free on every branch as of 2026-09-30. Re-check
before writing the file anyway, since the sibling branches move:

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
  reconcile its doc comment with `allows_owner_writes`' — see "Composing with #1379 (merged)",
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
7. Re-read and answer `Json(with_documents(...))`, same as above.

Nothing else happens on success. **No log line, no audit write** — see scope item 8:
`kyb_decided_by` / `kyb_decided_at` / `kyb_decision_reason` on the row are the whole
record of the verdict, and a later verdict overwrites them.

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
and keep all three doc comments mutually consistent (see "Composing with #1379 (merged)").

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

### 8. Correct the merged spec: the verdict keeps no audit record

**What this step replaces.** The previous revision of this plan proposed a
`tracing::info!` audit line here, for `decide_kyb` and for `review_document`. The user
answered on the Issue: **no audit record at all** — no log line, no store, and no
tech-debt entry about the gap. Write nothing of the kind, in either handler. The only
work left in this step is a documentation correction, because the merged spec promises
the opposite.

**Why the correction is required.** `docs/product-specs/kyb-lp-verification.md` § "KYB
Review Lifecycle" states that the verdict "is written to the append-only audit store
like any other". No such store exists, and nothing will now write one. Verified in the
working tree on 2026-09-30:

- No audit table anywhere in `packages/shared/migrations/` — nothing creates one
  (the only match for "audit" in that directory is a comment in
  `20260728000001_submitted_loans_changes_requested.sql` saying "no audit trail in
  scope").
- No operator-action writer anywhere in `packages/`, and no third-party sink or SIEM
  integration in the workspace.
- `packages/api/src/routes/audit_log.rs` is **not** it: `GET /v1/audit-log` reads
  indexed on-chain events from `contract_logs` via `ContractLogsRepo::list_audit_log`
  — a different substrate.
- `docs/product-specs/audit-logging.md:68` § "Trustee dashboard feed" says it itself:
  Operations Console operator actions "are **not** included in v1, because they live
  only in the non-queryable audit store", and serving them is a follow-up.

So the sentence describes a mechanism that does not exist and that this issue is
deliberately not building. Leaving it would be a spec claim no code satisfies — the
thing the repo's docs-first rule exists to prevent.

**The edit.** One paragraph in `docs/product-specs/kyb-lp-verification.md`, § "KYB
Review Lifecycle" — the single-sentence-pair paragraph beginning "Only the latest
decision is retained on the LP" (line 43 as of `167caf5`; **find it by its opening
words, not by line number**, since #1379 also touched that file). Replace exactly this:

> Only the latest decision is retained on the LP; there is no review history. That is
> about the record, not about the audit trail — a trustee's verdict on a legal entity
> is an operator action in the Operations Console and is written to the append-only
> audit store like any other (`audit-logging.md`).

with exactly this:

> Only the latest decision is retained on the LP; there is no review history. Nor is
> one kept anywhere else: no audit record of the verdict is written, so a second
> decision overwrites the first — its reason, its time, and the operator who made it —
> leaving nothing behind to reconstruct what was decided before. That is a deliberate
> choice rather than a gap to be filled later.

Rules for this edit:

- **Do not restructure the section.** One paragraph is replaced in place; every other
  paragraph, the transition table, and the section's heading stay exactly as merged.
- Keep the document's voice: declarative present tense, the decision stated and then
  justified in the same breath, no bullet lists, no "TODO", no issue references.
- The first sentence is kept **verbatim** — "only the latest decision is retained" is
  still true and is still the sentence the rest of the section leans on.
- The `audit-logging.md` mention goes with the clause. It is a bare backtick mention,
  not a Markdown link, so removing it cannot orphan that spec — it stays reachable
  from `docs/product-specs/index.md` and `docs/product-specs/trustee-dashboard.md`
  (verified). Do **not** add a replacement pointer to it.
- Do not touch `docs/product-specs/audit-logging.md`. Its § Scope describes a store
  this repo has not built; correcting that is its own spec's problem, not this
  issue's, and the user ruled out filing tech debt for it here.
- `npx tsx scripts/lint-docs.ts` must stay at **0 errors** after the edit.

The PR description must say plainly, in the same words as scope item 8, that the
verdict has no history: it lives only in `lps.kyb_decided_by` / `kyb_decided_at` /
`kyb_decision_reason`, a second verdict overwrites the first with no trace anywhere,
and that is accepted deliberately.

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

This step also covers the sentences #1379 left on `main` — see "Composing with #1379
(merged)", points 1, 3, 5 and 6. #1379's own additions stay; what must change is the
"opposite direction" crossing at `Failed`, which it states in **three** places, all of
which this issue falsifies and all of which must be fixed together:
`packages/shared/src/lp_repo.rs:88-91` (`allows_address_write`'s doc comment),
`packages/api/src/routes/lps.rs:33-36` (module header point 1), and
`packages/api/src/routes/lps.rs:700-706` (the `link_address` handler's doc comment —
prose only; its body stays exactly as merged, and #1379's "Do not add a
`guard_writable` call here" sentence is kept verbatim). All three must end up telling
the same story about `Failed`: it closes the profile *and* the address, for two
independent reasons, neither expressed in terms of the other. Leaving any one of them
behind is the failure mode this step exists to prevent — a reader who finds the stale
copy first has no way to tell which is current.

Keep within the repo's comment budget (AGENTS.md § Lint & style: at most one 2–3-line
spec-pointer header per file, plus the existing doc comments on public items — add no
new inline comments).

### 11. Docs

Everything in § Docs to Update, which names each file and the exact anchoring the
tech-debt tracker needs.

### 12. Lint

`cargo clippy --all -- -D warnings` must pass, and `cargo fmt` must leave the tree
clean. Steps 8 and 11 both touch `docs/`, so `npx tsx scripts/lint-docs.ts` must also
run at **0 errors** — it enforces the reachability of the new user-stories doc from
`docs/user-stories/index.md`, and step 8 edits a product spec. Run it once before
step 8's edit and once after, so any error it reports is attributable.

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

**`packages/shared/tests/settlement_address.rs`** (#1379's file, now on `main` — it
**stops compiling, and then one assertion fails**; see "Composing with #1379 (merged)",
point 4, which quotes the exact lines):

- `the_policy_is_total_and_classifies_every_status_deliberately` (line 59) — add
  `KybStatus::ChangesRequested` to the hard-listed status array (lines 68–74) *and*
  to the local `expected` helper's match (lines 61–65, → `true`). The helper matches
  exhaustively on purpose, so it stops compiling until the new status is classified;
  that is the test working, not the test being in the way. The array, by contrast,
  compiles either way — adding the variant there is what the compiler cannot force.
- `the_policy_is_independent_of_the_write_freeze` (line 89) — its second assertion
  (lines 95–99, `!Failed.allows_address_write(true) && Failed.allows_owner_writes()`,
  "Failed is the reverse crossing") is now **false** and must be rewritten, not
  deleted. The crossing that survives is `Passed` with no address linked: the profile
  is frozen while one address write is still allowed. Keep the `UnderReview`
  assertion (lines 90–94) as is, and keep the test's point — that neither policy is
  expressible in terms of the other — while recording in the assertion message that
  after this issue owner-writable *implies* address-writable, so the containment is
  one-directional rather than a two-way crossing.
- `const NON_TERMINAL` (lines 8–12) — widen from `[KybStatus; 3]` to `[KybStatus; 4]`
  and add `ChangesRequested`. Nothing forces this: the array compiles unchanged, and
  `an_unlinked_lp_may_set_an_address_at_any_non_terminal_status` (line 15) and
  `a_linked_address_may_be_replaced_until_the_decision_is_final` (line 25) would both
  simply stop covering the new status, silently.
- `the_two_terminal_statuses_close_the_address_differently` (line 35) — **leave it
  alone.** `Passed` and `Failed` are still the only terminal statuses, so it is
  unaffected and still true.
- The module comment (lines 1–4) names Issue #1379 only; add this issue to it, since
  the file now pins this issue's half of the rule as well.

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
`Failed` → `Suspended` transaction, and the migration itself.
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
- after a second verdict on the same LP (`ChangesRequested`, resubmit, then `Passed`),
  the row carries only the second one and the first is gone — confirming step 8's
  "no history" statement is what actually ships, and that nothing was left writing an
  audit record.

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md`** — **one paragraph corrected, and
  nothing else.** The spec merged with PR #1382 and already specifies this lifecycle
  and the review precondition; do not re-litigate or duplicate any of that. The one
  edit is step 8's: § "KYB Review Lifecycle", the paragraph beginning "Only the latest
  decision is retained on the LP", whose audit-store promise no code satisfies and
  none now will. Step 8 quotes the sentences to remove and gives the replacement in
  full. Do not restructure the section, and do not touch
  `docs/product-specs/audit-logging.md`.
- **`docs/user-stories/epic-1376/1274-kyb-state-machine.md`** — **new, and required**:
  ISSUE_PROTOCOL § 6 makes a user-stories doc part of "done" for an implementation
  issue, committed in the same PR. This was missing from the first draft of the plan.
  Follow `docs/user-stories/epic-1376/1379-ungate-link-address.md` (#1379's, now on
  `main` — read it there) for structure — persona, steps, expected outcome, concrete enough for an
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
- **`docs/exec-plans/tech-debt-tracker.md`** — **at most one entry**, and **read this
  whole bullet before editing the file**:
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
  - **No entry about the missing audit record.** The previous revision of this plan
    told the coder to file one. The user ruled it out (Issue comment, 2026-09-30):
    the decision is that the verdict is simply not recorded anywhere beyond the `lps`
    row, and that is not a debt to be paid down later — it is the behaviour, stated in
    the spec by step 8. Do not file it, and do not smuggle it into another entry's
    Impact paragraph.
  - **Possible entry: the SQL predicates carrying this issue's policy are untested**, if
    the coder judges the gap worth tracking (the repo's no-DB-in-tests rule is the
    cause, so it may be better stated once, elsewhere, than per issue).
  - Numbering (only if that one entry is filed): the highest existing entry is
    `### TD-97`, so a new entry is **TD-98**. Re-verified 2026-09-30. Check again with
    `grep -o '^### TD-[0-9]*' docs/exec-plans/tech-debt-tracker.md | grep -o '[0-9]*' | sort -n | tail -1`
    before writing, since the number moves as siblings land.
- **No frontend or user-docs changes.** `packages/frontend/src/api/lps.ts` gains
  nothing here; the LP-side submit UI and the trustee verdict buttons (#1271) are
  separate issues. #1271 does need to know that `KYB Pending` now means `UnderReview`
  and that `ChangesRequested` needs a rendering — that is a note for its planner, not
  a change here.
- `docs/` is touched, so `npx tsx scripts/lint-docs.ts` must pass.

## Implementation Log

- **2026-09-30 — implemented, no deviations.** All 12 steps landed as written:
  migration `20260930000001_kyb_review_lifecycle.sql` (stamp re-checked free);
  `KybStatus::ChangesRequested` added with `ALL`, `SUBMITTABLE`/`submittable_strs`,
  `may_transition_to`, and `allows_document_review`; `OWNER_WRITABLE` moved to
  `[NotStarted, InProgress, ChangesRequested]`; `allows_address_write` given the
  `ChangesRequested` arm without a `_` wildcard; `LpRow`/`COLUMNS`/all three
  `SELECT`s extended with the four new columns; `LpRepo::submit_for_review` and
  `LpRepo::decide_kyb` added exactly as specified, including the `Failed` →
  `accounts.status = 'Suspended'` write inside `decide_kyb`'s own transaction;
  `DocumentStatus::FromStr` added; `KybDocumentRepo::review`'s `WHERE` gained the
  `lps.kyb_status = 'UnderReview'` `EXISTS` clause; `resolve_kyb_decision`,
  `submit_blockers`, `pass_blockers`, `KybDecision`, `KybDecisionRequest`,
  `MAX_DECISION_REASON_LEN` added to the compute section; `submit_my_lp` and
  `decide_kyb` handlers and routes added; `review_document` gained the
  `UnderReview` precondition (LP read after the document-ownership check,
  `ApiError::Internal` on a missing LP, `ApiError::Conflict` on a wrong status);
  `LpResponse`/`LpSummary` gained the new fields, `kyb_decided_by` exposed by
  neither; all three copies of the "crosses in the opposite direction at
  `Failed`" prose (`lp_repo.rs`, `routes/lps.rs` module header, `link_address`
  doc comment) rewritten to say `Failed` now closes both policies, keeping
  #1379's "do not add a `guard_writable` call here" sentence verbatim; the
  module header's inert-gate clause replaced; the merged spec's one paragraph
  replaced verbatim as step 8 specifies, with no `audit-logging.md` pointer
  added.
- **Tests.** `packages/shared/tests/kyb_status.rs` rewritten per the Test
  Strategy — `a_failed_lp_reopens` became `a_failed_lp_is_terminal_and_frozen`
  asserting the opposite, plus every new test the plan named (`ALL`-driven
  totality, `SUBMITTABLE` agreement, the six-row transition table, the
  independence-of-three-policies test, `DocumentStatus::from_str` round-trip).
  `packages/shared/tests/settlement_address.rs` fixed at both breaks the plan
  predicted (the exhaustive `expected` helper and the hard-listed array), and
  `the_policy_is_independent_of_the_write_freeze`'s second assertion rewritten
  to the `Passed`-with-no-address crossing rather than deleted; `NON_TERMINAL`
  widened to 4. `packages/api/tests/lps.rs` gained the `resolve_kyb_decision` /
  `submit_blockers` / `pass_blockers` unit tests and the OpenAPI assertions the
  plan listed (decision enum excludes `UnderReview`, `LpResponse`/`LpSummary`
  expose the new fields and not `kyb_decided_by`, the review `409` names the
  new cause). One test ordering fix not anticipated by the plan: the
  transition-table literal had to list `UnderReview -> ChangesRequested` before
  `UnderReview -> Passed` to match `ALL`'s iteration order — a test artifact,
  not a policy change.
- **Verification.** `cargo fmt --all --check`, `cargo clippy --all -- -D
  warnings`, `cargo nextest run --workspace --no-tests=pass`, and `npx tsx
  scripts/lint-docs.ts` (0 errors) all pass; see the PR description for the
  actual command output. Manual DB verification of the SQL predicates (Test
  Strategy's unchecked list) was not performed in this session — tracked as
  new tech-debt entry **TD-98** (the pure predicates are unit-tested, the SQL
  restating them is not) rather than left silent.
