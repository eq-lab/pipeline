# Issue #762: Implement MetalPricePriceProvider (metalpriceapi.com) with METALPRICE_PROVIDER_KEY

Source: https://github.com/eq-lab/pipeline/issues/762

## Scope

Add a live USD price provider backed by [MetalpriceAPI](https://metalpriceapi.com/documentation),
registered under a new key `METALPRICE_PROVIDER_KEY = "metal_price"`. Loans whose
`loan_parameters.price_provider = "metal_price"` will then be priced by the
`asset_price_collector` worker job against real precious-metal (XAU/XAG/…) market data
instead of the deterministic `StaticPriceProvider`.

**In scope**
- New `METALPRICE_PROVIDER_KEY` constant + registry arm in `packages/shared/src/price_provider.rs`.
- New `metal_price` module in `packages/shared` implementing the existing `PriceProvider` trait
  (`current_price`, `historical_price`) over the MetalpriceAPI `/latest` and `/{YYYY-MM-DD}` endpoints.
- Env-based config for the API key + base URL (`MetalPriceSettings::from_env`), mirroring
  `CrystalSettings::from_env`.
- Pure unit tests (URL building + response parsing) in `packages/shared/tests/`.
- Docs: `.env.example` entries, references vendor pointer, module doc.

**Out of scope**
- No DB migration — `loan_parameters.price_provider` is plain `TEXT` with no CHECK constraint
  (`packages/shared/migrations/20260630000001_loan_parameters_and_asset_prices.sql:22`); the
  registry `price_provider_for` is the only validator.
- No changes to the collector loop/grid logic in `packages/worker/src/asset_price_collector/`.
- No seed data changes; assigning a loan to `metal_price` is an operational/data action.
- Paid-plan features (`/carat`, gram/kilogram `unit`) are not used.

## Assumptions and Risks

- **Registry stays synchronous.** `price_provider_for(key) -> Result<Arc<dyn PriceProvider>>`
  is sync and already returns `Result`. The `metal_price` arm calls
  `MetalPricePriceProvider::from_env()?` inside it, so a missing `METALPRICE_API_KEY` surfaces as
  an `Err` that the collector logs-and-skips per asset (see `collect_asset` at
  `packages/worker/src/asset_price_collector/mod.rs:216`). No signature change needed.
- **Decimal precision.** Rates arrive as JSON floats (e.g. `1856.906765`). Do **not** parse via
  `f64` (binary-float precision loss) and do **not** use `json_numeric::parse_numeric` (it rejects
  decimal points — it is for integer `NUMERIC(78,0)` columns). Deserialize the rate preserving its
  textual form (`serde_json::Number::to_string()` → `BigDecimal::from_str`).
- **Symbol convention.** For `base=USD&currencies=XAU`, the response carries `rates.XAU`
  (metal-per-USD) and its reciprocal `rates.USDXAU` (USD-per-troy-ounce). `current_price` must
  return **USD-per-unit**: prefer `rates["USD{asset}"]`; fall back to `1 / rates["{asset}"]` when the
  reciprocal key is absent. The provider is symbol-agnostic — it passes the loan's `asset` string
  through as `currencies`.
- **Historical granularity.** The MetalpriceAPI historical endpoint (`/{YYYY-MM-DD}`) is
  **date-level** (daily close), not intraday. `historical_price(asset, at)` truncates `at` to its
  UTC date; this keeps it idempotent per `(asset, date)` as the trait requires, but on an *hourly*
  collector grid every hour of a day resolves to the same daily value. Acceptable for daily
  collateral valuation; flagged in Open Questions.
- **External dependency + rate limits.** Adds a new outbound HTTP dependency with a quota
  (free tier is limited). Per-asset errors are already isolated by the collector. Timestamp source
  reliability is the vendor's.
- **Test constraint.** Tests must be pure — no DB, no reading `DATABASE_URL`/`POSTGRES_URL`/any env
  (per repo test rules). The registry arm for `metal_price` therefore cannot be exercised end-to-end
  in unit tests (it reads env); coverage is via the extracted pure helpers instead.

## Open Questions

- Historical resolution: is daily-close granularity acceptable for `metal_price`, or should the
  collector be constrained to `DAYS` interval for metal-priced assets (reject/warn on `HOURS`)?
  (Plan assumes daily-close is fine and documents the hourly caveat; no interval guard added.)
- Env var name: plan uses `METALPRICE_API_KEY` (+ optional `METALPRICE_BASE_URL`) by convention with
  the existing `CRYSTAL_*`/`SUMSUB_*` providers — confirm naming.

## Implementation Steps

1. **Module scaffold.** Add `pub mod metal_price;` to `packages/shared/src/lib.rs` (alphabetical
   order, before `metadata_fetcher`). Create `packages/shared/src/metal_price.rs`.

2. **Settings (`packages/shared/src/metal_price.rs`).** Add `MetalPriceSettings { api_key: String,
   base_url: String }` with `from_env()` mirroring `CrystalSettings::from_env`
   (`packages/shared/src/crystal/config.rs:45`):
   - `api_key` = `env::var("METALPRICE_API_KEY")` with `.context("required env var METALPRICE_API_KEY is not set")`.
   - `base_url` = `env::var("METALPRICE_BASE_URL").unwrap_or_else(|_| "https://api.metalpriceapi.com/v1".to_owned())`.

3. **Response models.** Define serde structs for the `/latest` and dated responses:
   - `MetalPriceResponse { success: bool, rates: Option<serde_json::Map<String, serde_json::Value>>, error: Option<MetalPriceError> }`
     (or `#[serde(default)]` fields) — model loosely enough to capture the vendor error payload
     (`{"success":false,"error":{"code":..,"info"/"message":..}}`).
   - Keep `rates` values as `serde_json::Value`/`Number` so precision is preserved for the
     `BigDecimal` conversion in step 4.

4. **Pure helpers (unit-testable, no I/O).** Extract as `pub(crate)`/`pub` fns so the external test
   file can call them without network or env:
   - `fn latest_url(base_url: &str, api_key: &str, asset: &str) -> String`
     → `"{base}/latest?api_key={key}&base=USD&currencies={asset}"`.
   - `fn historical_url(base_url: &str, api_key: &str, asset: &str, date: NaiveDate) -> String`
     → `"{base}/{YYYY-MM-DD}?api_key={key}&base=USD&currencies={asset}"`.
   - `fn parse_usd_price(body: &str, asset: &str) -> Result<BigDecimal>`:
     deserialize `MetalPriceResponse`; if `!success` → `bail!` with the vendor error;
     read `rates["USD{asset}"]` → `BigDecimal::from_str(number.to_string())`; else read
     `rates["{asset}"]` and return `BigDecimal::from(1) / rate` (guard against zero); else
     `bail!("metalpriceapi: no rate for {asset}")`.

5. **Provider struct + trait impl.** `pub struct MetalPricePriceProvider { http: reqwest::Client,
   settings: MetalPriceSettings }` with `pub fn from_env() -> Result<Self>` (build
   `reqwest::Client::new()` + `MetalPriceSettings::from_env()?`). Implement
   `#[async_trait] impl PriceProvider for MetalPricePriceProvider`:
   - `current_price(asset)`: GET `latest_url(...)`; on non-2xx `bail!` with status+body (mirror
     `CrystalClient::risk_check` at `packages/shared/src/crystal/client.rs:78`); else
     `parse_usd_price(&text, asset)`.
   - `historical_price(asset, at)`: `let date = at.date_naive();` GET `historical_url(...)`; same
     status check + `parse_usd_price`.

6. **Registry wiring (`packages/shared/src/price_provider.rs`).** Add
   `pub const METALPRICE_PROVIDER_KEY: &str = "metal_price";` next to `STATIC_PROVIDER_KEY`, and a
   match arm in `price_provider_for`:
   `METALPRICE_PROVIDER_KEY => Ok(Arc::new(crate::metal_price::MetalPricePriceProvider::from_env()?)),`.
   Update the module doc comment (lines 1–9) to name the new live provider.

7. **Docs / env.** Add to `.env.example` near the collector block (after line 82) or a new
   "MetalpriceAPI" block:
   - `METALPRICE_API_KEY=` `# required when any loan uses price_provider=metal_price`
   - `METALPRICE_BASE_URL=https://api.metalpriceapi.com/v1  # optional, default shown; EU mirror https://api-eu.metalpriceapi.com/v1`
   Add a vendor pointer under `docs/references/index.md` → "Vendor Documentation":
   `- [MetalpriceAPI documentation](https://metalpriceapi.com/documentation) — precious-metal USD spot & historical rates (metal_price provider)`.

8. **Lint.** Run `cargo clippy --all -- -D warnings` and fix all findings.

## Test Strategy

New external test file `packages/shared/tests/metal_price_provider.rs` (per repo convention — no
inline `#[cfg(test)] mod tests`, no DB, no env reads). Cover the pure helpers only:

- **URL building:** `latest_url` and `historical_url` produce the exact expected strings including
  `api_key`, `base=USD`, `currencies=<asset>`, and (historical) the `YYYY-MM-DD` path segment from a
  fixed `NaiveDate`.
- **`parse_usd_price` — reciprocal present:** sample body with `"USDXAU": 1856.906765` returns
  `BigDecimal` `1856.906765` exactly (asserts no float precision loss).
- **`parse_usd_price` — only metal-per-USD present:** body with `"XAU": 0.00053853` (no `USDXAU`)
  returns `1 / 0.00053853` (assert within a tight tolerance / exact reciprocal expression).
- **`parse_usd_price` — error payload:** `{"success":false,"error":{...}}` returns `Err`.
- **`parse_usd_price` — missing symbol:** `success:true` but `rates` lacks the asset → `Err`.
- (Existing `packages/shared/tests/static_price_provider.rs::registry_rejects_unknown_key` already
  covers the unknown-key path; do not add an env-reading registry test for `metal_price`.)

Network-dependent paths (`current_price`/`historical_price`) are intentionally not unit-tested
(would require env + live HTTP); their logic is fully delegated to the tested pure helpers plus the
status-check pattern already proven by `CrystalClient`.

## Docs to Update

- `.env.example` — `METALPRICE_API_KEY`, `METALPRICE_BASE_URL` (step 7).
- `docs/references/index.md` — MetalpriceAPI vendor documentation pointer (step 7).
- `packages/shared/src/price_provider.rs` module doc — mention the live `metal_price` provider.
- No product-spec change: this is an internal pricing source with no new user/agent-facing surface.
  If the historical-granularity Open Question resolves toward a `HOURS`-interval guard, revisit
  `docs/RELIABILITY.md` for the operational note.
