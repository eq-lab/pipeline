# Issue #964: Collateral valuation applies one reference price to every payable metal

Source: https://github.com/eq-lab/pipeline/issues/964

## Scope

`compute_collateral` (`packages/shared/src/collateral_valuation/mod.rs`) takes a single
`reference_price: Option<&BigDecimal>` and `assemble_metals` copies it onto **every**
`PayableMetal`. On a multi-metal concentrate (our first deal is gold-pyrite with a
payable silver credit) silver is priced at the gold price, inflating gross value, NSR,
collateral value, and CCR — in the direction that makes an undercollateralised loan look
healthy (issue quotes +45.64 pp: a true ~115% loan reporting ~150%).

The pure math is already per-metal-correct: `PayableMetal` carries its own
`reference_price` and `ConcentrateInputs::valuate()` sums `payable_oz_i * price_i` across
metals (see the existing test `fixed_charges_make_collateral_fall_faster_than_price`,
which mutates `metals[0].reference_price`). **The defect is entirely in assembly and
plumbing:** the single price fed into `compute_collateral`, copied across metals by
`assemble_metals`, and echoed by the API's `build_metals`.

**In scope**

- Feed each payable metal its own USD reference price, keyed by the metal's price-feed
  asset symbol (e.g. gold→XAU, silver→XAG).
- Change `compute_collateral`'s signature from a single price to an asset→price map, and
  update all three callers (detail endpoint, loan-book bulk valuation, CCR history).
- Extend the `asset_price_collector` price-discovery so every payable metal's asset (not
  just the anchor's headline asset) gets a price series collected.
- Fix the API display echo (`build_metals`) so each metal shows its own price.
- Regression tests reproducing the issue's gold+silver scenario.

**Out of scope**

- Per-metal *providers* (all metals of a loan share the anchor's `price_provider`; the
  low-cost metals API prices XAU and XAG identically). See Open Questions.
- Operations Console / frontend offtake form changes (no data-model change if we take the
  recommended code-map approach — see Open Questions).
- Quotational-period averaging, Chainlink cross-check, on-chain CCR write (#764 items).

## Assumptions and Risks

- **Metal→asset resolution.** The recommended design maps each `payable_terms[].metal`
  name to its price-feed asset symbol via a small pure function in `shared`
  (`asset_for_metal`). Confirmed vocabulary: `payable_terms[].metal` / `assays[].metal`
  store lowercase full names (`"gold"`, `"silver"` — see the migration comments and
  `packages/api/tests/collateral_valuation.rs`), and the price-feed symbols are the
  MetalpriceAPI codes `XAU`/`XAG`. So the map is `"gold"→"XAU"`, `"silver"→"XAG"` (plus
  `"platinum"→"XPT"`, `"palladium"→"XPD"` for completeness), case-insensitive. If an
  un-mapped metal appears, its price is absent and the loan reads "unpriced" (`Ok(None)`)
  rather than mispriced — a safe failure mode, but an un-mapped metal silently blocks
  valuation.
- **Standard-goods loans** have no `payable_terms`; they keep single-price semantics keyed
  on the anchor's `asset`. Must not regress.
- **CCR history** currently varies one price series over time. Making it multi-metal-
  correct requires fetching a series per metal-asset and resolving each metal's as-of
  price at every grid point — the largest caller change. Risk of subtle off-by-one in the
  per-asset as-of walk; mitigated by reusing the existing `price_at_or_before` + window
  seed pattern and a unit test.
- **Collector cost.** Adding XAG (and any other metal assets) increases API calls roughly
  linearly with distinct metal-assets. Still well within the spec's ≤US$1k/yr budget for
  the current asset set.
- **No existing DB rows change shape** under the recommended code-map approach (no
  migration). If the per-term-asset alternative is chosen instead, a JSONB field is added
  and the offtake submission DTO/validation/OpenAPI must change too.

## Open Questions

_None_ — resolved with the human before implementation:

1. **Metal→asset mapping** — **canonical code map** (`asset_for_metal` in `shared`:
   `"gold"→"XAU"`, `"silver"→"XAG"`, `"platinum"→"XPT"`, `"palladium"→"XPD"`,
   case-insensitive). No schema/migration, no offtake DTO or Operations Console change.
2. **Provider** — **shared**: all metals of a loan use the anchor's `price_provider`; the
   price key stays the asset symbol alone (MetalpriceAPI/Chainlink price XAU and XAG).
3. **CCR-history** — **make it fully multi-metal-correct now** (per-metal series, per-metal
   as-of price at each grid point).
4. **Vocabulary** — confirmed from code: `payable_terms[].metal`/`assays[].metal` are
   lowercase full names (`"gold"`, `"silver"`) → `XAU`/`XAG`.

## Implementation Steps

Steps assume the **recommended** design (canonical code map, shared provider, no
migration). If Open Question 1/3 flips, adjust the data-model steps accordingly.

**Status: all steps complete.** ✅ clippy (`--all --all-targets -D warnings`), ✅ doc lint
(0 errors), ✅ `cargo test --all` (all green, 9 new tests), ✅ frontend `tsc --noEmit`.

1. ✅ **`shared` — metal→asset resolver.** In
   `packages/shared/src/collateral_valuation/mod.rs`, add a pure
   `pub fn asset_for_metal(metal: &str) -> Option<&'static str>` (case-insensitive match
   on the confirmed vocabulary → XAU/XAG/XPT/XPD). Document it.

2. ✅ **`shared` — per-metal price plumbing.** Change the signature:
   ```rust
   pub fn compute_collateral(
       anchor: &CollateralValuationRow,
       assay: Option<&AssayRow>,
       offtake: Option<&OfftakeTermsRow>,
       prices: &std::collections::HashMap<String, BigDecimal>, // asset symbol → latest USD price
   ) -> anyhow::Result<Option<CollateralComputation>>
   ```
   - `StandardGoods`: `let Some(price) = prices.get(&anchor.asset) else { return Ok(None) };`
     then the existing `StandardGoodsInputs` path.
   - `MetalConcentrate`: require assay + offtake as today; call the updated
     `assemble_metals(assay, offtake, prices)`.
   - Update `assemble_metals` to return `anyhow::Result<Option<Vec<PayableMetal>>>`: for
     each payable term, resolve `asset_for_metal(term.metal)` then `prices.get(asset)`; if
     any required metal's price is absent return `Ok(None)` (loan reads "unpriced" — same
     semantics as a missing single price today). Set `PayableMetal.reference_price` to the
     resolved per-metal price. A metal absent from the map's vocabulary → `Ok(None)`.
   - Remove the now-inaccurate doc line about "single reference price applied to every
     payable metal / multi-metal is a follow-up."

3. ✅ **API detail endpoint** (`packages/api/src/routes/collateral_valuation.rs`):
   - In `get_collateral_valuation`, replace the single-price lookup with a
     `HashMap<String, BigDecimal>` built from `latest_prices()` filtered to
     `provider == anchor.price_provider` (asset → price). Pass it to `build_response`.
   - `build_response`: take `prices: &HashMap<String, BigDecimal>`; pass to
     `compute_collateral`. Recompute the `missing_inputs` "reference_price" signal from
     whether the required price(s) are present (standard goods: `anchor.asset`;
     concentrate: every payable metal's resolved asset). Keep `inputs.reference_price` /
     `reference_price_asset` as the headline (`anchor.asset`) price for display.
   - `build_metals`: take the price map; set each `MetalInput.reference_price` from the
     metal's own resolved asset price (falling back to `"0"` when absent), replacing the
     single-price copy.

4. ✅ **API loan-book bulk** (`packages/api/src/routes/loan_book.rs`, `collateral_by_loan`):
   for each anchor, build the asset→price map from the pre-fetched
   `latest_prices: &HashMap<(String,String), BigDecimal>` filtered to the anchor's
   provider, and pass it to `compute_collateral`.

5. ✅ **API CCR history** (`packages/api/src/routes/ccr_history.rs`):
   - Determine the loan's required assets: standard goods → `[anchor.asset]`; concentrate →
     the resolved asset of every payable metal in the latest offtake.
   - Fetch a price series per required asset (`price_at_or_before` seed +
     `prices_in_window`), and build a per-asset as-of resolver over the grid.
   - In `build_response`, at each grid point assemble a `HashMap<asset, price>` from each
     asset's as-of price; skip the point if any required asset has no price yet (mirrors
     today's "no price known yet" skip). Call `compute_collateral(anchor, assay, offtake,
     &map)`.

6. ✅ **Worker price discovery** (`packages/shared/src/collateral_valuation_repo.rs` +
   `packages/worker/src/asset_price_collector/mod.rs`):
   - Ensure every payable metal's asset gets collected, not just anchor headline assets.
     Add a repo loader (e.g. `all_anchors_with_offtakes` or reuse `distinct_asset_providers`
     + latest offtakes) and, in the collector `cycle`, compute the union of:
     (a) each anchor's `(asset, provider)`, and
     (b) for each concentrate loan, `(asset_for_metal(metal), provider)` for every payable
     term metal (using `asset_for_metal` from `shared`).
   - Collect each distinct pair as today. Keep the "skip asset configured with conflicting
     providers" behaviour intact.

7. ✅ **Lint/build.** `cargo clippy --all -- -D warnings`; `cargo build`.

## Test Strategy

- **`packages/shared/tests/collateral_valuation.rs`** (unit, pure — per memory, external
  test file, no DB/env):
  - New: two-metal (gold+silver) `ConcentrateInputs` with distinct per-metal prices;
    assert `gross_value == payable_oz_gold*price_gold + payable_oz_silver*price_silver`
    and that it is strictly less than the buggy single-(gold)-price result — the core
    regression, reproducing the issue's direction (silver must not be priced at gold).
  - New: `asset_for_metal` maps the confirmed vocabulary correctly and is case-insensitive;
    unknown metal → `None`.
  - New: `compute_collateral` with a price map `{XAU: .., XAG: ..}` on a 2-metal
    offtake/assay yields per-metal pricing; with XAG absent → `Ok(None)` (unpriced);
    standard-goods with `anchor.asset` present/absent → value / `Ok(None)`.
  - Keep the existing spec worked-example tests green (single-metal path unchanged).
- **API assembly tests** (existing pure tests in the route modules): update
  `build_response`/`build_metals`/CCR-history `build_response` call sites to the new
  signature; add a case asserting `metals[].reference_price` differ per metal and the CCR
  history resolves each metal's series independently.
- **Manual/worker**: confirm the collector's discovered pair set includes XAG for a
  gold+silver loan (unit test over the pure union computation if extracted; otherwise a
  targeted test on the new repo/union helper).

## Docs to Update

- `docs/product-specs/collateral-valuation.md`: the per-loan valuation record table lists
  `reference_price` (singular) and `refining_charges` "per metal". Clarify that
  `reference_price` is now per payable metal (keyed by the metal's price-feed asset), and
  document the metal→asset resolution and that the price collector polls every payable
  metal's asset. Update the worked example note if helpful (silver credit).
- Update the module doc comment in `collateral_valuation/mod.rs` (remove the
  single-price/follow-up caveat) — covered in Step 2.
- If the per-term-asset alternative is chosen (Open Question 1), also update the OpenAPI
  offtake schema docs.
