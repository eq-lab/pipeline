# LP Total Balance

## Overview

`GET /v1/positions/history` serves the data behind the LP home Total Balance card and graph. Besides the sPLUSD share balance and cost basis, each bucket carries the sPLUSD position valued in PLUSD, the PLUSD the LP has escrowed in pending wire-outs (Stellar), and their sum. The frontend does not compute these. The last item of the dense series is the current composite, because the grid ends at `truncate(now)`.

The request surface is unchanged: `wallet`, `days`, `interval`, `chain_id` (required) and the `MAX_SAMPLES` cap. Every new field is additive and optional. `GET /v1/pnl` is unchanged; the "earning" delta on the card keeps binding to `total_pnl`.

## Behavior

**Terms.** All new values are plain decimal strings in whole PLUSD (USD), 6 decimal places, rounded down. There is no exponent form.

| Field | Meaning | Present |
|---|---|---|
| `splusd_value` | `shares_balance / 10^share_decimals ×` the closing share price at that bucket | Always, except when the wallet holds shares and no price sample exists at or before the bucket. `"0.000000"` when it holds no shares |
| `wire_out_escrow` | PLUSD escrowed in the wallet's pending wire-outs at bucket close: requested and not yet settled or cancelled | Stellar chains with `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` only |
| `total_balance` | `splusd_value + wire_out_escrow`, or `splusd_value` alone when escrow is absent | Whenever `splusd_value` is present |

`total_balance` is the sum of the already-rounded terms, so the parts add up exactly. `plusd_balance` is a reserved name for the PLUSD held in the wallet; it is not served, and #1865 adds it and includes it in `total_balance`. Until then a wallet holding only PLUSD shows `total_balance = "0.000000"`, and the card must not label the total as including PLUSD.

**Not in the total.** PLUSD in the withdrawal queue, unclaimed deposit requests, and the LP's pending bank deposits (`pending_bank_deposits` on `GET /v1/lps/me`, #1285). Q3 and #1285 may add them later.

**Closing price.** The vault's `share_prices` are read per bucket: the last sample in the bucket (by timestamp, then block number), plus the single latest sample before the window. A bucket with no sample carries the previous price. A sample that does not parse (an exponent, over 64 characters, negative) counts as missing.

**Escrow fold.** The wallet's minter `WireOutRequested`, `WireOutSettled` and `WireOutCancelled` events become steps: `+amount` at the request, `−amount` at the settlement or cancellation. A settle or cancel whose request is not indexed is never read (the lookup starts from the wallet's requests), so it cannot unbalance the fold. Amounts use the same units as `wire_outs` on `GET /v1/requests` (raw 7-decimal `÷10`, floored to 6 places); a request with a zero or negative amount is ignored with a warning. The running sum is taken per bucket close. If it goes negative or overflows, which the event source does not produce, `wire_out_escrow` is omitted for the whole response and the API logs a warning. If the wire-out read fails, the field is omitted and a warning is logged when the wallet has positions; a wallet with no positions gets the repository error (500) instead of an empty history. EVM chains have no minter API scope (TD-169), so the field is absent there.

**Window and empty rules.**

- With `days` omitted, the window starts at the earlier of the wallet's first position and its first wire-out request.
- `history` is non-empty when the wallet has positions or wire-outs; a wallet with only wire-outs gets a dense series of zero-share items from its first request.
- `vault_address` is read from the chain's `vaults` row whenever `history` is non-empty (EVM lowercased, Stellar as stored). An empty result is `history: []` with `vault_address` absent.

**Stats.** `splusd_value` and `total_balance` on the response are the max, min and time-weighted average over the same grid as `history`, rounded down to 6 places. A stat is omitted when any bucket lacks its column.

**Existing strings.** `shares_balance`, `avg_cost_basis` and `cumulative_realized_pnl`, per item and in their stats, are plain strings when the value's scale is within ±64. For ordinary values the digits are unchanged; this removes the exponent form a negative-scale NUMERIC can produce. A value outside that range keeps the previous (possibly exponent) form rather than expanding to thousands of digits.

**Caveat.** Carry-forward is as trustworthy as event coverage. A missed settle or cancel event leaves the amount escrowed, a confident flat line.

## API Contract

`PositionHistoryItem` gains optional `splusd_value`, `wire_out_escrow` and `total_balance` (strings). `PositionHistoryResponse` gains optional `splusd_value` and `total_balance`, each a `SeriesStat` (`max`, `min`, `average`). Absent fields are omitted from the JSON, not `null`. `plusd_balance` is not in the schema.

## Data Model

No migration and no new configuration key. Reads `position_events`, `share_prices`, `vaults` and the minter events in `contract_logs`. Implementation: `packages/api/src/total_balance.rs`, `share_price_closing_sql` in `packages/shared/src/position_repo.rs`, `wire_out_escrow_steps` in `packages/api/src/minter_cash_book.rs`.
