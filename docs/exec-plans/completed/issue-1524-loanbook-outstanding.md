# Issue #1524: LoanBook readers: outstanding = disbursed − repaid − written_down; waterfall honours interest_adjustment

Source: https://github.com/eq-lab/pipeline/issues/1524

Parent epic: #1520 (LoanBook readers — realign to current indexer events). Siblings planned in
parallel: #1523 (`params.event` field paths), #1525 (per-loan minted yield), #1526 (registry
scoping). Related: #975, TD-132, TD-129. Follow-up that reuses this helper: #1534.

## Scope

### Ground truth (verified 2026-10-15)

- Both shipped LoanRegistry contracts define outstanding senior principal as
  `disbursed − repaid − writtenDown`:
  - EVM `pipeline-contracts/src/loanRegistry/LoanRegistryUpgradeable.sol:656-658` (`_outstanding`).
  - Stellar `pipeline-stellar-contracts/contracts/loan-registry/src/storage.rs:259-262`, `:359`.
- `repaid` is exactly cumulative senior principal repaid on both arms (Stellar `lib.rs:289`
  `repaid += senior_principal_repaid`, `:344` reverses it on un-record; EVM mapper
  `loan_mapper.rs:596` copies `mutable.repaid` into `repayment.senior_principal_repaid`).
  `disbursed` is senior-only (Stellar `lib.rs:192` caps it at `original_senior_tranche`).
- Accrued interest on both arms is
  `max(0, gross − (senior_interest + mgmt_fee + perf_fee) + interest_adjustment)`
  (EVM `:648-649`, Stellar `storage.rs:365`); `interest_adjustment` is a signed, cumulative
  accumulator (a waiver is negative; `adjust_interest`, Stellar `lib.rs:505-530`). It is never
  consumed by repayments, so it is a permanent offset to cumulative gross interest.
- Stellar `validate_repayment` (`lib.rs:853-893`) rejects `senior_interest > accrued_interest`
  and `repaid + senior_principal + written_down > disbursed`.
- All four new events (`Disbursed`, `Undisbursed`, `LoanWrittenDown`, `InterestAdjusted`) are in
  `LOAN_LIFECYCLE_EVENT_NAMES` (`packages/shared/src/contract_logs_repo.rs:15-30`), so they write
  a fresh `snapshot` and are picked by every latest-snapshot query.
- Prod Stellar LoanRegistry `CAQ2LXQV…` (`argocd/pipeline/prod.yaml:261`) runs post-rework WASM
  (queried via `stellar contract info interface`: exposes `disburse`, `write_down`,
  `loan_money`, `set_default(loan_id)` without `ccr`). Test `CDWN5B3F…` is the #36 post-rework
  deploy. Pre-rework rows from the retired test registry `CDYKALTK…` can still sit in
  `contract_logs` on chain `99000001`; see Assumptions and Risks.

### Units at every call site

| Call site | Snapshot source | Scale of every money field |
|---|---|---|
| `loan_book.rs` `build_loan_entry` (~`:1373`) | `list_latest_loan_snapshots_for_chain` | 6-dp, normalised in the repo (`contract_logs_repo.rs:391`) |
| `loan_book.rs` at-risk loop (~`:1615`) | same `loans` slice | 6-dp normalised |
| `ccr_history.rs::loan_snapshot_senior_usd` (`:237-239`) | `list_latest_loan_snapshots_for_chain` | 6-dp normalised, then `/ USDC_SCALE` (1e6) → USD |
| `collateral_valuation.rs::loan_snapshot_senior_usd` (`:380-382`) | `list_latest_loan_snapshots_for_chain` | 6-dp normalised, then `/ USDC_SCALE` (1e6) → USD |
| `waterfall.rs::compute_waterfall` (`:444`, `:478-485`) | `get_loan_snapshot_as_of` | **raw** on-chain (7-dp on Stellar, 6-dp on EVM); deliberately not normalised (`contract_logs_repo.rs:419-423`) because outputs feed `recordPayment` |

The helper is pure arithmetic over three fields of one `LoanSnapshot`, so it is
scale-agnostic: it returns the same scale its input carries. Every caller must pass a snapshot
whose fields are all at one scale (always true: normalisation is all-or-nothing via
`LoanSnapshot::normalize_usdc_for_display`). `interest_adjustment` is read only in the
waterfall, where it is raw like the rest of that snapshot.

### In scope

1. A shared, reusable outstanding helper on `LoanSnapshot` in `packages/shared`
   (`disbursed − repaid − written_down`, floored at 0).
2. Replace the five LoanBook call sites listed above with the helper.
3. Waterfall: apply the signed `interest_adjustment` to cumulative gross senior interest
   (placement per D1), and use the helper for the accrual base and the
   principal cap.
4. Correct the existing doc comments / OpenAPI descriptions that state the old formula on the
   touched DTOs and module docs.
5. Fixture updates and new tests (see Test Strategy).
6. Docs: TD-132, product specs (see Docs to Update).

### Out of scope

- `portfolio.rs:244,254,273`, `capital_allocation.rs:311`, `financial_position.rs:218`
  (deployed/outstanding elsewhere) — #1534, which will call the same helper. Do not touch.
- `loan_financials.rs:243` (`principal` = senior + equity, an original-size figure, not an
  outstanding) and `:253` (`offtaker_outstanding`) — unchanged.
- `loan_book.rs` `total_senior` / `senior_debt_coverage` (Σ **original** senior,
  `:1536`, `:1577-1581`) and `principal_of` — unchanged (D3).
- The accrual-base question of #975 (flat original tranche vs declining outstanding). This
  plan keeps the waterfall's existing declining-balance model and only corrects *which*
  outstanding it declines from. #975 stays open.
- Registry scoping of snapshot queries (#1526), `params.event` paths (#1523), minted yield
  (#1525), the frontend.
- Deduplicating the two identical `loan_snapshot_senior_usd` functions in `ccr_history.rs` and
  `collateral_valuation.rs` (keep the diff minimal; both just call the helper).

## Assumptions and Risks

- **R1 — pre-rework rows read as zero outstanding.** `disbursed`, `repaid`, `written_down`,
  `interest_adjustment` are `#[serde(default)]` (`loan_snapshot.rs:63-75`). A snapshot written by
  a pre-rework parser deserialises them as 0, so after this change such a loan reports
  `senior_outstanding = 0`, drops out of `deployed_senior` / top concentration / at-risk, and its
  CCR becomes `null` (loan book) or `0` bps (`ccr_bps` returns 0 for a non-positive denominator,
  `shared/src/collateral_valuation/mod.rs:216-226`). Prod runs post-rework WASM (verified), so
  prod is unaffected unless it holds rows from an older registry. Test chain `99000001` likely
  still holds rows from the retired `CDYKALTK…` registry; #1526 (scope snapshot queries to the
  configured registry) removes those from every reader. No legacy fallback (D2).
- **R2 — behaviour change for `Approved` loans.** An `Approved` (not yet disbursed) loan now
  reports outstanding 0, not its full tranche: loan book `senior_outstanding = "0.000000"`,
  `ccr_bps = null`, excluded from `deployed_senior`; collateral-valuation / ccr-history CCR
  becomes 0 bps (`ccr_bps` zero-denominator rule) rather than a figure against an undrawn
  tranche; waterfall accrues 0 interest and returns 0 principal (the contract rejects
  `recordPayment` on `Approved` anyway, `lib.rs:278-283`). This is the intended fix.
- **R3 — new zero floor in CCR routes.** `ccr_history.rs:237` and `collateral_valuation.rs:380`
  do not floor today; the helper floors. Only reachable with an anomalous snapshot
  (`repaid + written_down > disbursed`, which the contract forbids).
- **R4 — normalisation rounding.** Stellar normalisation truncates each field independently
  (`chains.rs:89-96`), so normalised outstanding can differ from `trunc((d − r − w) / 10)` by
  at most 2 micro-USDC. It cannot go negative (sum of truncations of a non-negative
  difference is ≥ 0); the floor covers it anyway. Display-only; acceptable.
- **R5 — interest-adjustment edge.** With the decided placement (D1, option A), a waiver
  larger than `gross − management_fee` clamps the net coupon target at 0 while the management
  fee target stays positive, so the interest tier can exceed the contract's
  `accrued_interest`. The contract caps only `senior_interest` against `accrued_interest`, and
  fees separately against `max_fee_bps` (`lib.rs:872-882`), so the baseline stays recordable in
  that edge only if `max_fee_bps` allows it. The Trustee may override components (flow note A).
  Pinned by a test so the behaviour is explicit.
- **R6 — waterfall gross is still an approximation of the contract's gross** (compound vs
  linear, today's outstanding applied to every epoch; module docs `waterfall.rs:14-35`,
  `:436-443`). Unchanged by this plan; only the outstanding definition moves.
- **R7 — sibling merge conflicts.** #1523 and #1526 edit `contract_logs_repo.rs`; #1525 may edit
  `loan_financials.rs` / `contract_logs_repo.rs`. This plan does not edit
  `contract_logs_repo.rs`, so conflicts should be limited to `docs/exec-plans/tech-debt-tracker.md`
  if a sibling also edits it. No blocking dependency.
- **A1 — `snapshot.repaid` (not `repayment.senior_principal_repaid`) is the subtrahend**, per
  the issue and the contract. They are equal on post-rework rows on both arms (Ground truth).
- **A2 — no DB in tests.** All new tests are pure unit tests on `LoanSnapshot`,
  `compute_loan_book` and `compute_waterfall`. No `DATABASE_URL` / `POSTGRES_URL` / env access.

## Resolved decisions (human, 2026-10-15)

- **D1 (was Q1) — option A.** `interest_adjustment` is added to cumulative gross senior
  interest before the fee split:
  `senior_gross_interest_cum = max(0, trunc(piecewise_interest(..)) + s.interest_adjustment)`.
  `management_fee_cum` is unchanged (it depends only on principal). `performance_fee_cum` and
  `senior_coupon_net_cum` are derived from the adjusted gross. The interest-tier total then
  equals the contract's `gross − recorded + interest_adjustment`.
- **D2 (was Q2) — no legacy fallback.** Pre-rework snapshots (with `disbursed`, `repaid` and
  `written_down` defaulted to 0) read as 0 outstanding. #1526 adds address-scoped repo variants
  for the LoanBook routes and keeps the existing unscoped methods for other callers. This does
  not affect the helper.
- **D3 (was Q3) — `senior_debt_coverage` unchanged.** It keeps dividing by Σ original senior.

### Addendum (human, 2026-10-15, review fixes)

- **R1 — CCR null for zero outstanding.** `routes::collateral_valuation::outstanding_senior_usd`
  returns `None` when `disbursed − repaid − written_down` is 0; both `loan_snapshot_senior_usd`
  (collateral valuation) and the `ccr_history` twin use it, so CCR is null for an undrawn or
  fully repaid loan, consistent with `GET /v1/loan-book`.
- **R2 — fee cap mirrors `validate_repayment` / `_validateRepayment`.** Both contracts enforce
  per payment `mgmt_fee + perf_fee + oet_alloc ≤ floor((senior_interest + mgmt_fee + perf_fee) ×
  max_fee_bps / 10_000)` (Soroban `lib.rs:877-882`, EVM `LoanRegistryUpgradeable.sol:571-572`;
  OET counts toward the fees, the cap base is the coupon plus mgmt and perf). The waterfall
  applies it after the interest-tier split: mgmt and perf are scaled proportionally down to
  `floor(coupon × cap / (10_000 − cap))` when they exceed it, then OET is trimmed to the room
  left. Freed amounts cascade to the equity residual, so the payment still sums to `amount`.
  D1 is unchanged for the normal case; the cap only bites when fees would be rejected.
- **R2 assumption — `max_fee_bps` is a per-registry admin setting** (`set_max_fee_bps` /
  `setMaxFeeBps`) that the API neither indexes nor reads, and no repo-documented default exists.
  Deployed configs differ: Hoodi EVM `5000` (`ChainValues.sol`), Anvil and Stellar tests `2000`.
  The API uses `ASSUMED_MAX_FEE_BPS = 5000` (the live Hoodi value). A registry configured lower
  can still reject a suggestion; the Trustee override (flow note A) covers that, and indexing
  the value is the proper fix if needed.
- **R3 — `senior_principal_fully_repaid`** is `true` only when `disbursed ≥
  original_senior_tranche` and outstanding after this payment is 0, so an Approved or partly
  drawn loan whose drawn amount is repaid is not reported as fully repaid. The contracts expose
  no such flag; this is an API-level definition.

## Open Questions

_None_

## Implementation Steps

Follow the project rules: comment-less code (no new doc comments or inline comments; existing
comments that state the old formula are corrected in place, not expanded), tests only under
`packages/<pkg>/tests/<topic>.rs`.

1. **Shared helper** — `packages/shared/src/loan_snapshot.rs`, in the existing
   `impl LoanSnapshot` block, add:

   ```rust
   pub fn outstanding_senior_principal(&self) -> BigDecimal {
       (&self.disbursed - &self.repaid - &self.written_down).max(BigDecimal::zero())
   }
   ```

   Import `bigdecimal::Zero` (or use `BigDecimal::from(0)`). No doc comment. It is a method on
   `LoanSnapshot` so #1534 can call `lv.row.snapshot.outstanding_senior_principal()` with no
   further plumbing. Scale-agnostic (see Units table).

2. **Loan book** — `packages/api/src/routes/loan_book.rs`:
   - `build_loan_entry` (~`:1370-1374`): `let outstanding_senior = s.outstanding_senior_principal();`
     Replace the three-line comment above it with a one-line correction only if needed; do not
     add new commentary.
   - At-risk loop (~`:1613-1616`): `at_risk_wl_and_default_senior += s.outstanding_senior_principal();`
     and drop the now-redundant floor comment.
   - Correct the formula text in the existing DTO docs (these feed OpenAPI):
     `LoanBookSummary.deployed_senior` (`:119`), `at_risk_wl_and_default_senior` (`:133`),
     `LoanBookEntry.senior_outstanding` (`:188`), `original_senior_tranche` (`:193`, "net of
     repayment" → "net of repayment and write-down; zero until disbursed"). New text:
     `disbursed − repaid − written_down`, floored at 0.
   - Leave `total_senior`, `senior_debt_coverage`, `principal_of` alone (D3).

3. **CCR history** — `packages/api/src/routes/ccr_history.rs:237-239`:
   `Ok(Some(row.snapshot.outstanding_senior_principal() / BigDecimal::from(USDC_SCALE)))`.
   Snapshot is 6-dp normalised, so `/ 1e6` → USD as before. Fix the formula in the doc comment
   at `:218-221`.

4. **Collateral valuation** — `packages/api/src/routes/collateral_valuation.rs:380-382`: same
   change as step 3. Fix the formula in the doc comment at `:358-360`.

5. **Waterfall outstanding** — `packages/api/src/routes/waterfall.rs`:
   - `:444-447`: `let outstanding = s.outstanding_senior_principal();` (raw base units — the
     snapshot from `get_loan_snapshot_as_of` is not normalised); keep
     `let senior_deployed = &outstanding;`. Remove the "Never negative" comment (the helper floors).
   - Module docs `:18-19`: `senior_deployed = disbursed − repaid − written_down` (the
     contract's outstanding). `:84-86`: the principal cap now keeps cumulative `repaid +
     written_down` within `disbursed` (matches `validate_repayment`'s
     `RepaidExceedsDisbursed`), not within `original_senior_tranche`.
   - `WaterfallResponse.senior_principal_fully_repaid` doc (`:196-199`) and the matching
     wording: "brings outstanding senior principal (`disbursed − repaid − written_down`) to zero".

6. **Waterfall interest adjustment** (option A, D1) — `compute_waterfall`:
   - `:453`: `let senior_gross_interest_cum = (trunc(&piecewise_interest(&epochs, senior_deployed, as_of)) + &s.interest_adjustment).max(BigDecimal::zero());`
     `interest_adjustment` is a whole raw base unit (signed `i128`/`int256` on-chain), so no
     extra truncation is needed; it shares the snapshot's raw scale.
   - Everything downstream (`perf_base`, `performance_fee_cum`, `senior_coupon_net_cum`, stage-2
     clamps, proportional split) stays as is and now sees the adjusted gross.
   - Module docs stage 1 (`:27-31`): add one bullet line
     `senior_gross_interest = max(0, Σ epochs … + interest_adjustment)` (signed; a waiver is
     negative) — replace the existing bullet rather than adding prose.

7. **Tests** — see Test Strategy; fixture changes are required for existing tests to keep their
   current expectations.

8. **Docs** — see Docs to Update.

9. **Verify** — `cargo fmt --all`, `cargo clippy --all -- -D warnings`,
   `cargo test -p shared --test loan_outstanding`, `cargo test -p pipeline-api --test loan_book --test waterfall --test ccr_history --test collateral_valuation`,
   then `cargo test --workspace` (no DB env set). `npx tsx scripts/lint-docs.ts` after the doc edits.

## Test Strategy

All pure unit tests; no `DATABASE_URL` / `POSTGRES_URL` / env-var DB access, no inline
`#[cfg(test)]`.

### New: `packages/shared/tests/loan_outstanding.rs`

One spec-pointer header line (to this plan). Local builder `snapshot(disbursed, repaid,
written_down)` with deliberately misleading `original_senior_tranche` and
`repayment.senior_principal_repaid` values (e.g. 999_999_999) so the tests prove the helper
ignores them.

- `fully_disbursed_with_no_repayment_is_disbursed` — d=1_000_000 → 1_000_000.
- `approved_loan_with_nothing_disbursed_is_zero` — all 0 → 0.
- `partly_disbursed_loan_is_only_the_disbursed_part` — tranche 1_000_000, d=400_000 → 400_000.
- `undisbursed_reduces_outstanding` — d=600_000 (after 1_000_000 − 400_000 undisbursed) → 600_000.
- `repaid_is_netted` — d=1_000_000, r=300_000 → 700_000.
- `written_down_is_netted` — d=1_000_000, r=300_000, w=200_000 → 500_000.
- `anomalous_over_repaid_floors_at_zero` — d=100, r=80, w=50 → 0.
- `ignores_original_tranche_and_cumulative_senior_principal_repaid` — explicit assert.
- `stellar_normalised_snapshot_yields_six_decimal_outstanding` — raw 7-dp d=100_000_000,
  r=30_000_000 → after `normalize_usdc_for_display(ChainKind::Stellar)` → 7_000_000 (6-dp);
  raw (un-normalised) → 70_000_000 (7-dp). Pins the scale-agnostic contract.
- `legacy_pre_rework_row_reads_as_zero` — deserialise a pre-rework JSON (no `disbursed` etc.)
  and assert 0 (pins R1 explicitly).

### Update: `packages/api/tests/loan_book.rs`

- `make_loan` (`:46-99`): `disbursed: usdc(senior_k * 1_000)` (fully disbursed), keep `repaid` /
  `written_down` 0, so every existing assertion is unchanged.
- Tests that model repaid principal by setting `repayment.senior_principal_repaid`
  (`entry_senior_outstanding_nets_repaid_from_original` `:596`,
  `deployed_senior_and_concentration_use_outstanding_senior` `:682`,
  `original_senior_tranche_is_distinct_from_outstanding` `:807`, and any at-risk test that does
  so) must set `snapshot.repaid` instead (keep the cumulative field equal too, mirroring
  real rows). Rename `entry_senior_outstanding_nets_repaid_from_original` to
  `entry_senior_outstanding_nets_repaid_from_disbursed`.
- New:
  - `approved_loan_has_zero_outstanding_and_null_ccr` — status `Approved`, `disbursed` 0, with
    collateral in the map → `senior_outstanding == "0.000000"`, `ccr_bps == None`,
    `deployed_senior` excludes it, `original_senior_tranche` still the full tranche.
  - `partly_disbursed_loan_outstanding_is_disbursed_part` — senior 80k, disbursed 30k →
    `senior_outstanding == "30000.000000"`, CCR computed against 30k.
  - `undisbursed_lowers_deployed_senior` — two loans, one with disbursed reduced → summary
    `deployed_senior` and `top_concentration.share` follow outstanding.
  - `written_down_default_loan_reduces_at_risk_senior` — `Default` loan, senior 30k fully
    disbursed, `written_down` 10k → `at_risk_wl_and_default_senior == "20000.000000"`.
  - `outstanding_ignores_stale_cumulative_senior_principal_repaid` — `repaid` 0 but
    `repayment.senior_principal_repaid` 30k → outstanding is the full disbursed amount.

### Update: `packages/api/tests/waterfall.rs`

- `snapshot_with_repayment` (`:57-96`): `disbursed: dec(senior_tranche)` and
  `repaid: repayment.senior_principal_repaid.clone()` so all existing expectations hold.
- New (senior 1_000_000 @ 1200 bps, exactly one year, `fees(100, 2000, 50)` — gross 120_000,
  mgmt 10_000, perf 22_000, net 88_000, oet 5_000 baseline):
  - `partly_disbursed_loan_accrues_and_caps_principal_on_disbursed` — disbursed 500_000 →
    gross 60_000, mgmt 5_000, perf 11_000, net 44_000, oet 2_500; large `amount` returns
    principal 500_000 and `senior_principal_fully_repaid == true`.
  - `approved_loan_accrues_nothing_and_returns_no_principal` — disbursed 0 → coupon/fees/oet/
    principal all 0, entire `amount` to `equity_distributed`.
  - `written_down_amount_is_excluded_from_principal_cap_and_accrual_base` — disbursed
    1_000_000, written_down 400_000 → base 600_000 (gross 72_000), principal cap 600_000.
  - `undisbursed_amount_is_excluded` — disbursed 700_000 after undisbursal → base 700_000.
  - `interest_waiver_reduces_coupon_and_performance_fee_not_management_fee` — adj −20_000 →
    gross 100_000, mgmt 10_000, perf 18_000, net 72_000, oet 5_000 (option A).
  - `positive_interest_adjustment_increases_gross` — adj +10_000 → gross 130_000, mgmt 10_000,
    perf 24_000, net 96_000.
  - `waiver_exceeding_gross_clamps_gross_at_zero` — adj −150_000 → net 0, perf 0, mgmt 10_000
    (pins R5).
  - `interest_adjustment_is_cumulative_against_recorded_interest` — second repayment with
    `senior_interest` 50_000 recorded and adj −20_000 → `target_senior_coupon_net = 72_000 −
    50_000 = 22_000` on a full payment.
  - `stellar_raw_scale_interest_adjustment_is_not_normalised` — raw figures ten times the 6-dp case (tranche
    10_000_000, adj −200_000) produce outputs exactly ten times the 6-dp expectations, with no normalisation applied.

### Unchanged but must stay green

`packages/api/tests/ccr_history.rs`, `packages/api/tests/collateral_valuation.rs` (they test the
pure builders; the async `loan_snapshot_senior_usd` wrappers are covered through the shared
helper tests), `packages/shared/tests/loan_snapshot.rs`, `packages/worker/tests/loan_mapper.rs`.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` **TD-132**: mark `[PARTIALLY RESOLVED 2026-10-xx / #1524]`;
  record that all LoanBook readers (`loan_book.rs`, `ccr_history.rs`, `collateral_valuation.rs`,
  `waterfall.rs`) now use `LoanSnapshot::outstanding_senior_principal()` =
  `disbursed − repaid − written_down` (contract definition); remaining sites
  (`portfolio.rs`, `capital_allocation.rs`, `financial_position.rs`) tracked by #1534.
- `docs/product-specs/collateral-valuation.md:118`: "Outstanding senior principal is the
  genesis senior tranche less senior principal repaid" → "disbursed less senior principal
  repaid less written down (`disbursed − repaid − writtenDown`, LoanRegistry's outstanding)".
- `docs/product-specs/loans.md:106-107`: replace "Outstanding Senior principal is
  `originalSeniorTranche − seniorPrincipalRepaid`" with `disbursed − repaid − writtenDown`.
- `docs/product-specs/trustee-dashboard.md` flow note A "Shipped" paragraph (`:72`): state that
  `outstanding_senior_principal` / `senior_deployed` = `disbursed − repaid − written_down` and
  that cumulative gross interest includes the signed `interest_adjustment` (waivers negative).
  Also on the Loans-page row (`:172`), `senior_outstanding` is net of repayment and write-down
  and zero until disbursed.
- No generated OpenAPI artifacts are committed; the DTO doc-comment fixes in steps 2-5 are the
  OpenAPI change.

## Addendum (human, 2026-10-15, integration review)

`GET /v1/loan-book/{loan_id}/valuations` listed `loan_snapshot` in `missing_inputs` whenever collateral was computed and senior was `None`. Since this PR senior is also `None` for zero outstanding (undrawn or fully repaid), so the Trustee saw "Awaiting: loan_snapshot" although the snapshot existed. `build_response` now takes `snapshot_found` and reports `loan_snapshot` only when the loan has no snapshot; zero outstanding leaves `ccr` null with no missing input. `ccr_history.rs` has no `missing_inputs` list (zero outstanding yields empty `points`), so it needed no change. Tests are in `packages/api/tests/collateral_valuation.rs`.
