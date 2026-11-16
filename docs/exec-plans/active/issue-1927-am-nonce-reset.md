# Issue #1927: AccessManager indexer drops a re-schedule after the contract nonce resets (unique key collision)

Source: https://github.com/eq-lab/pipeline/issues/1927

Parent epic: #1920. Found while planning #1922. Builds on #1921 (merged in `f74ce5b9`, plan
`docs/exec-plans/completed/issue-1921-access-manager-indexer.md`).

## Scope

### Contract behavior (checked by the planner on 2026-11-16)

Source: `pipeline-stellar-contracts@e9881ac`, `contracts/access-manager/src/{lib.rs,storage.rs}`.

- `schedule` (`lib.rs:338-349`): `prev_nonce` is the stored entry's nonce, or `0` when
  `get_schedule_entry` returns `None`. The new nonce is `prev_nonce + 1`. A still-live (not expired)
  entry rejects the call with `OperationAlreadyScheduled`.
- Entries are temporary storage. `schedule_ttl` (`storage.rs:317-337`): a closed slot (`timepoint = 0`,
  after `execute` or `cancel`) lives `EXPIRATION` (7 d) plus one day. A live slot lives until
  `timepoint + EXPIRATION` plus one day, so an expired schedule that was never closed lapses about one
  day after it expires.
- Once the entry lapses, the next `schedule` of the same `(caller, target, function, args)` gets the
  same `operation_id` with `nonce = 1` again.

Consequences for the projection:

- The unique key `(chain_id, contract_address, operation_id, nonce)` plus `ON CONFLICT DO NOTHING`
  drops the new schedule (the bug).
- Two rows can share `(operation_id, nonce)`. Both can even be `pending`: an expired schedule that was
  never closed (the table never stores `expired`), then a fresh one with `nonce = 1`.
- Two schedules with the same `(operation_id, nonce)` can never land in the same ledger: a reset needs
  the entry to lapse first, which takes at least about 8 days.

### In scope

1. [x] **New migration** that swaps the unique key for one that identifies a single schedule event:
   `UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)`, named
   `access_manager_operations_schedule_key`. The old auto-named constraint is dropped by a
   `pg_constraint` lookup. `schedule_ledger` comes before `nonce` so the index also serves the "newest
   schedule of this id" lookup below. The key is built only from chain data, so a replay of the same
   event (same ledger, same nonce) still conflicts and is skipped.
2. [x] **`INSERT_SCHEDULED_SQL`**: `ON CONFLICT (chain_id, contract_address, operation_id, schedule_ledger, nonce) DO NOTHING`.
3. [x] **`MARK_CANCELED_SQL` and `MARK_EXECUTED_SQL`**: a close updates **the newest schedule of the
   `operation_id` logged before the closing event, and only if that row is `pending`** (and, for a
   cancel, only if its `nonce` equals the event's nonce). "Newest" is
   `ORDER BY schedule_ledger DESC, source_log_id DESC LIMIT 1`. "Logged before" is
   `source_log_id < <closing contract_logs.id>`. Neither statement orders by `nonce`.
4. [x] **Test fake** `MemStore` (`packages/worker/tests/stellar_access_manager_support/mod.rs`) mirrors the
   new SQL exactly.
5. Tests and docs, listed below. Move BUG-38 (added to `known-bugs.md` by #1928) to `## Resolved`,
   and delete the #1928 "Known limitations" line about it.

#### Why "newest row, only if pending", bounded by the closing log id

Two closing rules were possible. The one chosen is "the newest row of the id logged before the close,
updated only if it is `pending`". The other is "the newest `pending` row of the id". The two give the
same result on a first pass, because the schedule a close consumes on chain is always the newest
schedule of that id before the close. They differ when the same rows are replayed (watermark reset to
0, which [Re-projection](../../references/access-manager-events.md#sync-loop) allows):

- Without the `source_log_id < closing id` bound, replaying an old execute `E1` (of `S1`, now
  `executed`) would close the later live schedule `S2`. The current `ORDER BY nonce DESC` statement has
  the same flaw today: `S1 (nonce 1)`, `E1`, `S2 (nonce 2, pending)`, then a replay closes `S2`.
- With "newest `pending` row", a replay of `C2` (which canceled `S2`) would cancel an older stale
  pending `S1` with the same nonce. "Newest row, only if pending" makes that replay a no-op.

`source_log_id` is a sound order for this bound. The sync loop processes rows strictly by
`contract_logs.id`, a lower id is never committed after a higher one for one contract, and a
`log_collector_state` rewind deduplicates on the `contract_logs` unique key, so replayed events keep
their ids (`access-manager-events.md` "Ordering").

### Out of scope

- No change to `access_manager_sync.rs` logic: the matching lives in the repo SQL, and
  `AccessManagerRepo::apply` already receives the closing row's `log_id`. The worker only needs the
  test fake changes.
- No new `expired` status, no reconciliation against `get_schedule` / `get_nonce` (TD-187).
- No change to the #1928 API query (it already supersedes by `(schedule_ledger, source_log_id)`).
- No backfill. Schedules dropped by the bug before this fix stay missing until the Risk Council
  schedules again, or until a `log_collector_state` rewind within RPC retention plus a sync watermark
  reset replays them (rollout note in the docs, optional, not part of this issue's deploy).
- The original migration `20261116000001_access_manager_operations.sql` is not edited: it is applied
  and sqlx checksums it.

## Assumptions and Risks

- **Ordering dependency on #1928 (PR open, branch `feat/1922-pending-operations-api`, not merged at
  planning time).** #1928 adds BUG-38 to `docs/exec-plans/known-bugs.md`, a "Known limitations" line
  and an "API read" section to `docs/references/access-manager-events.md`, and `LIST_PENDING_LOAN_OPS_SQL`
  to `packages/shared/src/access_manager_repo.rs` (just above `INSERT_SCHEDULED_SQL`, so the hunks are
  adjacent). Implement #1927 **after #1928 merges**, rebased on `origin/main`, so the BUG-38 move
  and the doc edits apply cleanly. If #1928 is still open at implementation time, wait (Decision 1).
- **Migration version.** The latest is `20261116000001`. No open PR adds a migration (checked
  2026-11-16). Use `20261117000001_access_manager_operations_schedule_key.sql`. Re-check
  `ls packages/shared/migrations | tail -3` after rebasing and pick the next free version if another
  PR has landed one with that number.
- **Constraint name.** The original `UNIQUE (...)` was declared inline, so Postgres generated its
  name (truncated past 63 chars). The migration looks it up in `pg_constraint` (`contype = 'u'` on
  `access_manager_operations`) and drops it with `EXECUTE format(... %I ...)`, as
  `20260728000001_submitted_loans_changes_requested.sql` does. `ADD CONSTRAINT` cannot fail on
  existing data: the old 4-column key implies the new 5-column key.
- **Rollback.** Going back to the 4-column key fails once two rows share `(operation_id, nonce)`. The
  rollback comment must say to delete the newer duplicates first.
- **Fake versus real SQL.** Worker tests run against `MemStore`, not Postgres (no DB in tests). The SQL
  is covered by string-pinning tests in `packages/shared/tests/`, as #1928 does. Risk: the fake drifts
  from the SQL. Mitigation: the fake mirrors each predicate one for one, and the pin tests assert each
  predicate's exact text.
- **Stale pending rows remain.** A schedule whose close was missed (TD-187) or that expired stays
  `pending`. After a reset a newer row exists. Closes now skip the stale row, and the #1928 read drops
  it as superseded. This is intended.

## Decisions (human, 2026-11-16)

The human accepted the three recommended defaults:

1. **Ordering with #1928.** Wait for #1928 to merge, rebase `fix/1927-am-nonce-reset` on
   `origin/main`, then implement. Do not start the code while #1928 is open.
2. **BUG-38.** Move it from `## Open` to `## Resolved` in `docs/exec-plans/known-bugs.md` as
   `BUG-38 … [FIXED <date> / #1927]` and add a one-line `Resolved:` note. This follows the file's
   convention (BUG-34, BUG-35, BUG-36). Do not delete it.
3. **Unique key.** Use the natural key `UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)`,
   not `source_log_id`. It is built only from chain data, so it still deduplicates if `contract_logs`
   rows were ever re-ingested with new ids.

## Open Questions

_None_

## Implementation Steps

0. [x] **Precondition.** `gh pr view 1928 --json state,mergedAt`. When `MERGED`:
   `git -C /Users/aabliazimov/Documents/work/pipeline-fix-1927-am-nonce-reset fetch origin && git rebase origin/main`.
   Otherwise stop and wait for the merge (Decision 1).

1. **Migration** `packages/shared/migrations/20261117000001_access_manager_operations_schedule_key.sql`:
   - Header: `-- spec: docs/references/access-manager-events.md#table`, then a `-- Rollback:` block
     (drop `access_manager_operations_schedule_key`; delete newer duplicate `(chain_id,
     contract_address, operation_id, nonce)` rows; re-add `UNIQUE (chain_id, contract_address,
     operation_id, nonce)`; `DELETE FROM _sqlx_migrations WHERE version = 20261117000001;`), as in
     `20261111000001_lp_bank_deposits_matched_reference.sql`.
   - A `DO $$ … $$` block: `SELECT con.conname INTO … FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid WHERE rel.relname = 'access_manager_operations' AND con.contype = 'u' AND con.conname <> 'access_manager_operations_schedule_key'`;
     `IF … IS NOT NULL THEN EXECUTE format('ALTER TABLE access_manager_operations DROP CONSTRAINT %I', …)`.
   - `ALTER TABLE access_manager_operations ADD CONSTRAINT access_manager_operations_schedule_key UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce);`
   - No data changes (no `UPDATE`, `INSERT` or `DELETE` statements).

2. **`packages/shared/src/access_manager_repo.rs`**:
   - `INSERT_SCHEDULED_SQL`: conflict target becomes
     `ON CONFLICT (chain_id, contract_address, operation_id, schedule_ledger, nonce) DO NOTHING`.
   - `MARK_CANCELED_SQL` (binds `$1` chain, `$2` contract, `$3` operation_id, `$4` nonce, `$5` tx hash,
     `$6` ledger, `$7` closing log id):
     ```sql
     UPDATE access_manager_operations
     SET status = 'canceled', closed_tx_hash = $5, closed_ledger = $6, updated_at = now()
     WHERE id = (
         SELECT id FROM access_manager_operations
         WHERE chain_id = $1
           AND contract_address = $2
           AND operation_id = $3
           AND source_log_id < $7
         ORDER BY schedule_ledger DESC, source_log_id DESC
         LIMIT 1)
       AND nonce = $4
       AND status = 'pending'
     ```
   - `MARK_EXECUTED_SQL` (binds `$1` chain, `$2` contract, `$3` operation_id, `$4` tx hash, `$5` ledger,
     `$6` closing log id): the same subquery with `$6`, and the outer `AND status = 'pending'`. Remove
     `ORDER BY nonce DESC`.
   - `AccessManagerRepo::apply`: bind `log_id` as `$7` for the cancel and `$6` for each execute id. No
     signature change. `OpWrite` is unchanged.

3. **`packages/worker/tests/stellar_access_manager_support/mod.rs`** (`MemStore::apply`), mirroring
   step 2:
   - `Schedule`: the duplicate check matches `operation_id`, `nonce` **and** `schedule_ledger`.
   - A shared helper `newest_before(ops, operation_id, log_id) -> Option<&mut Op>`: rows with that id
     and `new.source_log_id < log_id`, max by `(new.schedule_ledger, new.source_log_id)`.
   - `Cancel`: take `newest_before`, and update it only if `status == Pending && new.nonce == nonce`.
   - `Execute`: for each id, take `newest_before`, and update it only if `status == Pending`.
   - Drop the `max_by_key(|o| o.new.nonce)` logic.

4. **`packages/worker/src/indexer/stellar/access_manager_sync.rs`**: no logic change expected. Re-read
   it after step 2 and confirm nothing there assumes "highest nonce" (no log text or comment does today).

5. [x] **Docs** (see Docs to Update), then move BUG-38 to `## Resolved` (Decision 2).

6. [x] **Lint and test**: `cargo clippy --all -- -D warnings`;
   `cargo test -p shared --test migration_access_manager_schedule_key --test access_manager_projection_sql`;
   `cargo test -p pipeline-worker --test stellar_access_manager_sync`; then `/test-fast`; `npx tsx scripts/lint-docs.ts` for the doc edits.

## Test Strategy

The code stays comment-less, with only the `// spec:` header line. Tests live in external files. No
test reads `DATABASE_URL`, `POSTGRES_URL` or any other env var, and none touches a database.

**New `packages/shared/tests/migration_access_manager_schedule_key.rs`** (`include_str!` of the
migration, whitespace-flattened, as `migration_lp_bank_deposits_matched_reference.rs` does):
- `the_old_key_is_dropped_by_lookup`: contains `FROM pg_constraint`, `contype = 'u'`,
  `relname = 'access_manager_operations'`, and `DROP CONSTRAINT %I`.
- `the_new_key_identifies_one_schedule_event`: contains
  `ADD CONSTRAINT access_manager_operations_schedule_key UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)`.
- `there_is_no_data_change`: the non-comment statements have no `UPDATE`, `INSERT` or `DELETE`.
- `a_rollback_block_is_present`.

**New `packages/shared/tests/access_manager_projection_sql.rs`** (pins the repo constants):
- `the_insert_conflict_target_is_the_migration_key`: extract the column list after `ON CONFLICT (` in
  `INSERT_SCHEDULED_SQL` and the list after `UNIQUE (` in the migration (`include_str!`), and assert
  they are equal as sets. Also assert `DO NOTHING`.
- `cancel_closes_the_newest_schedule_logged_before_it`: `MARK_CANCELED_SQL` contains
  `source_log_id < $7`, `ORDER BY schedule_ledger DESC, source_log_id DESC LIMIT 1`, and, after the
  subquery, `AND nonce = $4 AND status = 'pending'`. It does not contain `ORDER BY nonce`.
- `execute_closes_the_newest_schedule_logged_before_it`: `MARK_EXECUTED_SQL` contains
  `source_log_id < $6` and the same `ORDER BY`, ends with `AND status = 'pending'`, and does not
  contain `ORDER BY nonce` or `nonce DESC`.
- `the_status_guard_is_outside_the_subquery`: in both statements the `status = 'pending'` predicate
  follows `LIMIT 1)`, so a closed newest row is never skipped in favor of an older pending one.

**`packages/worker/tests/stellar_access_manager_sync.rs`** (via `MemStore`). Rows get distinct
`tx_hash` values. Tests that need ledgers out of id order set `row.block_number` directly. Nonce `1`
means a reset.
- Rename `execute_touches_only_the_highest_nonce_pending_row` to
  `execute_touches_only_the_newest_schedule_of_the_id`, with the same assertions.
- `a_reschedule_after_the_nonce_reset_gets_its_own_row`: `S1(nonce 1)`, `E1`, `S2(nonce 1)`. Two rows:
  `S1` `executed` with `closed_tx_hash` E1, `S2` `pending` with `source_log_id` 3.
- `cancel_after_a_reset_closes_only_the_newest_schedule`: `S1(nonce 1)`, `C1(nonce 1)`,
  `S2(nonce 1)`, `C2(nonce 1)`. `S1` closed by C1, `S2` closed by C2.
- `execute_after_a_reset_skips_a_stale_pending_row`: `S1(nonce 3)` (never closed, i.e. expired),
  `S2(nonce 1)`, `E`. `S1` stays `pending`, `S2` is `executed`. This also proves the order is not by
  nonce.
- `cancel_naming_another_nonce_than_the_newest_schedule_changes_nothing`: `S1(nonce 2)`, `S2(nonce 1)`,
  `C(nonce 2)`. Nothing changes and the watermark advances.
- `replay_after_a_reset_never_closes_the_later_schedule`: `S1(nonce 1)`, `E1`, `S2(nonce 1)` pending.
  Reset the watermark and run again: ops are unchanged, `S2` is still `pending`, and the row count is 2.
  Also a cancel variant with `C1` in place of `E1`.
- `replay_of_a_close_never_falls_back_to_an_older_pending_row`: `S1(nonce 1)` stale `pending`,
  `S2(nonce 1)`, `C2(nonce 1)`. After a reset and a rerun, `S1` is still `pending` and `S2` is still
  `canceled`.
- `newest_is_by_ledger_then_log_id`: two schedules of one id where the higher `source_log_id` has the
  lower `block_number`, then an execute. The row with the higher ledger is closed.
- Existing tests keep passing unchanged: `replaying_from_a_reset_watermark_changes_nothing`,
  `schedule_then_cancel_in_one_batch_is_canceled`, `schedule_then_execute_in_one_batch_is_executed`.

## Docs to Update

- `docs/references/access-manager-events.md` (on top of #1928's version):
  - **Table**: point the migration line at both files and give the key as
    `UNIQUE (chain_id, contract_address, operation_id, schedule_ledger, nonce)`
    (`20261117000001_access_manager_operations_schedule_key.sql`). One row per schedule event.
  - `nonce` row: "increments on a re-schedule while the contract's temporary entry exists; restarts at
    1 once it lapses (`schedule_ttl`: 7 d + 1 d after execute or cancel, about 1 d after expiry), so
    `(operation_id, nonce)` is not unique over time."
  - **Status rules**: a cancel or execute closes the newest row of its `operation_id` (by
    `(schedule_ledger, source_log_id)`) among rows logged before the closing event, only if it is
    `pending` (a cancel also needs the event's `nonce`). Never by `nonce`.
  - **Per-row transaction / Re-projection**: closes are bounded to schedules logged before the closing
    row, so a replay never closes a later schedule.
  - **Execute matching** paragraph: replace "highest-nonce pending row" with the newest-row rule.
  - **Known limitations**: delete the BUG-38 / #1927 line that #1928 adds.
- `docs/exec-plans/known-bugs.md`: move BUG-38 to `## Resolved` with `[FIXED <date> / #1927]` and a `Resolved:` line (Decision 2).
- `docs/references/backend.md` (Stellar AccessManager indexing paragraph, about line 473): name the
  second migration next to `20261116000001_access_manager_operations.sql`.
- `docs/user-stories/epic-1920/1921-access-manager-indexer.md` Story 3, last bullet: "Re-scheduling the
  same call after it was closed adds a second row (`nonce + 1`, or `nonce = 1` again once the
  contract's entry lapsed about 8 days later); the closed row is untouched."
- No product-spec change: the behavior is the one already specified (every schedule is a row). The
  `pending_operations` contract in `docs/product-specs/loan-security-state.md` (#1928) is unchanged.
- Move this plan to `docs/exec-plans/completed/` when the PR merges (manager).
