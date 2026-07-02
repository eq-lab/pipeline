# Dashboards

## Overview

The protocol exposes two dashboard surfaces: an LP Dashboard scoped to the connected LP's position, and a Protocol Dashboard with four panels covering the balance sheet, deployment monitor, withdrawal queue, and yield history.

---

## LP Dashboard

Visible to any LP who connects a whitelisted wallet to the Pipeline app.

**Identity and compliance status**
- Connected wallet address.
- Whitelist status and freshness (days remaining until re-screening is required).

**Position summary**
- Current PLUSD balance.
- Current sPLUSD balance, live sPLUSD → PLUSD exchange rate, and the equivalent PLUSD value of the sPLUSD holding.
- Total deposited, total withdrawn, current net position.

**Yield earned**
- Computed as (current sPLUSD value in PLUSD) minus (cost basis of staked PLUSD), tracked per stake lot.
- Displayed as both nominal PLUSD and time-weighted annualised yield.

**Active withdrawal requests**
- Per-request row: `queue_id`, original amount, `amount_filled`, `amount_remaining`, status.
- No estimated fill time is displayed.

**Transaction history**
- Chronological log of: deposits, PLUSD mints (including any queued via the rate-limit deposit queue with their status), stakes, unstakes, withdrawal requests, partial fills, and final settlements.

**Pending deposits**
- Below-minimum accumulated USDC that has not yet reached the 1,000 USDC mint threshold is shown as "pending deposits — not yet earning yield", alongside the additional amount needed to unlock the mint.

---

## Protocol Dashboard — Panel A: Balance Sheet

**PLUSD supply**
- Total PLUSD outstanding.
- Total sPLUSD outstanding and current sPLUSD → PLUSD exchange rate.

**Capital Wallet reserves**
- USDC balance (units and USD value).
- USYC holding (units and current USD value at issuer's published NAV), shown as a separate line.
- USDC deployed on active loans (from the trustee feed).
- USDC in transit (on-ramp leg in either direction).

**Liquidity ratio**
- Current USDC ratio vs 15% target, with upper band (20%) and lower band (10%) indicators.

**Reconciliation indicator**
- The backing invariant (`PLUSD totalSupply == USDC in Capital Wallet + USYC NAV + USDC out on loans + USDC in transit`) displayed with green / amber / red status (green < 0.01% drift, amber 0.01%–1%, red > 1%).

Served by `GET /v1/financial-position` (aggregate statement of financial position).
Response: `assets` (`liquid` → `cash_stablecoins`, `tokenized_tbills`, `off_chain_usd`;
`deployed` → `secured_loans_outstanding`, `accrued_interest_receivable`), `liabilities`
(`senior_claims` → `plusd_outstanding`; `subordinated_capital` → `junior_tranche`), each with
a rolled-up `total`. Amounts are base-6 decimal strings; a field with no source is served as
`null`. Deployed figures are summed over the active-loan set (same `origination_date ≤ now <
effective_end` rule as the Loan Book): `secured_loans_outstanding` sums each active loan's
senior + equity tranche, `accrued_interest_receivable` sums cumulative `senior_interest`
received (via `PaymentRecorded`), and `junior_tranche` sums the on-chain original equity
tranche — the total Originator first-loss margin across active loans (authoritative figure
is the trustee feed, not yet indexed). In v1 the entire `liquid` block and `plusd_outstanding` are `null` from the REST
endpoint — the Capital-Wallet USDC / USYC / in-transit balances are not indexed,
and PLUSD `totalSupply` has no reliable indexed source (no `Transfer`/mint/burn
events). The frontend overrides the two REST `null` leaves with direct
Stellar/Soroban on-chain reads:

- **PLUSD outstanding** — `plusd.total_supply()` via `useStellarPlusdTotalSupply()`.
  Values are raw i128 bigint at 7-decimal SAC scale; the `1:1 redeemable` caption
  is displayed on the PLUSD row.
- **USDC reserve** — `usdc.balance(reserveAccount)` via `useStellarUsdcReserveBalance()`.
  `STELLAR_RESERVE_ACCOUNT_ID` defaults to empty (unconfirmed reserve holder); the
  row renders `—` until the env var is set.
- **USYC (Tokenized T-bills)** — the identity seam `convertUsycToUsdc` (1:1 stub)
  is in place; with no USYC holding configured, the row renders `—`.
- **Off-chain USD** — renders `—` (off-chain, no source).

Section totals are client-recomputed from sourced rows only (REST deployed/junior +
on-chain USDC/PLUSD). A muted footnote "Excludes assets pending a data source" is
shown while USYC and off-chain USD remain unsourced.

Note: the Liquidity Ratio band, Reconciliation Indicator, and Exchange-Rate line
described above are not implemented in v1 — the panel is exactly the two-column
Statement of Financial Position (Figma `3283:14275`).

---

## Protocol Dashboard — Panel B: Deployment Monitor

Reads loan identity and immutable parameters from the LoanRegistry on-chain. Reads outstanding principal, accrued interest, days remaining, and equity tranche from the trustee feed. Each field is labelled by its source.

**Per active loan**
- From chain: `loanId`, originator, borrower (hashed), commodity, corridor, original facility size, original senior/equity tranche split.
- From trustee feed: current outstanding principal, accrued interest, days remaining to maturity.
- From chain (mutable): current status, `currentMaturityDate`, `ccrBps` with timestamp.
- From chain (location): location type (Vessel / Warehouse / TankFarm / Other), location identifier, and — for vessels — a link to an external maritime tracking platform showing the vessel's current AIS position.
- From trustee feed (off-chain, labelled): equity tranche commitment and source originator.

**Per closed loan**
- All fields above plus: actual maturity date, `closureReason`, realised senior coupon, realised originator residual, realised loss (if any).

**Aggregate metrics**
- Total deployed (sum of outstanding senior principal across active loans).
- Weighted average tenor and weighted average gross rate.
- Commodity mix, corridor mix, originator concentration.

**Real-time event log per loan**
- Chronological list of price feed notifications and status transitions for that loan (watchlist triggers, margin calls, payment delays, AIS blackouts, CMA discrepancies, status transitions).

---

## Protocol Dashboard — Panel C: Withdrawal Queue

- Total queue depth (sum of outstanding escrowed PLUSD across all requests).
- Pending request count, with breakdown of fully pending vs partially filled.
- Oldest pending request age.
- Available USDC in the Capital Wallet vs total queue depth, expressed as a coverage ratio.
- Recent fills: `queue_id`, amount filled, full or partial indicator, time-in-queue.

Served by `GET /v1/withdrawal-queue` (aggregate, sourced from `contract_logs`
`WithdrawalRequested` + `RequestClaimed`). Response: `summary` (`in_queue_usd`,
`requests_count`, `estimated_wait_days`, `liquid_cover`) and `items[]`
(`account`, `amount`, `status` ∈ {`Queued`, `Completed`}, newest first). A request is
`Queued` until a matching `RequestClaimed` exists, then `Completed`; `in_queue_usd` sums
each queued request's `amount`. (The event's `queued` field is a global all-time
cumulative counter, not a per-request magnitude, and is not used for depth.)
`liquid_cover` is served as `null` until a Capital-Wallet USDC-available source exists
(arrives with the Panel A reserves endpoint); `estimated_wait_days` is the mean historical
time-in-queue over completed requests.

---

## Protocol Dashboard — Panel D: Yield History

**Cumulative yield minted**
- Time series of cumulative PLUSD minted into the sPLUSD vault, with two distinct series: loan repayment yield (discrete events per RepaymentSettled) and T-bill yield (weekly discrete events from USYC NAV distribution).

**Real-time T-bill accrual**
- Rolling accrued T-bill yield since the last weekly distribution. Resets to zero after each weekly mint event. Informational only — does not affect sPLUSD NAV until the weekly distribution fires.

**Exchange rate history**
- Time series of the sPLUSD → PLUSD exchange rate.

**Trailing yield**
- Trailing 30-day annualised yield to the senior tranche, with breakdown into loan-yield contribution and T-bill-yield contribution.
