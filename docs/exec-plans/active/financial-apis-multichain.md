# Financial APIs: multi-chain (financial-position, capital-allocation, withdrawal-queue)

Branch: `feature/financial-apis-multichain`. No GitHub issue yet.

Applies the epic #1521 (LoanBook API — multi-chain) conventions to three more endpoint groups:
`GET /v1/financial-position`, `GET /v1/capital-allocation`, `GET /v1/withdrawal-queue`. The
reference implementation is `GET /v1/loan-book` (#1530): `LenientChainFilter`, a sequential
per-chain fan-out in `handle_loan_book`, and `(chain_id, loan_id)` keys.

Backend only (API + worker). No Figma reference.

## Decisions (human, 2026-10-16)

1. **The loan-book rule applies wherever aggregation makes sense.** `chain_id` is optional. When
   it is omitted, the response is the union over every chain in `AppState.chains`. A configured id
   returns that chain only. A well-formed but unconfigured id returns 200 with an empty or zeroed
   response. A malformed or repeated value returns 400 (`LenientChainFilter`). Every item carries
   `chain_id`. All three endpoints aggregate.
2. **The EVM sources for `capital-allocation.in_transit` and `.withdrawal_queue` are
   implemented.** They are not left `null` on EVM (Part B).
3. **Multi-chain work first.** #1534 (deployed ignores disbursed/written_down) and #1535
   (rollover maturity) stay separate.
4. **Backend only.** There are no frontend changes.
5. **A capital-allocation bucket on a chain with no source configured.** The union sums the chains
   that have a source. The bucket is `null` only when no chain in scope has one.
6. **Registry-scoped loan readers.** The financial-position and capital-allocation fan-out reads
   through `list_latest_loan_snapshots(chain, registry)` /
   `list_loan_lifecycle_events_for_registry`, exactly as `handle_loan_book` does. This covers two
   of #1538's four callers. `portfolio.rs` / `dashboard.rs` stay unscoped, so #1538 stays open for
   them.
7. **Config is keyed by chain id only.** Nothing distinguishes mainnet from testnet. Each
   deployment configures the EVM chain ids it runs (stage: Hoodi; prod: mainnet, Base,
   Arbitrum, …) under the per-chain `CHAIN_<id>_EVM_*` keys. A chain id without that config is
   ignored: tracking stays off in the worker, and the API skips it or returns empty.

8. **Worker asset-tracking keys use `JOB_INDEXER_EVM_<id>_*` (2026-10-20).** This deliberately
   departs from the #1456 `CHAIN_<id>_<TYPE>_INDEXER_*` scheme. The keys are grouped under the job
   prefix next to Stellar's `JOB_INDEXER_STELLAR_*` asset-tracking keys, so one role can be
   compared across chains. They keep the chain id because each EVM chain has its own USDC and MPC
   addresses. Trade-off: `validate_chain_kind_keys` only scans `CHAIN_<id>_<TYPE>_` prefixes, so a
   `JOB_INDEXER_EVM_<id>_*` key set for a Stellar chain id is ignored rather than rejected at
   startup. The API keys stay `CHAIN_<id>_EVM_API_*`, since the API is not a job.

## Open questions

_None_

## Scope

### In scope

**Part A — API aggregation**

- All three handlers take `LenientChainFilter` instead of `Query<ChainQuery>` and fan out
  sequentially over the resolved chains. Their OpenAPI params become `params(LenientChainFilter)`
  and document the 400.
- **withdrawal-queue**
  - The `RequestClaimed` lateral join gains `c.chain_id = r.chain_id`. Today it matches on
    `(request_id, contract_address)` only, while `contract_logs` is unique per `chain_id`.
  - `WithdrawalQueueRow` and `WithdrawalQueueItem` gain `chain_id`.
  - Items are ordered by `requested_at` desc, with tie-break `(chain_id, request_id numeric)`.
  - `in_queue_usd`, `requests_count` and `estimated_wait_days` are computed over the union.
    `liquid_cover` stays `null`.
- **financial-position**
  - `effective_end` matches `e.chain_id == loan.chain_id && e.loan_id == loan.loan_id`.
  - The compute signature is unchanged, and `/v1/dashboard/summary` (single chain) keeps calling
    it as is.
- **capital-allocation**
  - Per-chain inputs: transfers, address sets, asset decimals, wallet balance and
    `loan_capital_transfers` rows.
  - The `deployed` id set is keyed `(chain_id, loan_id)`.
  - `in_transit` and `withdrawal_queue` are normalised to base-6 **per chain, before summing**
    (Stellar 7 dp, EVM 6 dp).
  - `trust_account` is summed across chains.
  - The null rule follows Open question 1.

**Part B — EVM sources for `in_transit` / `withdrawal_queue`**

- Worker EVM indexer: track USDC ERC-20 `Transfer` logs as `AssetTransfer` rows, with the same
  semantics as Stellar (#789 / #933):
  - internal custody↔ramp movements, where both sides are tracked;
  - every transfer touching the withdrawal-queue wallet (the EVM WithdrawalQueue's `assetHolder`,
    `docs/product-specs/evm-requests-queue.md`), with a running `wallet_balance_after`.
- API EVM config: custody/ramp sets, the withdrawal-queue wallet and asset decimals. The
  `/v1/ramp/*` review flow then works for EVM with no route changes, because it already keys on
  `transfer_addresses[chain_id]`.

### Out of scope

- Frontend. LP hooks always send `chain_id`. The Trustee `useCapitalAllocation` pins Stellar.
- #1534, #1535, and the `portfolio` / `dashboard` part of #1538.
- Moving `/v1/ramp/*` or `/v1/dashboard/*` to the new chain extractors.
- Renaming the legacy `CHAIN_<id>_API_STELLAR_*` keys (env-naming spec).
- `liquid_cover` and the remaining `null` buckets (`capital_wallet`, `tbills`) and liquid leaves.

## Assumptions and risks

- **Amounts.** Snapshot and withdrawal amounts are already normalised to 6 dp per chain inside
  the repo reads, so they can be summed across chains. The raw `AssetTransfer` amounts and wallet
  balances are not normalised. capital-allocation normalises them per chain with that chain's
  `asset_decimals`.
- **Unconfigured chain.** For `LenientChainFilter`'s `Unconfigured(id)`, the fan-out runs over
  zero chains, which gives empty or zeroed responses. This matches what these endpoints return for
  an unknown chain today, and the loan book's behaviour.
- **Behaviour change for one client.** The Trustee `useWithdrawalQueue` sends no `chain_id`. It
  moves from `DEFAULT_CHAIN_ID` to all chains. Its consumers read only the summary and `items`,
  and the `chain_id` field is additive.
- **Latency.** The fan-out is sequential (#1530 Resolved decision 2). capital-allocation keeps its
  per-chain `try_join!` inside the loop.
- **EVM log volume.** `EvmEventPoller` filters by contract address only. Adding USDC to the
  address list would pull every USDC transfer on mainnet. The asset address must never enter
  `static_addresses`. Transfers are fetched with topic filters instead (B2): up to 3 extra
  `eth_getLogs` calls per chunk, and only when tracking is configured.
- **Address form.** The EVM worker stores EIP-55 checksums (`to_checksum(None)`, as
  `WithdrawalRequested.withdrawer` does). The API normalises its EVM address config to EIP-55, so
  the `HashSet` / `=` compares in capital-allocation and ramp match.
- **Balance start.** `wallet_balance_after` starts at 0 from the chain's start block. A wallet
  funded before tracking reads negative. This is documented and not clamped, as on Stellar.

## Implementation steps

### Part A — API

1. **Chain resolution helper** (`routes/common.rs`):
   `LenientChainFilter::configured(&self, all) -> &[ConfiguredChain]`. It returns all chains,
   one chain, or `&[]` for `Unconfigured`. The three handlers iterate over this slice.
2. **withdrawal-queue**
   - `contract_logs_repo.rs`: move the query to a `pub const LIST_WITHDRAWAL_QUEUE_ROWS_SQL`, as
     #1523 / #1526 did. Add `r.chain_id` to the select list and `AND c.chain_id = r.chain_id` to
     the lateral join. Add `chain_id` to `WithdrawalQueueRow`.
   - `routes/withdrawal_queue.rs`: the handler loops over the chains and concatenates the rows.
     `compute_withdrawal_queue` sorts with the tie-break and emits `chain_id` per item.
3. **financial-position** (`routes/financial_position.rs`)
   - The handler loops over the chains. Each chain is skipped when it has no
     `loan_registry_addresses` entry. Snapshots and lifecycle events come from the
     registry-scoped readers (Open question 2).
   - `effective_end` becomes chain-aware.
4. **capital-allocation** (`routes/capital_allocation.rs`)
   - Introduce `pub struct ChainCapitalInputs { chain_id, transfers, addr, asset_decimals,
     withdrawal_queue_balance, capital_transfers }`.
   - `compute_capital_allocation(loans, events, to, &[ChainCapitalInputs])`:
     - `deployed` is checked against a `HashSet<(i64, &BigDecimal)>`;
     - `in_transit` and `withdrawal_queue` are computed per chain and then summed, following the
       null rule;
     - `trust_account` is summed;
     - `total` is folded as today.
   - Remove the `unwrap_or(7)` fallback. Every configured chain then has an `asset_decimals`
     entry (B5).
5. **OpenAPI and module docs**: the three `#[utoipa::path]` blocks and module headers, plus the
   new `chain_id` field doc on items. No new comments elsewhere (AGENTS.md).

### Part B — EVM sources

1. **Worker config** (`indexer/config.rs`, `IndexerJobSettings`), all optional:
   - `JOB_INDEXER_EVM_<id>_ASSET_ADDRESS`: the USDC ERC-20. Setting it enables tracking.
   - `JOB_INDEXER_EVM_<id>_WITHDRAWAL_QUEUE_WALLET_ADDRESS`: the `assetHolder`.
   - `JOB_INDEXER_EVM_<id>_CUSTODY_ADDRESSES` and `JOB_INDEXER_EVM_<id>_RAMP_ADDRESSES`
     (CSV): set both or neither. A partial pair warns and disables only that pair, as on Stellar.
   - Validate them as EVM addresses. Reject an asset address that collides with a core contract
     (`deal_tokens::reject_core_collision` pattern).
2. **Topic-filtered fetch** (`indexer/poller.rs`)
   - Extend `LogFetcher` with `get_filtered_logs(Filter)`.
   - Add an `AssetTransferSource { asset, tracked: Vec<B256>, wallet: Option<B256> }` that builds
     its filters per chunk:
     - `topic0 = Transfer`, `topic1 ∈ tracked`, `topic2 ∈ tracked`;
     - `topic1 = wallet`;
     - `topic2 = wallet`.
   - `fetch_chunk_logs` appends these logs and dedups by `(tx_hash, log_index)`, before its
     existing `(block, log_index)` sort.
3. **Parser** (`indexer/parsers.rs`): ERC-20 `Transfer` → `ContractLog { event_name:
   "AssetTransfer", params: { from, to, amount } }`, with EIP-55 addresses. Register the handler
   in `register_evm_handlers` only when tracking is configured.
4. **Wallet balance**
   - Move `compute_wallet_balance_field` from `indexer/stellar/mappers.rs` to the shared
     `indexer/mappers.rs`.
   - The EVM mapper calls it for `AssetTransfer` when the wallet is configured, with the same SQL
     and `(chain_id, contract_address)` scope.
5. **API config** (`config.rs`, EVM arm of `ChainsConfig::from_env`), keys under the #1526 naming:
   - `CHAIN_<id>_EVM_API_CUSTODY_ADDRESSES`, `CHAIN_<id>_EVM_API_RAMP_ADDRESSES`,
     `CHAIN_<id>_EVM_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS`, and `CHAIN_<id>_EVM_API_ASSET_DECIMALS`
     (default 6, ≤ 18).
   - Addresses are normalised to EIP-55.
   - These feed the existing `transfer_addresses`, `withdrawal_queue_wallets` and
     `asset_decimals` maps.

## Test strategy

Pure tests: no DB, no inline `#[cfg(test)]`.

- `packages/api/tests/withdrawal_queue.rs`
  - two chains with the same `request_id`, where a claim on chain A does not complete chain B;
  - items carry `chain_id`;
  - tie-break ordering;
  - union summary;
  - the SQL const contains the chain-scoped join predicate.
- `packages/api/tests/financial_position.rs`
  - two chains with overlapping `loan_id`, where a `LoanClosed` on chain A does not end chain B's
    loan;
  - the union sums both;
  - single-chain output is byte-identical to today (pin first, as #1530 step 0).
- `packages/api/tests/capital_allocation.rs`
  - overlapping `loan_id`, where the deployed flag on chain A does not deploy chain B's loan;
  - 7 dp and 6 dp chains are normalised per chain before summing;
  - the null rule: all sourced, some sourced, none sourced;
  - `trust_account` is summed;
  - single-chain byte identity.
- `packages/api/tests/chain_param.rs`: `LenientChainFilter::configured` for All, One and
  Unconfigured.
- `packages/api/tests/chains_config.rs`: EVM custody/ramp/wallet/decimals keys are parsed,
  normalised to EIP-55 and defaulted to 6; a partial pair is disabled; a Stellar-kind key on an EVM
  chain is rejected.
- `packages/worker/tests/`
  - the ERC-20 `Transfer` parser;
  - `AssetTransferSource` filter construction;
  - `fetch_chunk_logs` with the existing `FakeFetcher` (filtered logs merged, deduped and sorted;
    the asset never in the address-only call);
  - worker config parsing and collision rejection.
- Run `cargo clippy --all -- -D warnings`, `cargo fmt --all --check` and `cargo test`.

## Progress (2026-10-16)

- [x] Part A: `LenientChainFilter::configured`, withdrawal-queue (chain-scoped claim join in
  `LIST_WITHDRAWAL_QUEUE_ROWS_SQL`, `chain_id` on items, tie-break), financial-position and
  capital-allocation fan-out with registry-scoped readers, chain-aware `effective_end`, per-chain
  `ChainCapitalInputs`.
- [x] Part B: worker `EvmAssetTracking` config, `add_filtered_event_handler` /
  `fetch_filtered_logs`, `indexer/asset_transfers.rs`, the shared `compute_wallet_balance_field`,
  and the API's EVM capital-source keys.
- [x] Tests, docs, `.env.example`. `cargo clippy --all --all-targets -D warnings`, `cargo fmt
  --check` and `cargo test --all` (1485 passed) are green.

Deviations from the steps above:

- capital-allocation returns 500 (`ApiError::Internal`) when a configured chain has no
  `asset_decimals` entry. It does not fall back to a scale. Config always inserts one, so the
  error is reachable only through a hand-built `AppState`.
- `api-authorization.md` lists none of these endpoints, so it is not changed.
- `.env.example`: the Stellar `in_transit` comment said "clamped at 0", which contradicts #1027.
  It is corrected.

## Docs to update

- `ARCHITECTURE.md` per-chain paragraph: add these three groups to the LoanBook exception list.
- `docs/product-specs/dashboards.md`: Panel A (financial-position and capital-allocation) and
  Panel C (withdrawal-queue). Cover the chain scope, the union semantics, `chain_id` on items and
  the EVM bucket sources.
- `.env.example`: the new worker and API EVM keys.
- `docs/superpowers/specs/2026-10-09-env-naming-standardization-design.md`: the new keys as
  implemented.
- `routes/ramp.rs` module header: it is no longer Stellar-only.
