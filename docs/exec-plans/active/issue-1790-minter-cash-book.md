# Issue #1790: Minter cash book read model: wire-ins, wire-outs, ramps, bank_cash and in_flight from indexed events

Source: https://github.com/eq-lab/pipeline/issues/1790

Parent epic: #1776. Merge-order step 4 (additive, dark until its keys are set). The
`/v1/capital-allocation` switch is merge-order step 6. It ships in this PR as a **dark, opt-in
per-chain flag**, and the flag is turned on only after the folds match on-chain values on test.

## Scope

The cash book is built by folding the minter events the indexer already writes to `contract_logs`
(epic decision 2026-10-29). The API makes no RPC call. One new event is indexed: the minter's
permissionless `snapshot`, used as the fold checkpoint. No migration.

**Worker (indexer):**

- Index the minter `snapshot` event as `MinterSnapshot`.
  - Contract: `pipeline-stellar-contracts` `contracts/minter/src/event.rs:170-177`, emitted at
    `lib.rs:810-816`.
  - Shape: topics `["snapshot", ledger: u32]`, value `Map { pool: PoolState }`.
  - `PoolState` (`types.rs:146-156`) is itself a nested `Map`.
- Stored params (decimal strings, raw 7-dp):
  - `ledger`, `bank_cash`, `in_flight`, `outstanding_total`, `unabsorbed_total`,
    `total_assets`;
  - `read_failed` as a JSON bool.
  - `custody` (`Vec<(Address, i128)>`) is not decoded or stored. The fold does not need it, and
    leaving it out avoids a tuple-decoding failure mode.
- No new RPC call, no change to `index_once`. The minter id is already in the `getEvents`
  `contractIds` filter (`poller.rs:151-153`), so `snapshot` events are already fetched. Today
  they fall through as `None` (`parsers.rs:618-621`).

**API:**

1. **Config.** Add two optional per-Stellar-chain keys:
   - `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` (`C…` Strkey). It must equal the indexer's
     `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS`. It scopes every fold and list by
     `(chain_id, contract_address)`.
   - `CHAIN_<id>_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER` (`true`/`false`, default `false`).
     This is the dark switch.

   Unset means no behaviour change. On an EVM chain these `STELLAR` keys already abort startup
   (`shared::chains::validate_chain_kind_keys`), so EVM can never be switched.
2. **`GET /v1/cash-book?chain_id=`.**
   - Trustee-only: bearer plus the `trustee` role, because it joins on-chain addresses to LP
     accounts.
   - `chain_id` is required (`RequiredChain`).
   - When the chain has no minter address (every EVM chain, and an unconfigured Stellar chain)
     it returns `404 {"error":"minter_not_configured"}`.
   - Response: `{ chain_id, minter, summary, wire_ins[], wire_outs[], ramps[] }`.
3. **LP wire-outs.** `GET /v1/requests` (`routes/analytics.rs`) gains an optional
   `wire_outs: [...]` list beside `requests`:
   - It holds the wallet's own wire-outs on in-scope chains that have a minter address.
   - It is **omitted** (`skip_serializing_if = "Option::is_none"`) when no in-scope chain has
     one, so EVM-only and unconfigured responses stay byte-identical.
   - No new `type` value is added to `requests[]` (`renderRequestRow.tsx:80-194` switches on
     literal strings).
4. **`/v1/capital-allocation`.** When the flag is on **and** the chain's fold is `complete`:
   - that Stellar chain's `in_transit` becomes `in_flight`;
   - its `trust_account` contribution becomes `bank_cash`;
   - its Trustee-entered `loan_capital_transfers` trust-account and on/off-ramp figures stop
     counting.

   `deployed` is unchanged. If the fold is incomplete, the chain falls back to today's sources
   with a `warn!`. EVM keeps its sources. The endpoint still sums across chains.

**Out of scope:**

- contract changes (frozen);
- EVM cash book / EVM minter folds;
- indexing the Stellar AccessManager or SecurityRegistry NFT mint/burn (human decision
  2026-11-03);
- frontend #1757 / #1763 / #1764 / #1765;
- materialising the fold in a table;
- `#1687` matching changes;
- closing `#1690` (the manager or a human decides; the PR says "supersedes").

## Assumptions and Risks

**Fold rules, checked against every write at minter HEAD.** The minter is unchanged since
`7646cef`, and pipeline-stellar-contracts HEAD is `d0d5757`. The rules:

- `bank_cash += WireIn.amount`, both direct and escrowed (`lib.rs:116`).
- `bank_cash += CashDisbursementReversed.amount` (`:254`).
- `bank_cash += CashRepaid.cash` (`:314`).
- `bank_cash += RampClosed.received` for UsdcToBank (`:541-543`).
- `bank_cash −= WireInReturned.amount` (`:176`).
- `bank_cash −= CashDisbursed.amount` (`:205`).
- `bank_cash −= CashRepaymentReversed.cash` (`:374`).
- `bank_cash −= WireOutSettled.amount` (`:449`).
- `bank_cash −= RampOpened.amount` for BankToUsdc (`:498`).
- `bank_cash += CashRecorded.delta` for every reason, signed as emitted:
  - `record_income` emits `+delta` (`:590-592`);
  - `record_expense` emits `-delta` (`:601-603`), so it is not subtracted twice;
  - `record_correction` is signed (`:611-635`).
- `in_flight += RampOpened.amount` in both directions (`:500`).
- `in_flight −= ramp.amount` on close (`:540`).
- No cash effect: `correct_vault_mint`, `MintCorrected`, `LossAbsorbed`, `WireInAssigned`,
  `WireOutRequested`, `WireOutCancelled`.

**`RampClosed` carries no amount and no direction.**

- `loss = ramp.amount − received` (`:544`) and `RampClosed` carries both `received` and `loss`.
  So the `in_flight` decrement is `received + loss`, with no join needed.
- The direction still needs the join to `RampOpened` on `(contract_address, id)`.
- If the matching `RampOpened` is not indexed, the `bank_cash` effect is unknown, so
  `complete = false`.
- If the open is indexed and `received + loss ≠ RampOpened.amount`, also `complete = false`
  (defensive).

**Only Income / Expense / Correction are emitted as `CashRecorded` today.** `disburse` and
`reverse_disburse` write cash entries without `record_cash` (`:209-228`, `:260-279`). The issue's
rule "every reason" therefore cannot double-count at HEAD. The fold follows the issue literally.
Contracts are frozen, so this cannot change without a redeploy.

**Completeness: the "deploy-ledger" path is not implementable.**

- The minter constructor emits no event (`lib.rs:67-94`; `stellar_access::ownable::set_owner`
  only writes storage). Nothing marks the deploy ledger in `contract_logs`.
- `log_collector_state` stores only the current cursor, so the API cannot prove the indexer
  covered the minter from its deploy ledger. The minter key may also have been added after the
  cursor passed the deploy.
- The plan therefore sets `complete = true` iff a valid `MinterSnapshot` exists for
  `(chain_id, minter)` and every post-checkpoint event folds cleanly (resolved question 1).

**Snapshot semantics.**

- The fold starts from the latest valid snapshot, ordered by `(block_number, log_index)`, and
  applies only events strictly after it, including later events in the same ledger.
- Lists (`wire_ins` / `wire_outs` / `ramps`) are built from the whole indexed history. They can
  be partial before the indexer's coverage starts, which `complete` does not claim to cover.
- A follow-up event whose origin event is not indexed is still folded into the totals but is
  left out of the lists.

**Operational prerequisite.** Someone must call `snapshot()` (permissionless, any funded
account) **after the new worker image is live** on each network. An old worker skips the event
and advances its cursor, so a snapshot emitted under it is lost and must be re-emitted. Until
then `complete = false` and the capital-allocation switch cannot engage.

**Ids.** `WireIn` / `WireInAssigned` store `params.id` as a JSON number, and the other minter
events store it as a string (`parsers.rs:312, 346`; `minter_parsers.rs`). The Rust side
normalises with `shared::loan_event_params::json_i64`. Any SQL joins on `params->>'id'`, which
renders both forms as the same text, as `lp_bank_deposit_repo.rs:132-136` already does.

**Escrow rule aligned with #1687.** `Escrowed` iff `WireIn.receiver == minter address`, the same
rule as `mark_minted_direct`'s `receiver <> minter` (`lp_bank_deposit_repo.rs:107-118`) and the
contract's branch (`lib.rs:120-125`).

**Units.**

- Folds run on raw `i128` 7-dp values.
- Output goes through `shared::chains::normalize_usdc_amount(Stellar, …)` (floor ÷10) and then
  `formatting::base6_to_decimal_string`. That gives the dollar string every other endpoint
  serves, e.g. raw `12345678` → `"1.234567"`.
- Normalisation happens once, on the final totals, not per event.
- Acceptance compares `floor(onchain / 10)`.

**Capital-allocation meaning change (step 6 only).** With the flag on:

- Stellar `in_transit` stops depending on Trustee ramp-review approvals (`/v1/ramp/events`
  stays as is);
- Stellar `trust_account` stops reflecting Trustee-entered rows.

The field names and units are unchanged: `trust_account` stays a dollar figure, so `bank_cash`
base-6 is divided by 10^6 before it joins the dollar sum (`capital_allocation.rs:355-363`). The
frontend reader (`trustee/src/components/useCapitalAllocationCard.ts:146-165`) needs no change.
The PR and the spec state that Stellar `loan_capital_transfers` stop counting once the flag is on.

**Rollout safety (pipeline-test), per the issue's mandatory checklist:**

- **Migrations are additive only:** there is no migration. `MinterSnapshot` is a new
  `event_name` in the existing `contract_logs`. No `TRUNCATE`.
- **The previous image keeps booting:**
  - the schema is unchanged;
  - the old worker ignores `snapshot` events;
  - the old API ignores the new keys and the new rows (every reader filters on `event_name`;
    the audit log uses the `AUDIT_EVENT_NAMES` whitelist, `audit_log.rs:59`).
- **New env keys are optional:** both are unset by default, which ships dark. A malformed value
  fails startup, like the existing `…_ASSET_DECIMALS`. Setting the flag without the minter
  address is a startup error, because it is a misconfiguration.
- **EVM behaviour is unchanged:**
  - `STELLAR_` keys cannot be set on EVM chains;
  - EVM `ChainCapitalInputs` get `minter_cash: None`, which is exactly the legacy path;
  - `/v1/requests` omits `wire_outs` when no minter-configured chain is in scope;
  - the EVM minter parsers (`indexer/parsers.rs:419-640`) and `PLUSD_LEDGER_SQL` are untouched;
  - regression tests cover each of these (see Test Strategy).
- **RPC reads in the indexer are best-effort:** no RPC is added. The snapshot parser is pure
  decoding. A decode failure returns `None` plus the existing "recognised by name but not
  decodable" warning (`parsers.rs:640-651`) and never fails `index_once`.
- **API changes are additive:**
  - a new route;
  - an optional new field on `/v1/requests`;
  - no field removed;
  - the capital-allocation meaning changes only when an operator sets the flag.
- **Explicit rollout step: emit a snapshot.** After the new worker image is live on a network,
  call the permissionless `snapshot()` once on that network's minter (test 99000001 now, mainnet
  on its next release). Check that a `MinterSnapshot` row exists and that `summary.complete` is
  `true` before setting the capital-allocation flag. If the worker is rolled back while a
  snapshot is emitted, call `snapshot()` again after rolling forward.
- **API and worker roll independently:** with the API first, there are no snapshots yet, so
  `complete = false` and the switch cannot engage. With the worker first, it writes rows nothing
  reads yet.

**Merge-order dependencies and conflicts.**

- #1793 is implemented on branch `chore/1793-delete-stellar-yield-mint` (PR #1803). It renames
  the Rust field `yield_minter_id` → `minter_id` in `indexer/stellar/parsers.rs` / `poller.rs` /
  `indexer/config.rs`, and it merges before this issue. Rebase onto it once it lands and use
  `minter_id` in the new match arm.
- #1789 and #1791 (same step 4) likely also touch:
  - `parsers.rs` dispatch;
  - `api/src/config.rs` / `AppState` (new optional keys);
  - `.env.example` and `backend.md`.

  Expect mechanical conflicts.
- #1794 edits `.env.example` and `backend.md`; conflicts should be trivial.

**Performance.** The fold is recomputed per request over the minter's full event history. That is
fine at testnet volume. `/v1/capital-allocation` is polled, but it folds only for flagged chains.
Log a tech-debt entry for materialising the fold if volume grows.

## Open Questions

_None_

### Resolved questions (human, 2026-11-03)

1. **Completeness without a snapshot: snapshot only.** `complete = true` iff a valid
   `MinterSnapshot` exists for `(chain_id, minter)` and every post-checkpoint event folds cleanly.
   There is no deploy-ledger or operator-asserted genesis path. Calling the permissionless
   `snapshot()` once per network after the new worker image is live is an explicit rollout step
   (see Rollout safety and the user-stories doc).
2. **Partial totals are served.** `summary.bank_cash` / `in_flight` always carry the folded
   values, with `complete = false` when the fold is incomplete, as the issue says. They are never
   `null`.

## Implementation Steps

1. **Worker: snapshot parser.**
   - In `packages/worker/src/indexer/stellar/minter_parsers.rs`, add
     `pub fn parse_minter_snapshot(raw: &RawEvent) -> Option<StellarLog>`:
     - `matches(raw, "snapshot", 2)`;
     - `ledger = extract_u32(&raw.topics_base64[1])`;
     - `pool = get_map_entry(&raw.value_base64, "pool")?`, which must be `ScVal::Map`;
     - read `bank_cash`, `in_flight`, `outstanding_total`, `unabsorbed_total` and
       `total_assets` as `I128`, and `read_failed` as `Bool`, through small local helpers over
       `&ScVal` (`scmap_field`, `scmap_i128`, `scmap_bool`). Reuse `i128_from_parts` from
       `crate::stellar::scval`.
     - Return `build(raw, "MinterSnapshot", json!({...}))`, with amounts as decimal strings
       and `ledger` as a string.
   - In `packages/worker/src/indexer/stellar/parsers.rs`:
     - add `"snapshot"` to `MINTER_COLLECTED_EVENTS` (`:39-55`);
     - add `"snapshot" => parse_minter_snapshot(raw)` to the minter match (`:622-639`);
     - import the parser;
     - drop "and the diagnostic `snapshot`" from the branch comment, keeping the code
       comment-light per AGENTS.md.
   - The poller needs no change: `MinterSnapshot` is not a loan-registry event, so it goes
     through `StellarLogMapper`.
2. **Shared: repo reads** (`packages/shared/src/contract_logs_repo.rs`).
   - `pub const MINTER_CASH_BOOK_EVENT_NAMES: &[&str]` holds `WireIn`, `WireInAssigned`,
     `WireInReturned`, `CashDisbursed`, `CashDisbursementReversed`, `CashRepaid`,
     `CashRepaymentReversed`, `WireOutRequested`, `WireOutSettled`, `WireOutCancelled`,
     `RampOpened`, `RampClosed`, `CashRecorded` and `MinterSnapshot`.
   - `pub const MINTER_EVENTS_SQL` selects
     `event_name, block_number, log_index, block_timestamp, params` with:
     - `WHERE chain_id = $1 AND contract_address = $2 AND event_name = ANY($3)`;
     - `ORDER BY block_number, log_index`.
   - `#[derive(sqlx::FromRow)] pub struct MinterEventRow { event_name: String, block_number: i64,
     log_index: i32, block_timestamp: i64, params: serde_json::Value }`.
   - `pub async fn list_minter_events(&self, pool, chain_id, minter) -> Result<Vec<MinterEventRow>>`.
   - `pub const LP_WIRE_OUT_EVENTS_SQL` returns the minter's `WireOutRequested` rows with
     `LOWER(params->>'lp') = $3`, plus the `WireOutSettled` / `WireOutCancelled` rows whose
     `params->>'id'` is among them, with the same chain and contract scope. Add
     `pub async fn list_lp_wire_out_events(&self, pool, chain_id, minter, wallet_lower)`.
   - `pub async fn get_indexer_cursor(&self, pool, chain_id) -> Result<i64>` reads
     `log_collector_state.last_indexed_block` and returns 0 when absent. Alternatively reuse
     `shared::db::EventRepo::get_cursor` if it is reachable from the API's state.
3. **Shared: LP resolution** (`packages/shared/src/lp_repo.rs`).
   - `pub const STELLAR_ADDRESS_HOLDERS_SQL`:
     ```sql
     SELECT DISTINCT ON (h.address) h.address, l.id, l.legal_name
       FROM lp_settlement_address_history h
       JOIN lps l ON l.id = h.lp_id
      WHERE h.chain_kind = 'stellar' AND h.address = ANY($1)
      ORDER BY h.address, h.created_at DESC, h.id DESC
     ```
     The history table is a superset of current links, thanks to the backfill in
     `20261102000004_…` plus every new link, so a relinked LP keeps its old wire-outs.
   - `pub async fn holders_of_stellar_addresses(&self, addrs: &[String]) -> Result<Vec<StellarAddressHolder>>`.
4. **API: pure fold** — a new `packages/api/src/minter_cash_book.rs`, `pub mod` in `lib.rs`. No
   DB.
   - Types:
     - `WireInStatus { Direct, Escrowed, Assigned, Returned }`;
     - `WireOutStatus { Pending, Settled, Cancelled }`;
     - `RampStatus { Open, Closed }`;
     - `CashBookWireIn`, `CashBookWireOut`, `CashBookRamp` (raw `i128` amounts, unix
       timestamps);
     - `CashBookFold { bank_cash: i128, in_flight: i128, complete: bool,
       checkpoint_ledger: Option<i64> }`.
   - `pub fn build_wire_ins(rows, minter) -> Vec<CashBookWireIn>`:
     - origin `WireIn` (Escrowed iff `receiver == minter`, else Direct);
     - then `WireInAssigned` → Assigned, with `receiver` replaced and `assigned_at` set;
     - `WireInReturned` → Returned, with `returned_at` and `return_ref_hash` set;
     - join on `json_i64(params.id)`.
   - `pub fn build_wire_outs(rows) -> Vec<CashBookWireOut>`:
     - `WireOutRequested` → Pending (`lp`, `amount`, `requested_at = block_timestamp`);
     - `WireOutSettled` → Settled (`settled_at`, `value_date`, `ref_hash`);
     - `WireOutCancelled` → Cancelled (`cancelled_at`).
   - `pub fn build_ramps(rows) -> Vec<CashBookRamp>`:
     - `RampOpened` → Open (`direction`, `amount`, `opened_at`, `open_ref_hash`);
     - `RampClosed` joined on id → Closed (`received`, `loss`, `closed_at`,
       `close_ref_hash`).
   - `pub fn fold_cash(rows) -> CashBookFold`:
     - pick the latest `MinterSnapshot` whose params parse (`checkpoint_ledger` = its
       `ledger`), and start from its `bank_cash` / `in_flight`;
     - with no valid snapshot, start from 0 and set `complete = false`;
     - apply the rules under Assumptions to rows strictly after the checkpoint position;
     - take the ramp direction from a map built over **all** `RampOpened` rows;
     - an unparseable amount, an unknown ramp direction or an open/close amount mismatch on a
       post-checkpoint row sets `complete = false`.
   - All lists are sorted by on-chain id, descending.
   - `pub fn to_base6_string(raw: i128) -> String` =
     `normalize_usdc_amount(ChainKind::Stellar, …)` then `base6_to_decimal_string`.
5. **API: config** (`packages/api/src/config.rs`, `lib.rs`, `main.rs`).
   - Add `minter_addresses: HashMap<i64, String>` and
     `capital_allocation_from_minter: HashSet<i64>` to `ChainsConfig` and `AppState`.
   - Load them in `ChainsConfig::from_env` for Stellar chains only:
     - `load_minter_address` follows the `load_loan_registry_address` Strkey normalisation
       (`config.rs:236-266`), but is optional;
     - `load_capital_allocation_switch` accepts `true` / `false`, trimmed and
       case-insensitive; anything else is an error. Flag `true` with no minter address is an
       error.
   - Log each at `info!`.
   - Update the `ChainsConfig` doc block (`config.rs:52-79`).
   - Wire both into `AppState` in `main.rs:131-160`.
   - Update every test `AppState { … }` literal: `loan_registry_scope.rs`,
     `vouchers_chain_required.rs`, `dashboard_auditlog_chain.rs`, `ramp_kyc_chain.rs`,
     `lp_payment_details_head.rs`, `chains.rs`, `analytics_pnl_positions_chain.rs`,
     `lp_settlement_address.rs`, `loan_chain_required.rs`, `voucher_signing.rs`. Re-grep
     `AppState {` before editing.
6. **API: `GET /v1/cash-book`** — new `packages/api/src/routes/cash_book.rs`, registered in
   `routes/mod.rs`, `main.rs` `api_docs.merge(CashBookDoc::openapi())` and
   `.nest("/v1", cash_book::router())`.
   - Handler order:
     1. `AuthClaims` → `has_role(TRUSTEE_ROLE)`, else 403.
     2. `RequiredChain`.
     3. `pub fn resolve_minter(chain, &minter_addresses) -> Result<&str, ApiError>`, which
        returns `NotFound("minter_not_configured")`.
     4. `tokio::try_join!` of `list_minter_events` and `get_indexer_cursor`.
     5. The pure builders, then `holders_of_stellar_addresses` for the distinct wire-out `lp`s.
   - DTOs (utoipa `ToSchema`): `CashBookResponse { chain_id, minter, summary: CashBookSummary {
     bank_cash, in_flight, complete, checkpoint_ledger: Option<i64>, as_of_ledger: i64 },
     wire_ins, wire_outs, ramps }`.
   - Item fields:
     - wire-in: `id`, `status`, `receiver`, `amount`, `value_date`, `ref_hash`,
       `recorded_at`, `assigned_at?`, `returned_at?`, `return_ref_hash?`;
     - wire-out: `id`, `status`, `lp`, `lp_id?`, `lp_legal_name?`, `amount`, `requested_at`,
       `settled_at?`, `value_date?`, `ref_hash?`, `cancelled_at?`;
     - ramp: `id`, `status`, `direction`, `amount`, `opened_at`, `open_ref_hash`,
       `received?`, `loss?`, `closed_at?`, `close_ref_hash?`.
   - Amounts are base-6 dollar strings. Timestamps and value dates use
     `formatting::iso_utc_from_unix`. Status and direction are the contract's variant names.
   - Document 200 / 400 / 401 / 403 / 404 / 500 and `security(("bearer_auth" = []))`, with
     `modifiers(&SecurityAddon)`.
7. **API: LP wire-outs on `/v1/requests`** (`packages/api/src/routes/analytics.rs`).
   - Add `#[serde(skip_serializing_if = "Option::is_none")] pub wire_outs:
     Option<Vec<LpWireOutItem>>` to `RequestsResponse`.
   - `LpWireOutItem { chain_id, id, status, amount, requested_at, settled_at?, value_date?,
     ref_hash?, cancelled_at? }`.
   - Add a pure `pub fn minter_chains_in_scope(scope, chains, minter_addresses) -> Vec<(i64,
     String)>`.
   - When the result is non-empty, call `list_lp_wire_out_events` per chain with the
     already-lowercased `wallet`, then `build_wire_outs`. With `status=pending`, keep only
     `Pending`. Sort newest first by `requested_at`, then `(chain_id, id)`.
   - When it is empty, `wire_outs` is `None` (omitted). The `Unconfigured` early return keeps
     `{"requests":[]}`.
   - Register `LpWireOutItem` in `AnalyticsDoc`.
8. **API: capital-allocation dark switch** (`packages/api/src/routes/capital_allocation.rs`).
   - Add `pub minter_cash: Option<MinterCashTotals>` to `ChainCapitalInputs`, where
     `MinterCashTotals { bank_cash: BigDecimal, in_flight: BigDecimal }` holds base-6 units.
   - In the handler, for chains in `capital_allocation_from_minter`:
     - add a sixth `try_join!` arm: `list_minter_events` then `fold_cash`;
     - when `complete`, set `Some(normalised totals)`; otherwise use `None` plus
       `tracing::warn!(chain_id, "capital-allocation: minter fold incomplete; using legacy sources")`.
   - In `compute_capital_allocation`:
     - `chain_in_transit` returns `Some(in_flight)` when `minter_cash` is `Some`, ignoring
       `addr` and `capital_transfers`;
     - `trust_account` becomes a per-chain sum: `bank_cash / 10^6` when `minter_cash` is
       `Some`, else `Σ(deposit − withdrawal)` over that chain's rows;
     - `deployed` is unchanged.
   - Update the module and struct doc text to state the switched sources. Docs move to the
     spec where possible, per the comment-less rule. Existing doc comments are kept to the
     minimum the current file style needs.
9. **Docs** (see Docs to Update) and the user-stories doc.
10. **Tech debt.** Add entries to `docs/exec-plans/tech-debt-tracker.md`:
    - the fold is recomputed per request (no materialisation);
    - completeness depends on an operator-emitted snapshot (no indexer coverage record);
    - the EVM minter has no cash book.
11. **Lint and build:**
    - `cargo fmt --all`;
    - `cargo clippy --all -- -D warnings`;
    - `cargo test -p pipeline-worker -p pipeline-api -p shared`;
    - `npx tsx scripts/lint-docs.ts`, which ran in this worktree at plan time: 0 errors.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`. There is no inline
`#[cfg(test)]`, no `DATABASE_URL` / `POSTGRES_URL` and no Postgres; lazy pools are fine only where
the code path returns before any query. Test bodies have no comments.

- **`packages/worker/tests/stellar_minter_cash_parsers.rs`** (extend):
  - `snapshot` decodes to `MinterSnapshot` with the exact params, including a negative-safe
    i128 round-trip and `read_failed` true/false. The encoder builds a nested `map_val` for
    `pool`.
  - Wrong arity, a missing `pool` and a non-map `pool` each give `None`.
  - `each_minter_topic_routes_to_its_stored_name` gains the snapshot case.
  - Remove `"snapshot"` from `uncollected_minter_topics_are_dropped`, keeping the other three.
  - `MinterSnapshot` is not claimed by `is_loan_registry_event`.
  - A `snapshot` from the loan-registry id is not parsed.
- **`packages/api/tests/minter_cash_book.rs`** (new) covers `build_*` and `fold_cash`:
  - Wire-in statuses:
    - Direct (receiver ≠ minter);
    - Escrowed (receiver == minter);
    - Assigned (receiver replaced);
    - Returned (with return ref);
    - id join across a JSON number `3` and the string `"3"`.
  - Wire-out statuses: Pending, Settled (`ref_hash`, `value_date`) and Cancelled; a follow-up
    whose request is missing is not listed.
  - Ramps: open and closed in both directions; `RampClosed` joined to its `RampOpened`.
  - Each `bank_cash` writer in isolation:
    - `+`: `WireIn` direct and escrowed, `CashDisbursementReversed`, `CashRepaid.cash`,
      `RampClosed.received` (UsdcToBank);
    - `−`: `WireInReturned`, `CashDisbursed`, `CashRepaymentReversed.cash`, `WireOutSettled`,
      `RampOpened` BankToUsdc.
  - `CashRecorded`:
    - Income `+X`;
    - **Expense with emitted `delta = -X` decreases `bank_cash` by exactly X**;
    - Correction `+Y` and `−Y`.
  - No-effect events: `MintCorrected`, `LossAbsorbed`, `WireInAssigned`, `WireOutRequested`,
    `WireOutCancelled`.
  - `in_flight`:
    - `+amount` on open in both directions;
    - `−(received + loss)` on close, with and without a loss;
    - a BankToUsdc close leaves `bank_cash` unchanged;
    - a UsdcToBank close adds only `received`.
  - Checkpoints:
    - no snapshot gives `complete = false` and the genesis sum;
    - with a snapshot, only later events apply: an earlier `log_index` in the same ledger is
      excluded and a later one is included;
    - the latest of two snapshots wins;
    - a malformed snapshot is skipped in favour of an earlier valid one.
  - A ramp opened before the snapshot and closed after it decrements `in_flight` and uses the
    pre-snapshot direction. With the open not indexed, `complete = false`. An open/close amount
    mismatch gives `complete = false`.
  - A malformed post-checkpoint amount gives `complete = false`.
  - `to_base6_string`: `12345678` → `"1.234567"`, and `0` → `"0.000000"`.
- **`packages/shared/tests/contract_logs_repo.rs`** (extend) asserts on the new SQL constants,
  with `STELLAR_ADDRESS_HOLDERS_SQL` in `packages/shared/tests/settlement_address.rs`:
  - `MINTER_EVENTS_SQL` and `LP_WIRE_OUT_EVENTS_SQL` scope by `chain_id` **and**
    `contract_address`, and order by `block_number, log_index`;
  - `MINTER_CASH_BOOK_EVENT_NAMES` is exactly the 14 names;
  - `STELLAR_ADDRESS_HOLDERS_SQL` filters `chain_kind = 'stellar'` and picks the latest link.
- **`packages/api/tests/chains_config.rs`** (extend, under its `ENV_LOCK`):
  - the minter address is parsed and normalised;
  - unset means absent;
  - a malformed address is an error;
  - the flag is parsed as true/false;
  - a malformed flag is an error;
  - the flag without an address is an error;
  - an EVM chain loads with neither entry.
- **`packages/api/tests/cash_book.rs`** (new):
  - `resolve_minter`: an EVM chain → 404 `minter_not_configured`; an unconfigured Stellar
    chain → 404; a configured one → `Ok`.
  - OpenAPI: `/v1/cash-book` exists, `chain_id` is required, bearer-gated, and 200 / 400 /
    401 / 403 / 404 are documented. Follow `lp_bank_deposits.rs:207-316`.
  - Router: no token (`jwt_keys: None`) → 401, with no DB touched.
- **`packages/api/tests/analytics_pnl_positions_chain.rs`** (extend):
  - the existing `{"requests":[]}` assertion stays;
  - `minter_chains_in_scope` is empty for EVM chains, for `Unconfigured`, and for a Stellar
    chain without a minter, and is filtered correctly for `All` / `One`;
  - a `RequestsResponse` with `wire_outs: None` serialises without a `wire_outs` key, which is
    the EVM byte-identity regression;
  - the OpenAPI exposes `wire_outs` as optional.
- **`packages/api/tests/capital_allocation.rs`** (extend; existing fixtures get
  `minter_cash: None` and must pass unchanged):
  - A switched Stellar chain: `in_transit = in_flight`, `trust_account = bank_cash` in dollars,
    the chain's `loan_capital_transfers` trust and ramp figures are ignored, `deployed` is
    unchanged, and `total` is consistent.
  - **EVM regression:** an EVM chain computed alone and alongside a switched Stellar chain
    yields the same EVM contribution as the legacy formula.
  - Flag on but fold incomplete (`minter_cash: None`) equals the legacy output.
- **Manual acceptance on test** (in the user-stories doc, not automated):
  1. Deploy.
  2. Call `snapshot()`.
  3. Exercise every minter call on testnet.
  4. Compare `GET /v1/cash-book?chain_id=99000001` `summary` with
     `stellar contract invoke … -- bank_cash` / `in_flight` (simulated, `floor(÷10)`). Do this
     while `as_of_ledger` ≥ the last minter-tx ledger, so both read the same ledger.
  5. Only then set `CHAIN_99000001_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER=true`.

## Docs to Update

- **New** `docs/product-specs/minter-cash-book.md` (under 150 lines), plus an entry in
  `docs/product-specs/index.md`. It covers:
  - Overview;
  - Behavior: the fold rules, the snapshot checkpoint, `complete`, statuses and units;
  - API Contract: `GET /v1/cash-book`, `/v1/requests.wire_outs` and the capital-allocation
    switch;
  - Data Model: `MinterSnapshot` and the minter rows;
  - Security: trustee-only.
- `docs/product-specs/dashboards.md:105`: the Stellar `in_transit` / `trust_account` sources
  when the switch is on, and that Stellar `loan_capital_transfers` then stop counting.
- `docs/product-specs/withdrawals.md` "API Contract": the LP `wire_outs` list on
  `/v1/requests`.
- `docs/references/backend.md`:
  - the §Stellar events table (`:303-331`): a `snapshot` → `MinterSnapshot` row, "16 of its 22
    events", and drop "`snapshot` … not collected";
  - a short "Minter cash book" subsection: the fold, the ops `snapshot()` step after the worker
    rollout, and the two new API keys.
- `.env.example`, near `:213`: `# CHAIN_99000001_STELLAR_API_MINTER_ADDRESS=C...` (optional, must
  equal the indexer key) and `# CHAIN_99000001_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER=false`
  (optional, dark switch).
- `ARCHITECTURE.md` chain-scope paragraph: `GET /v1/cash-book` requires `chain_id` (400), and an
  unconfigured minter gives 404.
- **New** `docs/user-stories/epic-1776/1790-minter-cash-book.md`, in the format of
  `1788-stellar-debt-only-deal-registered.md`, plus a row in `docs/user-stories/index.md` under
  "Epic #1776". Stories:
  - after the worker rollout, the operator calls `snapshot()` once and it is indexed (an explicit
    rollout step);
  - before any snapshot, `summary.complete` is `false` and the partial totals are still served;
  - the cash book matches on-chain `bank_cash` / `in_flight`;
  - Expense and Correction;
  - a ramp in both directions;
  - an escrowed wire-in is assigned or returned;
  - an LP sees its wire-outs on `/v1/requests`;
  - EVM `/v1/capital-allocation` and `/v1/requests` are unchanged;
  - the switch flips Stellar buckets only when `complete`.
- `docs/exec-plans/tech-debt-tracker.md`: the entries from step 10.
- PR body: state that Stellar `loan_capital_transfers` stop counting once the flag is set,
  the ops `snapshot()` step, "Supersedes #1690", and the overlap with #1687 / #931.
