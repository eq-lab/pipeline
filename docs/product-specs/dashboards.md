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

**Home screen states (epic #1419):** the home route (`/`) renders one of seven states depending on
account/wallet/KYB/balance combinations (full table: [home-screen-states.md](./home-screen-states.md)).
**Precedence rule:** the first matching state wins. The zero state requires **both** no auth session
and no connected wallet; a wallet-connected visitor with no session is its own state (state 7,
#1460 — the wallet is display-only, the visitor registers via the Account page's `Add email` row),
and every other state presupposes a session.

---

## Protocol Dashboard — Header

The summary strip at the top of the Protocol Dashboard: TVL card, Cumulative Yield card, Current APY Net to sPLUSD, and Loan Book Yield KPIs. All fields derive from already-indexed contract events. Served by three endpoints in the `GET /v1/dashboard/*` group.

**Chain scope (#1498).** Every Protocol Dashboard panel and the home stats strip send `chain_id`
of the connected wallet's chain (EVM wallet → `VITE_EVM_CHAIN_ID`, Stellar wallet →
`VITE_STELLAR_CHAIN_ID`); with no wallet connected they use the default chain, which is Stellar for
now. There is no chain selector. The rule lives in one hook (`useActiveChain`, see
[`wallet-flows.md`](../frontend/wallet-flows.md#active-chain-for-protocol-reads)); the dashboard
reads it through `useDashboardChain`.

### `GET /v1/dashboard/summary?chain_id?`

Five headline KPIs (`tvl`, `outstanding_in_loans`, `current_apy_net_to_splusd`, `loan_book_yield`, `cumulative_yield_total`). USDC amounts are 6dp strings; rates are decimal-fraction strings (e.g. `"0.104000"` = 10.4 %); amounts are `0` and rates `null` when empty ([yield-apy-semantics.md](./yield-apy-semantics.md)).

| Field | Definition | Source |
|---|---|---|
| `tvl` | PLUSD in circulation plus pending deposits, from an event-sourced PLUSD supply ledger (#1631), see [dashboards-tvl-ledger.md](./dashboards-tvl-ledger.md) | `contract_logs` |
| `outstanding_in_loans` | Σ (senior + equity tranche) over active loans, `0.000000` when nothing is active (status timeline, [loan-status-timeline.md](./loan-status-timeline.md); same set as `loan_book_yield`) | `compute_financial_position` |
| `current_apy_net_to_splusd` | Gross book rate × realized net/gross haircut (see below). `null` only when the gross rate is `null`; `0` for a `0` gross rate over an outstanding book | derived |
| `loan_book_yield` | Outstanding-senior-weighted gross current senior rate: `Σ(outstanding_senior × current_rate) / Σ outstanding_senior` (see [book-rate-weighting.md](./book-rate-weighting.md)). `null` when no active loans or nothing is outstanding | `compute_loan_book` |
| `cumulative_yield_total` | LP yield: legacy Σ `YieldMinted.s_plusd_amount` + Minter `CashRepaid.interest_minted` of non-carved-out loans, net of `CashRepaymentReversed`; fees excluded — see Yield source below | `contract_logs` |

**Chain scope (#1595).** `chain_id` is optional on all three endpoints, aggregated the way the financial endpoints are (#1530): omitted = the union over every configured chain; a configured id = that chain only; a well-formed id outside `CHAINS` = `200` with a zeroed summary / empty series and no DB call; malformed or repeated = `400`. There is no `DEFAULT_CHAIN_ID` fallback. Amounts (`tvl`, `outstanding_in_loans`, `cumulative_yield_total`, series points) are base-6 USDC per chain, then summed. The rates (`loan_book_yield`, `current_apy_net_to_splusd`) are computed over the union of active loans, so they are outstanding-senior-weighted across chains and `null` only when no chain has an active loan with outstanding senior. Loan snapshots and lifecycle events are read through each chain's `CHAIN_<id>_<TYPE>_API_LOAN_REGISTRY_ADDRESS`. The LP frontend always sends `chain_id`, so it keeps seeing single-chain numbers.

`target_net_to_splusd` is out of scope — no endpoint serves it, so the frontend keeps a static `"8–12%"` label for the "Target Net to sPLUSD" card (#738 seam).

**`current_apy_net_to_splusd` formula:** `gross_book_rate × (Σ senior_interest / Σ (senior_interest + mgmt_fee + perf_fee))`. Sums run over all loans with repayment data; falls back to haircut = 1 (net = gross) when no repayments yet. `null` when no active loans or nothing is outstanding.

**Frontend status (issue #760):** the frontend now consumes all three endpoints. "Current APY Net to sPLUSD" maps to `summary.current_apy_net_to_splusd` (the effective-haircut rate); "Loan Book Yield" maps to `summary.loan_book_yield`. The TVL card replaces the prior "TVL chart — Coming soon" placeholder. The cumulative yield series is backed by `/v1/dashboard/yield-history` (net minted), distinct from the prior `/v1/stats/yield` gross-accrual estimate. The deployment ratio (`outstanding_in_loans / tvl`) is displayed as a progress bar — an approved client-side computation of two backend-served values.

### `GET /v1/dashboard/tvl-history?days&interval&chain_id?`

Returns `{ series: [{ timestamp, tvl }], max, min, average }` (series oldest first). `tvl(t)` is the running sum of the PLUSD ledger up to `t` ([dashboards-tvl-ledger.md](./dashboards-tvl-ledger.md)); a withdrawal leaves TVL at its claim, never at its request. `days`/`interval` (`hourly`/`daily`/`weekly`) mirror `/v1/stats/yield`; the sample cap is `MAX_SAMPLES = 1000` (HTTP 400 on overflow); `days=None` → full history from earliest ledger event; no events → an empty series with zero stats. Final point equals summary `tvl`. Across chains every point is the sum of the per-chain running totals on one grid (the window ends at now); `max` / `min` / `average` are time-weighted over the summed series.

### `GET /v1/dashboard/yield-history?days&interval&chain_id?`

Returns `{ series: [{ timestamp, cumulative_yield }], max, min, average }` (series oldest first). `cumulative_yield(t)` = the yield source below up to `t`, summed over the chains in scope; a repayment reversed at `r` drops out of the series from `r` on. Same query/cap contract as `tvl-history`. Final point equals `cumulative_yield_total`. Distinct from `/v1/stats/yield` (which is a gross accrual estimate — this is net minted).

### Yield source (#1533, #1595, #1634)

Per chain, LP yield only (full definition in [yield-apy-semantics.md](./yield-apy-semantics.md)):

- the historical `YieldMinted.s_plusd_amount` rows already in `contract_logs` (`ContractLogsRepo::list_yield_mints`, normalized to base-6 when read, #901), plus
- `CashRepaid.interest_minted` from `ContractLogsRepo::list_repayment_mints` (protocol-wide) for repayments with no `LoanDefaulted` ordered before them (`(block_number, log_index)`) on the chain's LoanRegistry (carved-out interest is minted to the Pocket), net of the earliest `CashRepaymentReversed`. Fees are excluded, so the total intentionally differs from Σ LoanBook `minted_yield`. A `CashRepaid` with no matching `PaymentRecorded` is excluded, as in `minted_yield` (#1525).

`CashRepaid` amounts are raw on-chain values, normalized per loan with the chain's `asset_decimals` (`CHAIN_<id>_STELLAR_API_ASSET_DECIMALS` default 7, `CHAIN_<id>_EVM_API_ASSET_DECIMALS` default 6). The portfolio `GET /v1/stats/yield` is a per-chain gross-accrual estimate (`chain_id` required), scoped to the chain's current LoanRegistry (#1538).

---

## Protocol Dashboard — Panel A: Balance Sheet

**PLUSD supply**
- Total PLUSD outstanding.
- Total sPLUSD outstanding and current sPLUSD → PLUSD exchange rate.

**Capital Wallet reserves**
- USDC balance (units and USD value).
- USYC holding (units and current USD value at issuer's published NAV), shown as a separate line.
- USDC deployed on active loans (from the trustee feed). `GET /v1/capital-allocation`: `deployed` = Σ senior tranche over loans that are active (originated and Approved / Performing / WatchList, see [loan-status-timeline.md](./loan-status-timeline.md)) **and** Trustee-flagged `is_loan_deployed` (#1027); a past-maturity open loan still counts.
- USDC in transit (on-ramp leg in either direction) and USD held in the trust account. `GET /v1/capital-allocation` (#1027): `in_transit` = gross Trustee-approved custody↔ramp flow of the tracked asset (both legs, absolute, 6-decimal-normalized) minus the per-loan confirmed transfers (`Σ(on_ramp_transferred + off_ramp_transferred)`); `null` unless custody/ramp sets are configured, **not clamped** — may go negative. `trust_account` = `sum(trust_account_deposit) − sum(trust_account_withdrawal)` over the in-scope chains' Trustee-entered `loan_capital_transfers` records (not clamped — see route module docs). `withdrawal_queue` = the withdrawal-queue wallet's indexed USDC balance (on EVM the WithdrawalQueue's `assetHolder`), `null` unless the wallet is configured. The per-loan records are written via the trustee-only full-upsert `POST /v1/loan-book/{loan_id}/transfers` (read back via `GET` on the same path).

**Liquidity ratio**
- Current USDC ratio vs 15% target, with upper band (20%) and lower band (10%) indicators.

**Reconciliation indicator**
- The backing invariant (`PLUSD totalSupply == USDC in Capital Wallet + USYC NAV + USDC out on loans + USDC in transit`) displayed with green / amber / red status (green < 0.01% drift, amber 0.01%–1%, red > 1%).

**Chain scope (financial endpoints).** `GET /v1/financial-position`, `GET /v1/capital-allocation`
and `GET /v1/withdrawal-queue` follow the `GET /v1/loan-book` `chain_id` rule (#1530): omitted = the
union over every configured chain, a configured id = that chain, a well-formed unconfigured id =
200 with an empty or zeroed response, malformed or repeated = 400. Lifecycle events and Trustee
flags only apply to loans on their own chain. `in_transit` and `withdrawal_queue` are normalized
per chain, then summed over the chains that source them (`null` only when none does).

Served by `GET /v1/financial-position` (aggregate statement of financial position).
Response: `assets` (`liquid` → `cash_stablecoins`, `tokenized_tbills`, `off_chain_usd`;
`deployed` → `secured_loans_outstanding`, `accrued_interest_receivable`), `liabilities`
(`senior_claims` → `plusd_outstanding`; `subordinated_capital` → `junior_tranche`), each with
a rolled-up `total`. Amounts are base-6 decimal strings; a field with no source is served as
`null`. Deployed figures are summed over the active-loan set (the same status-timeline rule as the Loan Book, [loan-status-timeline.md](./loan-status-timeline.md); maturity does not end a loan): `secured_loans_outstanding` sums each active loan's
senior + equity tranche, `accrued_interest_receivable` sums cumulative `senior_interest`
received (via `PaymentRecorded`), and `junior_tranche` sums the on-chain original equity
tranche — the total Originator first-loss margin across active loans (authoritative figure
is the trustee feed, not yet indexed). In v1 the entire `liquid` block and `plusd_outstanding` are `null` from the REST
endpoint — the Capital-Wallet USDC / USYC / in-transit balances are not indexed,
and PLUSD `totalSupply` has no reliable indexed source (no `Transfer`/mint/burn
events). The frontend overrides the two REST `null` leaves with direct on-chain reads of the
dashboard chain (Stellar/Soroban or EVM): see
[dashboards-balance-sheet-sources.md](./dashboards-balance-sheet-sources.md).

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

**In Origination tab**
- The Active Loans table is served by `GET /v1/loan-book` with an optional `chain_id` (#1530): omitted = the union over every configured chain with `summary` recomputed over it; a configured id = that chain only; a well-formed unconfigured id = 200 with an empty book; malformed or repeated = 400. The LP frontend currently always sends the dashboard chain.
- Alongside the Active Loans table, the panel exposes an **In Origination** tab listing submitted-but-not-yet-drawn loans. Served by `GET /v1/loan-book/submissions` (public; returns `SubmissionView[]`, newest first, no server-side status filter). The LP frontend sends no `chain_id`, so the tab lists submissions for every target chain; the endpoint filters by target chain only when `chain_id` is sent (configured = filter by the submission's target chain, well-formed but unconfigured = 200 empty, malformed or repeated = 400). Per-loan routes require `chain_id`. The tab shows **only in-flight originations** (#1053): submissions whose normalized status is `InReview`, `ChangesRequested`, or `Rejected` — `Approved` submissions and merged loan-lifecycle statuses (`Performing`, `Closed`, `Past Due`, …) are already loans, belong on the Active Loans tab, and are excluded from the rows and the count badge (mirrors the Trustee origination table, #1044). The table keeps the Active Loans table's visual language but renders its own 8-column field set (issue #814's set minus the Originator column, removed by #1104, plus a Chain column naming each row's `target_chain_id`, #1604; Figma `4116-9155`).
- Row fields are taken directly from the submission's `loan_data` (the verbatim `SubmitLoanRequest`, a nested JSON object): Commodity (`commodity`), Facility (`economics.original_facility_size`, compact USD), Corridor (`corridor`, arrow separator), Rate (`economics.senior_interest_rate_bps`), Maturity (`economics.original_maturity_date`), Submitted (the submission's `created_at`), and Status. No metrics are computed on the frontend — a missing or malformed field renders `—`, never a fabricated value. The Status cell renders a human-readable label, not the backend literal (#1053): `InReview` → "In review", `ChangesRequested` → "Changes requested", `Rejected` → "Rejected"; colour-coded `Rejected` → negative (red), `InReview`/`ChangesRequested` → pending (amber). Both tabs carry a live count badge.

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
(`chain_id`, `account`, `amount`, `status` ∈ {`Queued`, `Completed`}, newest first, ties by
`(chain_id, request_id)`). A request is `Queued` until a `RequestClaimed` on the same chain and
contract exists, then `Completed`; `in_queue_usd` sums
each queued request's `amount`. (The event's `queued` field is a global all-time
cumulative counter, not a per-request magnitude, and is not used for depth.)
`liquid_cover` is served as `null` until a Capital-Wallet USDC-available source exists
(arrives with the Panel A reserves endpoint); `estimated_wait_days` is the mean historical
time-in-queue over completed requests.

---

## Protocol Dashboard — Panel D: Yield History

Split out to [dashboards-yield-history.md](./dashboards-yield-history.md) (size limit).
