# Issue #2145: Waterfall: offtaker ceiling reads the as_of snapshot, contracts check current totals (backdated as_of)

Source: https://github.com/eq-lab/pipeline/issues/2145

Parent epic: #2129 (math correctness). Follow-up from the #2132 review (#2123). Builds on #2123 (unconditional offtaker ceiling), #2124 (fee-cap fit), #1547 (`max_fee_bps: Option<u32>`) and #2126 (`LoanAccrual::from_ppm`, per-epoch flooring), all on `main` (branch base `5f622f7e`).

## Scope

`GET /v1/loan-book/{loan_id}/waterfall` (`packages/api/src/routes/waterfall.rs`, `get_waterfall`) loads one snapshot, `get_loan_snapshot_as_of(.., as_of)`, and uses it for everything. When `as_of` is backdated, that snapshot leaves out every lifecycle event indexed after `as_of`: later `PaymentRecorded` / `PaymentUnrecorded`, `Disbursed` / `Undisbursed`, `LoanWrittenDown`, `EconomicsAmended` (interest adjustment), `LoanDefaulted` / cure. The registries validate against the state at **execution time**, so the API can propose a split that `recordPayment` reverts.

### What the frozen contracts check against running state

EVM `pipeline-contracts` `src/loanRegistry/LoanRegistryUpgradeable.sol` (`150631a`, same as `origin/main`): `_recordPayment` (`:309-345`), `_validateRepayment` (`:548-584`), `_accruedInterest` (`:636-650`). Stellar `pipeline-stellar-contracts` `contracts/loan-registry/src/lib.rs` (`e9881ac`; `origin/main` `2291743` is the same): `record_payment` (`:271-315`), `validate_repayment` (`:854-895`), `storage.rs` `accrued_interest` (`:353-372`).

| # | Check (both chains) | State it reads at execution | Waterfall today | Decision |
|---|---|---|---|---|
| 1 | Status in `Performing..=Default` (`_requireStatusRange` / `require_status_range`), else `WrongCurrentStatus` | current `status` | not checked | **Latest** status outside the range is a `400` (human decision 2026-11-20) |
| 2 | Sum of components `== offtakerReceived` (`WrongRepaymentData`) | none | always holds | No change |
| 3 | `status == Default` ⇒ `mgmt + perf + oet + equity == 0` (`NonZeroOnDefault`) | current `status` | as_of `status` | **Latest** status |
| 4 | `seniorInterest ≤ _accruedInterest()` (`InterestExceedsMax`), where `_accruedInterest = max(0, gross(block.timestamp) − recorded(seniorInterest + mgmt + perf) + interestAdjustment)`, and `0` when `Closed` | current gross, current recorded totals, current `interestAdjustment`, current `status` | as_of gross, as_of recorded, as_of adjustment, as_of status | Gross stays at **as_of**. Recorded totals, adjustment and Closed status become **latest** |
| 5 | `mgmt + perf + oet ≤ (seniorInterest + mgmt + perf) × maxFeeBps / 10_000` (`FeesExceedCap`) | current `maxFeeBps` only (per payment, not cumulative) | registry-synced `max_fee_bps` | No change |
| 6 | `repaid + seniorPrincipalRepaid + writtenDown ≤ disbursed` (`RepaidExceedsDisbursed`) | current `disbursed`, `repaid`, `writtenDown` | as_of outstanding | **min(as_of outstanding, latest outstanding)** |
| 7 | `offtakerReceived_total + offtakerReceived ≤ originalOfftakerPrice` (`OfftakerExceedsPrice`) | current cumulative `offtakerReceived` (price is immutable) | as_of `offtaker_received` | **Latest** `offtaker_received` |

Notes on the table:

- Check 4 bounds only `seniorInterest` on both chains. The API bounds `senior_interest + mgmt + perf` by the headroom, which is stricter. That stays as it is.
- `gross(as_of) ≤ gross(execution)`: accrued gross only grows with time (each epoch adds a non-negative floored term). So `gross(as_of) + latest adjustment − latest recorded` never exceeds the contract headroom at execution. That keeps the accrual at `as_of`, as the issue asks, and it is still contract-safe. The as_of recorded totals are **not** safe. Example: payment B (as_of T2) records all interest through T2. A preview of payment A backdated to T1 < T2 sees `gross(T1) − 0 > 0` headroom, but on-chain the headroom is about `gross(now) − gross(T2)` ≈ 0, so A reverts with `InterestExceedsMax`.
- Principal cap uses the minimum for two reasons. Latest outstanding alone would let a backdated payment return principal disbursed only after `as_of`. The as_of outstanding alone reverts after a later repayment or write-down (the issue's second bug).

### The rule after this fix

**Time-integrated accrual uses `as_of`. Every running counter that `recordPayment` checks or updates uses the loan's latest indexed state.**

- **as_of snapshot**, unchanged: `origination_date` check, `genesis_rate_ppm`, the rate/outstanding event timeline (`LoanAccrual`: `accrued_floored_per_epoch`, `outstanding_seconds`), so gross interest, `management_fee_cum`, `oet_allocation_cum`. Also the as_of outstanding used in the principal cap, and `ensure_event_history_complete`.
- **Latest snapshot**, new:
  - `repayment.*` cumulative totals for stage 2 (targets), the interest headroom and stage 3 (offtaker ceiling)
  - `interest_adjustment` for gross cum and headroom
  - `status` for the `Default` branch and the `Closed` headroom zero
  - `disbursed − repaid − written_down` for the principal cap and the `senior_principal_fully_repaid` flag
- `original_offtaker_price` and `original_senior_tranche` are immutable, so either snapshot gives the same value. Read them from the as_of snapshot `s`.

Stage 2 (targets) subtracting the **latest** recorded totals goes beyond what the contracts check. Only senior interest is bounded cumulatively; mgmt / perf / OET are not. It keeps the bookkeeping coherent: when payments are recorded out of order, the sum of recorded fees and OET never exceeds what has accrued. With the as_of totals, A would charge the [origination, T1] fees and OET a second time. See Open Questions.

For the common case, `as_of` omitted or `≥` the last indexed event, both snapshots are the same row, so every existing output stays the same.

After the fix, the waterfall ceiling is `original_offtaker_price − latest offtaker_received`, the same figure `loan_financials.rs` serves as `offtaker_outstanding` from its latest snapshot (display-normalized there). `loan_financials.rs` needs no change.

### Out of scope

- New routes or query parameters (minimal endpoint surface). The route still takes `amount` and `as_of`.
- Rejecting a loan whose latest status is outside `Performing..=Default` was out of scope in the first draft. It is now in scope (Open Questions, step 7).
- Relaxing the API's interest bound from `senior + mgmt + perf` to the contract's `senior` only.
- Contracts (frozen). The 400 message text keeps its "exceeds the loan's outstanding offtaker balance" prefix, so `mapWaterfallError` in `packages/trustee/src/utils/userError.ts` still matches. Trustee copy for the new status 400 was added after review (`mapWaterfallError`, Repayment Recovery dialog).

## Assumptions and Risks

- **Raw scale.** The latest snapshot must be **raw on-chain base units** (7-decimal on Soroban), like the as_of one. `list_latest_loan_snapshots` normalizes USDC for display, so it must **not** be used. Reuse `ContractLogsRepo::get_loan_snapshot_as_of(&state.pool, chain_id, registry, &loan_id, i64::MAX)`. It is the same raw SQL (`LOAN_SNAPSHOT_AS_OF_SQL`, `block_timestamp BIGINT <= $3`), and with `i64::MAX` it returns the newest row (`ORDER BY block_number DESC, log_index DESC LIMIT 1`). There is no new repo method. `get_latest_loan_snapshot` (indexer path, `&mut PgConnection`) would also work but needs a pooled connection; prefer the as_of method.
- **Read race.** The indexer may append a row between the two reads. The latest read is a superset of the as_of read, and a row that lands after both reads is the same staleness the endpoint already has. No transaction is needed.
- **One extra indexed query per call.** It is a single-row lookup on the same index the as_of query uses. The two reads may run concurrently (`tokio::try_join!`).
- **Behaviour change only for backdated `as_of`.** With an `as_of` older than later recorded payments, the API now proposes less interest, fees and OET (possibly 0), caps principal lower, and may reject an amount it used to accept. Each of these previously produced a split that reverted on-chain or double-charged fees.
- **`as_of` before a later disbursement.** The cap uses `min`, so principal returned never exceeds what was outstanding at `as_of`. `senior_principal_fully_repaid` is computed on latest state, so it stays `false` when principal disbursed after `as_of` remains.
- **Signature churn.** `compute_waterfall` gains a parameter (7 total; clippy's `too_many_arguments` fires above 7). There are 34 call sites in `packages/api/tests/waterfall.rs` and 2 in `waterfall_accrual.rs`; the edits are mechanical.
- **Concurrent work.** #1786 Phase 2 (uncommitted in the main checkout, someone else's) touches `packages/api/src/routes/waterfall.rs` (comment-only). Whichever lands second resolves the conflict. Do not touch the main checkout.
- **Comment-less rule.** `waterfall.rs` carries a large pre-existing `//!` header. Edit the sentences this change makes false. Do not add new comments or field docs beyond what is needed to keep the existing doc truthful.

## Open Questions

Resolved by the human on 2026-11-20 (issue comment).

- **Stage-2 targets on latest recorded totals: yes.** Stage 2 subtracts the latest recorded coupon / mgmt / perf / OET totals, so payments recorded out of order never charge the same accrual period's fees or OET twice.
- **BUG-42 is fixed in this PR, not logged.** The waterfall returns `400` when the loan's latest status is outside `Performing..=Default`, the range `recordPayment` accepts on both chains (EVM `_requireStatusRange(.., Performing, Default)` in `_recordPayment`, Stellar `require_status_range(.., Performing, Default)` in `record_payment`; `Approved` and `Closed` give `WrongCurrentStatus`). The check is on the latest status, before the offtaker ceiling. The Closed-status zero in `interest_headroom` is removed because a Closed loan never reaches it.

## Implementation Steps

All paths are relative to the worktree `/Users/aabliazimov/Documents/work/pipeline-fix-2145-waterfall-backdated-ceiling`. Line numbers refer to `5f622f7e`.

1. **Add `LatestLoanState`** in `packages/api/src/routes/waterfall.rs` (pure-core section, next to `WaterfallBreakdown`, `:280-295`):
   ```rust
   #[derive(Debug, Clone, PartialEq)]
   pub struct LatestLoanState {
       pub status: String,
       pub disbursed: BigDecimal,
       pub outstanding_senior_principal: BigDecimal,
       pub interest_adjustment: BigDecimal,
       pub repayment: RepaymentSnapshot,
   }
   impl From<&LoanSnapshot> for LatestLoanState { /* copy fields; outstanding = s.outstanding_senior_principal() */ }
   ```
   Import `shared::loan_snapshot::RepaymentSnapshot`.

2. **`compute_waterfall` signature** (`:340-347`): `compute_waterfall(s: &LoanSnapshot, latest: &LatestLoanState, amount, as_of, fees, rate_events, max_fee_bps)`. Inside:
   - Stage 3 (`:356-363`): `outstanding_offtaker = &s.original_offtaker_price - &latest.repayment.offtaker_received`. Keep the message prefix `"amount ({amount}) exceeds the loan's outstanding offtaker balance"`. The parenthetical prints `latest.repayment.offtaker_received`. It stays unclamped, so an over-received loan still rejects `0`.
   - Principal cap (`:365`): `let principal_cap = s.outstanding_senior_principal().min(latest.outstanding_senior_principal.clone());`. Use it in place of `outstanding` in the cascade (`:458`), the `default_breakdown` call and both `senior_principal_fully_repaid` computations.
   - Accrual (`:366-370`) stays on `s` and `rate_events`, unchanged.
   - Headroom (`:322-328`, `:371`): `interest_headroom(latest, &gross_accrued)` reads `latest.status` (`Closed` → 0), `latest.repayment.{senior_interest,mgmt_fee,perf_fee}` and `latest.interest_adjustment`.
   - `senior_gross_interest_cum` (`:372-373`): `gross_accrued + latest.interest_adjustment`, floored at 0.
   - Stage 2 (`:395-402`): subtract `latest.repayment.{mgmt_fee,perf_fee,senior_interest,oet_alloc}`.
   - Default branch (`:413-414`): `LoanStatus::parse(&latest.status) == Some(LoanStatus::Default)`.
   - Flags (`:462-464`): `senior_principal_fully_repaid = latest.disbursed >= s.original_senior_tranche && &latest.outstanding_senior_principal - &senior_principal_returned <= 0`. `offtaker_fully_received` uses the new `outstanding_offtaker`.

3. **`default_breakdown`** (`:478-509`): take `s` (for `original_senior_tranche`), `latest`, `principal_cap`, `headroom` and `outstanding_offtaker`. Compute the fully-repaid flag the same way as step 2. The Default 400 message prints `principal_cap`.

4. **Handler `get_waterfall`** (`:224-271`):
   - Keep the as_of read. Add `let latest_row = state.contract_logs_repo.get_loan_snapshot_as_of(&state.pool, chain_id, registry, &loan_id, i64::MAX).await?.ok_or_else(|| ApiError::NotFound(..same message..))?;`. It may run with the as_of read in `tokio::try_join!`.
   - `let latest = LatestLoanState::from(&latest_row.snapshot);`, and pass `&latest` to `compute_waterfall`.
   - `ensure_event_history_complete(&row.snapshot, ..)` stays on the as_of row.
   - Rewrite the snapshot comment (`:224-231`) to two or three lines: the as_of snapshot drives accrual; the latest drives the registry's running-state checks (#2145).

5. **Module doc** (`//!`, `:13-89`): update only the sentences this change makes false.
   - Stage 2 (`:30-34`): "the loan's **latest** cumulative `repayment.*` counters".
   - Stage 3 (`:35`): "`original_offtaker_price − latest repayment.offtaker_received`".
   - The principal-cap sentence (`:61-64`): `min(outstanding at as_of, latest outstanding, remaining)`.
   - Contract bounds (`:69-81`): headroom and the Default status use latest state.
   - Add one sentence: accrual runs to `as_of`; every running counter the registry checks comes from the latest indexed snapshot (#2145).
   - Utoipa responses (`:188`): no change.
   - Doc of the `get_loan_snapshot_as_of` repo method (`packages/shared/src/contract_logs_repo.rs:1152-1156`): "Sole caller is `routes::waterfall`" stays true. No edit needed unless it says "once".

6. **Specs.**
   - `docs/product-specs/yield.md`, the paragraph at `:56`, after the headroom sentence: "Accrual runs to `as_of`, but every running counter the registry validates against at execution uses the loan's latest indexed state: cumulative recorded interest, fees and OET (targets and headroom), `interest_adjustment`, `offtaker_received` (ceiling), `Default` status, and `repaid + written_down ≤ disbursed`. Senior principal returned is capped at the smaller of the outstanding at `as_of` and now. A backdated `as_of` therefore never proposes a split that `recordPayment` reverts (#2145)."
   - `docs/product-specs/yield.md:61` (Offtaker-price ceiling): "cumulative `offtaker_received`" becomes "the loan's latest cumulative `offtaker_received`, whatever the `as_of`".
   - `docs/product-specs/trustee-dashboard.md:77`: after "first disbursement→`as_of` (#1630)", add "; ceilings, caps and recorded totals use the loan's latest state (#2145)".

7. **Status range (BUG-42, fixed here).** `compute_waterfall` returns `400` ("loan status is X: a repayment can only be recorded while the loan is Performing, WatchList or Default") when `latest.status` is not one of those three, before the offtaker ceiling. Remove the `Closed` branch of `interest_headroom`. No known-bugs entry. Tests: `latest_status_outside_the_record_payment_range_is_rejected`, `closed_after_as_of_is_rejected_even_though_as_of_state_was_performing`, `approved_at_as_of_but_performing_now_is_accepted`, `performing_and_watchlist_latest_statuses_are_accepted`; `closed_loan_has_no_headroom` becomes `closed_loan_is_rejected_like_the_contract_does`. The Trustee `mapWaterfallError` maps this 400 to status-specific copy (added after review). The handler reads the latest snapshot first, checks the status right away (`ensure_repayable_status`), and reads the `as_of` snapshot only when the latest row is newer than `as_of` (`needs_as_of_read`).

8. **User stories.** Create `docs/user-stories/epic-2129/2145-waterfall-backdated-ceiling.md` (format as `2124-waterfall-fee-cap-interest.md`, Status `Initial`) and add its row to the `## Epic #2129 — Math correctness` table in `docs/user-stories/index.md`. Stories:
   - **Backdated payment after a later one.** The loan has price 1,000,000. Payment B of 600,000 is recorded. Record Repayment for A with an as-of date before B and an amount of 500,000. Expected: `/waterfall` answers `400` ("exceeds the loan's outstanding offtaker balance"), the page shows the "amount is too high" copy, and nothing is recordable. An amount of 400,000 gives a `200` split that `recordPayment` accepts, with `offtaker_fully_received = true`.
   - **Backdated payment after a principal repayment.** B returned 900,000 of 1,000,000 principal. A backdated split returns at most 100,000 principal, and the rest goes to equity.
   - **Backdated payment after interest was paid.** B paid all interest and fees through its date. A backdated split proposes 0 interest, fees and OET, so no `InterestExceedsMax` revert.
   - **Current as-of.** With no as-of, or today's date, the split is unchanged from before.

9. Run `cargo fmt --all`, `cargo clippy --all --all-targets -- -D warnings` and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Pure unit tests only, in `packages/api/tests/`: no `DATABASE_URL` / `POSTGRES_URL` / env vars, no Postgres, nothing inline in `src/`.

**Mechanical update.** Every existing `compute_waterfall` call passes `&LatestLoanState::from(&s)` as the second argument. Use a local helper, e.g. `fn latest(s: &LoanSnapshot) -> LatestLoanState`. This covers `packages/api/tests/waterfall.rs` (34 sites, including the `run` / `run_with` helpers) and `packages/api/tests/waterfall_accrual.rs` (`run` `:117`, `run_amount` `:478`). Every existing assertion must pass unchanged, which shows the no-backdate path keeps its behaviour.

**New tests in `packages/api/tests/waterfall.rs`.** Fixture: `snapshot("1000000", "0", 1200)`, `fees(100, 2000, 50)`, `genesis(&s)`, `Some(MAX_FEE_BPS)`, and `HALF = ORIGINATION + CONTRACT_YEAR / 2` as the backdated `as_of`. At `HALF` on 1,000,000 outstanding: gross 60,000, mgmt 5,000, perf 11,000, coupon 44,000, OET 2,500. Each `latest` is built from a clone of `s` with the post-B fields changed.

1. `issue_2145_backdated_offtaker_ceiling_uses_latest_received` (the issue repro). `s.original_offtaker_price = 1_000_000`, `s.repayment.offtaker_received = 0`. In `latest`, `offtaker_received = 600_000` and `equity_distributed = 600_000`, with no interest recorded so the targets are untouched.
   - `amount = 500_000` returns `Err(ApiError::BadRequest(m))` with `m.contains("exceeds the loan's outstanding offtaker balance")` and `m.contains("600000")`.
   - Control: the same call with `LatestLoanState::from(&s)` is `Ok`. This shows the latest state is what rejects it.
   - `amount = 400_000` against `latest` is `Ok` with `offtaker_fully_received == true`.
2. `backdated_principal_cap_uses_latest_repaid`. In `latest`, `repaid = 900_000`, `repayment.senior_principal_repaid = 900_000` and `offtaker_received = 900_000`. `amount = 1_000_000` at `HALF` gives `senior_principal_returned == 100_000`, `equity_distributed == 837_500` (1,000,000 − 60,000 − 2,500 − 100,000) and `senior_principal_fully_repaid == true`.
3. `backdated_principal_cap_does_not_return_principal_disbursed_after_as_of`. In `s`, `disbursed = 500_000`, with the genesis event at outstanding 500,000. In `latest`, `disbursed = 1_000_000` and outstanding 1,000,000. `amount = 1_000_000` at `HALF` gives `senior_principal_returned == 500_000` and `senior_principal_fully_repaid == false`.
4. `backdated_interest_headroom_uses_latest_recorded_totals`. `latest.repayment` = senior_interest 88,000, mgmt 10,000, perf 22,000, oet 5,000, offtaker_received 125,000, which is B's one-year interest recorded after `HALF`. `amount = 50_000` at `HALF` gives coupon, mgmt, perf and OET all `0`, and `senior_principal_returned == 50_000`.
5. `backdated_waterfall_uses_latest_interest_adjustment`. `latest.interest_adjustment = -60_000`, `as_of = ONE_YEAR_LATER` (gross 120,000), `amount = 2_000_000`. Expect mgmt 10,000, perf 10,000 and coupon 40,000, summing to `60_000`, and `s.interest_adjustment = 0` is ignored.
6. `loan_defaulted_after_as_of_uses_the_default_split`. `s.status = "Performing"`, `latest.status = "Default"`. `amount = 1_050_000` at `HALF` gives principal 1,000,000, coupon 50,000, and fees, OET and equity all `0`. It succeeds with `max_fee_bps = None` as well.
7. `loan_cured_after_as_of_uses_the_normal_cascade`. `s.status = "Default"`, `latest.status = "WatchList"`. The fees are non-zero and match the Performing fixture.
8. `latest_state_equal_to_as_of_snapshot_is_a_no_op`. For one multi-tier fixture, assert that `compute_waterfall(&s, &LatestLoanState::from(&s), ..)` gives the same breakdown as the pre-change expected values in `full_repayment_one_year_with_fees`. This may be folded into the mechanical update.

For tests 2 and 4, also assert the contract check directly on the split against `latest`. Test 2: `latest.repaid + senior_principal_returned + latest.written_down <= latest.disbursed` (`RepaidExceedsDisbursed`). Test 4: `senior_coupon_net <= max(0, 120_000 − 120_000 + 0)`, the contract headroom at B's execution, a lower bound for any later execution (`InterestExceedsMax`). Both fail on the pre-fix code.

There is no handler or DB test: the second read is a plain reuse of the already-covered `get_loan_snapshot_as_of`.

Commands:

```bash
cargo test -p pipeline-api --test waterfall --test waterfall_accrual --test loan_chain_required
cargo clippy --all --all-targets -- -D warnings
cargo fmt --all -- --check
npx tsx scripts/lint-docs.ts
```

## Docs to Update

- `docs/product-specs/yield.md`, § Waterfall components (`:56`) and § Offtaker-price ceiling (`:61`): accrual at `as_of`, running counters from the latest state, principal cap `min`.
- `docs/product-specs/trustee-dashboard.md:77`: one clause on the latest state (#2145).
- `packages/api/src/routes/waterfall.rs` module doc: stages 2 and 3, the principal cap and the contract-bounds sentences.
- `docs/user-stories/epic-2129/2145-waterfall-backdated-ceiling.md` (new) and its row in `docs/user-stories/index.md`.
