# Issue #2123: Waterfall: reject quotational offtaker overpayment like both contracts (OfftakerExceedsPrice)

Source: https://github.com/eq-lab/pipeline/issues/2123

Parent epic: #2129 (math correctness). Siblings in the same file: #2124 (fee-cap interest leak), #1547 (`max_fee_bps` from the registry).

## Scope

`GET /v1/loan-book/{loan_id}/waterfall` (`packages/api/src/routes/waterfall.rs`) rejects an `amount` that pushes cumulative `offtaker_received` past `original_offtaker_price` only when the loan's pricing basis is `Fixed`. For a `Quotational` (metal concentrate) loan it answers `200`, cascades the overage into `equity_distributed` and sets `offtaker_overpaid = true` (#963). Both deployed contracts reject that payment on every loan, so the Trustee is shown a split that `recordPayment` / `record_payment` then reverts.

The contract checks (read-only, frozen):

- EVM `pipeline-contracts` `src/loanRegistry/LoanRegistryUpgradeable.sol` `_validateRepayment` (`:579-583`, `main` at `150631a`): `if (repaymentTotals.offtakerReceived + repayment.offtakerReceived > immutableLoanData.originalOfftakerPrice) revert LoanRegistryOfftakerExceedsPrice(...)`.
- Stellar `pipeline-stellar-contracts` `contracts/loan-registry/src/lib.rs` `validate_repayment` (`:890-894` at `e9881ac`; `:916-920` on `origin/main` `2291743`, unchanged): `if cumulative.offtaker_received + r.offtaker_received > immutable.original_offtaker_price { panic_with_error!(OfftakerExceedsPrice) }`.

Both checks are unconditional: no pricing basis, and they also apply to a loan in `Default`. `original_offtaker_price` is immutable on both chains: no setter, no amend or rollover path rewrites it. So the ceiling is the same for every loan, for its whole life.

What changes:

1. **Stage 3 becomes unconditional.** Any `amount > original_offtaker_price − offtaker_received` is a `400` with the existing message, for every loan, in every status (the check already runs before the `Default` branch).
2. **`offtaker_overpaid` is removed** from `WaterfallBreakdown` and `WaterfallResponse`. After step 1 it can never be `true`. Keeping it as an always-`false` field would invite #982 (S15) to wire a branch that can never fire. Nothing reads it today: the Trustee `WaterfallResponse` interface (`packages/trustee/src/api/useLoanWaterfall.ts`) does not declare it, the LP app and wallet-connect never call `/waterfall`, and #982 is unbuilt (`backlog`).
3. **`PricingBasis` is retired from the waterfall**: the enum, `PricingBasis::from_valuation_mode`, the `pricing_basis` parameter of `compute_waterfall`, and the handler's `collateral_valuation_repo.get_anchor` lookup. After step 1 the basis no longer changes any output, so a parameter that is passed but never read would be dead code. This is the one part beyond the ceiling check itself; see Open Questions for the localized alternative.
4. Docs, specs and the S15 design note stop describing the quotational exception, and #982 is told what to use instead.

Out of scope:

- The fee-cap and interest-tier math (#2124), `ASSUMED_MAX_FEE_BPS` (#1547). Do not touch `cap_interest_fees`, `oet_room_under_cap`, the `fees_target > headroom` block, or the cascade arithmetic.
- The Trustee frontend. Its existing generic `400` mapping (`mapWaterfallError` in `packages/trustee/src/utils/userError.ts`: "This amount is too high for this loan. Enter a smaller amount.") already covers the new rejection, and the 400 message text stays unchanged so that mapping still matches.
- How operations handle a real quotational-period overage in cash. That is a product question (see Open Questions); this fix only makes the API agree with the contract.
- `ValuationMode` and the collateral-valuation tables and routes, which stay as they are for their other consumers.
- Contracts (frozen).

## Assumptions and Risks

- **Same-file siblings.** #2124 and #1547 edit `waterfall.rs` and `packages/api/tests/waterfall.rs`. Both branches are still at their "start work" commit, and the epic lists #2123 first ("land them one after another"). Step 3 deletes one `PricingBasis::Fixed,` line at each of the 27 + 2 test call sites and drops one `compute_waterfall` parameter. If #1547 adds a parameter (e.g. `max_fee_bps`), the sibling that lands second gets mechanical conflicts at those call sites, and any new sibling test that passes `PricingBasis::Fixed` stops compiling until that line is deleted. The changes in `src/` stay outside the fee-cap regions (`:493-510`, `:529-546`, `:602-633` at `b75cf30b`) except for the `default_breakdown(...)` call (`:512-521`), which loses its last argument. That call sits next to the `fees_target` block #2124 rewrites, so a small conflict there is possible.
- **#1786 Phase 2 (uncommitted, main checkout, someone else's work).** It rewrites one comment line inside the stage-3 comment block this plan deletes ("healthy-looking CCR" → "healthy-looking figure"), and its plan (`docs/exec-plans/active/issue-1786-retire-ccr.md:36`) lists "the waterfall pricing basis (`waterfall.rs` `from_valuation_mode`)" under Keep. Whichever lands second resolves it: the comment goes either way, and that Keep bullet becomes stale once this merges. Do not edit the #1786 plan from this branch; note it in the PR body.
- **`docs/user-stories/index.md`.** Each epic-2129 sub-issue adds an `## Epic #2129` section, so the second PR to land gets a trivial conflict there.
- **Behaviour change for concentrate loans.** A Trustee who used to preview a QP-repriced final settlement above the genesis price now gets a 400 instead of a split. That split could never be recorded on-chain anyway (it reverted), so nothing that works today breaks. It does remove a misleading preview.
- **Rounding.** The comparison stays exact (`BigDecimal`, untruncated `amount` against `original_offtaker_price − offtaker_received`). The contract compares integer base units, and `amount` is normally an integer, so a fractional `amount` is at least as strict here as on-chain. No change.
- No DB, migration, indexer or OpenAPI-client change. `utoipa` regenerates the schema from the struct, and no OpenAPI dump checked into `docs/generated/` mentions the field (verified by grep).

## Open Questions

- **Retire `PricingBasis` now or later?** The manager asked to keep this change localized to the offtaker-ceiling check so #2124 and #1547 rebase easily. Step 3 also deletes the now-dead `PricingBasis` enum and parameter, which touches 29 test call sites. Recommended: do it now (siblings have not coded yet; #2123 is first in the epic order; otherwise a dead `_pricing_basis` parameter and a wasted DB lookup stay in the code). The alternative is to skip Step 3, rename the parameter to `_pricing_basis`, keep the handler lookup and the `from_valuation_mode` test, and add a tech-debt entry to remove them after #2124 and #1547 merge. Confirm which.
- **What happens to a real quotational-period overage in cash?** (Non-blocking for this fix.) With the contract cap, cash the offtaker pays above `original_offtaker_price` on a concentrate deal cannot go through `recordPayment`. The specs say nothing about how it is settled (off-chain to the originator or Equity like the originator residual, or something else). This plan only states the on-chain constraint in the specs. If a product rule is wanted, it needs a separate issue.

## Implementation Steps

All paths are relative to the worktree root `/Users/aabliazimov/Documents/work/pipeline-fix-2123-waterfall-quotational-overpay`. Line numbers refer to base `b75cf30b`.

1. **Stage 3 becomes unconditional:** `compute_waterfall` in `packages/api/src/routes/waterfall.rs` (`:432-462`).
   - Replace the comment block and check with:
     ```rust
     let outstanding_offtaker = &s.original_offtaker_price - &s.repayment.offtaker_received;
     if amount > &outstanding_offtaker {
         return Err(ApiError::BadRequest(format!( /* existing message, unchanged */ )));
     }
     ```
     Keep the "deliberately not clamped at 0" behaviour, so a loan that is already over-received still rejects every `amount`, including `0`. Under the comment-less rule, drop the multi-paragraph rationale comment. Its substance moves to the specs in step 5.
   - Remove the `offtaker_overpaid` local, and the `offtaker_overpaid` argument from the `default_breakdown(...)` call (`:512-521`).
   - Update the `compute_waterfall` doc (`:418-419`) so the stage-3 `Err` reads "when `amount` exceeds the outstanding offtaker balance (stage 3)", with no `Fixed` qualifier.
2. **Remove `offtaker_overpaid`.**
   - `WaterfallResponse` (`:211-226`): delete the field and its doc.
   - `offtaker_fully_received` doc (`:212-214`): change "(or past — never past, per stage 3's rejection)" to plain "to `original_offtaker_price`".
   - `WaterfallBreakdown` (`:362-365`): delete the field.
   - `default_breakdown` (`:568-599`): delete the `offtaker_overpaid` parameter and its field in the returned struct.
   - Cascade return (`:556-566`): delete the field.
   - `build_response` (`:648`): delete the mapping.
3. **Retire `PricingBasis` from the waterfall** (subject to Open Question 1).
   - Delete the `PricingBasis` enum and its `impl` (`:127-159`), and the `pricing_basis: PricingBasis` parameter of `compute_waterfall`.
   - In the handler `get_waterfall`, delete the `pricing_basis` lookup (`:321-331`) and stop passing it at the `compute_waterfall` call (`:335-342`).
   - Remove the now-unused `use shared::collateral_valuation_repo::ValuationMode;`.
   - `state.collateral_valuation_repo` stays on `AppState` for its other routes.
4. **Module and OpenAPI docs** in the same file.
   - Rewrite stage 3 in the `//!` header (`:34-55`) to two or three lines: `outstanding_offtaker = original_offtaker_price − repayment.offtaker_received`, and an `amount` above it is a `400` on every loan and in every status, as both LoanRegistries enforce it (`OfftakerExceedsPrice`); not clamped at 0.
   - Leave the stage-4 wording "stage 3's rejection has already bounded" (`:82-83`) as it is; it never mentions the pricing basis.
   - In `#[utoipa::path]` responses (`:254`), change "(fixed-price loans only) amount exceeds the loan's outstanding offtaker balance" to "amount exceeds the loan's outstanding offtaker balance".
5. **Specs and design docs.**
   - `docs/product-specs/yield.md:61`: replace the "Offtaker-price ceiling (pricing basis)" paragraph. The waterfall rejects (`400`) any amount that would take cumulative `offtaker_received` above `original_offtaker_price`, on every loan and in every status. This matches `OfftakerExceedsPrice` in both LoanRegistries (EVM `_validateRepayment`, Stellar `validate_repayment`); a quotational-period settlement above the genesis price cannot be recorded through `recordPayment`. Issue #2123 supersedes the #963 quotational exception.
   - `docs/product-specs/loans.md:66-67`: "Outstanding offtaker balance is `originalOfftakerPrice − offtakerReceivedTotal`, a hard ceiling on every loan, enforced by the LoanRegistry (`OfftakerExceedsPrice`) and by the waterfall (see yield.md, #2123)."
   - `docs/design-docs/trustee-dashboard-v3-design-assignment.md:102` (S15 checklist item 3): auto-green when the received cash covers the contracted price (the financials' `offtaker_outstanding` is `0`, as Record Repayment already does in `docs/frontend/trustee-flows.md:1392`). Received can never exceed the contracted price, because the registry caps it. On early payoff or waiver the Trustee ticks it manually. Remove every `offtaker_overpaid` and QP-overage mention.
   - Do not edit `docs/exec-plans/completed/issue-963-qp-repriced-final-settlement.md`; it is historical.
6. **User-stories doc.** Create `docs/user-stories/epic-2129/2123-waterfall-quotational-overpay.md` (format as `docs/user-stories/epic-1521/1661-waterfall-error-mapping.md`). Add an `## Epic #2129 — Math correctness` section with its row (Status `Initial`) to `docs/user-stories/index.md`, or append the row if a sibling already added the section. Stories:
   - **Concentrate loan, amount above the remaining contracted price.** Record Repayment on a loan whose collateral valuation mode is `MetalConcentrate`; enter an amount above the served offtaker outstanding. Expected: `/waterfall` answers `400` ("exceeds the loan's outstanding offtaker balance"); the page shows "This amount is too high for this loan. Enter a smaller amount."; no split; nothing is recordable.
   - **Concentrate loan, exactly the remaining contracted price.** Expected: `200`; split shown; recordable on-chain without `OfftakerExceedsPrice`.
   - **API shape.** `GET /v1/loan-book/{id}/waterfall?chain_id=…&amount=…` on any loan has no `offtaker_overpaid` key; `offtaker_fully_received` is still served.
7. **Tell #982.** Post one comment on #982 (`gh issue comment 982`) saying #2123 removes `offtaker_overpaid` from the waterfall response because both registries reject cumulative offtaker receipts above `original_offtaker_price`. S15 item 3 therefore auto-greens on `offtaker_outstanding == 0` (the design-assignment §3.2 text is updated in the #2123 PR), and the title's "(consume offtaker_overpaid)" is stale. Do not edit #982's labels, title or body.
8. Run `cargo fmt --all`, `cargo clippy --all -- -D warnings`, and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Pure unit tests only, in `packages/api/tests/` (no `DATABASE_URL`, no Postgres, nothing inline in `src/`).

`packages/api/tests/waterfall.rs`:

- Remove `PricingBasis` (and `ValuationMode`) from the imports, and delete the `PricingBasis::Fixed,` argument at every `compute_waterfall` call (step 3).
- **New `issue_2123_repro_quotational_overpayment_is_rejected`.** `original_offtaker_price = 1_000_000`, `offtaker_received = 900_000`, `amount = 150_000`. Assert `Err(ApiError::BadRequest(m))` with `m.contains("exceeds the loan's outstanding offtaker balance")` (use `matches!`). Then assert `amount = 100_000` is `Ok` with `offtaker_fully_received` set.
- **Rewrite `quotational_accepts_a_qp_repriced_final_settlement` as `qp_repriced_settlement_above_offtaker_price_is_rejected`.** Same PIPE-GPC-001 fixture: price 13,372,557.24, received 12,275,866.32. The 1,764,807.37 settlement is now `Err(BadRequest)`. Exactly 1,096,690.92 is `Ok`, `offtaker_fully_received`, and cascades to equity. This absorbs `quotational_within_contract_price_is_not_flagged`, so delete that test.
- **Delete `pricing_basis_derives_from_valuation_mode`.**
- **New `default_loan_rejects_amount_above_offtaker_price`.** Status `"Default"`, `original_offtaker_price` below `outstanding senior + interest headroom`, `amount` between the two. Expect the offtaker-ceiling `BadRequest`, not the Default message. The contract applies `OfftakerExceedsPrice` in Default too.
- **`response_maps_the_components`.** Drop the `offtaker_overpaid` assertion. Add `serde_json::to_value(build_response(1, &b))` and assert the object has no `offtaker_overpaid` key and still has `offtaker_fully_received`.
- Keep `amount_exceeding_outstanding_offtaker_is_rejected`, `offtaker_ceiling_accounts_for_amounts_already_received` and `already_over_received_loan_rejects_every_further_amount_including_zero` (minus the argument); they now cover every loan.

`packages/api/tests/waterfall_accrual.rs`:

- Remove the `PricingBasis` import and the `PricingBasis::Quotational` argument in `run` (`:103-111`) and `run_amount` (`:432-441`). These fixtures set `original_offtaker_price = 1e17` and `HUGE_AMOUNT = 1e17`, so `amount > outstanding` is false and they stay green without the quotational bypass. Confirm by running them.

Commands:

```bash
cargo test -p pipeline-api --test waterfall --test waterfall_accrual --test loan_chain_required
cargo clippy --all -- -D warnings
npx tsx scripts/lint-docs.ts
```

No Trustee test change: `packages/trustee/src/utils/-userError.test.ts:290-300` already pins the generic copy for this exact message, and the message text is unchanged.

## Docs to Update

- `docs/product-specs/yield.md` (§ Offtaker-price ceiling): every loan is capped, matching the contracts; supersedes the #963 exception.
- `docs/product-specs/loans.md` (§ Genesis economics, `originalOfftakerPrice` bullet).
- `docs/design-docs/trustee-dashboard-v3-design-assignment.md` (§3.2 S15 checklist item 3): no `offtaker_overpaid`.
- `docs/user-stories/epic-2129/2123-waterfall-quotational-overpay.md` (new) and `docs/user-stories/index.md` (new epic section or row).
- Module, rustdoc and OpenAPI text in `packages/api/src/routes/waterfall.rs` (steps 1-4).
- No change to `docs/frontend/trustee-flows.md` (already keyed on `offtaker_outstanding`) or `docs/references/backend.md` (no ceiling detail).
