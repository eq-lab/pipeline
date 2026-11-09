# LP Total Balance

## Overview

`GET /v1/positions/history` serves the data behind the LP home Total Balance card and graph. Besides the sPLUSD share balance and cost basis, each bucket carries the sPLUSD position valued in PLUSD, the PLUSD the LP has escrowed in pending wire-outs (Stellar), the PLUSD the wallet holds, and their sum. The frontend does not compute these. The last item of the dense series is the current composite, because the grid ends at `truncate(now)`.

The request surface is unchanged: `wallet`, `days`, `interval`, `chain_id` (required) and the `MAX_SAMPLES` cap. Every new field is additive and optional. `GET /v1/pnl` is unchanged; the "earning" delta on the card keeps binding to `total_pnl`.

## Behavior

**Terms.** All new values are plain decimal strings in whole PLUSD (USD), 6 decimal places, rounded down. There is no exponent form.

| Field | Meaning | Present |
|---|---|---|
| `splusd_value` | `shares_balance / 10^share_decimals ×` the closing share price at that bucket | Always, except when the wallet holds shares and no price sample exists at or before the bucket. `"0.000000"` when it holds no shares |
| `wire_out_escrow` | PLUSD escrowed in the wallet's pending wire-outs at bucket close: requested and not yet settled or cancelled | Stellar chains with `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`; EVM chains only when `…_EVM_API_PLUSD_ADDRESS` is set (see Escrow fold) |
| `plusd_balance` | PLUSD held in the wallet at bucket close, folded from its indexed PLUSD movements | Chains with `CHAIN_<id>_<EVM\|STELLAR>_API_PLUSD_ADDRESS` set, and only when the fold is sound (see PLUSD fold) |
| `total_balance` | `splusd_value + wire_out_escrow? + plusd_balance?`: the terms that are present | Whenever `splusd_value` is present |

Without `plusd_balance`, `total_balance` is the sum of the already-rounded terms, so the parts add up exactly. With both `plusd_balance` and `wire_out_escrow`, the PLUSD and escrow are summed in raw asset units and the total is rounded down once, so a wire-out request never moves the total by a rounding step (the displayed parts can differ from it by one 6-dp step). The card labels the total as including PLUSD when `plusd_balance` is present. Without it the total is the #1313 value, unchanged.

**Not in the total.** PLUSD in the withdrawal queue, unclaimed deposit requests, and the LP's pending bank deposits (`pending_bank_deposits` on `GET /v1/lps/me`, #1285). Q3 and #1285 may add them later.

**Closing price.** The vault's `share_prices` are read per bucket: the last sample in the bucket (by timestamp, then block number), plus the single latest sample before the window. A bucket with no sample carries the previous price. A sample that does not parse (an exponent, over 64 characters, negative) counts as missing.

**Escrow fold.** The wallet's minter `WireOutRequested`, `WireOutSettled` and `WireOutCancelled` events become steps: `+amount` at the request, `−amount` at the settlement or cancellation. A settle or cancel whose request is not indexed is never read (the lookup starts from the wallet's requests), so it cannot unbalance the fold. Amounts use the same units as `wire_outs` on `GET /v1/requests` (raw 7-decimal `÷10`, floored to 6 places); a request with a zero or negative amount is ignored with a warning. The running sum is taken per bucket close. If it goes negative or overflows, which the event source does not produce, `wire_out_escrow` is omitted for the whole response and the API logs a warning. If the wire-out read fails, the field is omitted and a warning is logged when the wallet has positions; a wallet with no positions gets the repository error (500) instead of an empty history. EVM chains have no minter API scope (TD-169). Only when `CHAIN_<id>_EVM_API_PLUSD_ADDRESS` is set, the field is served on EVM too, so the total stays continuous when PLUSD moves into the minter: the wallet's `WireOutRequested`, `WireOutSettled` and `WireOutCancelled` rows (same params as Stellar, raw 6-decimal amounts) are read from the minter of the wallet's latest request (`LP_WIRE_OUT_EVENTS_INFERRED_MINTER_SQL`, scoped by chain and matched by the stored EIP-55 wallet); a minter redeploy hides earlier minters' requests (TD-169). Without the PLUSD key EVM output is unchanged.

**PLUSD fold.** Every PLUSD balance movement is one `contract_logs` row (`PlusdTransfer`, see `docs/references/backend.md#plusd-transfer-indexing`). The wallet's rows are read in chain order with a JSON containment match on `from` or `to`, with no `since` filter. Each row is a step: `+amount` when the wallet is the receiver, `−amount` when it is the sender, `0` for a transfer to itself. Raw integer amounts are summed per movement in `i128`, then converted with the vault row's `asset_decimals` (PLUSD: 7 on Stellar, 6 on EVM) and rounded down to 6 places. `asset_decimals` above 18 omits the term. A negative running value at any movement, an overflow, or a malformed or oversized amount omits `plusd_balance` for the whole response and logs a warning; so does `asset_decimals` above 18 or unreadable (warning). The same failed-read rule as the escrow applies, decided on the folded terms: a PLUSD series that fails its fold is not other data, so a failed wire-out read for a wallet with no positions is still a 500. PLUSD in the withdrawal queue is not counted (Q3); a wire-out request moves PLUSD from `plusd_balance` into `wire_out_escrow`, so `total_balance` stays continuous.

**Coverage rule.** A missed movement is a confident wrong line, and the negative guard only catches missed credits. Set the API key only once indexing covers PLUSD from its deployment (EVM: after the cursor is rewound to the PLUSD deploy block). The term is off on Stellar 99000001 and 99000002, whose PLUSD predates the indexer key and Soroban RPC retention, until the starting-balance seed (TD-175, #1878) lands.

**Window and empty rules.**

- With `days` omitted, the window starts at the earliest of the wallet's first position, first wire-out request and first PLUSD movement of the folded series (a PLUSD fold that fails does not stretch it).
- `history` is non-empty when the wallet has positions, wire-outs or PLUSD movements; a wallet with only PLUSD (or only wire-outs) gets a dense series of zero-share items from its first movement.
- `vault_address` is read from the chain's `vaults` row whenever `history` is non-empty (EVM lowercased, Stellar as stored). An empty result is `history: []` with `vault_address` absent.

**Stats.** `splusd_value` and `total_balance` on the response are the max, min and time-weighted average over the same grid as `history`, rounded down to 6 places. A stat is omitted when any bucket lacks its column.

**Existing strings.** `shares_balance`, `avg_cost_basis` and `cumulative_realized_pnl`, per item and in their stats, are plain strings when the value's scale is within ±64. For ordinary values the digits are unchanged; this removes the exponent form a negative-scale NUMERIC can produce. A value outside that range keeps the previous (possibly exponent) form rather than expanding to thousands of digits.

**Caveat.** Carry-forward is as trustworthy as event coverage. A missed settle or cancel event leaves the amount escrowed, a confident flat line.

## API Contract

`PositionHistoryItem` gains optional `splusd_value`, `wire_out_escrow`, `plusd_balance` and `total_balance` (strings). `PositionHistoryResponse` gains optional `splusd_value` and `total_balance`, each a `SeriesStat` (`max`, `min`, `average`). Absent fields are omitted from the JSON, not `null`.

## Data Model

One additive migration, `20261109000001_plusd_transfer_params_index.sql`: a partial GIN index (`jsonb_path_ops`, `WHERE event_name = 'PlusdTransfer'`) serving the `@>` holder lookup. New keys: indexer `CHAIN_<id>_EVM_INDEXER_PLUSD_ADDRESS` / `CHAIN_<id>_STELLAR_INDEXER_PLUSD_ADDRESS` (index PLUSD movements) and API `CHAIN_<id>_EVM_API_PLUSD_ADDRESS` / `CHAIN_<id>_STELLAR_API_PLUSD_ADDRESS` (serve the term; must equal the indexer key, EIP-55 or `C…`). Reads `position_events`, `share_prices`, `vaults` and the minter and `PlusdTransfer` events in `contract_logs`. Implementation: `packages/api/src/total_balance.rs`, `PLUSD_HOLDER_STEPS_SQL` in `packages/shared/src/contract_logs_repo.rs`, `share_price_closing_sql` in `packages/shared/src/position_repo.rs`, `wire_out_escrow_steps` in `packages/api/src/minter_cash_book.rs`.
