# Issue #1313: Backend: composite Total-Balance series (PLUSD + sPLUSD + USD trust) for the LP home graph

Source: https://github.com/eq-lab/pipeline/issues/1313

Parent epic: #1247 (V1.0). This issue blocks #1282 (the LP home Total Balance card and graph) and
item 3 of #1629 (the portfolio chart shows the share count as dollars, so it needs a sPLUSD value
per bucket). The PLUSD wallet term was split out to #1865; see the "Split out to #1865" section.

## Scope

### Decision: extend `GET /v1/positions/history`

The repo rule is that the frontend does not compute metrics. `docs/frontend/dashboard-components.md`
(`variant="stake-or-add-usd"`) already records that "no combined-total endpoint exists, so summing
PLUSD + sPLUSD client-side is not done". So the composite is served by the backend.

It goes on the existing LP history read, `GET /v1/positions/history`
(`packages/api/src/routes/pnl.rs`). No route is added. The request surface is unchanged:

- query parameters `wallet`, `days`, `interval`, and `chain_id` (required);
- the `MAX_SAMPLES` cap.

Every new field is additive and optional, so today's consumer
(`packages/frontend/src/api/usePositionsHistory.ts`) does not change. The last item of the dense
series is the current composite: each grid point adopts every event bucketed at or before it, and
the last grid point is `truncate(now)`. One response therefore covers both current and historical.

### What exists today (research)

**sPLUSD shares per bucket**
- Source: the `position_events` view, read by `PositionRepo::get_position_history`.
- Served as `shares_balance`, in raw share units.
- No gap.

**sPLUSD share price**
- Source: `share_prices`, filled by the price poller (EVM `convertToAssets`, Stellar
  `convert_to_assets` simulation). Each row is the normalised PLUSD per whole share at one sample.
- The `vaults` row carries `share_decimals` and `asset_decimals`.
- Gap: the price is not joined to the history. Only an average per bucket exists today
  (`get_avg_prices`), not a closing price.

**PLUSD in wire-out escrow (Stellar)**
- The minter events `WireOutRequested`, `WireOutSettled` and `WireOutCancelled` are indexed.
- `ContractLogsRepo::list_lp_wire_out_events` plus `minter_cash_book::build_wire_outs` serve them
  per wallet as `wire_outs` on `/v1/requests` (#1790).
- Gap: they are not in a balance series.
- Stellar only: `minter_addresses` exists only for Stellar chains. EVM has no cash book (TD-169).

**PLUSD wallet balance**
- Not indexed on either chain.
- Moved to #1865.

**`/v1/pnl`**
- Unchanged. The "+$X earning" delta on the card keeps binding to `total_pnl`.

**Contracts** (frozen; `pipeline-stellar-contracts` @ e9881ac, read-only):
- `Minter.record_wire_in` stakes an LP receiver's wire straight into the vault. It shows up as
  sPLUSD shares and needs no separate term.
- An escrowed (minter-receiver) wire-in belongs to no LP until `assign_wire_in`.
- `request_wire_out` moves the LP's PLUSD into minter escrow until the Trustee settles it (the PLUSD
  is burned) or cancels it (the PLUSD is returned).

### Response additions

All new values are plain decimal strings in whole PLUSD/USD, with 6 decimal places, rounded down.

`PositionHistoryItem` gains:

- `splusd_value`
  - Formula: `shares_balance / 10^share_decimals × the closing share price at that bucket`.
  - Omitted only when the wallet holds shares and no price sample exists at or before the bucket.
  - `"0.000000"` when there are no shares.
- `wire_out_escrow` (the "USD trust" term)
  - The PLUSD escrowed in the wallet's pending wire-outs at bucket close: requested and not yet
    settled or cancelled. This definition does not depend on #1285.
  - Raw PLUSD amounts are converted with the vault's `asset_decimals`.
  - Omitted on every EVM chain, and on Stellar chains without
    `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`.
  - Also omitted, with a `warn` log, if the escrow fold goes negative. That would mean a settle or
    cancel was indexed without its request.
- `total_balance`
  - `splusd_value + wire_out_escrow` when escrow is present; otherwise just `splusd_value`.
  - Computed as the sum of the already-rounded terms, so the parts add up exactly to the total.
  - Present whenever `splusd_value` is present.
  - The spec and OpenAPI-facing docs say that the PLUSD wallet term is added by #1865. Until then,
    `total_balance` does not include PLUSD sitting in the wallet.
- **Reserved name:** `plusd_balance` is reserved for #1865 and is not served by this issue.

`PositionHistoryResponse` gains two optional `SeriesStat`s for the chart Y-axis (same pattern as
#1234):

- `splusd_value`
- `total_balance`

Each is the max, min and time-weighted average over the same grid that `history` renders. Each is
omitted when its column is omitted.

### Semantics that change

- **Window start when `days` is omitted:** the earlier of the wallet's first position and its first
  wire-out request (today it is the first position only).
- **When `history` is non-empty:** when the wallet has positions **or** wire-outs (today: positions
  only).
- **`vault_address`:** read from the chain's `vaults` row whenever `history` is non-empty. An empty
  result is still `history: []` with `vault_address` absent.
- **Existing string fields:** `shares_balance`, `avg_cost_basis` and `cumulative_realized_pnl`
  (per item and in the stats) switch to `to_plain_string()`. The digits do not change; this removes
  the exponent form that sqlx can produce for negative-scale NUMERIC.

### Resolved questions (human, 2026-11-09)

- **Q4, split.** This issue ships `splusd_value`, `wire_out_escrow` and `total_balance`, plus the
  two Y-axis stats. All PLUSD indexing and `plusd_balance` move to #1865.
- **Q1, ship `wire_out_escrow` now.** It is defined as the PLUSD escrowed in the wallet's pending
  wire-outs, and it is independent of #1285.
- **Q2 (applies to #1865).** The PLUSD term stays off on testnet. #1865 adds a tech-debt entry and
  a follow-up for a seed job (see the split section).
- **Q3, excluded for now.** Withdrawal-queue PLUSD and unclaimed deposit requests are not part of
  the total. This is to be revisited with #1282's design.
- **#1285 (approved plan).** The LP's pending bank deposits are served as `pending_bank_deposits`
  on `GET /v1/lps/me`, not as `lp_ledger.balance`. They are not added to this total now; they are a
  possible later term.

### Out of scope

- Frontend binding: the #1282 Total Balance card and the #1629 chart and tooltip.
- The PLUSD wallet term (#1865).
- An EVM wire-out escrow term, since the EVM minter has no API scope (TD-169).
- In-flight queue and deposit requests (Q3).
- `pending_bank_deposits` (#1285).
- Any contract change.
- No migration, and no new configuration keys: the escrow term reuses the existing minter key.

### Split out to #1865 (for its planner to reuse)

Moved verbatim from the earlier version of this plan:

- **Migration (additive).** `packages/shared/migrations/<date>_plusd_transfer_holder_indexes.sql`
  with two partial indexes:
  - `CREATE INDEX IF NOT EXISTS idx_contract_logs_plusd_transfer_{from,to} ON contract_logs (chain_id, LOWER(params->>'{from,to}'), block_number, log_index) WHERE event_name = 'PlusdTransfer'`
- **Row shape.** One `contract_logs` row per PLUSD balance-moving event:
  - `event_name = "PlusdTransfer"`
  - params `{ kind: "transfer"|"mint"|"burn"|"clawback", from|null, to|null, amount: "<raw integer>" }`
  - No pre-insert running balance: the balance is folded when read, so cursor rewinds and replays
    are harmless.
- **EVM indexer.**
  - Key: `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS`.
  - New `indexer/plusd_transfers.rs`: a filter on the PLUSD address plus the `Transfer` topic, so it
    is never an address-only `eth_getLogs` call.
  - Mint is `from == 0x0`, stored as `from: null`. Burn is `to == 0x0`, stored as `to: null`.
  - Reject the address if it collides with a core contract role or with the tracked asset.
- **Stellar indexer.**
  - Key: `CHAIN_<id>_STELLAR_INDEXER_PLUSD_ADDRESS`. PLUSD is a SAC.
  - New `stellar/plusd_parsers.rs`, decoding these events:

    | Event | Topics | Field read |
    |---|---|---|
    | `transfer` | `[transfer, from, to, asset]` | value is an `i128` or the muxed map `{amount, to_muxed_id}` |
    | `mint` | `[mint, to, asset]` (CAP-67) or `[mint, admin, to, asset]` (legacy) | `to` is the second-to-last topic |
    | `burn` | `[burn, from, asset]` | `from` |
    | `clawback` | both layouts | `from` is the second-to-last topic |

  - Route the PLUSD contract id in `stellar/poller.rs` before `dispatch_parser`.
  - Since protocol 23 (CAP-67), classic PLUSD operations also emit these events.
- **API.**
  - Keys: `CHAIN_<id>_<EVM|STELLAR>_API_PLUSD_ADDRESS`. They are optional and must equal the
    indexer's key.
  - New `plusd_balance_delta_sql(interval)`:
    - per-bucket signed `to`/`from` sums, output as `::text`;
    - a regex guard on amount strings: `'^[0-9]{1,39}$'`;
    - full history, with no `since` filter.
  - Parse the bucket sums as i128 and fold them with `checked_add`. A negative running balance
    means the coverage is incomplete: omit `plusd_balance` and log a `warn`.
  - Serve `plusd_balance`, and from then on include it in `total_balance` and in the window start.
- **Coverage (Q2).**
  - EVM: rewind the cursor to the PLUSD deploy block.
  - Stellar: the current testnet PLUSD SAC predates Soroban RPC retention. Keep the term off there
    (API key unset).
  - Add a tech-debt entry for the missing per-holder seed, and a follow-up issue for a seed job
    that anchors on SAC `balance(holder)`, like `pocket_seeds`.

## Assumptions and Risks

- **The total excludes wallet PLUSD until #1865.** A wallet holding only PLUSD shows
  `total_balance = "0.000000"`. This is the documented, interim behaviour. #1282 must not label the
  total as including PLUSD before #1865 ships; the spec states this.
- **Trust term coverage.** Wire-outs are folded from minter events indexed since the minter key was
  set. A request indexed without its settle or cancel shows as escrowed until the later event
  arrives. A settle or cancel indexed without its request trips the negative guard, and the field
  is omitted.
- **Carry-forward trust.** As with `shares_balance`, a missed event becomes a confident flat line.
  This is the existing caveat in `docs/references/backend.md`.
- **Price granularity.** Each bucket uses the closing price sample within that bucket. A bucket with
  no sample carries the previous price. The latest bucket uses the latest sample.
- **Query cost.** The handler adds two reads, both run concurrently with `tokio::join!`:
  - closing prices: in-window samples plus one seed row;
  - the wire-out events: already used by `/v1/requests`.
- **Stellar wallet case.** Wire-out lookup lowercases the wallet the same way `/v1/requests` does,
  because `LP_WIRE_OUT_EVENTS_SQL` compares `LOWER(params->>'lp')`.
- **No dependency on #1285.** #1285 may later add `pending_bank_deposits` as a separate optional
  term.

## Open Questions

_None_

## Implementation Steps

New code is comment-less: at most one `// spec:` header per new file, pointing at
`docs/product-specs/lp-total-balance.md`. SQL is defined as `pub fn …_sql()` with needle tests.
Numbers are served as plain strings.

1. **Spec first.** Write `docs/product-specs/lp-total-balance.md`:
   - Overview.
   - Behavior: the terms, how each is gated, rounding, the window and empty rules, the negative
     guard, the reserved `plusd_balance` name ("added by #1865"), and the exclusions from Q3 and
     #1285.
   - API Contract: the new item fields and stats.
   - Keep it under 150 lines and add a row to `docs/product-specs/index.md`.
2. **Closing share prices (`packages/shared/src/position_repo.rs`).**
   - Add `pub fn share_price_closing_sql(interval: &str) -> String`, a `UNION ALL` of two parts:
     - (a) `SELECT DISTINCT ON (DATE_TRUNC('{interval}', block_timestamp))` the closing samples
       with `block_timestamp >= $2`, ordered `block_timestamp DESC, block_number DESC`;
     - (b) the single latest sample with `block_timestamp < $2` (`ORDER BY block_timestamp DESC, block_number DESC LIMIT 1`).
   - Scope both parts to
     `chain_id = $1 AND LOWER(vault_address) = (SELECT LOWER(address) FROM vaults WHERE chain_id = $1)`.
   - Output `bucket, price::text AS price`, ordered by bucket.
   - Add `#[derive(sqlx::FromRow)] pub struct SharePriceBucket { bucket: DateTime<Utc>, price: String }`
     and `PositionRepo::get_share_price_closings(chain_id, interval, since: DateTime<Utc>)`.
3. **Escrow steps (`packages/api/src/minter_cash_book.rs`).**
   - Add `pub fn wire_out_escrow_steps(wire_outs: &[CashBookWireOut]) -> Vec<(i64, i128)>`:
     - `(requested_at, +amount)` for each request;
     - `(settled_at.or(cancelled_at), −amount)` when either is set;
     - sorted by timestamp.
4. **Pure compute (new `packages/api/src/total_balance.rs`, exported from `lib.rs`).**
   - `pub fn parse_bounded_decimal(s: &str) -> Option<BigDecimal>`: reject an empty string, a
     length over 64, `e`/`E`, or more than one `.`; then `BigDecimal::from_str`.
   - `pub fn raw_to_units(raw: i128, decimals: u32) -> Option<String>`:
     - `decimals ≤ 18`, otherwise `None`;
     - exact division by `10^decimals`, then `with_scale_round(6, Down).to_plain_string()`.
   - `pub fn fold_escrow(steps: &[(i64, i128)], interval) -> Option<Vec<(DateTime<Utc>, i128)>>`:
     - bucket each timestamp with `interval.truncate`, then take the cumulative sum with
       `checked_add`;
     - return `None` on overflow or any negative running value.
   - `pub fn composite_window_start(first_position: Option<i64>, first_escrow: Option<i64>) -> Option<DateTime<Utc>>`:
     the minimum of the values that are present.
   - Generalise the grid walk in `routes/pnl.rs`:
     - `walk_grid(interval, start, now, visit)` iterates `truncate(start)..=truncate(now)`, and each
       column carries its own pointer.
     - Columns are positions, prices and escrow. They use the same `<=` adoption rule as
       `walk_history_grid`.
     - `build_history_series` and `compute_position_history_stats` keep their current behaviour,
       so `tests/positions_history.rs` passes unchanged.
   - Inputs:
     `pub struct CompositeInputs<'a> { positions: &'a [PositionHistoryBucket], prices: &'a [SharePriceBucket], escrow: Option<&'a [(DateTime<Utc>, i128)]>, share_decimals: u32, asset_decimals: u32 }`.
   - Builder:
     `pub fn build_composite_history(inputs, interval, window_start, now) -> CompositeSeries { items, splusd_value: Option<SeriesStat>, total_balance: Option<SeriesStat> }`.
     - Apply the presence rules above.
     - Round each term to 6 dp before summing.
     - Compute stats as the time-weighted integral, the same way as
       `compute_position_history_stats`.
     - Emit stats only when every item has the column: a single omitted bucket omits the stat.
     - Parse prices with `parse_bounded_decimal`. A price that does not parse counts as missing.
5. **Handler (`get_position_history` in `routes/pnl.rs`).**
   - Normalise the wallet as today.
   - Read the vault and escrow first, concurrently:
     - `get_vaults(chain_id)`;
     - when `chain.kind == Stellar` and `state.minter_addresses` has the chain:
       `list_lp_wire_out_events(chain_id, minter, &wallet.to_lowercase())`, then
       `build_wire_outs`, then `wire_out_escrow_steps`, then `fold_escrow`. On a fold failure, set
       `None` and log a `warn`.
   - Resolve `since`:
     - `days` given: unchanged.
     - `days` omitted: `composite_window_start(get_first_position_timestamp, first escrow step)`.
   - Apply the `MAX_SAMPLES` check unchanged.
   - Then fetch positions and `get_share_price_closings` concurrently. The closings query takes
     `since` and falls back to the window start.
   - No `vaults` row: return the empty response as today.
   - Build the response. Set `vault_address` from the `vaults` row (Stellar case kept, EVM
     lowercased) when `history` is non-empty.
   - Add the fields to the existing schemas in `PnlDoc`, as optional fields with
     `skip_serializing_if`.
   - Switch the existing strings to `to_plain_string()`.
6. **Docs.** Update the docs listed below. Then run:
   - `cargo clippy --all -- -D warnings`
   - `cargo test -p pipeline-api -p shared`
   - `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`

## Test Strategy

The tests are pure unit tests: no Postgres, and no `DATABASE_URL`, `POSTGRES_URL` or other database
env vars. They live in `packages/<pkg>/tests/<topic>.rs`, never inline.

**`packages/shared/tests/position_repo_composite_sql.rs`**
- Needle tests on the normalised `share_price_closing_sql("hour")` output:
  - `DISTINCT ON (DATE_TRUNC('hour', block_timestamp))`;
  - the seed arm with `block_timestamp < $2` and `LIMIT 1`;
  - `UNION ALL`;
  - `FROM vaults WHERE chain_id = $1`;
  - `price::text`;
  - no `AVG(`.

**`packages/api/tests/minter_cash_book.rs` (extend), for `wire_out_escrow_steps`**
- request then settled; request then cancelled; still pending;
- two overlapping wire-outs;
- ordering is by timestamp.

**`packages/api/tests/positions_history_composite.rs`**
- `splusd_value`:
  - shares × price / 10^share_decimals, rounded down to 6 dp;
  - a price carried across a bucket with no sample;
  - a seed price from before the window;
  - shares > 0 with no price: the field and `total_balance` are omitted, and so are both stats;
  - zero shares with no price gives `"0.000000"`.
- `wire_out_escrow`:
  - requested then settled; requested then cancelled; two overlapping;
  - `None` input omits the field, and the total equals `splusd_value`;
  - a negative fold or an overflow means `fold_escrow` returns `None`.
- `total_balance` equals the sum of the rounded terms, and is present whenever `splusd_value` is
  present.
- Window start:
  - it is the minimum of the first position and the first escrow step;
  - a wallet with only wire-outs gets a dense series from its first request, with zero-share items;
  - empty inputs give an empty history.
- Stats:
  - max, min and time-weighted average for `splusd_value` and `total_balance` match a
    hand-computed series;
  - they are omitted when their column is omitted.
- Parsing:
  - `parse_bounded_decimal` rejects `"1e400"`, `"1E+6"`, a 65-character string, `"1.2.3"` and `""`;
  - `raw_to_units` rejects `decimals = 19`.
- No output string contains `e` or `E`.

**Existing tests**
- `packages/api/tests/positions_history.rs` stays green with unchanged expectations.
- `packages/api/tests/analytics_pnl_positions_chain.rs` (extend):
  - the OpenAPI `PositionHistoryItem` schema has `splusd_value`, `wire_out_escrow` and
    `total_balance` as non-required fields, and does **not** have `plusd_balance`;
  - `PositionHistoryResponse` has both optional stats.

## Docs to Update

- **`docs/product-specs/lp-total-balance.md`** (new), plus a row in `docs/product-specs/index.md`.
- **`docs/references/backend.md`:**
  - In the `GET /v1/positions/history` section:
    - the new fields and stats;
    - the presence rules;
    - the closing-price join;
    - the escrow fold and its negative guard;
    - the window and empty rule change;
    - the reserved `plusd_balance` name ("added by #1865");
    - the exclusions (queue and deposit requests, `pending_bank_deposits`);
    - a pointer to the spec.
  - Remove the sentence saying the series deliberately carries no share-price join. Keep the
    statement that it carries no unrealized PnL.
  - Update the purpose of `/v1/positions/history` in the LP-facing endpoint table.
- **`docs/exec-plans/tech-debt-tracker.md`:** a note under TD-169 that EVM `wire_out_escrow` is
  absent until the EVM minter has an API scope.
- **`docs/user-stories/epic-1247/1313-composite-total-balance.md`** (new, API-level stories):
  - the sPLUSD value per bucket;
  - the escrow term on Stellar with a minter, omitted on EVM;
  - a wallet with only wire-outs gets a history;
  - the total equals the sum of the terms;
  - `plusd_balance` is not served yet;
  - pointers to the automated coverage.
- **Frontend docs:** no change in this issue. #1282 and #1629 bind `total_balance` and
  `splusd_value`, and they update `docs/frontend/dashboard-components.md`, including the sentence
  "no combined-total endpoint exists".
