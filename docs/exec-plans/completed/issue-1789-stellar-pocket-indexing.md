# Issue #1789: Index the Stellar Pocket; inline pocket state in the loan book; recoveries in LP PnL and cumulative yield

Source: https://github.com/eq-lab/pipeline/issues/1789

Parent epic: #1776, merge-order step 4. This lands after #1788 (merged), #1793 (PR #1803) and #1794 (PR #1806).
Unblocks frontend #1758 (PR #1827, which reads pocket state on-chain and is not changed here).

## Scope

### Source of truth (checked 2026-11-03)

- **Contracts:** `pipeline-stellar-contracts` HEAD `d0d5757`. `contracts/pocket` is unchanged since `7646cef`.
- **Testnet deployment (#36):** pocket `CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5`,
  loan registry `CDWN5B3F…`, minter `CAPL5WN3…`.
- **Testnet state:**
  - loan-registry `next_loan_id()` = `0`;
  - `pocket(0..=5)` fails with `Error(Contract, #2)` (`NoPocket`);
  - `getEvents` on the pocket over the whole retention window (ledgers 5413862..5534821) returns
    nothing.

  So the pocket has emitted no business event yet. Setting the key on pipeline-test now misses no
  history.
- **Event encoding:** every pocket event is `#[contractevent]` with the default map data format.
  - `topics[0]` is the snake_case symbol; `#[topic]` fields follow in declaration order.
  - `value` is an `ScMap` of the remaining fields.
  - This is the same layout every existing Stellar parser decodes (`extract_i128_from_map`).

| On-chain topic | Topics | Value map | Stored `event_name` | Stored `params` (strings unless noted) |
|---|---|---|---|---|
| `pocket_opened` | `loan_id: u32` | `amount, snapshot_ledger: u32, supply_at_snapshot` | `PocketOpened` | `loan_id, amount, snapshot_ledger, supply_at_snapshot` |
| `released` | `loan_id` | `principal, released, interest` | `PocketReleased` | `loan_id, principal, released, interest` |
| `unreleased` | `loan_id` | `principal, interest` | `PocketUnreleased` | `loan_id, principal, interest` |
| `burned` | `loan_id` | `amount, burned` | `PocketBurned` | `loan_id, amount, burned` |
| `claimed` | `loan_id, holder: Address` | `paid` | `PocketClaimed` | `loan_id, holder` (exact Strkey, `G…` or `C…`), `paid`, `paid_zero` (JSON bool) |
| `reporters_set`, OZ `paused` / `unpaused` / ownership / upgrade | | | not stored | |

- **Name collisions:** none of the five names exists today.
  - `Released` is already the CollateralRegistry name (`stellar/collateral_registry_parsers.rs:22`,
    `audit_log.rs:97`). That is why every name carries the `Pocket` prefix.
  - The generic topics `released`, `burned` and `claimed` are therefore decoded only when the
    event's `contract_id` equals the pocket id.

### In scope

1. **Worker, config.**
   - New optional `CHAIN_<id>_STELLAR_INDEXER_POCKET_ADDRESS`, parsed into
     `StellarIndexerSettings.pocket_id: Option<String>`.
   - Validation is the same as the collateral-registry key: `validate_contract_id` plus a Strkey
     `Contract` parse.
   - The key joins the distinct-role check (`indexer/config.rs:237-269`) as `POCKET_ADDRESS`.
2. **Worker, parsers.** New `indexer/stellar/pocket_parsers.rs`:
   - five parsers and `dispatch_pocket(raw)`;
   - a warn on a recognised-but-undecodable pocket topic (same as `dispatch_collateral_registry`);
   - `is_pocket_event(name)`.
3. **Worker, poller.**
   - Add `pocket_id` to the `getEvents` contract filter.
   - Route by contract id **before** `dispatch_parser`: an `else if` right after the
     collateral-registry branch (`stellar/poller.rs:170-184`).
   - Pocket logs go through the existing `StellarLogMapper`. There is no RPC in the mapper and no
     change to `index_once`.
4. **Worker, view seed.** New `indexer/stellar/pocket_seed.rs`, a separate `tokio::spawn`ed loop
   started from `run_stellar_indexer_job` when both the pocket id and the loan-registry id are set.
   - **Candidates:** loans with a `LoanDefaulted` row on the chain's registry that have no
     `PocketOpened` row on the pocket and no seed row.
   - **For each candidate:**
     - simulate `pocket(loan_id)` and decode `PocketData`;
     - store it with `as_of_ledger = simulateTransaction.latestLedger`;
     - insert with `ON CONFLICT DO NOTHING`.
   - **Errors:**
     - `NoPocket` (`Error(Contract, #2)`) is logged at debug level;
     - any other error is warned once per loan per process;
     - errors never propagate.
   - It runs outside `index_once` and outside its transaction, so a failing simulate cannot stall
     Stellar indexing (`indexer/mod.rs:240-276`).
5. **Shared, read model.**
   - **Migration:** `pocket_seeds` (additive).
   - **New `shared::pocket`:** the pure fold.
   - **New `shared::pocket_repo`:**
     - list pocket events per chain and pocket;
     - list seeds;
     - list a holder's claims;
     - list seed candidates;
     - insert a seed.
6. **Fold** (pure, `shared::pocket::fold_pocket`), per `(chain_id, pocket contract_address, loan_id)`.
   Events are ordered by `(block_number, log_index)`.
   - **With an indexed `PocketOpened`:**
     - fold from zero, ignore any seed, `complete = true`;
     - `opened = PocketOpened.amount`;
     - `snapshot_ledger` and `supply_at_snapshot` come from `PocketOpened`.
   - **Without one, but with a seed:**
     - start from the seed's totals and apply only events with `block_number > as_of_ledger`;
     - `complete = false`, `opened = null`;
     - `snapshot_ledger` and `supply_at_snapshot` come from the seed.
   - **Neither:** `None`. No pocket is served until the seed loop fills it.
   - **Formulas** (from the issue, checked against `pocket/src/lib.rs`):
     - `held = amount − Σreleased.released + Σunreleased.principal − Σburned.burned`
     - `released_total = Σ(released + interest) − Σunreleased(principal + interest)`
     - `burned_total = Σburned.burned` (not `.amount`)
     - `claimed_total = Σpaid` (zero claims add 0)
7. **API, config.**
   - New optional `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS`, read into
     `ChainsConfig.pocket_addresses` / `AppState.pocket_addresses: HashMap<i64, String>`.
   - This is the API-side twin of the indexer key. API and worker are decoupled, as with
     `…_API_LOAN_REGISTRY_ADDRESS`.
   - Stellar chains only. On an EVM chain the existing `validate_chain_kind_keys` already rejects
     a `STELLAR_` key.
   - Unset means no pocket field data, no claims list and no yield or PnL change.
8. **API, `GET /v1/loan-book`.**
   - Each `LoanBookEntry` gains `pocket: Option<LoanPocket>`.
   - **`null` when:**
     - the chain has no API pocket key;
     - the loan has no pocket fold (not carved out, or not yet seeded).
   - **`LoanPocket` fields:**
     - `snapshot_ledger` (u32);
     - `supply_at_snapshot`: raw sPLUSD share count, decimal string, unscaled;
     - `opened`: 6-dp string or `null` when `complete = false`;
     - `held`, `released_total`, `burned_total`, `claimed_total`: 6-dp USDC strings, the loan-book
       convention, via `normalize_usdc_amount(kind, …)` + `base6_to_decimal_string`;
     - `complete` (bool).
   - Filled in `handle_loan_book` after `compute_loan_book`. The `compute_loan_book` signature is
     unchanged, so the dashboard caller does not change.
9. **API, LP side.**
   - **`GET /v1/requests`** gains a sibling list:
     - `pocket_claims: Vec<PocketClaimItem>`, always present and empty when none;
     - item fields: `{chain_id, loan_id, amount (raw PLUSD, like RequestItem.amount), tx_hash, created_at (ISO)}`;
     - built from `PocketClaimed` rows where `params->>'holder'` equals the **query wallet
       verbatim** (not the lowercased copy the handler uses for `get_all_requests`);
     - only Stellar chains in scope that have an API pocket key;
     - `paid_zero` rows are excluded: they move nothing. They stay in `contract_logs` and in the
       audit log.
   - **No new `type` value** in `requests[]`. The frontend switches on literal `type` / `status`.
   - **Per-holder `claimable`** stays an on-chain read in the frontend (#1758).
10. **API, `GET /v1/pnl`** gains `pocket_recovered: Option<String>`.
    - Value: Σ `paid` of the wallet's `PocketClaimed` rows on the chain, raw PLUSD, the same unit
      as `total_realized_pnl`.
    - `null` on EVM or without an API pocket key.
    - When non-null:
      - `total_realized_pnl = Σ positions.realized_pnl + pocket_recovered`;
      - `total_pnl = total_unrealized_pnl + total_realized_pnl`.
    - `positions[]` is unchanged. `avg_apy` is unchanged.
    - Confirmed by the human, 2026-11-03 (Resolved questions 2).
11. **API, dashboard yield** (Stellar only).
    - Keep `chain_yield_deltas(kind, legacy, repayments)` and its EVM behaviour **byte-for-byte**.
    - Add `chain_yield_deltas_counting_recoveries(kind, legacy, repayments)`, which also counts
      `carved_out` rows. Both share a private inner fn with an `include_carved` flag.
    - `read_chain_yield` (`dashboard.rs:394-414`) calls the new fn only when
      `kind == Stellar && state.pocket_addresses.contains_key(&chain_id)`. EVM chains, and Stellar
      without the key, take the existing path.
    - Confirmed by the human, 2026-11-03 (Resolved questions 1):
      - recovered **interest** only counts as yield (`CashRepaid.interest_minted` of carved-out
        repayments, == `Released.interest`);
      - it is booked **at release**, i.e. at the `CashRepaid` timestamp;
      - it is netted at `CashRepaymentReversed` (== `Unreleased`);
      - recovered principal is not yield.
    - `cumulative_yield_total` keeps `base6_to_decimal_string`, so the empty state is still exactly
      `"0.000000"`.
12. **API, audit log.** Add the five names to `AUDIT_EVENT_NAMES` (`audit_log.rs:59-103`) and to
    the `format_action` match (`audit_log.rs:334`).
    - **`PocketOpened`:**
      - action: "Pocket opened — {amount}";
      - details: `amount`, `snapshot_ledger`, `supply_at_snapshot` (unscaled, like
        `CashRepaid.fee_shares`).
    - **`PocketReleased`:**
      - action: "Pocket recovery released — {released} principal, {interest} interest";
      - details: `principal`, `released`, `interest`.
    - **`PocketUnreleased`:**
      - action: "Pocket release reversed — {principal} principal, {interest} interest burned";
      - details: `principal`, `interest`.
    - **`PocketBurned`:**
      - action: "Pocket write-down — {burned} burned of {amount}";
      - details: `amount`, `burned`.
    - **`PocketClaimed`:**
      - action: "Pocket claim — {paid}", or "Pocket claim — nothing claimable" when `paid_zero`;
      - details: `holder`, `paid`, `paid_zero`.
    - All amounts go through `param_amount(…, chain_kind)`.
    - `scope` is `Loan #<id>` (the rows carry `loan_id`).
    - `reference` is empty (no snapshot), as for the Minter rows.
13. **Docs, env, user stories:** see Docs to Update.

### Out of scope

- **Contract or deployment changes.** Contracts are frozen.
- **AccessManager indexing, and SecurityRegistry NFT mint/burn** (human decision 2026-11-03).
- **EVM pocket indexing** and any EVM behaviour change.
- **Frontend work** (#1758 reads the pocket on-chain).
- **Per-holder `claimable`** in any API.
- **A per-holder view seed** (`claimed(holder, loan_id)`) for claims emitted before the key was set.
- **TVL ledger.** Claims are PLUSD transfers, not supply changes. Burns are already covered by
  `LoanWrittenDown.burned` and `CashRepaymentReversed`, so `PLUSD_LEDGER_SQL` is unchanged.
- **`loan_financials` `minted_yield`.** It already counts carved-out interest.
- **`argocd` manifests.** Setting both pocket keys on pipeline-test is a post-merge ops step (see
  Rollout).

## Assumptions and Risks

### Dependencies and coordination

- **#1793 / PR #1803:** implemented on branch `chore/1793-delete-stellar-yield-mint` (status as of
  2026-11-03). It renames `yield_minter_id` → `minter_id` in `indexer/config.rs`,
  `stellar/parsers.rs` and `stellar/poller.rs`. This plan adds `pocket_id` next to it.
  - Write all new code against the name `minter_id`.
  - Base the branch on `main` once #1803 has merged.
  - If #1803 has not merged yet, do not reproduce its rename. Add the pocket lines next to the
    current field and rebase before the PR. The hunks are adjacent, not overlapping.
- **#1794 / PR #1806 (open):** owns the env and key-map lines for both pocket keys (Resolved
  questions 4). It adds `CHAIN_<id>_STELLAR_INDEXER_POCKET_ADDRESS` and
  `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS` to `.env.example` and to the `docs/references/backend.md`
  key map, in a "not read by this build (#1789)" group.
  - This PR only moves both lines from that group into the live blocks and replaces their comments.
    It does not invent the key names.
  - If #1806 still lacks the API key line when this is implemented, ask #1794's owner to add it
    there. Only add it here as a fallback, and say so in the PR description.
  - If #1806 is not merged yet, rebase onto it before opening the PR.
- **#1790 / #1791 (planning in parallel):** both add API address keys and `AppState` fields. They
  touch the same `AppState { … }` literals in about 10 test files and neighbouring `.env.example`
  lines. These are mechanical conflicts, owned by whichever PR lands later.

### Rollout safety (pipeline-test)

- **Migration** `20261103000001_pocket_seeds.sql` only creates a new table. No existing table is
  touched, and nothing on `contract_logs` or `log_collector_state` changes. The previous image
  ignores the table, so rollback boots.
- **Both new keys are optional.** Unset means:
  - no pocket polling and no seed loop;
  - `pocket: null` everywhere;
  - `pocket_claims: []` and `pocket_recovered: null`;
  - the yield unchanged.

  So merge alone changes nothing observable. The dashboard yield change is gated on the API key
  too, so it also ships dark.
- **EVM is unaffected:**
  - `chain_yield_deltas` keeps its body and signature;
  - EVM chains never reach the new code paths (no key, kind check);
  - regression tests pin it.
- **The seed loop is isolated.**
  - It runs in its own task with its own pool connections.
  - Simulate errors are swallowed and logged.
  - `index_once` never awaits it.
- **API changes are additive:** a new nullable field on `LoanBookEntry`, a new sibling list on
  `/v1/requests`, and a new nullable field on `/v1/pnl`.
  - When the key is set, `total_realized_pnl` / `total_pnl` include recoveries **by design**
    (decision 2026-10-29). They change the LP home numbers (`frontend/src/routes/index.tsx:164,191-192`).
    No frontend code change is needed, because the formatting is unchanged.
- **Cursor:**
  - The Stellar cursor is per chain (`shared/src/db.rs:15-46`), and `START_BLOCK` applies only
    while the cursor is 0 (`poller.rs:295-307`).
  - Setting the key indexes from the current cursor. On testnet nothing is lost (no pocket events
    exist).
  - For a later key set: rewind the cursor within retention, since replays dedupe on
    `(chain_id, contract_address, block_number, log_index)`. Past retention, rely on the view seed.
  - Both are documented in #1794's ops checklist section of `docs/references/backend.md`.

### Correctness risks

- **Seed timing.** `simulateTransaction` reads state at `latestLedger`.
  - Events at or before that ledger are in the seed; events after it are folded on top.
  - This holds even if the indexer lags or runs ahead of the simulate node, because the filter is
    on the ledger number, not on cursor time.
  - A ledger closing during the simulate call is the only residual race. It is best-effort and
    stated in docs.
- **Claims emitted before the key was set** are absent from `pocket_claims` and `pocket_recovered`,
  although `claimed_total` is right via the seed. On testnet there are none. This is documented as
  a limitation.
- **Repeat default:** `LoanDefaulted.moved = 0` and no new `PocketOpened`. The candidate query keys
  on the loan, not on the event, so a loan is seeded at most once.
- **Old-deployment defaults** with no pocket would stay candidates forever. They are bounded,
  because candidates come only from the configured registry. Each is warned once per process, then
  logged at debug level.
- **Wallet matching.** "Join holders to LPs on the exact `G…` string" is read as: match
  `params.holder` byte-for-byte against the `wallet` query parameter of `/v1/requests` and
  `/v1/pnl`. `/v1/pnl` already keeps Stellar wallets verbatim (`vouchers.rs:118`). There is no
  join to the `lps` table.

### Acceptance against a live pocket

- The issue asks that the folded totals equal `pocket(loan_id)` for a defaulted testnet loan.
  Testnet has no loans. Per Resolved questions 3, the live comparison runs in the epic QA pass
  #1778 once a testnet loan has been drawn and defaulted.
- Until then, equivalence is proven by unit tests. They replay the frozen contract's own test
  scenarios (`pocket/src/test.rs`) as event sequences and assert the contract's asserted
  `PocketData`.
- The user-stories doc carries the live check, marked for QA #1778.

### Lint

`npx tsx scripts/lint-docs.ts` could not run during planning: the worktree has no `node_modules`.
The coder runs it after `yarn install`.

### Resolved questions (human, 2026-11-03)

1. **Cumulative yield: accepted as proposed.**
   - Only recovered **interest** counts. It is booked **at release**: the carved-out
     `CashRepaid.interest_minted` at its timestamp, == `Released.interest`.
   - It is netted at `CashRepaymentReversed` / `Unreleased`.
   - Stellar only, and only when `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS` is set.
   - Recovered principal is not yield.
2. **`/v1/pnl`: accepted as proposed.**
   - `pocket_recovered` = Σ the wallet's `PocketClaimed.paid` (principal plus interest), realised at
     claim time.
   - It is added to `total_realized_pnl` and `total_pnl`.
   - Unclaimed `claimable` is excluded: the loss is already in the sPLUSD share price at carve-out.
3. **Live acceptance: accepted.**
   - This PR proves fold equivalence with unit tests that replay the frozen contract's scenarios.
   - The live comparison of the folds with `pocket(loan_id)` moves to the epic QA pass #1778, once a
     testnet loan has been drawn and defaulted.
4. **API key: accepted.**
   - New optional `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS`, the same pattern as #1790's API minter
     key.
   - #1794 adds it to `.env.example` and `docs/references/backend.md` (see Dependencies).

## Open Questions

_None_

## Implementation Steps

1. **Migration.** Add `packages/shared/migrations/20261103000001_pocket_seeds.sql`.
   - Columns:
     - `chain_id BIGINT NOT NULL`, `pocket_address TEXT NOT NULL`, `loan_id NUMERIC NOT NULL`;
     - `as_of_ledger BIGINT NOT NULL`, `snapshot_ledger BIGINT NOT NULL`;
     - `supply_at_snapshot`, `held`, `released_total`, `burned_total`, `claimed_total`: all
       `NUMERIC NOT NULL`;
     - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
   - `PRIMARY KEY (chain_id, pocket_address, loan_id)`.
   - Use `CREATE TABLE IF NOT EXISTS`. No other DDL.
   - If a sibling PR already took the same version prefix, bump the suffix. Never edit a merged
     migration.
2. **Shared fold.** Add `packages/shared/src/pocket.rs` with a one-line spec pointer to
   `docs/references/backend.md#stellar-pocket-indexing`, and register it in
   `packages/shared/src/lib.rs`.
   - **Types:**
     - `PocketEventRow { loan_id: BigDecimal, event_name: String, block_number: i64, log_index: i64, block_timestamp: i64, params: Value }`;
     - `PocketSeedRow { loan_id, as_of_ledger: i64, snapshot_ledger: i64, supply_at_snapshot, held, released_total, burned_total, claimed_total }`
       (all `BigDecimal`);
     - `PocketFold { snapshot_ledger: i64, supply_at_snapshot, opened: Option<BigDecimal>, held, released_total, burned_total, claimed_total, complete: bool }`.
   - **Functions:**
     - `pub fn fold_pocket(events: &[PocketEventRow], seed: Option<&PocketSeedRow>) -> Option<PocketFold>`,
       implementing the rules in Scope §6;
     - `pub fn fold_pockets(events, seeds) -> HashMap<BigDecimal, PocketFold>`, which groups by
       `loan_id`.
   - **Parsing:** read amounts from `params` as decimal strings. A row with a missing or
     unparsable amount is skipped (logged at warn), never a panic.
3. **Shared repo.** Add `packages/shared/src/pocket_repo.rs` (`PocketRepo { pool }`), registered in
   `lib.rs`, with these methods:
   - `list_events(chain_id, pocket) -> Vec<PocketEventRow>`:
     - `contract_logs WHERE chain_id=$1 AND contract_address=$2 AND event_name IN ('PocketOpened','PocketReleased','PocketUnreleased','PocketBurned','PocketClaimed')`;
     - `ORDER BY block_number, log_index`.
   - `list_seeds(chain_id, pocket) -> Vec<PocketSeedRow>`.
   - `list_holder_claims(chain_id, pocket, holder) -> Vec<PocketClaimRow { loan_id, paid, tx_hash, block_timestamp }>`:
     - `event_name='PocketClaimed' AND params->>'holder' = $3` (no `LOWER`);
     - `AND COALESCE((params->>'paid_zero')::boolean, false) = false`;
     - newest first.
   - `list_seed_candidates(chain_id, registry, pocket) -> Vec<u32>`: distinct
     `(params->>'loan_id')` of `LoanDefaulted` on `registry`, minus loans with a `PocketOpened` on
     `pocket`, minus loans in `pocket_seeds`.
   - `insert_seed(chain_id, pocket, &PocketSeedRow) -> bool`: `ON CONFLICT DO NOTHING`.

   Plain `sqlx::query` with binds, matching `contract_logs_repo.rs` style.
4. **Worker config.** In `packages/worker/src/indexer/config.rs`:
   - add `pub pocket_id: Option<String>` to `StellarIndexerSettings`;
   - parse `{ip}POCKET_ADDRESS`, copying the `cr_key` block (`:131-139`);
   - push `("POCKET_ADDRESS", id)` into `roles` (`:249-262`);
   - set it in the `Ok(Self { … })` literal.
5. **Worker parsers.** Add `packages/worker/src/indexer/stellar/pocket_parsers.rs` (spec pointer
   header) and register it in `stellar/mod.rs`.
   - **Shape:** the `matches` / `build` helper style of `minter_parsers.rs`.
   - **Parsers** (`pub fn parse_pocket_*`), one per topic in the Scope table:
     - `loan_id` from `extract_u32(topics[1])`;
     - `holder` from `parsers::extract_address(topics[2])` (already `pub`, `parsers.rs:455`);
     - amounts from `extract_i128_from_map(value, key).to_string()`;
     - `snapshot_ledger` from `extract_u32_from_map`;
     - `paid_zero = paid == 0`.
   - **`pub const POCKET_EVENT_TOPICS`.**
   - **`pub fn dispatch_pocket(raw) -> Option<StellarLog>`:** a `match raw.event_name`. It warns
     when a listed topic fails to decode. `reporters_set` and unknown topics return `None` silently.
   - **`pub fn is_pocket_event(name)`.**
6. **Worker poller.** In `packages/worker/src/indexer/stellar/poller.rs`:
   - add a `pocket_id: Option<String>` field and constructor argument;
   - push it into `contract_ids` in `poll`;
   - add the branch
     `else if self.pocket_id.as_deref() == Some(raw.contract_id.as_str()) { dispatch_pocket(&raw) }`
     directly after the collateral-registry branch (`:170-173`), so it runs before `dispatch_parser`;
   - pass `settings.pocket_id.clone()` in `run_stellar_indexer_job`;
   - log "Stellar Pocket indexer enabled" when set.

   No change to `dispatch_parser`, `is_loan_registry_event` or `StellarLogMapper`.
7. **Worker seed loop.** Add `packages/worker/src/indexer/stellar/pocket_seed.rs`:
   - **`pub fn decode_pocket_data(&ScVal) -> anyhow::Result<PocketDataView>`:** reads the map
     fields `snapshot_ledger` (u32) and `supply_at_snapshot`, `held`, `released_total`,
     `burned_total`, `claimed_total` (i128). Reuse the map helpers from `loan_registry_reader.rs`.
   - **`pub fn is_no_pocket_error(msg: &str) -> bool`:** true for `Error(Contract, #2)`.
   - **`async fn read_pocket(rpc, pocket_id, loan_id) -> Result<(PocketDataView, u64)>`:** the
     simulate envelope of `StellarLoanRegistryReader::call_view` (`loan_registry_reader.rs:66-104`),
     but it keeps `sim.latest_ledger`.
   - **`pub async fn run_pocket_seed_loop(rpc, PocketRepo, chain_id, pocket_id, registry_id)`:**
     - each cycle: candidates → read → `insert_seed`;
     - sleep a `POCKET_SEED_INTERVAL` of 60 s;
     - per-loan failures are logged, never returned;
     - a `HashSet<u32>` of already-warned loans.
   - **Wiring:** in `run_stellar_indexer_job`, `tokio::spawn` it when `pocket_id` and
     `loan_registry_id` are both set. Warn once if the pocket is set without a registry ("pocket
     view seed disabled").
8. **API config and state.**
   - **`packages/api/src/config.rs`:**
     - `pocket_addresses: HashMap<i64, String>` in `ChainsConfig`;
     - a `load_pocket_address(chain_id, kind, &mut out)` that reads
       `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS` for Stellar chains only;
     - validate with `parse_chain_address` + Strkey `Contract` parse.
   - **`packages/api/src/lib.rs`:** add `pocket_addresses` to `AppState`.
   - **`packages/api/src/main.rs`:** thread it through.
   - **Tests:** add `pocket_addresses: HashMap::new()` to every `AppState { … }` literal under
     `packages/api/tests/` (`rg -l 'loan_registry_addresses:' packages/api/tests`).
   - Add `pocket_repo: PocketRepo` to `AppState` only if the handlers cannot build it from
     `state.pool`. Prefer a field, consistent with the other repos.
9. **API loan book** (`packages/api/src/routes/loan_book.rs`).
   - Add `#[derive(Debug, Serialize, ToSchema)] pub struct LoanPocket` (Scope §8 fields).
   - Add `pub pocket: Option<LoanPocket>` to `LoanBookEntry`. Set it to `None` at the only
     constructor (`:1470`) and register the schema in `LoanBookDoc`.
   - Add a pure `pub fn attach_pockets(resp: &mut LoanBookResponse, pockets: &HashMap<LoanRef, (ChainKind, PocketFold)>)`
     and a pure `pub fn loan_pocket(kind, &PocketFold) -> LoanPocket` (formatting).
   - In `handle_loan_book`, per chain with a pocket address, run `list_events` + `list_seeds` and
     then `fold_pockets` into the map. Call `attach_pockets` after `compute_loan_book`.
10. **API requests** (`packages/api/src/routes/analytics.rs`).
    - Add `PocketClaimItem` (ToSchema) and `pub pocket_claims: Vec<PocketClaimItem>` on
      `RequestsResponse`. It is empty in the `Unconfigured` early return and in the error-free empty
      case.
    - For each in-scope chain with `kind == Stellar` and a pocket address, call
      `list_holder_claims(chain, pocket, query.wallet.trim())`.
    - Map the rows with a pure `pub fn pocket_claim_items(chain_id, rows) -> Vec<PocketClaimItem>`.
      `created_at` uses `iso_utc_from_unix`.
    - Register the schema.
11. **API PnL** (`packages/api/src/routes/pnl.rs`).
    - Add `pub pocket_recovered: Option<String>` to `PnlResponse`.
    - Add a pure
      `pub fn pnl_totals(unrealized: &BigDecimal, realized: &BigDecimal, pocket_recovered: Option<&BigDecimal>) -> (String, String, Option<String>)`,
      returning `total_realized_pnl`, `total_pnl` and `pocket_recovered`. `None` gives exactly
      today's strings.
    - In `compute_pnl`, when the chain is Stellar and has a pocket address, sum
      `list_holder_claims(chain, pocket, wallet)`.
    - Update the utoipa `description` of `total_realized_pnl` / `total_pnl` via the field set.
12. **API dashboard** (`packages/api/src/routes/dashboard.rs`).
    - Move the body of `chain_yield_deltas` into `fn yield_deltas(kind, include_carved, legacy, repayments)`.
      `chain_yield_deltas` calls it with `false`.
    - Add `pub fn chain_yield_deltas_counting_recoveries(kind, legacy, repayments)`, which passes
      `true`.
    - In `read_chain_yield`, choose the new fn when
      `kind == ChainKind::Stellar && state.pocket_addresses.contains_key(&chain_id)`.
    - Update the doc comment for `read_chain_yield` (one line, no new comments elsewhere).
13. **API audit log** (`packages/api/src/routes/audit_log.rs`).
    - Add the five names to `AUDIT_EVENT_NAMES` and their arms to `format_action` (Scope §12).
    - Extend the module doc's event-family sentence by "Pocket events (#1789)".
14. **Comment hygiene.** New files carry only the spec-pointer header. There are no body, field or
    test comments.
15. **Lint and checks.**
    - `cargo clippy --all -- -D warnings`
    - `cargo test -p shared -p pipeline-worker -p pipeline-api` (pure tests only)
    - `npx tsx scripts/lint-docs.ts`
    - `scripts/check-chain-env-names.sh`

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There are no inline
`#[cfg(test)]` modules and no `DATABASE_URL` / `POSTGRES_URL` or any Postgres connection.

- **`packages/worker/tests/stellar_pocket_parsers.rs`** (XDR fixtures built with the
  `stellar_collateral_registry_parsers.rs` helpers):
  - each of the five events decodes to its `event_name` and `params`, including i128 values above
    `u64::MAX`;
  - `claimed` with `paid = 0` gives `paid_zero: true`, and `paid > 0` gives `false`;
  - a `G…` holder and a `C…` holder both decode to exact Strkeys;
  - a too-short topic list or a missing map key returns `None`;
  - `reporters_set` and `paused` return `None`;
  - `dispatch_pocket` maps the generic `released` / `burned` / `claimed` to the `Pocket*` names;
  - **name uniqueness:** no `Pocket*` name satisfies `is_loan_registry_event`,
    `is_collateral_registry_event` or `is_pocket_event`, nor equals any minter or deal-token stored
    name.
- **`packages/worker/tests/stellar_pocket_config.rs`** (env-based, unique chain ids per test,
  following `stellar_collateral_registry_config.rs`):
  - unset or whitespace gives `None`;
  - a valid id gives `Some`;
  - a bad CRC errors with an error that names the key;
  - the same id as `MINTER_ADDRESS` or `LOAN_REGISTRY_ADDRESS` fails the distinct-role check and
    names `POCKET_ADDRESS`.
- **`packages/worker/tests/stellar_pocket_seed.rs`:**
  - `decode_pocket_data` on an XDR `PocketData` map;
  - a wrong type or missing field is an error;
  - `is_no_pocket_error` is true for the simulate message `HostError: Error(Contract, #2)` and
    false for others.
- **`packages/shared/tests/pocket_fold.rs`.** Event sequences replay the frozen contract tests in
  `pocket/src/test.rs` and assert the contract's `PocketData`:
  - `default_opens…` gives `held` 500;
  - `recoveries_are_claimed…`: `recover(200,50)`, claims 150 / 100 / 0 / 0, `recover(100,0)`,
    claim 60, then `held` 200, `released_total` 350 and `claimed_total` 310;
  - `release_caps…` gives `held` 0 and `released_total` 310;
  - `write_downs…` gives `burned_total` 300 (`.burned`, not `.amount` 400) and `released_total`
    200;
  - `unrelease…` gives `held` 500 and `released_total` 0.

  Also:
  - **Seed rules:**
    - a seed plus only post-`as_of_ledger` events gives seed + delta and `complete = false`;
    - events at or below `as_of_ledger` are ignored;
    - a later-indexed `PocketOpened` wins over the seed and gives `complete = true`.
  - **No data:** no events and no seed gives `None`.
  - **Grouping:** `fold_pockets` groups by loan.
- **`packages/api/tests/pocket_loan_book.rs`:**
  - **`loan_pocket` formatting:**
    - Stellar 7-dp raw → 6-dp strings;
    - `supply_at_snapshot` unscaled;
    - `opened` null when `complete = false`.
  - **`attach_pockets`:**
    - fills only matching `(chain_id, loan_id)`;
    - other entries stay `null`;
    - the JSON has `"pocket": null` for them (additive shape).
- **`packages/api/tests/dashboard_auditlog_chain.rs`** (extend):
  - **Stellar `chain_yield_deltas_counting_recoveries`:**
    - includes a carved-out repayment's interest at its timestamp;
    - drops it at its reversal;
    - `compute_summary` gives the expected 6-dp total;
    - no rows gives `"0.000000"`.
  - **EVM regression:**
    - the existing carved-out tests stay untouched;
    - a new test feeds one mixed fixture (live, carved, reversed, legacy) to
      `chain_yield_deltas(ChainKind::Evm, …)` and asserts a pinned delta vector equal to today's
      output;
    - the same fixture through `chain_yield_deltas(ChainKind::Stellar, …)` is unchanged, which
      proves the default path did not move.
- **`packages/api/tests/pnl_pocket_recovered.rs`:**
  - `pnl_totals` with `None` returns exactly today's `total_realized_pnl` / `total_pnl` strings
    (the EVM and unconfigured regression);
  - with `Some(250)`, both totals add 250 and `pocket_recovered` = `"250"`.
- **`packages/api/tests/analytics_pocket_claims.rs`:** `pocket_claim_items` maps rows to items
  (ISO `created_at`, raw `amount`, `chain_id`). The serialized `RequestsResponse` contains
  `pocket_claims: []` when empty.
- **`packages/api/tests/audit_log.rs`** (extend):
  - `format_action` for all five events at Stellar scale;
  - `PocketClaimed` with `paid_zero` gives "nothing claimable";
  - `build_response` gives `scope.label = "Loan #N"` and an empty `reference`;
  - the five names are in `AUDIT_EVENT_NAMES`.
- **`packages/api/tests/chains_config.rs`** (extend): `CHAIN_<stellar>_STELLAR_API_POCKET_ADDRESS`
  is parsed; unset gives no entry; a bad id errors.
- **Live check** (user-stories doc, run in QA #1778, not CI): once a testnet loan is defaulted, compare the
  `/v1/loan-book` `pocket` with `pocket(loan_id)` via `stellar contract invoke … -- pocket`.

## Docs to Update

- **`.env.example`:**
  - #1794 adds both keys (dependency). This PR moves them out of #1794's "not read by this build"
    group and sets the live comments.
  - Stellar indexer block: `CHAIN_99000001_STELLAR_INDEXER_POCKET_ADDRESS=CD464CN7ZWOYRGCTHE74Q5PR3JSRPTHDRZYD4OZR4DY64ZSBJ6YZ2RA5`,
    with the comment "optional — Pocket events + view seed; needs LOAN_REGISTRY_ADDRESS for the
    seed".
  - API block: `CHAIN_99000001_STELLAR_API_POCKET_ADDRESS=`, with the comment "optional — loan-book
    `pocket`, `/v1/requests` `pocket_claims`, `/v1/pnl` `pocket_recovered`, Stellar recovered-interest
    yield".
- **`docs/references/backend.md`:**
  - **New `#### Stellar Pocket indexing`** under "Event Indexer", after "Stellar deal-token-factory
    indexing". It covers:
    - the event table and the five stored names (and why they carry the prefix);
    - contract-id-first routing;
    - the fold formulas and the `complete` / seed rules;
    - `pocket_seeds`, `as_of_ledger` and the best-effort race;
    - the cursor / rewind / retention guidance;
    - the pre-key-claims limitation.
  - **Key map:** both pocket keys come from #1794. Flip their rows from "not read by this build" to
    live.
  - **Section 3A:** add the `/v1/requests` `pocket_claims` and `/v1/pnl` `pocket_recovered`
    semantics.
- **`docs/product-specs/yield-apy-semantics.md`:**
  - "Dashboard cumulative yield": Stellar with the pocket key counts carved-out interest at release,
    net of reversal. EVM is unchanged.
  - New "/v1/pnl pocket_recovered" section: the definition and how it enters `total_realized_pnl` /
    `total_pnl`.
  - Fix the header's "excluded from LP yield" sentence.
- **`docs/product-specs/dashboards.md`:** the `cumulative_yield_total` row and the "Yield source"
  bullets (Stellar recovered interest, gated by the key).
- **`docs/product-specs/trustee-dashboard.md`:** add `pocket` (fields, `null` rule, `complete`) to
  the Loans page `GET /v1/loan-book` row.
- **`docs/product-specs/audit-logging.md`:** add a "Pocket events (#1789)" bullet with the five
  names, the `paid_zero` rendering, and `supply_at_snapshot` passed unscaled.
- **`docs/user-stories/epic-1776/1789-stellar-pocket-indexing.md`** (new):
  - **Stories:**
    - the key is set and the worker logs that the pocket indexer is enabled;
    - a default produces `PocketOpened` and the loan-book `pocket` with `complete: true`;
    - a carved-out repayment gives `PocketReleased`, the yield increase and the audit row;
    - a claim gives `pocket_claims`, `pocket_recovered` and the totals;
    - a zero claim is stored and in the audit log, but not in `pocket_claims`;
    - a write-down gives `PocketBurned` and `burned_total`;
    - the seed path after a late key set gives `complete: false`;
    - EVM Hoodi numbers are unchanged;
    - folds equal `pocket(loan_id)` (QA #1778, after a testnet default).
  - Add its row to `docs/user-stories/index.md` under "Epic #1776".
- **On completion:** move this plan to `docs/exec-plans/completed/`.
