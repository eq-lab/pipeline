# Issue #1023: Guard against non-market price providers resolving in production

Source: https://github.com/eq-lab/pipeline/issues/1023

## Scope

Make it impossible for a **production** deployment to resolve a non-market price
provider (today: the `static` stub, `StaticPriceProvider`) for a live loan, while
keeping the stub usable in dev/test behind an explicit escape hatch.

In scope:

1. **Provider registry (`packages/shared/src/price_provider.rs`).** Classify each
   registered provider as market vs non-market, and make `price_provider_for` refuse a
   non-market key unless the caller explicitly opts in (dev/test escape hatch, default
   refuse). Return the existing `anyhow::Err` so the collector logs-and-skips exactly as
   it already does for unknown keys / missing API config.
2. **Submission validation (`packages/api/src/routes/loan_book.rs`).** In the pure
   `validate_submission`, reject a `price_provider` that is not a known registry key
   (same style as the neighbouring `valuation_mode` check) and reject an empty/blank
   `asset`.
3. **DB constraint (`packages/shared/migrations/`).** Add a `CHECK` constraint on
   `collateral_valuation_config.price_provider` (mirroring the `valuation_mode` CHECK on
   the same table). Per decision, the migration does **not** scan/flag surviving `static`
   rows in the data tables — CHECK only.
4. **Worker startup assertion (`packages/worker/`).** At worker boot, when the escape
   hatch is off, fail fast if any **drawn** loan's valuation anchor names a non-market
   provider.

Out of scope:

- Removing or changing `StaticPriceProvider`'s behavior — it stays as the dev/test stub.
- A `CHECK` constraint on `loan_collateral_valuations.price_provider` (see Assumptions —
  it would break existing pure fixtures that use arbitrary provider strings; the API
  validation + resolution guard + startup assertion already cover that table).
- A canonical "valid asset symbol" whitelist — none exists in the codebase and
  `metal_price` accepts arbitrary currency symbols (see Open Questions).
- Any on-chain / contract change. Per the issue this is monitoring integrity, not funds.

## Assumptions and Risks

- **Only one non-test caller of `price_provider_for`.** Confirmed by grep: the sole
  non-test call site is `packages/worker/src/asset_price_collector/mod.rs:200`. The only
  test caller is `packages/shared/tests/static_price_provider.rs`. Changing the signature
  is low-churn.
- **The escape-hatch flag must be a parameter, not an env read inside
  `price_provider_for`.** `validate_submission` is documented as pure and unit-tested
  without env, and project rule forbids env-gated tests. So the flag is threaded as an
  explicit `bool` argument; the single env read happens in worker config
  (`AssetPriceCollectorSettings::from_env`). This keeps `shared` pure and testable.
- **Existing tests will break and must be updated in the same PR:**
  - `packages/api/tests/loan_submission.rs` fixture uses `price_provider: "LME"` (lines
    45 and 361) — not a known key. `validate_submission` currently accepts it; after this
    change it must be a known key (`metal_price`). Both sites must change or
    `valid_submission_passes` / the JSON deserialize test will fail.
  - `packages/shared/tests/static_price_provider.rs:60` calls
    `price_provider_for(STATIC_PROVIDER_KEY).unwrap()` — must pass the new
    `allow_non_market = true` argument, else it fails (static is non-market).
  - `packages/api/tests/ccr_history.rs:46` (`"ICE"`) and
    `packages/shared/tests/collateral_valuation.rs:205` (`"metalpriceapi"`) build
    **in-memory** `CollateralValuationRow` structs only — never validated, never inserted.
    No `CHECK` on `loan_collateral_valuations`, so these need **no** change. (This is a
    key reason CHECK is scoped to `collateral_valuation_config` only.)
- **"Non-closed" is not cleanly queryable.** On-chain closed/repaid status is not copied
  into `submitted_loans` (see `20260713000001_submitted_loans_onchain_link.sql`). The
  startup assertion therefore checks all **drawn** loans (`submitted_loans.chain_id IS NOT
  NULL`) — a stricter, safe superset of "approved, non-closed". In production no live loan
  should ever carry `static`, so the superset costs nothing.
- **Registry ↔ CHECK coupling.** The provider key set now lives in two places: the Rust
  registry and the SQL `CHECK`. Adding a future provider means updating both. This mirrors
  the existing `valuation_mode` CHECK / `ValuationMode` enum coupling and is acceptable;
  note it in the migration comment.
- **Dev workflow risk.** After this change, local dev using `static` must set
  `PRICE_PROVIDER_ALLOW_NON_MARKET=true`, or the collector will log-and-skip every
  `static` pair and worker startup will abort. Mitigated by adding it to `.env.example`
  with a dev value and a clear "unset in production" comment.

## Open Questions

_None_ — both resolved by the issue owner (2026-08-11):

- **"Flag surviving `static` rows":** decided **CHECK only, no row scan**. The migration
  adds the `CHECK` on `collateral_valuation_config.price_provider` and does not touch
  `loan_asset_prices` / `loan_collateral_valuations`.
- **`asset` validation strictness:** decided **non-empty only** (mirrors the existing
  `to` / `metadata_uri` checks). No symbol whitelist / format check.

## Implementation Steps

**Status: all steps 1–6 implemented on `fix/1023-guard-non-market-price-providers`.**
`cargo clippy --all -- -D warnings` is clean; `cargo test -p shared`,
`cargo test -p pipeline-api`, `cargo test -p pipeline-worker`, and full
`cargo test --all` all pass (0 failures). No deviations from the plan.

### 1. Provider registry — market classification + guarded resolution

`packages/shared/src/price_provider.rs`

1. Add a small provider descriptor table so market-ness lives next to the keys:
   ```rust
   struct ProviderSpec { key: &'static str, is_market: bool }
   const PROVIDERS: &[ProviderSpec] = &[
       ProviderSpec { key: STATIC_PROVIDER_KEY,     is_market: false },
       ProviderSpec { key: METALPRICE_PROVIDER_KEY, is_market: true  },
   ];
   ```
2. Add public helpers:
   - `pub fn is_known_provider(key: &str) -> bool` — key is in `PROVIDERS`.
   - `pub fn is_market_provider(key: &str) -> bool` — key is in `PROVIDERS` and
     `is_market` (unknown ⇒ false).
3. Change the signature to
   `pub fn price_provider_for(key: &str, allow_non_market: bool) -> Result<Arc<dyn PriceProvider>>`:
   - Resolve the key as today. Before returning, if the resolved provider is non-market
     **and** `!allow_non_market`, return
     `Err(anyhow!("non-market price provider `{key}` refused in production; set PRICE_PROVIDER_ALLOW_NON_MARKET to allow in dev/test"))`.
   - Unknown key ⇒ existing "unknown price provider key" error (unchanged).
4. Update the module rustdoc to describe market vs non-market and the escape hatch.

### 2. Thread the escape hatch through the collector

`packages/worker/src/asset_price_collector/config.rs`

- Add `pub allow_non_market: bool` to `AssetPriceCollectorSettings`.
- In `from_env`, set it via `env_bool("PRICE_PROVIDER_ALLOW_NON_MARKET")` (reuse
  `crate::indexer::config::env_bool`; add the `use`). Document the var in the struct
  rustdoc.

`packages/worker/src/asset_price_collector/mod.rs`

- In `collect_asset`, change the call at line 200 to
  `price_provider_for(provider_key, settings.allow_non_market)?`. The existing per-pair
  error handling in `cycle` (lines 182–187) already logs-and-skips on `Err`, so a refused
  `static` pair is logged and skipped — no further change needed there.

### 3. Submission validation

`packages/api/src/routes/loan_book.rs`

- Add `use shared::price_provider::is_known_provider;` (the crate already imports other
  `shared::*` modules).
- In `validate_submission`, immediately after the `valuation_mode` match (~line 1030) add:
  - `asset` non-empty: if `req.collateral_valuation.asset.trim().is_empty()` ⇒
    `Err("`asset` must not be empty".to_owned())`.
  - known provider: if `!is_known_provider(&req.collateral_valuation.price_provider)` ⇒
    `Err(format!("unknown price_provider `{other}` (expected one of: static, metal_price)"))`.
    (Accept any *known* key, including `static` — the market guard is enforced at
    resolution/startup, which respect the dev escape hatch. Keeping `validate_submission`
    env-free preserves its purity and its unit tests.)

### 4. Migration — CHECK constraint (no row scan)

New file `packages/shared/migrations/20260811000001_price_provider_market_guard.sql`
(next date-ordered slug after `20260810000001_drop_bank_transactions.sql`):

- `ALTER TABLE collateral_valuation_config ADD CONSTRAINT collateral_valuation_config_price_provider_check CHECK (price_provider IN ('static', 'metal_price'));`
- Header comment: purpose, the forward-only rollback reference (mirroring sibling
  migrations), and a note about the registry↔CHECK coupling.
- Per decision: no scan/flag of `loan_asset_prices` / `loan_collateral_valuations`.

### 5. Worker startup assertion

`packages/shared/src/collateral_valuation_repo.rs`

- Add `pub async fn distinct_providers_for_drawn_loans(&self) -> Result<Vec<String>, sqlx::Error>`:
  ```sql
  SELECT DISTINCT lcv.price_provider
  FROM loan_collateral_valuations lcv
  JOIN submitted_loans sl ON sl.id = lcv.submitted_loan_id
  WHERE sl.chain_id IS NOT NULL
  ```

`packages/worker/src/asset_price_collector/mod.rs`

- Add a pure helper (unit-testable, no DB):
  `pub fn non_market_providers_in_use(providers: &[String], allow_non_market: bool) -> Vec<String>`
  → returns keys for which `!is_market_provider(k) && !allow_non_market`.
- Add `pub async fn assert_live_loans_use_market_providers(repo: &CollateralValuationRepo, allow_non_market: bool) -> anyhow::Result<()>`
  that loads `distinct_providers_for_drawn_loans`, runs the pure helper, and returns
  `Err(anyhow!(...))` naming the offending provider keys if the list is non-empty.

`packages/worker/src/main.rs`

- Inside the `JOB_ASSET_PRICE_COLLECTOR_ENABLED` block, before spawning the job, `?`-call
  `assert_live_loans_use_market_providers(&anchors_repo, settings.allow_non_market).await`
  so a misconfigured production worker aborts at boot with a clear error (migrations have
  already run at this point).

### 6. Update tests (see Test Strategy) and `.env.example`

- `.env.example`: add `PRICE_PROVIDER_ALLOW_NON_MARKET=true` with a comment: "dev/test
  only — allows the non-market `static` price stub; leave unset/false in production."

## Test Strategy

- `packages/shared/tests/static_price_provider.rs`:
  - Update `registry_resolves_static_key` to `price_provider_for(STATIC_PROVIDER_KEY, true)`.
  - Update `registry_rejects_unknown_key` to pass a bool (e.g. `false`) — still `Err`.
  - Add `registry_refuses_static_without_escape_hatch`:
    `assert!(price_provider_for(STATIC_PROVIDER_KEY, false).is_err());`
  - Add `is_market_provider` / `is_known_provider` assertions: `metal_price` market,
    `static` known-but-not-market, `"nope"` neither.
- `packages/api/tests/loan_submission.rs`:
  - Change the `valid_request()` fixture provider (line 45) and the JSON payload (line
    361) from `"LME"` to `"metal_price"`.
  - Add `unknown_price_provider_is_rejected` (set `price_provider = "LME"`, expect
    `Err` mentioning `price_provider`).
  - Add `empty_asset_is_rejected` (blank `asset`, expect `Err`).
  - Add `static_provider_is_accepted_at_submission` (known key ⇒ `Ok`, documenting that
    the market guard is a resolution/startup concern, not a submission concern).
- `packages/worker/tests/asset_price_collector.rs`: add unit tests for
  `non_market_providers_in_use`:
  - `["metal_price"]`, `allow=false` ⇒ empty.
  - `["static"]`, `allow=false` ⇒ `["static"]`.
  - `["static"]`, `allow=true` ⇒ empty.
  - `["metal_price","static"]`, `allow=false` ⇒ `["static"]`.
- Lint gate: `cargo clippy --all -- -D warnings` (per AGENTS.md) after the Rust changes.
- The `CHECK` constraint, `distinct_providers_for_drawn_loans`, and
  `assert_live_loans_use_market_providers`'s DB path are validated by migration run at
  worker boot / CI DB setup, not by unit tests (project rule: unit tests do not connect to
  Postgres). The pure helper carries the logic coverage.

## Docs to Update

- `docs/product-specs/collateral-valuation.md` — in **Price sources**, add a one-line
  policy: the protocol distinguishes market price providers (live external feeds) from
  non-market stubs used only in development, and a production deployment refuses to resolve
  a non-market provider for a live loan.
- `.env.example` — document `PRICE_PROVIDER_ALLOW_NON_MARKET` (see step 6).
- Module rustdoc in `packages/shared/src/price_provider.rs` (see step 1.4).
- No change to `docs/product-specs/price-feed.md` (behavior of the feed loop is unchanged;
  this only guards which provider may resolve).
