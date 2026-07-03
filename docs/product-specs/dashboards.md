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

## Protocol Dashboard — Header

The summary strip at the top of the Protocol Dashboard: TVL card, Cumulative Yield card, Current APY Net to sPLUSD, and Loan Book Yield KPIs. All fields derive from already-indexed contract events. Served by three endpoints in the `GET /v1/dashboard/*` group.

### `GET /v1/dashboard/summary?chain_id`

Five headline KPIs (`tvl`, `outstanding_in_loans`, `current_apy_net_to_splusd`, `loan_book_yield`, `cumulative_yield_total`). USDC amounts are 6dp strings; rates are decimal-fraction strings (e.g. `"0.104000"` = 10.4 %); unavailable fields are `null`.

| Field | Definition | Source |
|---|---|---|
| `tvl` | Σ `DepositRequested.amount` − Σ `WithdrawalRequested.amount` (request-side, v1 proxy) | `contract_logs` |
| `outstanding_in_loans` | Σ (senior + equity tranche) over active loans | `compute_financial_position` |
| `current_apy_net_to_splusd` | Gross book rate × realized net/gross haircut (see below). `null` when no active loans | derived |
| `loan_book_yield` | Principal-weighted gross senior rate. `null` when no active loans | `compute_loan_book` |
| `cumulative_yield_total` | Σ `YieldMinted.s_plusd_amount` (net minted to sPLUSD vault; EVM incl. T-bill leg, Stellar loan-repayment-only — see Multi-chain note) | `contract_logs` |

`target_net_to_splusd` is out of scope — the frontend keeps a static `"8–12%"` label.

**`current_apy_net_to_splusd` formula:** `gross_book_rate × (Σ senior_interest / Σ (senior_interest + mgmt_fee + perf_fee))`. Sums run over all loans with repayment data; falls back to haircut = 1 (net = gross) when no repayments yet. `null` only when no active loans.

**Note:** the frontend currently maps "Current APY Net to sPLUSD" to `/v1/stats` `vaults[].apy`; switching to the effective-haircut rate requires a frontend update (tracked on epic #712).

### `GET /v1/dashboard/tvl-history?days&interval&chain_id`

Returns `[{ timestamp, tvl }]` (oldest first). `tvl(t)` is the running cumulative net flow (Σ deposits − Σ withdrawals up to `t`). `days`/`interval` (`hourly`/`daily`/`weekly`) mirror `/v1/stats/yield`; the sample cap is `MAX_SAMPLES = 1000` (HTTP 400 on overflow); `days=None` → full history from earliest flow event; no events → `200 []`. Final point equals summary `tvl`.

### `GET /v1/dashboard/yield-history?days&interval&chain_id`

Returns `[{ timestamp, cumulative_yield }]` (oldest first). `cumulative_yield(t)` = Σ `YieldMinted.s_plusd_amount` up to `t`. Same query/cap contract as `tvl-history`. Final point equals `cumulative_yield_total`. Distinct from `/v1/stats/yield` (which is a gross accrual estimate — this is net minted).

### Multi-chain `YieldMinted` indexing

`YieldMinted` is indexed on both **EVM** and **Stellar** chains. The `list_yield_mints` repo query (`params->>'s_plusd_amount'`) works identically on both because both chains store `s_plusd_amount` and `treasury_amount` as decimal strings at the top level of `params`.

**Stellar leg:** on Stellar today, `YieldMinted` is emitted only on loan repayment (`s_plusd_amount = repayment.senior_interest`, the net senior coupon; `treasury_amount = mgmt_fee + perf_fee + oet_alloc`). There is no T-bill vault leg on Stellar currently. The Stellar YieldMinter is configured via `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` (optional; ships dark when unset).

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

- **PLUSD outstanding** (LIABILITY) — total PLUSD in circulation, read from Horizon:
  `GET /assets?asset_code=PLUSD&asset_issuer={plusdIssuerId}` → `balances.authorized`.
  The PLUSD SAC has no Soroban `total_supply()` method; Horizon `/assets` is the only
  source. Returns a Horizon human-decimal string (no SAC bigint scaling). The `1:1
  redeemable` caption is displayed on the PLUSD row. Configured via
  `VITE_STELLAR_PLUSD_ISSUER_ID`.
- **Cash — stablecoins (USDC)** (ASSET) — ONLY the USDC in Pipeline's custody
  account, read via a direct Soroban contract call: `usdc_SAC.balance(usdcCustodyId)`.
  Returns a raw i128 bigint at 7-decimal SAC scale; `sacRawToDisplay` converts to
  a human number before formatting. Sentinel guard: if the call returns i64 max
  (~9.2e18), the row renders `—` (issuer account guard). Configured via
  `VITE_STELLAR_USDC_ID` (SAC contract) and `VITE_STELLAR_USDC_CUSTODY_ID`
  (custody G-account); both must be set for a real value to display.
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
