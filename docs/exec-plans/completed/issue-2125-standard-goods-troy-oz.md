# Issue #2125: Collateral valuation: StandardGoods multiplies a per-troy-oz price by tonnes

Source: https://github.com/eq-lab/pipeline/issues/2125

Parent epic: #2129 (math correctness). QA: #2130. Siblings in the same module: #1328 (asset / metal name normalization). Overlapping branch: #1786 Phase 2 (`chore/1786-retire-ccr-phase2`, not merged).

## Scope

### Finding: how price units are known today

Nothing in the stored data records the unit of a price.

- **Price feed spec.** `docs/product-specs/collateral-valuation.md` and `price-feed.md` are silent on units. The record table describes `reference_price` only as "Last price read".
- **Price table.** `loan_asset_prices.price_usd`, read through `shared::loan_asset_price_repo`, is a bare USD figure per `(asset, price_provider, timestamp)`. There is no unit column.
- **Providers.** `shared::price_provider` registers two providers:
  - `metal_price` (MetalpriceAPI). `metal_price.rs:14` says "Metals are quoted per troy ounce" and returns USD per unit.
  - `static`. A dev stub that returns a unitless constant.
- **Collector asset list.** The worker `asset_price_collector` polls a dynamic list, not a configured one:
  - `distinct_asset_providers()`: every anchor's free-text `asset`;
  - every payable metal resolved through `asset_for_metal` (gold, silver, platinum, palladium to `XAU`, `XAG`, `XPT`, `XPD`);
  - the `SECURITY_MARK_COMMODITIES` assets.
- **Anchor asset.** `CollateralValuationInput.asset` is free text, checked only for non-empty (`loan_book.rs` `validate_submission`, TD-55 / #1328). The Trustee origination form labels it "Asset symbol". `quantity_dmt` is always dry metric tonnes: the field name, the API doc and the form label "Quantity (dry metric tonnes)" all say so.
- **Only existing unit model.** `shared::security_marks` (#1783) has `QuoteUnit { TroyOz, Mt, Lb, Bbl }` and `quote_factor` (`TONNE_TROY_OZ = 10^10 / 311035`). The unit is set per commodity in the `SECURITY_MARK_COMMODITIES` env map, because the provider's unit is not uniform across symbols. The #1783 fixtures map `XCU` under `metal_price` as `TroyOz` in one entry and `Lb` in another.

The concentrate path already converts with `grams_per_troy_oz()` (31.1035) because every payable metal is a precious metal priced per troy ounce. The standard-goods path has no conversion: `compute_collateral` passes `anchor.quantity_dmt` (tonnes) as `StandardGoodsInputs.quantity`. That struct's own doc says "quantity in the price's unit". The bug is the caller, not the struct.

### Chosen approach

Add a fixed, in-code **asset → quote unit** table for standard goods, kept in `collateral_valuation/mod.rs` beside the existing troy-ounce constant:

- `XAU`, `XAG`, `XPT`, `XPD` (the precious metals `asset_for_metal` already knows; MetalpriceAPI quotes them per troy ounce) mean the price is per troy ounce. The quantity converts as `quantity_dmt × 1,000,000 / 31.1035`.
- Any other asset has no known quote unit. The loan reads **unpriced** (`Ok(None)`) and is never valued against a guessed unit. This follows the module's existing rule ("unpriced rather than silently mispriced", `asset_for_metal`) and the #1783 `unsupported_unit` status. **See Open Question 1:** this is the product decision the issue anticipates.
- The match ignores case (`eq_ignore_ascii_case`), like `asset_for_metal`. The price lookup still keys on the stored `anchor.asset` string, so this adds no normalization; that belongs to #1328.

Alternatives rejected:

- (a) **Persist a quote unit on the anchor.** This needs a migration on `loan_collateral_valuations`, a new `CollateralValuationInput` field, a Trustee form field and a backfill. It is a cross-package product change. #1786 is retiring the consumers of this record, so it is not justified for this bug.
- (b) **Reuse `SECURITY_MARK_COMMODITIES`.** That map is keyed by normalized commodity, not by the anchor's asset. It is env config that ships dark, and `collateral_valuation` is a pure module (no env reads). Coupling the two would make the loan-book summary depend on the mark-suggestion config.
- (c) **Default unknown assets to "per tonne".** This keeps today's silent mis-valuation for any symbol quoted per ounce or per pound (for example `XCU` on MetalpriceAPI). It stays available as the answer to Open Question 1.

### In scope

- `packages/shared/src/collateral_valuation/mod.rs`: the quote-unit helper and the fix in the `StandardGoods` arm of `compute_collateral`.
- Regression and unit tests in `packages/shared/tests/collateral_valuation.rs`.
- Fixture updates in `packages/api/tests/collateral_valuation.rs` and `packages/api/tests/ccr_history.rs`, only if those tests still exist on `main` at implementation time (#1786 Phase 2 deletes or changes them).
- One `missing_inputs` entry in `/valuations` (`routes/collateral_valuation.rs` `build_response`), only if that GET route still exists on `main` at implementation time.
- Docs: the collateral-valuation spec, a user-stories doc, a tech-debt entry.

What changes for users:

- `GET /v1/loan-book` per-entry `collateral` / `ltv` (until #1786 Phase 2 removes them).
- `summary.total_collateral`, `senior_debt_coverage` and `at_risk_wl_and_default_pct`.
- `/valuations` `collateral_value` / `ccr` (until #1786 Phase 2).

For standard-goods loans on `XAU`, `XAG`, `XPT` or `XPD`, these become about 32,150 times larger, which is the correct value. Standard-goods loans on any other asset change from a wrong value to `null` (unpriced).

### Out of scope

- Concentrate valuation (`ConcentrateInputs::valuate`, `assemble_metals`, `assemble_penalties`): unchanged.
- `asset_for_metal` and metal-name matching (#1328).
- Asset normalization at submission, and rejecting a `StandardGoods` submission whose asset has no known quote unit. That would edit `validate_submission`, which #1328 also edits. Filed as a follow-up note in the tech-debt entry (Docs to Update).
- `shared::security_marks`: its `quote_factor` is already correct and is not touched. No shared-constant refactor between the two modules, which keeps the diff local.
- The worker price collector, the waterfall (`PricingBasis::from_valuation_mode` is unit-free), frontends, migrations and contracts (frozen).

## Assumptions and Risks

- **Troy-ounce constant.** The plan uses the codebase's `31.1035` g/oz, so 1 t = 32,150.7226 oz. The issue text uses the exact 31.1034768 g/oz (32,150.7466 oz/t). The concentrate path, `security_marks::TONNE_TROY_OZ` and the spec's worked example all use 31.1035. Keeping one constant across the three paths makes standard goods, concentrate and mark suggestions agree. The difference is 7.5 ppm: the issue's example gives $231,485,202.63 instead of $231,485,375.6, both "$231.5M". A reviewer who wants the exact constant should change it in all three places in a separate issue.
- **Unknown-asset behaviour change.** Any live standard-goods anchor whose asset is outside `XAU` / `XAG` / `XPT` / `XPD` (for example a backfilled `loan_parameters` asset, or `KC` / `XCU` used in dev) moves from a wrong value to `null`:
  - The loan-book summary aggregates stop counting it.
  - `/valuations` reports `missing_inputs: ["quote_unit"]` while that route exists.
  - The planner cannot query pipeline-test or production data, so it does not know whether such anchors exist. This is part of Open Question 1.
- **Merge overlap with #1786 Phase 2.** That branch edits the same file:
  - the module header;
  - the `StandardGoodsInputs::collateral_value` doc;
  - removal of `ccr_bps` and `ConcentrateValuation::ccr_bps` (lines ~200-225).

  It deletes `routes/ccr_history.rs`, `tests/ccr_history.rs` and the `/valuations` GET with its `build_response` tests. It keeps `compute_collateral`. To keep the conflict small, this plan:
  - leaves the module header and every CCR item alone;
  - edits only the `StandardGoods` arm and the doc paragraph of `compute_collateral`;
  - adds the new helper between `compute_collateral` and `nsr_per_dmt`.

  Whichever PR merges second rebases. If Phase 2 is on `main` first, skip Implementation Steps 4 and 5.
- **Merge overlap with #1328.** #1328 is expected to edit `asset_for_metal`, `assemble_metals` and/or `validate_submission`. This plan touches none of them. Do not reuse or refactor `asset_for_metal` for the new table: a separate `match` keeps the two diffs apart.
- **Precision.** `BigDecimal` division by 31.1035 does not terminate. Multiply by `1_000_000` first and divide last, the same order as the concentrate path (`payable_mass / g_per_oz`). Callers already round for display (`usd()`, the loan book's ×1e6 formatting).
- **Comment-less code rule (AGENTS.md).** Add no new doc comments to the helper. Only reword the existing `compute_collateral` doc sentence that would otherwise become false ("standard goods needs the headline asset's price only").

## Open Questions

1. **Standard-goods assets outside the precious-metal set.** The plan's default is that `XAU`, `XAG`, `XPT` and `XPD` are per troy ounce and every other asset reads *unpriced*. Please confirm, or choose instead:
   - (a) unknown assets are treated as quoted **per tonne** (factor 1, today's behaviour); or
   - (b) an explicit list of further assets with their unit (for example `XCU` per troy ounce or per lb, grain per tonne, `BRENT` per bbl, which cannot convert from tonnes).

   Related: do any live standard-goods loans on pipeline-test or production use an asset outside the four? They would show `null` collateral after this change. Note that MetalpriceAPI is the only market provider, and the plan does not assume it quotes non-precious symbols per troy ounce. The #1783 fixtures treat `XCU`'s unit as configurable.

## Implementation Steps

1. **Helper** (`packages/shared/src/collateral_valuation/mod.rs`, insert between `compute_collateral` and `nsr_per_dmt`):
   - `pub fn quote_quantity(asset: &str, quantity_dmt: &BigDecimal) -> Option<BigDecimal>`;
   - when `asset` matches `XAU`, `XAG`, `XPT` or `XPD` (ignoring ASCII case), return `Some(quantity_dmt * BigDecimal::from(1_000_000) / grams_per_troy_oz())`;
   - otherwise return `None`;
   - no doc comment;
   - if Open Question 1 resolves to (a) or (b), only this `match` changes ((a): the fallback arm returns `Some(quantity_dmt.clone())`; (b): add arms).
2. **Fix the `StandardGoods` arm** of `compute_collateral` (`mod.rs:283-297`):
   - after the price lookup, `let Some(quantity) = quote_quantity(&anchor.asset, &anchor.quantity_dmt) else { return Ok(None); };`;
   - pass `quantity` (not `anchor.quantity_dmt.clone()`) into `StandardGoodsInputs`;
   - leave `StandardGoodsInputs` and its `collateral_value()` unchanged.
3. **Reword the `compute_collateral` doc** (`mod.rs:245-254`). It should say that standard goods needs the headline asset's price **and a known quote unit for that asset**, and that the tonnes are converted into that unit. Keep it to the existing sentences; do not touch the module header (#1786 Phase 2 rewrites it).
4. **`/valuations` GET**, only if `get_collateral_valuation` / `build_response` still exist in `packages/api/src/routes/collateral_valuation.rs` on `main`:
   - in `build_response`, for a `StandardGoods` anchor whose headline price is present but `quote_quantity(&anchor.asset, &anchor.quantity_dmt)` is `None`, push `"quote_unit"` onto `missing_inputs`;
   - import `quote_quantity` from `shared::collateral_valuation`;
   - no other DTO change.
5. **API test fixtures**, only for files still present on `main`:
   - `packages/api/tests/collateral_valuation.rs` `standard_goods_anchor()` and `kc_prices()`: switch asset `KC` to `XAU` and `quantity_dmt` `1000` to `0.0311035` (exactly 1,000 troy oz). `ccr_bps == 16_000` and the other assertions then hold unchanged.
   - Add `unsupported_asset_reports_quote_unit_missing`: a `KC` anchor with a `KC` price gives `collateral_value: None` and `missing_inputs == ["quote_unit"]`.
   - `packages/api/tests/ccr_history.rs` `anchor()`: switch asset to `XAU` and the price maps' `KC` keys to `XAU`. Convert each `quantity_dmt` argument from ounces to tonnes (`1000` becomes `0.0311035`, `100` becomes `0.00311035`), so the expected CCR values stay the same.
   - `concentrate_anchor()` there derives from `anchor("0.40", "100")`. It is a concentrate, which uses tonnes directly, so keep its quantity `100` (override after the call, or pass `100` explicitly).
   - Update `required_assets(..) == vec!["KC"]` to `vec!["XAU"]`.
6. **Run**:
   - `cargo clippy --all -- -D warnings`;
   - `cargo test -p shared -p pipeline-api`;
   - `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests are pure unit tests in `packages/<pkg>/tests/<topic>.rs`: no inline `#[cfg(test)]`, no `DATABASE_URL` / `POSTGRES_URL`, no Postgres.

`packages/shared/tests/collateral_valuation.rs`:

- **Regression (the issue's example).** `standard_goods_converts_tonnes_to_troy_oz`:
  - setup: `StandardGoods` anchor, asset `XAU`, `quantity_dmt = 2`, haircut `0.10`, prices `{XAU: 4000}`;
  - `compute_collateral` gives `collateral_value` ≈ 231,485,202.63 (tolerance 0.01);
  - it also asserts that the value exceeds 32,000 × the naive `4000 × 2 × 0.9 = 7,200`.
- **Update `compute_collateral_standard_goods_uses_anchor_asset`.** Today it encodes the bug (it passes 160.75 *ounces* as `quantity_dmt`). Set `quantity_dmt = 0.004999887625` (exactly 160.75 oz), so the expected 578,700 stays. Keep the "no price for the anchor's asset gives unpriced" half.
- **Each precious metal converts.** For `XAG`, `XPT` and `XPD`: 1 t, price 1, haircut 0 gives ≈ 32,150.7226.
- **Case.** `xau` with a price keyed `xau` is priced: the unit match ignores case, and the price key is the stored string.
- **Unknown asset is unpriced.** `KC` (and `XCU`) with its price present gives `Ok(None)`. This test flips to a per-tonne or explicit-unit assertion if Open Question 1 changes the policy.
- **Helper.** `quote_quantity("XAU", 1)` ≈ 32,150.7226. `quote_quantity("XAU", 0.0311035) == 1000` exactly (as `BigDecimal` after `normalized()`). `quote_quantity("KC", 1)` is `None`.
- **Unchanged.** `standard_goods_applies_price_quantity_haircut` (the struct is untouched), every concentrate, penalty, `nsr_per_dmt` and `asset_for_metal` test, and `security_marks.rs` `tonne_troy_factor_matches_the_valuation_constant`. The last one also pins the same 31.1035 constant.

`packages/api/tests/collateral_valuation.rs` and `ccr_history.rs`: as in Step 5, only while those files exist.

Regression elsewhere: `packages/api/tests/loan_book.rs`, `waterfall.rs`, `loan_submission.rs` and `packages/worker/tests/asset_price_collector.rs` stay green unchanged. None of them builds a standard-goods valuation.

## Docs to Update

- **`docs/product-specs/collateral-valuation.md`**, section "Standard goods" only (#1786 Phase 2 edits the overview, the CCR line and the record-table CCR rows, not this section). After the formula, add a units paragraph:
  - `reference_price` is US$ per the asset's quote unit;
  - `quantity` is the anchor's dry metric tonnes, converted into that unit first;
  - `XAU`, `XAG`, `XPT` and `XPD` are quoted per troy ounce, 1 t = 1,000,000 / 31.1035 troy oz (the same constant as the concentrate waterfall);
  - a standard-goods asset with no known quote unit reads *unpriced*, never valued against a guessed unit (or the rule chosen in Open Question 1);
  - a one-line example: 2 t of refined gold at US$4,000/oz with a 10% haircut is 2 × 32,150.72 oz × 4,000 × 0.9 = about US$231.5M.

  Write the formula with the conversion visible, e.g. `collateral_value = reference_price * quantity_in_quote_unit * (1 - haircut)`.
- **`docs/user-stories/epic-2129/2125-standard-goods-troy-oz.md`** (new), linked from `docs/user-stories/index.md` under a new "Epic #2129 — Math correctness" section. A sibling may add the section first; reuse it on rebase.
  - Persona: operator or QA via the API.
  - Story 1: a drawn standard-goods `XAU` loan with 2 t and a 10% haircut. `GET /v1/loan-book` `summary.total_collateral` (and `/valuations` `collateral_value` while it exists) shows about 231.5M × the XAU price / 4,000, not about 7,200.
  - Story 2: a standard-goods loan on a non-precious symbol reads `collateral: null` (and `missing_inputs: ["quote_unit"]` on `/valuations` while it exists).
  - Story 3: a concentrate loan's value is unchanged.
- **`docs/exec-plans/tech-debt-tracker.md`**: a new entry (next free TD number, currently TD-191; re-check on rebase because siblings may take it).
  - The standard-goods quote unit is a hard-coded precious-metal table in `collateral_valuation::quote_quantity`, separate from `security_marks::QuoteUnit`.
  - Non-precious standard-goods assets read unpriced until a per-anchor quote unit exists.
  - Submission does not reject a standard-goods asset with no known unit (follow-up next to TD-55 / #1328).
- No change to `price-feed.md`, `relayer-service.md` ("price times quantity" stays true at that level) or `docs/references/backend.md` (it documents no units for this path).
