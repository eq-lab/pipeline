# Issue #1526: LoanBook readers: scope loan snapshot queries to the configured LoanRegistry address

Source: https://github.com/eq-lab/pipeline/issues/1526

Parent epic: #1520 (LoanBook readers realignment). Must land before epic #1521 (LoanBook
multi-chain), whose per-chain fan-out (#1528 foundation, #1530 `GET /v1/loan-book` across all
chains) reuses these repository methods. No Figma reference (backend-only) — no visual
verification step.

## Scope

### Problem

`LoanEventMapper` (`packages/worker/src/indexer/loan_mapper.rs:670-678`) writes every
LoanRegistry row to `contract_logs` with `contract_address` set to the registry that emitted it.
On EVM that is the EIP-55 checksum (`LoanAddress::as_db_string`, which calls `to_checksum(None)`).
On Stellar it is the `C…` Strkey as-is. Each registry numbers its loans from the start, so a
LoanRegistry redeploy on the same chain reuses loan ids.

The LoanBook readers filter on `chain_id` (and `loan_id`) only. After a redeploy, the old
registry's loan 1 and the new registry's loan 1 fall into the same `DISTINCT ON` bucket or mix
in timelines. Only two methods filter on `contract_address` today: the worker-side
`get_latest_loan_snapshot` and the API-unused `list_latest_loan_snapshots`.

### Today the API has no LoanRegistry address config

`packages/api/src/config.rs` (`ChainsConfig::from_env`) reads these settings per chain:

- voucher-signing contracts (`CHAIN_<id>_SIGNER_KEY` / `_DM_ADDRESS` / `_WQ_ADDRESS` on EVM, `CHAIN_<id>_API_STELLAR_*` on Stellar)
- custody and ramp address sets
- the withdrawal-queue wallet
- asset decimals

`AppState` (`packages/api/src/lib.rs:50`) holds none of the indexer's contract addresses. Only the
worker reads the registry address, from two keys:

- `CHAIN_<id>_EVM_INDEXER_LOAN_REGISTRY_ADDRESS` (required, `packages/worker/src/indexer/config.rs:374`)
- `CHAIN_<id>_STELLAR_INDEXER_LOAN_REGISTRY_ADDRESS` (optional, `config.rs:108-118`)

The project keeps API and worker env separate on purpose: they have separate Vault paths
`…/{api,worker}`.

### Approach

- **One required per-chain API key.** It is named under the #1456 scheme
  (`docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`):
  - `CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS` (EVM chains)
  - `CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS` (Stellar chains)
- **Required for every chain in `CHAINS`.** `ChainsConfig::from_env` fails with an error naming
  the missing key. The existing `validate_chain_kind_keys` check already rejects the wrong-type
  spelling.
- **Storage.** The address is stored in `ChainsConfig::loan_registry_addresses` and then in
  `AppState::loan_registry_addresses` (`HashMap<i64, String>`). It is kept in exactly the form
  the indexer writes (EIP-55 or Strkey), so an exact `=` compare is correct. This is the same
  compare `get_latest_loan_snapshot` already uses.
- **Lookup for #1521.** The address is looked up per chain id through one helper,
  `routes::common::loan_registry_address(state, chain_id) -> Result<&str, ApiError>`.
  - Startup guarantees every configured chain has an entry. So the error branch is reachable only
    for a `chain_id` that is not configured, and it returns `ApiError::BadRequest("unknown chain_id …")`.
  - #1528 makes that a validated 400 anyway.
  - #1530's fan-out calls the helper once per chain and passes the address into the same repo
    methods. Nothing here assumes a single chain.
- **LoanBook-only scoping, others untouched.** Repo methods called only by LoanBook routes gain
  the parameter in place. Methods shared with non-LoanBook groups keep their unscoped form, and
  LoanBook switches to a scoped version (see Implementation Steps 1).
- **SQL as `pub const`s.** Every scoped query's SQL moves into a `pub const`, so pure tests can
  check the `contract_address = $N` predicate. #1523 does the same and uses the names
  `LATEST_WATCHLIST_ENTRY_SQL` and `LOAN_ECONOMICS_EVENTS_SQL`. This plan reuses those exact names.

### Deliberate duplication (to be removed by #1538)

| Unscoped (kept for non-LoanBook callers) | Scoped (LoanBook) | Non-LoanBook callers |
|---|---|---|
| `list_latest_loan_snapshots_for_chain` | existing `list_latest_loan_snapshots` | `portfolio.rs:144`, `dashboard.rs:193`, `capital_allocation.rs:160`, `financial_position.rs:166` |
| `list_loan_lifecycle_events` | new `list_loan_lifecycle_events_for_registry` | `portfolio.rs:153`, `dashboard.rs:196`, `capital_allocation.rs:167`, `financial_position.rs:170` |

The duplicated row-decoding code is moved into a private helper so the two queries in each pair
differ only in their SQL. The other four methods have only LoanBook callers, so they are scoped
in place and not duplicated:

- `get_loan_snapshot_as_of`
- `latest_status_by_loans`
- `latest_watchlist_entry_by_chain`
- `list_loan_economics_events`

### In scope

1. `packages/shared/src/contract_logs_repo.rs`: scoped methods, the new `…_for_registry`
   variants, and the SQL consts.
2. `packages/api/src/config.rs`, `lib.rs`, `main.rs`: the required key, the `ChainsConfig`
   field and the `AppState` field.
3. `packages/api/src/routes/common.rs`: the `loan_registry_address` helper, used inside
   `trustee_indexed_loan_guard`.
4. LoanBook callers: `loan_book.rs` (:802, :1087, :1096, :1130), `loan_financials.rs` (:156,
   :173, :189), `waterfall.rs` (:288, :308), `ccr_history.rs` (:230),
   `collateral_valuation.rs` (:373), and `common.rs` (:64).
5. Tests, `.env.example`, the env-naming spec, `ARCHITECTURE.md`, and stale doc comments.

### Out of scope

- `portfolio.rs`, `dashboard.rs`, `capital_allocation.rs`, `financial_position.rs`. They are not
  edited at all, and they move to the scoped methods in #1538.
- The JSON-path fixes in the watchlist and economics queries belong to #1523 (sibling, running
  in parallel).
- `get_earliest_origination_date` and a scoped variant of it. Its only caller is `portfolio.rs:120`, which is not LoanBook; #1538 adds the scoped variant together with the portfolio migration.
- Outstanding and interest-adjustment math belongs to #1524. `minted_yield_for_loan` belongs to #1525.
- `chain_id` extractors, all-chains fan-out and `(chain_id, loan_id)` re-keying belong to epic #1521.
- Renaming the API's other legacy keys to the #1456 scheme.
- Worker changes. The indexer already writes `contract_address` correctly.

## Assumptions and Risks

- **Overlap with #1523 (in parallel, same file, same two queries).** #1523 moves the SQL of
  `latest_watchlist_entry_by_chain` and `list_loan_economics_events` into `LATEST_WATCHLIST_ENTRY_SQL` and
  `LOAN_ECONOMICS_EVENTS_SQL`, and rewrites their `params->'event'` paths. To keep the textual
  conflict small:
  - Use the same const names.
  - Add the new predicate as its own line right after `WHERE chain_id = $1`.
  - Give the address the **next unused** placeholder and `.bind` it **last**. Never renumber existing `$N`.
  - Do not touch the `SELECT` list, the `status` predicate, or #1523's doc-comment fixes.

  Whichever PR merges second rebases. When resolving, keep #1523's JSON paths and this issue's
  `contract_address` line. If #1523 merged first, start from its consts.
- **Overlap with #1524.** #1524 edits the outstanding computation just below the snapshot call in
  `ccr_history.rs:222-240` and `collateral_valuation.rs:361-381`. This issue changes only the
  call expression there.
- **Overlap with #1528.** #1528 adds the configured chain list to `AppState` and to
  `make_test_state`. This issue adds one field to both, so the conflict is trivial.
- **Rollout (load-bearing): the API refuses to start without the key.**
  - Before the deploy that carries this change, add
    `CHAIN_<id>_<TYPE>_API_LOAN_REGISTRY_ADDRESS` for **every** chain in `CHAINS` to Vault
    (`secrets/data/pipeline/{test,prod}/api`) and to the API blocks of
    `argocd/pipeline/test.yaml` / `prod.yaml`.
  - The value must equal the indexer's `…_INDEXER_LOAN_REGISTRY_ADDRESS`. A different valid
    address passes startup but empties the LoanBook. The resolved address is logged per chain at
    startup with `tracing::info!` so this can be checked by eye.
  - A Stellar chain whose LoanRegistry is not deployed still needs a value. That is the cost of
    "required everywhere", accepted by the human decision.
  - The PR description carries this checklist.
- **Address form.** EVM input can be any hex case. It is re-rendered as EIP-55, so a lowercase
  paste still matches. Stellar input is validated with `stellar_strkey::Contract` and stored as
  its canonical string.
- **Intended behaviour change after a real redeploy.** LoanBook views show only the configured
  registry's loans. Non-LoanBook endpoints keep today's unscoped behaviour until #1538
  lands.
- **Coverage limit.** The tests check the SQL text and the config parsing, not query execution:
  DB-backed tests are forbidden. A wrong placeholder-to-bind pairing would not be caught, so each
  test also checks the placeholder number (see Test Strategy).
- **Performance.** `contract_address` has no index. An extra equality filter only narrows the
  rows the existing indexes already return.

## Resolved decisions (human, 2026-10-15)

1. **Key name** — API-owned `CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS` /
   `CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS`. The API does not read the indexer key.
2. **Required for every chain in `CHAINS`.** API startup fails with a clear error naming the
   missing key. There is no "no loans" fallback and no warning-only mode.
3. **Callers outside LoanBook** (portfolio, dashboard, capital_allocation, financial_position)
   keep their existing unscoped methods, untouched. LoanBook routes (loan_book, loan_financials,
   waterfall, ccr_history, collateral_valuation, common/`trustee_indexed_loan_guard`) use
   address-scoped methods. `list_latest_loan_snapshots_for_chain` is kept. The duplication is
   listed above, and #1538 will migrate the other groups.
4. **`get_earliest_origination_date` is not scoped here.** Its only caller is `portfolio.rs:120`, which is not LoanBook, so a scoped variant would have no caller in this issue. Adding the scoped variant moves to #1538, together with the portfolio migration. This issue leaves the method untouched.
5. **Tests** — each scoped query's SQL moves into a `pub const`, and pure tests check the
   `contract_address = $N` predicate (the same approach as #1523). Config tests are added as well.

## Open Questions

_None_

## Implementation Steps

1. **Repo: `packages/shared/src/contract_logs_repo.rs`.** Put each const directly above its
   method. Insert the predicate as its own line right after `WHERE chain_id = $1`, and bind the
   address last.
   1. `LIST_LATEST_LOAN_SNAPSHOTS_SQL` — hoist the SQL of the existing `list_latest_loan_snapshots`
      (:290). It already has `AND contract_address = $2`; keep it. Update its doc comment (drop
      "Used by Portfolio"; say it backs the LoanBook readers).
   2. Move the row-to-`LoanSnapshotRow` decode loop that `list_latest_loan_snapshots` and
      `list_latest_loan_snapshots_for_chain` duplicate (:323-344 and :382-403) into a private
      `fn decode_snapshot_rows(chain_id, rows) -> anyhow::Result<Vec<LoanSnapshotRow>>`.
      `list_latest_loan_snapshots_for_chain` keeps its signature and SQL. Only its decode loop is
      replaced by the call.
   3. New `list_loan_lifecycle_events_for_registry(executor, chain_id, contract_address: &str,
      to_unix)` with `LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL`. This is the
      `list_loan_lifecycle_events` SQL plus `AND contract_address = $4`. The old
      `list_loan_lifecycle_events` (:254) is unchanged.
   4. In-place scoping for the methods that only LoanBook calls. `contract_address: &str` goes
      directly after `chain_id`, matching `list_latest_loan_snapshots` and `get_latest_loan_snapshot`:
      - `get_loan_snapshot_as_of` (:424) with `LOAN_SNAPSHOT_AS_OF_SQL`, plus `AND contract_address = $5`.
      - `latest_status_by_loans` (:484) with `LATEST_STATUS_BY_LOANS_SQL`, plus `AND contract_address = $4`.
      - `latest_watchlist_entry_by_chain` (:519) with `LATEST_WATCHLIST_ENTRY_SQL` (#1523's name),
        plus `AND contract_address = $3`. Leave the `status` predicate to #1523.
      - `list_loan_economics_events` (:776) with `LOAN_ECONOMICS_EVENTS_SQL` (#1523's name), plus
        `AND contract_address = $4`. Leave the `SELECT` list to #1523.
   5. Update the `LOAN_LIFECYCLE_EVENT_NAMES` header comment (:9-14) to list the snapshot
      queries as they now stand. Update any doc comment that points LoanBook readers at
      `list_latest_loan_snapshots_for_chain` (`get_loan_snapshot_as_of`, `latest_status_by_loans`)
      to point at `list_latest_loan_snapshots`.
2. **Config: `packages/api/src/config.rs`.**
   1. Add `pub loan_registry_addresses: HashMap<i64, String>` to `ChainsConfig`, and document both
      keys as **required** in the struct's env-var block.
   2. New `fn load_loan_registry_address(chain_id: i64, kind: ChainKind, out: &mut HashMap<i64,
      String>) -> Result<()>`:
      - EVM: key `CHAIN_{id}_EVM_API_LOAN_REGISTRY_ADDRESS`.
        - Missing or blank → `bail!("{key} is required for chain {chain_id} (LoanRegistry address the LoanBook readers are scoped to)")`.
        - Parse as `alloy::primitives::Address`, with `with_context` naming the key.
        - Insert `addr.to_checksum(None)`.
      - Stellar: key `CHAIN_{id}_STELLAR_API_LOAN_REGISTRY_ADDRESS`.
        - Missing or blank → the same kind of `bail!`.
        - Parse with `stellar_strkey::Contract::from_string`, with `with_context` naming the key.
        - Insert `contract.to_string()`.
      - On success, `tracing::info!(chain_id, loan_registry = %addr, "API LoanRegistry scope loaded")`.
   3. Call it from both arms of `match chain_kind` in `from_env`, right after
      `validate_chain_kind_keys`, and return the map in `Self`.
3. **State: `packages/api/src/lib.rs` and `main.rs`.** Add
   `pub loan_registry_addresses: HashMap<i64, String>` to `AppState`, and fill it from
   `chains_config.loan_registry_addresses` in `main.rs`.
4. **Resolver: `packages/api/src/routes/common.rs`.**
   - Add `pub fn loan_registry_address(state: &AppState, chain_id: i64) -> Result<&str, ApiError>`.
     It is a map lookup. A missing entry returns
     `ApiError::BadRequest(format!("unknown chain_id: {chain_id}"))`.
   - In `trustee_indexed_loan_guard`, resolve the address with `?` and pass it to `latest_status_by_loans`.
5. **LoanBook callers.**
   - `loan_book.rs::handle_loan_book` (:1078): resolve with `?`. Call `list_latest_loan_snapshots`,
     `list_loan_lifecycle_events_for_registry` and `latest_watchlist_entry_by_chain` with it.
   - `loan_book.rs::list_submissions` (:798-806): for each chain in `ids_by_chain`, resolve the
     address.
     - A chain not configured is skipped with `continue`, because submission rows can carry a
       historical `chain_id`. The view then keeps its stored review status, as un-indexed loans do today.
     - Otherwise pass the address to `latest_status_by_loans`.
   - `loan_financials.rs::get_loan_financials` (:139): resolve with `?`, then call
     `list_latest_loan_snapshots`, `list_loan_economics_events` and `get_loan_snapshot_as_of` with it.
   - `waterfall.rs::get_waterfall` (:255): resolve with `?` for `get_loan_snapshot_as_of` and
     `list_loan_economics_events`.
   - `ccr_history.rs::loan_snapshot_senior_usd` (:222) and
     `collateral_valuation.rs::loan_snapshot_senior_usd` (:361): resolve with `?` and call
     `list_latest_loan_snapshots`. Change only the call expression, because #1524 owns the lines below.
6. **Test fixture.** Add `loan_registry_addresses: HashMap::new()` to `make_test_state` in
   `packages/api/tests/voucher_signing.rs:54`. It is the only other `AppState` literal.
7. **Existing config tests.** Every existing `packages/api/tests/chains_config.rs` case that expects
   `from_env` to **succeed** now has to set the chain's registry key. Add it to each such case's
   `set` list. Cases that expect an error for another reason keep that error, but check the
   message still matches and the new required-key error does not hide it. Where the order of
   checks matters, set the key in the `set` list. Apply the same to any other test binary that
   calls `ChainsConfig::from_env` (`grep -rn "ChainsConfig::from_env" packages/api/tests`).
8. **Docs** — see Docs to Update.
9. **Verify.**
   - Run `cargo build --all`, `cargo clippy --all -- -D warnings`, and
     `cargo test -p shared -p pipeline-api` (no DB, no `DATABASE_URL` read).
   - Run `npx tsx scripts/lint-docs.ts`.
   - `git diff --stat` must show no change to `portfolio.rs`, `dashboard.rs`,
     `capital_allocation.rs` or `financial_position.rs`.
   - Start the local API without the key: it must fail, naming the key.

Comment rule (AGENTS.md): add no new field or function doc comments beyond what already exists.
Only fix the ones that become wrong.

## Test Strategy

Pure unit tests only: no `sqlx` connection, no `DATABASE_URL` / `POSTGRES_URL` read, and no inline
`#[cfg(test)]`.

1. **`packages/shared/tests/contract_logs_repo.rs`** (existing binary). One test per scoped
   const:
   - `LIST_LATEST_LOAN_SNAPSHOTS_SQL`
   - `LOAN_LIFECYCLE_EVENTS_FOR_REGISTRY_SQL`
   - `LOAN_SNAPSHOT_AS_OF_SQL`
   - `LATEST_STATUS_BY_LOANS_SQL`
   - `LATEST_WATCHLIST_ENTRY_SQL`
   - `LOAN_ECONOMICS_EVENTS_SQL`

   Each test asserts:
   - the const contains `contract_address = $N` with the **exact** expected `N` ($2 / $4 / $5 /
     $4 / $3 / $4, matching the bind order in the method);
   - it still contains `chain_id = $1`.

   Compare after collapsing whitespace, so a reformat does not break the test. A helper
   `fn normalized(sql: &str) -> String` in the test file collapses runs of whitespace to one space.
   These tests sit beside #1523's tests on `LATEST_WATCHLIST_ENTRY_SQL` / `LOAN_ECONOMICS_EVENTS_SQL`
   and do not repeat its JSON-path checks.
2. **`packages/api/tests/chains_config.rs`** (existing binary, existing `with_env` + `ENV_LOCK`).
   Every test adds the new keys to its teardown list.
   - An EVM chain with the key set to an all-lowercase address: `loan_registry_addresses[&id]`
     equals `Address::to_checksum(None)` of the same value.
   - An EVM chain without the key: `from_env` errors, and the message contains
     `CHAIN_<id>_EVM_API_LOAN_REGISTRY_ADDRESS`.
   - An EVM chain with a blank key: the same error.
   - An EVM chain with invalid hex: an error naming the key.
   - A Stellar chain (`CHAIN_<id>_TYPE=stellar`, plus the minimum vars the existing Stellar cases
     set) with a valid `C…` Strkey: stored in canonical form.
   - A Stellar chain without the key: the error names `CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS`.
   - A Stellar chain with a `G…` account or a malformed Strkey: an error naming the key.
   - An EVM chain with `CHAIN_<id>_STELLAR_API_LOAN_REGISTRY_ADDRESS` set: `from_env` errors
     through `validate_chain_kind_keys`.
   - Two chains in `CHAINS`, one EVM and one Stellar, each with its own key: two distinct entries
     keyed by chain id.
3. **`packages/api/tests/loan_registry_scope.rs`** (new binary). Build an `AppState` as
   `voucher_signing.rs::make_test_state` does (`connect_lazy`, never queried), with two chains in
   `loan_registry_addresses`. Assert that:
   - `loan_registry_address` returns each chain's own address;
   - an unconfigured chain returns `ApiError::BadRequest`.

   This is the seam #1521's fan-out calls per chain.
4. **Regression.** The existing pure route tests must pass unchanged: `loan_book.rs`,
   `loan_financials.rs`, `waterfall.rs`, `ccr_history.rs`, `collateral_valuation.rs`,
   `portfolio_compute.rs`, `dashboard.rs`, `capital_allocation.rs`, `financial_position.rs`.
   They exercise the compute functions, not the repo calls.

Manual check, on the developer's own local stack only and never in tests:

- With the key set to the locally indexed registry, `GET /v1/loan-book` returns the same loans
  as before.
- With a different valid address, the book is empty while `/v1/dashboard/summary` is unchanged.
- With the key unset, the API exits at startup with an error naming the key.

## Docs to Update

- **`.env.example`** — add `# CHAIN_1_EVM_API_LOAN_REGISTRY_ADDRESS=0xabc...  # required` to the
  per-chain API block (near :36-42), and
  `# CHAIN_99000001_STELLAR_API_LOAN_REGISTRY_ADDRESS=C...  # required` to the Stellar API block
  (near :163-181). Each gets a note: "must equal the indexer's `…_INDEXER_LOAN_REGISTRY_ADDRESS`;
  LoanBook endpoints read only this registry's loans".
- **`docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`** — add the two
  keys to the API table as new keys (old column "—"), marked "implemented in #1526, required".
- **`ARCHITECTURE.md:122`** — add one sentence: the API's LoanBook readers are scoped to each
  chain's required `CHAIN_<id>_<TYPE>_API_LOAN_REGISTRY_ADDRESS`, and the other API groups are
  still chain-scoped only.
- **Code comments** — the `ChainsConfig` env-var doc block in `packages/api/src/config.rs`, and
  the stale doc comments in `contract_logs_repo.rs` (Implementation Steps 1.5).
- **No product-spec change.** Behaviour on a single-registry chain is unchanged.
- **PR description** — include:
  - the rollout checklist: add the key for every chain in `CHAINS` to Vault `…/{test,prod}/api`
    and to the argocd API blocks before deploying, with the value equal to the indexer's registry
    address;
  - a link to #1538, which migrates portfolio, dashboard,
    capital_allocation and financial_position to the scoped methods, so the duplication can be
    deleted.

## Addendum (human, 2026-10-15, integration review)

`GET /v1/loan-book` no longer returns 400 for a `chain_id` outside the API's `CHAINS`. The LP frontend sends the connected wallet's chain (for example EVM 560048 or 1), which may not be configured in the API, and a 400 broke the page. For this endpoint only, an unconfigured chain returns 200 with an empty loan book (empty `loans`, zeroed `summary`), exactly what main returned for a chain with no rows. Per-loan routes and the trustee-guarded writes keep the 400 via `loan_registry_address`. Covered by `loan_book_for_unconfigured_chain_is_empty_not_error` in `packages/api/tests/loan_registry_scope.rs`.
