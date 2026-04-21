# Dashboards

## Overview

The protocol exposes two dashboard surfaces: an LP Dashboard scoped to the connected LP's position, and a Protocol Dashboard with four panels covering the balance sheet, deployment monitor, withdrawal queue, and yield history.

---

## LP Dashboard

Visible to any LP who connects a whitelisted wallet to the Pipeline app.

**Identity and compliance status**
- Connected wallet address.
- KYC status and Chainalysis freshness (days remaining until re-screening is required).

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

---

## Protocol Dashboard — Panel B: Deployment Monitor

Reads loan identity and immutable parameters from the LoanRegistry on-chain. Reads outstanding principal, accrued interest, days remaining, and equity tranche from the trustee feed. Each field is labelled by its source.

**Per active loan**
- From chain: `loanId`, originator, borrower (hashed), commodity, corridor, original facility size, original senior/equity tranche split.
- From trustee feed: current outstanding principal, accrued interest, days remaining to maturity.
- From chain (mutable): current status, `currentMaturityDate`, `lastReportedCCR` with timestamp.
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
