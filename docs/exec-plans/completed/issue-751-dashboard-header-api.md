# Issue #751: Dashboard Header API: summary metrics + TVL and cumulative-yield time series

Source: https://github.com/eq-lab/pipeline/issues/751

Sub-issue of #712 (Protocol Dashboard). Backend flow.

## Scope

Back the **Protocol Dashboard header** (the summary strip above "Statement of Financial
Position"): a TVL card (headline + area chart + "Outstanding in Loans"), a Cumulative Yield
card (headline + chart), and two KPI cards (Current APY Net to sPLUSD, Loan Book Yield).

All decisions are resolved (see Answered Decisions). **No new config and no external inputs** —
every field derives from already-indexed contract events.

### Endpoints (new module `packages/api/src/routes/dashboard.rs`)

**1. `GET /v1/dashboard/summary?chain_id`** — the header KPIs in one call.

| Field | Definition | Source |
|---|---|---|
| `tvl` | Σ `DepositRequested.amount` − Σ `WithdrawalRequested.amount`, as-of now. USDC (6dp string). | `contract_logs` (new repo query). |
| `outstanding_in_loans` | Σ senior tranche outstanding over active loans. | `financial_position::compute_financial_position` → `assets.deployed.secured_loans_outstanding`. |
| `current_apy_net_to_splusd` | **Effective-haircut net rate** (decimal-fraction string, e.g. `"0.104000"`). Formula below. | `loan_book` gross rate × realized net/gross ratio from `PaymentRecorded` events. |
| `loan_book_yield` | Principal-weighted gross senior rate. | `loan_book::compute_loan_book` → `summary.avg_yield`. |
| `cumulative_yield_total` | Σ `YieldMinted.s_plusd_amount`, as-of now (net PLUSD minted to the sPLUSD vault; includes loan + T-bill vault legs). 6dp string. | `contract_logs` (new repo query). |

`target_net_to_splusd` is **out of scope** (dropped; frontend keeps its static `"8–12%"`).

**`current_apy_net_to_splusd` formula** — all inputs from loan registry events, no config:

```
gross_book_rate = loan_book summary.avg_yield          # principal-weighted gross senior rate (active loans)
realized_net    = Σ  repayment.senior_interest         # recorded seniorInterest IS the NET senior coupon (fees carved on-chain)
realized_gross  = Σ (repayment.senior_interest + repayment.mgmt_fee + repayment.perf_fee)
haircut         = realized_gross > 0 ? realized_net / realized_gross : 1.0
current_apy_net_to_splusd = gross_book_rate × haircut
```

- Confirmed semantics: recorded `seniorInterest` = **net** senior coupon (post mgmt+perf);
  `mgmt_fee` + `perf_fee` are the treasury carve-outs — so `realized_gross` reconstructs the
  pre-fee interest. (`operations-console.md`, `yield.md`, YieldMinter v2.3 delta.)
- `haircut` is summed over **all loans on the chain that have recorded repayment data** (not
  just active ones) — bullet loans record nothing until maturity, so restricting to the active
  set would usually leave the ratio undefined. Falls back to `1.0` (net = gross) when the book
  has no repayments yet. `current_apy_net_to_splusd` is `null` only when there are no active
  loans (no `gross_book_rate`).

**2. `GET /v1/dashboard/tvl-history?days&interval&chain_id`** — `[{ timestamp, tvl }]`, where
`tvl(t)` = Σ `DepositRequested.amount` (ts ≤ t) − Σ `WithdrawalRequested.amount` (ts ≤ t): the
running cumulative net-flow. `days`/`interval`/`MAX_SAMPLES` contract identical to
`/v1/stats/yield`. Final grid point equals the summary `tvl` (consistency invariant).

**3. `GET /v1/dashboard/yield-history?days&interval&chain_id`** — `[{ timestamp, cumulative_yield }]`,
where `cumulative_yield(t)` = Σ `YieldMinted.s_plusd_amount` (ts ≤ t): running cumulative net
yield minted to sPLUSD. Same query/cap contract. Final point equals `cumulative_yield_total`.

> **New endpoint, not a reuse of `/v1/stats/yield`.** `/v1/stats/yield` serves a *gross*
> continuous senior-interest *accrual* estimate (`accrued`, from `senior_interest_rate_bps`).
> The header needs the *net minted* figure (post-fee, incl. T-bill) from `YieldMinted`. The two
> series are intentionally different.

### Out of scope
- Indexing Capital-Wallet reserves (the Panel A `liquid: null` gap).
- Splitting cumulative yield by source / real-time T-bill accrual (#738) — the blended
  `YieldMinted` total already includes the T-bill vault leg.
- Frontend header wiring — a separate sub-issue of #712. **Note:** the frontend currently maps
  "Current APY Net to sPLUSD" to `/v1/stats` `vaults[].apy`; switching to this effective-haircut
  rate requires a frontend update (flag on the epic).

## Answered Decisions

1. Build a consolidated `/v1/dashboard/summary` (one round-trip).
2. `tvl` / `tvl-history` = Σ `DepositRequested` − Σ `WithdrawalRequested` (request-side, both
   USDC 6dp), for both the headline and the chart.
3. `target_net_to_splusd` dropped.
4. `cumulative_yield` = Σ `YieldMinted.s_plusd_amount` (net, incl. T-bill vault leg).
5. `current_apy_net_to_splusd` = effective-haircut net rate, all inputs from loan registry
   events (no fee-rate config).

## Assumptions and Risks

- **TVL basis is request-side, not settlement-side** (agreed "for now"). Some deposits sit in
  the rate-limit queue and some withdrawals are unsettled; requested amounts are the v1 proxy.
  Both events carry `amount` in **USDC 6dp** (`analytics.rs`), so the subtraction is unit-safe.
- **`YieldMinted` availability.** Parsed + stored by the EVM indexer (`worker/src/indexer/parsers.rs:359`,
  #442, closed) **and now also by the Stellar indexer** (`stellar/parsers.rs::parse_yield_minted`,
  this issue). On Stellar, `YieldMinted` is loan-repayment-only (no T-bill vault leg today).
  If none exist yet on the chain, `cumulative_yield_total` = `"0.000000"` and the series is
  empty (mirrors `/v1/stats/yield`). The Stellar YieldMinted gap is now closed.
- **Stellar `YieldMinted` config.** Opt-in via `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` env var.
  Ships dark when unset — a no-op on chains where the contract is not yet deployed.
- **Net-APY reads gross until first repayment.** With `haircut = 1.0` fallback, a brand-new book
  reports net = gross; the haircut sharpens as repayments accrue. Acceptable and self-correcting.
- **No new config, no unmerged code deps.** Reuses merged compute fns
  (`compute_financial_position`, `compute_loan_book`) and merged event parsers. Additive module.
- Active-loan set uses the shared `origination_date ≤ now < effective_end` rule for parity.

## Open Questions

_None._ (TVL request-vs-settlement basis resolved to request-side for v1; fee inputs resolved
to event-derived haircut. Both documented above.)

## Implementation Steps

1. **[DONE] Repo queries — `packages/shared/src/contract_logs_repo.rs`.**
   - `list_flow_events(pool, chain_id, to)` → `(block_timestamp, kind, amount)` over
     `DepositRequested` (+) / `WithdrawalRequested` (−), `block_timestamp ≤ to`, ordered by ts —
     powers both the `tvl` sum and the `tvl-history` series.
   - `list_yield_mints(pool, chain_id, to)` → `(block_timestamp, s_plusd_amount)` over
     `YieldMinted` — powers `cumulative_yield_total` and `yield-history`.
   - Realized net/gross for the haircut comes from the existing loan snapshots' `repayment`
     fields (`senior_interest`, `mgmt_fee`, `perf_fee`) — no new query; reuse
     `list_latest_loan_snapshots_for_chain`.
   - Return raw rows; aggregate in pure compute fns (testable without a DB).

2. **[DONE] New module `packages/api/src/routes/dashboard.rs`** — mirror `financial_position.rs`:
   DTOs `#[derive(Serialize, ToSchema)]`, `DashboardDoc` (`#[derive(OpenApi)]`), `router()`,
   `#[utoipa::path]` handlers, base-6 decimal strings, `ChainQuery`/`resolve_chain`, and
   `Interval` + `MAX_SAMPLES` for the two series (copy the ceiling-division cap + 400 message
   from `portfolio::handle_yield`).

3. **[DONE] `GET /v1/dashboard/summary`.** Fetch loan snapshots + lifecycle events + flow/yield rows
   once; assemble:
   - `tvl` ← deposits − withdrawals sum.
   - `outstanding_in_loans` ← `compute_financial_position(...).assets.deployed.secured_loans_outstanding`.
   - `loan_book_yield` ← `compute_loan_book(..., &empty_map).summary.avg_yield`.
   - `current_apy_net_to_splusd` ← new pure fn
     `net_apy(gross_book_rate, &loans)` implementing the haircut formula above.
   - `cumulative_yield_total` ← YieldMinted sum.
   - `null` where no data (no active loans → `current_apy_net_to_splusd`, `loan_book_yield` null).

4. **[DONE] `GET /v1/dashboard/tvl-history`.** Pure fn `compute_tvl_series(flows, from, to, step)`:
   walk the shared sample grid (reuse the `portfolio::compute_series` grid pattern), emit the
   running signed cumulative sum at each grid point. `days=None` → earliest flow event; empty → `200 []`.

5. **[DONE] `GET /v1/dashboard/yield-history`.** Pure fn `compute_yield_series(mints, from, to, step)`:
   same grid walk over `YieldMinted.s_plusd_amount`.

6. **[DONE] Register** in `routes/mod.rs` (`pub mod dashboard;`) and `main.rs` (merge `DashboardDoc`,
   `.nest("/v1", dashboard::router())`).

7. **[DONE] Lint:** `cargo clippy --all -- -D warnings` clean.

8. **[DONE] Stellar `YieldMinted` indexing** — closes the gap where cumulative-yield endpoints
   returned zero on Stellar chains.
   - `packages/worker/src/indexer/stellar/parsers.rs`: add `parse_yield_minted` (u128 map
     decoding via `extract_u128_from_map`; `params` shape matches EVM top-level
     `s_plusd_amount`/`treasury_amount` decimal strings).
   - `dispatch_parser`: new `yield_minter_id: Option<&str>` param; new branch routes
     events to `parse_yield_minted` — flows to `StellarLogMapper` → `contract_logs`.
   - `packages/worker/src/indexer/stellar/poller.rs`: thread `yield_minter_id` through
     `StellarEventPoller` fields, `new(...)`, `poll()` (contract_ids + dispatch call), and
     `run_stellar_indexer_job`.
   - `packages/worker/src/indexer/config.rs`: add `yield_minter_id: Option<String>` to
     `StellarIndexerSettings`; parse from `CHAIN_<id>_STELLAR_YIELD_MINTER_ID`; include in
     role-distinctness check.
   - `packages/worker/tests/stellar_loan_parsers.rs`: three parser tests (happy-path,
     large-u128, wrong-event-name rejection).

## Test Strategy

Compute-layer tests only, in `packages/api/tests/dashboard.rs` — pure functions against
fixtures, **no `DATABASE_URL`/`POSTGRES_URL`/env-gated DB**, no inline `#[cfg(test)]` in `src/`.
Model helpers on `tests/portfolio_compute.rs` / `tests/financial_position.rs`.

- `compute_tvl_series`: empty → `[]`; deposits-only monotone increase; a withdrawal reduces the
  running total; final grid point equals the deposits−withdrawals sum at `to`; `MAX_SAMPLES`
  over-cap returns 400.
- `compute_yield_series`: empty → `[]`; monotone non-decreasing cumulative; final point equals
  the YieldMinted sum at `to`.
- `net_apy` (haircut): no repayments → `haircut = 1.0` → net = gross; a fixture with recorded
  `senior_interest`/`mgmt_fee`/`perf_fee` → net = gross × (net/gross); no active loans → `null`;
  guard `realized_gross = 0`.
- Summary assembly: `null` propagation and unit correctness (USDC 6dp for `tvl` /
  `cumulative_yield_total`, decimal-fraction for the two rates).

## Docs to Update

- `docs/product-specs/dashboards.md`: add a **Protocol Dashboard — Header** section — the five
  fields, exact sources/formulas (esp. the effective-haircut net rate and the `YieldMinted`-based
  cumulative yield), the request-side TVL v1 approximation, and the three endpoints. Note the
  dropped `target_net_to_splusd` and the frontend `current_apy_net_to_splusd` migration.
- OpenAPI: covered by the utoipa registration (surfaces in `/swagger`).
