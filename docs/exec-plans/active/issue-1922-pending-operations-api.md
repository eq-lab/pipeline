# Issue #1922: API: pending AccessManager operations inline in loan-book and loan security responses

Source: https://github.com/eq-lab/pipeline/issues/1922

Parent epic: #1920, merge-order step 2. Builds on #1921 (merged in #1926, base `origin/main` `f74ce5b9`), which
creates `access_manager_operations`. Frontend consumers: #1923 (security page), #1924 (hub and loan pages). QA:
#1925.

## Scope

### Source of truth (checked by the planner on 2026-11-16)

- Table `access_manager_operations` (`packages/shared/migrations/20261116000001_access_manager_operations.sql`), repo
  `packages/shared/src/access_manager_repo.rs`, reference `docs/references/access-manager-events.md`, completed plan
  `docs/exec-plans/completed/issue-1921-access-manager-indexer.md`.
- Contract `pipeline-stellar-contracts@e9881ac`, `contracts/access-manager`:
  - `consume_scheduled` (`lib.rs:473`): `OperationNotReady` while `now < timepoint`; `OperationExpired` when
    `now >= timepoint + EXPIRATION` (`is_expired`, `storage.rs:307`). So `ready` is `ready_at <= now < expires_at`
    and `expired` is `now >= expires_at`, with `expires_at = ready_at + 604800` as stored.
  - `schedule` (`lib.rs:339`): a new schedule of an id is accepted only when the previous one is not live
    (executed, canceled or expired). Its nonce is `previous + 1` while the temporary entry still exists, and
    restarts at 1 once the entry's TTL lapses (`schedule_ttl`, `storage.rs:327`: about `ready_at + 8 d` for a
    live entry, `7 d + 1 d` after an execute or cancel).
- API today: `GET /v1/loan-book` (`routes/loan_book.rs`, `handle_loan_book`, `LenientChainFilter`) and
  `GET /v1/loan-book/{loan_id}/security` (`routes/loan_security.rs`, `RequiredChain`, `404
  security_registry_not_configured` without the API SecurityRegistry key). Both are **public** (no auth extractor);
  see Assumptions.
- API address config (`packages/api/src/config.rs`): `loan_registry_addresses` (required on every chain),
  `minter_addresses` (`CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`, optional), `security_registry_addresses`
  (`CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS`, optional, Stellar only). Stage (`argocd/pipeline/test.yaml`)
  sets all three on chain 99000001 to the same ids as the indexer keys.

### In scope

1. A `PendingOperation` DTO and a `pending_operations: PendingOperation[]` key, always present (never `null`), on:
   - `GET /v1/loan-book/{loan_id}/security?chain_id=`: SecurityRegistry operations of that loan (`set_terms`,
     `resolve_flag`, `release_with_consent`).
   - every `loans[]` entry of `GET /v1/loan-book[?chain_id=]`: every loan-scoped operation of that loan on the
     configured LoanRegistry, Minter and SecurityRegistry.
2. `PendingOperation` fields: `operation_id` (64 lowercase hex, as stored), `nonce` (number), `caller`, `target`,
   `target_kind` (`loan_registry` / `minter` / `security_registry` / `other`), `function`, `args_xdr` (base64,
   verbatim from `args_xdr`), `args` (`args_json` verbatim, a JSON array, display only), `ready_at`, `expires_at`
   (ISO-8601 UTC, `iso_utc_from_unix`), `state` (`waiting` / `ready` / `expired`). Sorted by `ready_at`, then
   `operation_id`, then `nonce`.
3. Selection rules (one SQL statement per chain, see Step 2):
   - `status = 'pending'` only; executed and canceled rows are never returned. `expired` is derived at read time.
   - **Scoped to the configured targets**: `target` must equal the chain's API LoanRegistry, Minter or
     SecurityRegistry address (whichever are configured). This mirrors every LoanBook reader (scoped to the
     configured LoanRegistry) and keeps a loan id of a retired contract from attaching to the same id on the
     current one. `target_kind` is derived from the same comparison; `other` stays in the enum for future non-loan
     operations and is not emitted by these two responses.
   - **Loan resolution**: `COALESCE(loan_id, <record → loan lookup>)`. The lookup runs only for rows with
     `loan_id IS NULL`, `record_id IS NOT NULL` and `target` = the configured SecurityRegistry, and uses the same
     three sources as the indexer's `RECORD_LOAN_SQL` (`security_records`, `SecurityRecordRegistered` rows in
     `contract_logs`, `security_view_snapshots` `kind = 'record'`). Rows that still have no loan are not returned.
   - Rows without `args_xdr` / `args_json` (transaction out of retention) are not returned; they cannot be executed
     from the console and the indexer never sets `loan_id` for them anyway.
   - **Superseded rows**: a `pending` row is dropped when a later schedule of the same
     `(chain_id, contract_address, operation_id)` exists (`(schedule_ledger, source_log_id)` greater), whatever its
     status. On chain a new schedule of an id is only accepted after the previous one stopped being live, so the
     older row is dead. Ordering by schedule ledger rather than `nonce` is deliberate: the contract nonce restarts
     at 1 after the temporary entry's TTL lapses, so a higher nonce is not always the newer schedule.
4. Empty array: on EVM chains (no query), when the indexer key is unset (empty table), for loans with no pending
   operations, and for chains or loans the API does not serve.
5. No new route, no migration, no new env key, no `AppState` field.
6. Docs and user stories (see Docs to Update).

### Out of scope

- `set_inspectors` and any other non-loan-scoped operation (Decision 1; the hub keeps its footnote).
- Any change to the #1921 indexer, its table or its unique key. The nonce-reset collision below is fixed in #1927
  (Decision 3).
- Frontend types and pages (#1923, #1924). Adding a key to the JSON does not break the existing TS consumers.
- Auth changes on either endpoint.
- Reconciliation against on-chain `get_schedule` (TD-187).

## Decisions (human, 2026-11-16)

1. **Non-loan operations.** `set_inspectors` and any other operation that is not loan-scoped are left out of
   #1922. The hub keeps its footnote for them.
2. **Expired operations.** Returned always, with no time window, as the issue says. They read `expired` until a
   later schedule of the same id supersedes them.
3. **Nonce-reset collision.** Fixed separately in bug sub-issue #1927 (epic #1920). #1922 keeps the
   superseded-row filter by `(schedule_ledger, source_log_id)` and only logs the bug in `known-bugs.md` with a
   reference to #1927 (Step 7).
4. **Auth.** Both endpoints stay public, although the issue says "trustee". The spec's Security note says that
   every served field is already public on chain.

## Assumptions and Risks

- **Auth (Decision 4).** Both endpoints are public today (`loan-security-state.md#security`; the LP app also reads
  `/v1/loan-book`) and stay public: every served field (caller, target, function, args, ready time) is already
  public in the schedule transaction and event on chain. The spec's Security section says so.
- **Encoding.** `ready_at` / `expires_at` are ISO strings as the issue specifies, although the rest of the
  `/security` body serializes `u64` times as decimal strings. The spec states the exception explicitly.
- **Config drift.** If the API's Minter or SecurityRegistry key is unset while the indexer's is set, operations on
  that contract are not served (same as `pocket` / `ltv_bps` behaviour). Stage sets all three. Documented.
- **#1921 nonce-reset collision (#1927, Decision 3).** The indexer's key is
  `(chain_id, contract_address, operation_id, nonce)` with `INSERT … ON CONFLICT DO NOTHING`. Once the contract's
  temporary schedule entry lapses (about 8 days after `ready_at` for an unexecuted schedule, 8 days after an execute
  or cancel), the nonce restarts at 1. A later schedule of the **same arguments by the same caller** (very likely
  for `set_default(loan)` / `cure(loan)`, whose only argument is the loan id) then collides with the old row and is
  silently dropped: the console shows nothing (old row executed or canceled) or the stale expired row. Earliest
  possible occurrence on stage is about 8 days after the indexer goes live, so it does not block this issue. The
  supersede rule above is correct both before and after a fix. Step 7 logs it in `known-bugs.md`; the fix (a
  migration plus an indexer change) is #1927.
- **Expired rows never leave the table.** An expired schedule cannot be canceled on chain once its entry lapses,
  and the indexer never closes it, so it reads `expired` until a later schedule of the same id supersedes it.
  They are served always, with no window (Decision 2).
- **Execute mismatch (TD-187).** A pending row whose execute was not matched reads `expired` after 7 days; an
  immediate execute of the same args marks a live schedule `executed`. Inherited from #1921, unchanged.
- **Projection lag.** Up to one `access-manager-sync` interval (15 s) after the cursor passes the ledger. The
  frontend keeps its in-session state until #1923 / #1924 switch to the API.
- **Error policy.** A database error on the pending-operations read is a `500` for the whole response, exactly as
  the SecurityRegistry fields on `/v1/loan-book` (#1786) and the rest of `/security`.
- **Performance.** One extra statement per Stellar chain on `/v1/loan-book` and one on `/security`, served by
  `idx_am_ops_pending_loan` / the unique key; the record lookup only runs for the rare unresolved row. The table is
  tiny (a handful of Risk Council schedules).
- **No dependency on unmerged work.** #1921 is on `main`. The unrelated uncommitted #1786 Phase 2 work in the main
  checkout touches `loan_book.rs`; the worktree is based on `origin/main` and the coder must not pull those changes
  in. Expect a merge conflict in `loan_book.rs` / `main.rs` with #1786 Phase 2 if that lands first (both add or
  remove fields near `ltv_bps`).

## Open Questions

_None_

## Implementation Steps

### 1. DTO and pure mapping: `packages/api/src/pending_operations.rs` (new, `pub mod pending_operations;` in `lib.rs`)

Header: `// spec: docs/product-specs/loan-security-state.md#pending-operations`. No other comments.

- `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)] #[serde(rename_all = "snake_case")]`
  `pub enum PendingOperationState { Waiting, Ready, Expired }`.
- Same derives: `pub enum PendingTargetKind { LoanRegistry, Minter, SecurityRegistry, Other }`.
- `#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)] pub struct PendingOperation { operation_id: String,
  nonce: u32, caller: String, target: String, target_kind: PendingTargetKind, function: String, args_xdr: String,
  #[schema(value_type = Vec<Object>)] args: serde_json::Value, ready_at: String, expires_at: String,
  state: PendingOperationState }` (all `pub`).
- `pub struct TargetScope<'a> { pub loan_registry: Option<&'a str>, pub minter: Option<&'a str>,
  pub security_registry: Option<&'a str> }` with
  - `pub fn targets(&self) -> Vec<String>` (the configured ones, in that order);
  - `pub fn kind(&self, target: &str) -> PendingTargetKind` (exact string match; `Other` otherwise).
- `pub fn pending_state(now: i64, ready_at: i64, expires_at: i64) -> PendingOperationState`:
  `now < ready_at` → `Waiting`; `now >= expires_at` → `Expired`; else `Ready`.
- `pub fn pending_operation(row: &PendingOpRow, scope: &TargetScope<'_>, now: i64) -> Option<PendingOperation>`:
  `nonce` via `u32::try_from` (`None` on failure; the contract nonce is `u32`, so this never happens in practice),
  `ready_at` / `expires_at` via `crate::formatting::iso_utc_from_unix`, `args_xdr` and `args` verbatim.
- `pub fn sort_pending(ops: &mut [PendingOperation])` or sort inside the grouping: key `(ready_at unix, operation_id,
  nonce)`. Sort on the unix values from the row, not on the ISO string, so do it before mapping or keep the unix
  value alongside; the coder picks the simplest form.
- `pub fn group_by_loan(chain_id: i64, rows: &[PendingOpRow], scope: &TargetScope<'_>, now: i64)
  -> HashMap<LoanRef, Vec<PendingOperation>>` keyed `(chain_id, loan_id.to_string())`, each vector sorted.
  `LoanRef` is `routes::loan_book::LoanRef`; if that import direction is awkward, return
  `HashMap<(i64, String), …>` (same type).

### 2. Read SQL and repo method: `packages/shared/src/access_manager_repo.rs`

- `#[derive(Debug, Clone, PartialEq, sqlx::FromRow)] pub struct PendingOpRow { pub loan_id: i64,
  pub operation_id: String, pub nonce: i64, pub caller: String, pub target: String, pub function: String,
  pub args_xdr: String, pub args_json: Value, pub ready_at: i64, pub expires_at: i64 }`.
- `pub const LIST_PENDING_LOAN_OPS_SQL: &str` with binds `$1 chain_id`, `$2 targets TEXT[]`,
  `$3 security_registry TEXT NULL`, `$4 loan_id BIGINT NULL`. Shape (the coder may restructure, the tests in Step 6
  pin the rules, not the exact text):

  ```sql
  SELECT r.loan_id, o.operation_id, o.nonce, o.caller, o.target, o.function,
         o.args_xdr, o.args_json, o.ready_at, o.expires_at
  FROM access_manager_operations o
  CROSS JOIN LATERAL (
      SELECT COALESCE(o.loan_id, (
          SELECT l.loan_id FROM (
              SELECT loan_id FROM security_records
              WHERE chain_id = o.chain_id AND contract_address = $3 AND record_id = o.record_id
              UNION ALL
              SELECT (params->>'loan_id')::bigint FROM contract_logs
              WHERE chain_id = o.chain_id AND contract_address = $3
                AND event_name = 'SecurityRecordRegistered'
                AND (params->>'record_id')::bigint = o.record_id
                AND params->>'loan_id' IS NOT NULL
              UNION ALL
              SELECT loan_id FROM security_view_snapshots
              WHERE chain_id = o.chain_id AND contract_address = $3 AND kind = 'record'
                AND entity_id = o.record_id AND loan_id IS NOT NULL
          ) l
          WHERE o.loan_id IS NULL AND o.record_id IS NOT NULL AND o.target = $3
          LIMIT 1)) AS loan_id
  ) r
  WHERE o.chain_id = $1
    AND o.status = 'pending'
    AND o.target = ANY($2)
    AND o.args_xdr IS NOT NULL
    AND o.args_json IS NOT NULL
    AND r.loan_id IS NOT NULL
    AND ($4::bigint IS NULL OR r.loan_id = $4)
    AND NOT EXISTS (
        SELECT 1 FROM access_manager_operations n
        WHERE n.chain_id = o.chain_id
          AND n.contract_address = o.contract_address
          AND n.operation_id = o.operation_id
          AND (n.schedule_ledger, n.source_log_id) > (o.schedule_ledger, o.source_log_id))
  ORDER BY r.loan_id, o.ready_at, o.operation_id, o.nonce
  ```

- `AccessManagerRepo::list_pending_loan_ops(&self, chain_id: i64, targets: &[String],
  security_registry: Option<&str>, loan_id: Option<i64>) -> anyhow::Result<Vec<PendingOpRow>>`. Return early with
  `Vec::new()` when `targets` is empty. Runtime `sqlx::query_as`, no macros.

### 3. Loan security endpoint: `packages/api/src/security_state.rs`, `packages/api/src/routes/loan_security.rs`

- `LoanSecurityResponse`: add `pub pending_operations: Vec<PendingOperation>` (after `records`).
  `build_security_response` sets it to `Vec::new()`; its signature stays the same (existing tests keep compiling).
- `get_loan_security`: after `build_security_response`, read
  `AccessManagerRepo::new(state.pool.clone()).list_pending_loan_ops(chain_id, &[contract.to_owned()],
  Some(contract), Some(i64::from(id)))`, map with `TargetScope { loan_registry: None, minter: None,
  security_registry: Some(contract) }` and the same `now`, sort, assign. `?` on the error (→ `500`).
- `LoanSecurityDoc`: add `PendingOperation`, `PendingOperationState`, `PendingTargetKind` to `components`. Extend
  the `200` description: "…, and the loan's pending SecurityRegistry operations scheduled on the AccessManager".

### 4. Loan book: `packages/api/src/routes/loan_book.rs`

- `LoanBookEntry`: add `pub pending_operations: Vec<PendingOperation>` after `price_stale`; `build_loan_entry`
  sets `Vec::new()`.
- `async fn pending_ops_by_loan(state, chain_ids, now) -> Result<HashMap<LoanRef, Vec<PendingOperation>>, ApiError>`:
  for each chain id with `chain_kind == Some(ChainKind::Stellar)`, build `TargetScope` from
  `loan_registry_addresses`, `minter_addresses`, `security_registry_addresses`; skip when `targets()` is empty;
  `list_pending_loan_ops(chain_id, &targets, scope.security_registry, None)`; merge `group_by_loan`.
- `pub fn attach_pending_operations<S: BuildHasher>(resp: &mut LoanBookResponse,
  by_loan: &HashMap<LoanRef, Vec<PendingOperation>, S>)`: per entry, clone the matching vector or leave `[]`.
- `handle_loan_book`: after `attach_security`, call both with `to` as `now`.
- `LoanBookDoc`: add the three schemas to `components`.

### 5. Wire-up and lint

- `packages/api/src/lib.rs`: `pub mod pending_operations;`. No `AppState` or `main.rs` change.
- `cargo fmt`, `cargo clippy --all -- -D warnings`, `npx tsx scripts/lint-docs.ts`.

### 6. Tests (see Test Strategy)

`packages/api/tests/pending_operations.rs` (new) and `packages/shared/tests/access_manager_pending_sql.rs` (new);
extend `packages/api/tests/loan_book_security.rs` / `loan_security.rs` only where an existing key-set or OpenAPI
assertion needs the new key.

### 7. Known bug

Append the next free `BUG-<N>` (BUG-38 at planning time) to `docs/exec-plans/known-bugs.md`: location
`packages/shared/src/access_manager_repo.rs` (`INSERT_SCHEDULED_SQL`) and the migration's unique key; symptom,
root cause (contract nonce restarts at 1 after the temporary entry lapses, `storage.rs:327` / `lib.rs:339`), and
workaround (none; the Risk Council can still execute by retyping the args, as before #1920). Found while planning
#1922. The entry names its tracking issue, #1927, and says #1927 removes the entry when it is fixed.

### 8. Docs (see Docs to Update)

## Test Strategy

Pure unit tests only: no database, no `DATABASE_URL` / `POSTGRES_URL` or any env var, no inline `#[cfg(test)]`.
One-line spec header per file, no other comments.

`packages/api/tests/pending_operations.rs` (header `// spec: docs/product-specs/loan-security-state.md#pending-operations`):

- `pending_state` boundaries with `ready_at = R`, `expires_at = R + 604800`: `R - 1` → `waiting`; `R` → `ready`;
  `R + 604799` → `ready`; `R + 604800` → `expired`; far future → `expired`.
- `TargetScope::kind`: each configured address maps to its kind; an unknown address and an unconfigured minter
  (`None`) give `other`. `targets()` lists only the configured ones.
- `pending_operation` mapping: `args_xdr` byte-identical, `args` equals `args_json` (e.g. `[0, 145000,
  "1816128000"]`), `ready_at` / `expires_at` ISO (`1763251200` → `"2025-11-16T00:00:00Z"`), `nonce` as a number,
  `operation_id` unchanged; a nonce above `u32::MAX` yields `None`.
- `group_by_loan`: rows for loans 0 and 7 group under `(chain, "0")` and `(chain, "7")`; within a loan the order
  is by `ready_at`, then `operation_id`, then `nonce`; loan 0 is a valid key.
- JSON shape: a serialized `PendingOperation` has exactly the 11 keys of the spec, `state` and `target_kind` in
  snake_case.
- `attach_pending_operations` (with `compute_loan_book` on fixture snapshots, as `loan_book_security.rs` does):
  fills only the matching chain and loan; the same loan id on two chains gets its own list; an unmatched entry
  serializes `"pending_operations": []`, never `null` or missing.
- `build_security_response` serializes `"pending_operations": []`.
- OpenAPI: `LoanBookDoc` and `LoanSecurityDoc` list `pending_operations` as a required array of
  `PendingOperation`; the two enums carry exactly `waiting|ready|expired` and
  `loan_registry|minter|security_registry|other`.

`packages/shared/tests/access_manager_pending_sql.rs` (header `// spec: docs/references/access-manager-events.md#api-read`),
SQL-shape assertions in the `pocket_repo_sql.rs` style (whitespace-normalized `contains`):

- `o.status = 'pending'`, `o.chain_id = $1`, `o.target = ANY($2)`, `args_xdr IS NOT NULL`,
  `args_json IS NOT NULL`, `r.loan_id IS NOT NULL`, `$4::bigint IS NULL OR`.
- Record fallback reads `security_records`, `SecurityRecordRegistered` and `security_view_snapshots` scoped by
  `contract_address = $3`, and only when `o.loan_id IS NULL`.
- Supersede rule: `NOT EXISTS` on the same `operation_id` and `contract_address` comparing
  `(schedule_ledger, source_log_id)`; no `nonce >` comparison.
- No `executed` / `canceled` literal outside the status filter; `ORDER BY` starts with the loan and `ready_at`.

Run `cargo test -p pipeline-api -p shared`, `cargo clippy --all -- -D warnings`, `npx tsx scripts/lint-docs.ts`.
Manual check on stage after deploy (QA #1925): `GET /v1/loan-book/0/security?chain_id=99000001` and
`GET /v1/loan-book?chain_id=99000001` show the Risk Council's pending schedules with the args the console sent.

## Docs to Update

- `docs/product-specs/loan-security-state.md`:
  - new `## Pending operations` section: the DTO table (field, type, source), states and boundaries, sort,
    selection rules (pending only, configured targets, read-time record resolution, rows without args skipped,
    supersede rule), empty cases (EVM, indexer key unset, API key unset), ISO exception to the encoding rule,
    `other` reserved, lag (15 s sync interval), `500` on a database error;
  - API Contract: add `"pending_operations": [ … ]` to the JSON example and one line pointing at the new section;
  - Loan book fields: add `pending_operations` (always an array; LoanRegistry, Minter `reverse_repay` and
    SecurityRegistry operations of the loan);
  - Data Model: the route now also reads `access_manager_operations` (and the record sources for unresolved rows);
  - Security: pending AccessManager operations are served (public on-chain data from the schedule transaction);
    roles (`can_call`) and the record NFT holder are still not served.
- `docs/references/backend.md`: the `GET /v1/loan-book` bullets (near the `ltv_bps` line) get `pending_operations`;
  the "Stellar AccessManager indexing" paragraph replaces "The API read is #1922" with the two responses and a
  link to `loan-security-state.md#pending-operations`.
- `docs/references/access-manager-events.md`: replace "The read API is #1922" with an `## API read` section
  (which rows are served, supersede rule, derived `expired`), linking to the spec.
- `docs/product-specs/trustee-dashboard.md`: one clause in the Loans page `loans[]` list for `pending_operations`.
- `docs/exec-plans/tech-debt-tracker.md` TD-177 status: API part done (#1922); Trustee pages (#1923, #1924) remain.
- `docs/exec-plans/known-bugs.md`: the nonce-reset collision, tracked by #1927 (Step 7).
- `docs/user-stories/epic-1920/1922-pending-operations-api.md` (new, same format as `1921-access-manager-indexer.md`):
  stories for the security response, the loan-book rows, the `waiting` → `ready` → `expired` transitions, a
  `resolve_flag` whose record was registered after the schedule (read-time resolution), executed / canceled rows
  disappearing, and the empty cases (EVM chain, key unset).
- Move this plan to `docs/exec-plans/completed/` when the PR merges (manager).
