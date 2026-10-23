# Yield and APY Semantics — Product Spec

Fixes the definitions of every APY / yield figure served by `/v1/pnl`, `/v1/stats`, the LoanBook financials and the Protocol Dashboard (#1634). Contract facts: Minter `repay` mints `interest` into the vault for a non-carved-out loan (raises the share price, LP yield) and into the Pocket for a carved-out (defaulted) loan (no share-price effect); fees (`mgmt + perf + oet`) are staked for the treasury (no share-price effect). Legacy `YieldMinted` carried `s_plusd_amount` (vault) and `treasury_amount` (fees).

## /v1/pnl avg_apy

Time-weighted return of the wallet's share-price exposure, `shared::time_weighted_return::time_weighted_apy`:

- Holding intervals come from `position_events` (`PositionRepo::get_balance_events`): an interval opens at the first event with `shares_balance > 0` and closes at the event that takes it to `0` (still open = until now). Partial buys or sells inside an interval do not split it.
- Prices come from `share_prices` (`PositionRepo::get_share_price_series`): the price at a boundary is the latest sample at or before it. An interval with no price at either boundary is skipped (it counts neither return nor time).
- `avg_apy = exp(Σ ln(price_end / price_start) × 365 d / total_held_secs) − 1`, i.e. `Π(price_end / price_start)` annualised over the total held time. It is independent of buy timing and time out of the vault is excluded; realised PnL is included implicitly (it is part of the price path).
- Several vaults on a chain are pooled the same way: all intervals multiply and their held seconds add.
- `null` when total held time is under 1 day or no interval has prices. The year stays 365 days (#1630 owns the year length).

## /v1/stats apy

Linear (simple-interest) annualisation: `(p_latest / p_oldest − 1) × 365 / days`, where `p_oldest` is the oldest price inside the `apy_days` window and `days` the span between it and the latest price. `null` when that span is under **7 days** (a short bump no longer annualises to a huge figure). The year length is #1630's.

## Per-loan minted_yield

`/v1/loan-book/{id}/financials` `minted_yield` = legacy `YieldMinted` `s_plusd_amount + treasury_amount` (missing key counts as 0) + Minter `CashRepaid.interest_minted` + the `PaymentRecorded` fee leg, net of reversals. This is consistent with `not_minted_yield = interest + fees + OET − minted_yield`; a legacy 100 + 33 repayment of 100 interest and 33 fees leaves `not_minted_yield = 0`.

## Dashboard cumulative yield

`cumulative_yield_total` and `/v1/dashboard/yield-history` are **LP yield only**:

- legacy `YieldMinted.s_plusd_amount`;
- plus `CashRepaid.interest_minted` of repayments whose loan has no registry `LoanDefaulted` at or before the repayment timestamp (the contract never resets the carve-out flag, even after a cure);
- net of `CashRepaymentReversed`, normalised per loan by chain kind as before;
- fees (`PaymentRecorded` fee leg, legacy `treasury_amount`) excluded.

It therefore intentionally no longer equals Σ LoanBook `minted_yield`: the 100 + 33 example is 100 here and 133 per loan, and a carved-out repayment's interest counts in `minted_yield` but not here.

## Conventions

Amounts are `0` ("0.000000") when empty; rates are `null` when there is no book. `outstanding_in_loans` is `"0.000000"` when nothing is active. `current_apy_net_to_splusd` is `null` only when the gross rate is `null`, and `"0.000000"` when the gross rate is `0` over an outstanding book.
