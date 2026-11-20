# Yield and APY Semantics — Product Spec

Fixes the definitions of every APY / yield figure served by `/v1/pnl`, `/v1/stats`, the LoanBook financials and the Protocol Dashboard (#1634). Contract facts: Minter `repay` mints `interest` into the vault for a non-carved-out loan (raises the share price, LP yield) and into the Pocket for a carved-out (defaulted) loan (no share-price effect); fees (`mgmt + perf + oet`) are staked for the treasury (no share-price effect). Legacy `YieldMinted` carried `s_plusd_amount` (vault) and `treasury_amount` (fees).

## /v1/pnl avg_apy

Time-weighted return of the wallet's share-price exposure, `shared::time_weighted_return::time_weighted_apy`:

- Holding intervals come from `position_events` (`PositionRepo::get_balance_events`): an interval opens at the first event with `shares_balance > 0` and closes at the event that takes it to `0` (still open = until now). Partial buys or sells inside an interval do not split it.
- Prices come from `share_prices` (`PositionRepo::get_share_price_series`): the price at a boundary is the latest sample at or before it. `get_share_price_series` is bounded to the wallet's first holding event (samples from then on plus the single latest sample before it). A holding that starts before the first price sample is clipped to start at that sample; an interval that ends before the first sample contributes nothing (neither return nor time).
- `avg_apy = exp(Σ ln(price_end / price_start) × 365 d / total_held_secs) − 1`, i.e. `Π(price_end / price_start)` annualised over the total held time. It is independent of buy timing and time out of the vault is excluded; realised PnL is included implicitly (it is part of the price path).
- Several vaults on a chain are pooled the same way: all intervals multiply and their held seconds add.
- `null` when the usable held time (after clipping) is under **7 days**, the same minimum as `/v1/stats` (`MIN_APY_SPAN_SECS`), or no interval has prices. Event rows with a `NULL` `shares_balance` are ignored, never treated as a zero balance. The year stays 365 days (#1630 owns the year length).

## /v1/stats apy

Linear (simple-interest) annualisation: `(p_latest / p_oldest − 1) × 365 / days`, where `p_oldest` is the oldest price inside the `apy_days` window and `days` the span between it and the latest price. `null` when that span is under **7 days** (a short bump no longer annualises to a huge figure). The year length is #1630's.

## Per-loan minted_yield

`/v1/loan-book/{id}/financials` `minted_yield` = legacy `YieldMinted` `s_plusd_amount + treasury_amount` (missing key counts as 0) + Minter `CashRepaid.interest_minted` + the `PaymentRecorded` fee leg, net of reversals. This is consistent with `not_minted_yield = interest + fees + OET − minted_yield`; a legacy 100 + 33 repayment of 100 interest and 33 fees leaves `not_minted_yield = 0`.

## Dashboard cumulative yield

`cumulative_yield_total` and `/v1/dashboard/yield-history` are **LP yield only**:

- legacy `YieldMinted.s_plusd_amount`;
- plus `CashRepaid.interest_minted` of repayments whose loan has no registry `LoanDefaulted` ordered before the repayment by `(block_number, log_index)` (a default in the same block but after the repayment does not carve it out; the contract never resets the carve-out flag, even after a cure). Carved-out interest is minted to the Pocket (claimable by snapshot holders) and is excluded from LP yield, except on a Stellar chain with `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS` set (below);
- net of `CashRepaymentReversed`, normalised per loan by chain kind as before;
- fees (`PaymentRecorded` fee leg, legacy `treasury_amount`) excluded.

It therefore intentionally no longer equals Σ LoanBook `minted_yield`: the 100 + 33 example is 100 here and 133 per loan, and a carved-out repayment's interest counts in `minted_yield` but not here.

**Stellar with the pocket key (#1789).** When `kind == Stellar` and the chain has `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS`, recovered interest also counts: the `CashRepaid.interest_minted` of carved-out repayments (equal to `PocketReleased.interest`) is booked at release, that is at the `CashRepaid` timestamp, and netted at its `CashRepaymentReversed` (equal to `PocketUnreleased`). Recovered principal is not yield. EVM chains, and Stellar chains without the key, keep the definition above unchanged. `cumulative_yield_total` keeps its 6-decimal formatting, so the empty state is still `"0.000000"`.

## /v1/pnl pocket_recovered

`pocket_recovered` (#1789) is the sum of the wallet's `PocketClaimed.paid` (principal plus interest, raw PLUSD, the unit of `total_realized_pnl`) on the requested chain, matched on the wallet's exact `G…` string. `/v1/pnl` accepts only `G…` wallets (`normalise_wallet` rejects a `C…` address with 400), so a `C…` holder's claims are served only by `GET /v1/requests` `pocket_claims`, never in `pocket_recovered`. It is realised at claim time. It is `null` on EVM and on a Stellar chain without `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS`. When non-null:

- `total_realized_pnl = Σ positions.realized_pnl + pocket_recovered`;
- `total_pnl = total_unrealized_pnl + total_realized_pnl`.

`positions[]` and `avg_apy` are unchanged. The unclaimed claimable amount is excluded: the loss is already in the sPLUSD share price at carve-out. Claims emitted before the pocket key was set are not included. `complete` in the loan-book `pocket` assumes the pocket key stayed configured since the `PocketOpened` ledger; if it was unset for a while, rewind the Stellar cursor within RPC retention (see backend.md "Stellar Pocket indexing").

## Conventions

Amounts are `0` ("0.000000") when empty; rates are `null` when there is no book. `outstanding_in_loans` is `"0.000000"` when nothing is active. `current_apy_net_to_splusd` is `null` only when the gross rate is `null`, and `"0.000000"` when the gross rate is `0` over an outstanding book.
