# Issue #1783: Manual marks: suggested per-unit price and mark-due flags for the Trustee's revalue

Source: https://github.com/eq-lab/pipeline/issues/1783

Parent epic: #1775, merge-order step 4. It depends on #1779 (merged, `193ba5ee`) and #1780 (merged, `b42d58ff`). Its frontend pair is #1859, which prefills the `revalue` form with the suggested price and shows the mark-due and stale flags. #1859 already exists, so it is the "frontend follow-up" the acceptance asks for, and no new issue is filed. The contract source of truth is `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/{lib.rs,types.rs}`.

## Scope

The backend suggests a per-unit price for every open goods record and flags the marks that are due. The holder of `revalue` (TRUSTEE, via `access_manager.execute`, delay 0) submits the mark from the Trustee UI (#1859). The worker holds no key and makes no write.

### Contract facts this mirrors (e9881ac)

- `revalue(record_id, value_per_unit: i128, benchmark: Symbol, report_hash: BytesN<32>)` (`lib.rs:613-650`). It rejects `value_per_unit < 0`, allows `0` and stamps `at = ledger timestamp`. A USD record's mark is data only.
- Value is `Σ counted_quantity × value_per_unit`, divided by `1e7` once (`lib.rs:868-916`). Quantities are 7 dp in the record's `unit` (`Dmt` / `Mt` / `Bbl`; `Usd` iff not goods, `types.rs`). So **`value_per_unit` is USD per one record unit, at 7 dp** (`$100 / Mt` → `1_000_000_000`).
- A goods record's price is stale when it has no mark, or when `price_stale_after > 0 && now − mark.at > price_stale_after`. This is already mirrored in `shared::security_state::mark_stale`.
- The user docs say there is **no haircut** on goods (`risk-management.md:60`): "goods count at counted quantity times market price". The advance ratio is the margin. A suggested mark never applies `haircut_pct`.

### What is added

1. **`shared::security_marks`** (new, pure). It holds:
   - the commodity map and the mark policy;
   - commodity normalization and unit conversion;
   - 7-dp encoding and bounded decimal parsing;
   - the standard-goods and concentrate suggestion;
   - the canonical price report and its sha256;
   - the `mark_due` rule.

   The rule lives in `shared` so that #1784 ("overdue mark" alert, worker) and #1785 ("marked records" readiness) reuse it.
2. **Inline fields on `GET /v1/loan-book/{loan_id}/security`** (#1780). No new route.
   - Per record: `suggested_mark`, `suggestion_status`, `move_bps`, `mark_due`, `mark_due_reasons`, `mark_due_at`.
   - In `prices`: `mark_max_age`, `mark_move_bps`, `marks_due`.
3. **Price collector source.** `asset_price_collector` collects the union of today's list and the `(asset, provider)` pairs of the open SecurityRegistry goods records whose commodity is mapped. This includes the payable-metal assets of mapped concentrates. It is additive: with the map unset, or no SecurityRegistry rows, the list is unchanged and no new query runs.
4. **Config** (all optional; unset means no behaviour change):
   - `SECURITY_MARK_COMMODITIES` (API and worker, same value);
   - `SECURITY_MARK_MAX_AGE_SECS` (default `86400`);
   - `SECURITY_MARK_MOVE_BPS` (default `200`).

### Commodity → price mapping (proposed; human confirms, see Open Questions)

`SECURITY_MARK_COMMODITIES` is a JSON array, parsed once at boot by `shared::security_marks::MarkSettings::parse`:

```json
[{"commodity":"gold","mode":"StandardGoods","asset":"XAU","price_provider":"metal_price","quote_unit":"TroyOz","benchmark":"XAU"},
 {"commodity":"copper cathode","mode":"StandardGoods","asset":"XCU","price_provider":"metal_price","quote_unit":"TroyOz"},
 {"commodity":"gold pyrite concentrate","mode":"MetalConcentrate","asset":"XAU","price_provider":"metal_price","benchmark":"XAU_NSR"}]
```

**Normalization.** A record's free-text `commodity` and the map keys are normalized the same way:

- trim, then ASCII-lowercase;
- collapse every run of whitespace, `-` and `_` into one `_`;
- `gold pyrite concentrate`, `Gold-Pyrite  Concentrate` and `gold_pyrite_concentrate` are therefore one key;
- an empty result, a non-ASCII character or a key longer than 64 bytes never matches, so the record is unmapped.

**Matching.** Exact match on the normalized key only. There is no fuzzy or prefix match, and no fallback to the loan's `loan_collateral_valuations` anchor ("never guessed").

**Validation.** Boot fails with a message naming the key when any of these is violated. A malformed value is not "unset".

- the raw value is at most 16 KiB;
- at most 64 entries;
- the normalized `commodity` keys are unique;
- `asset` matches `[A-Z0-9_-]{1,16}`;
- `price_provider` satisfies `shared::price_provider::is_known_provider`;
- `quote_unit` is one of `TroyOz`, `Mt`, `Lb`, `Bbl` (required for `StandardGoods`; must be absent or `TroyOz` for `MetalConcentrate`);
- `benchmark` is a valid Soroban `Symbol`, `[A-Za-z0-9_]{1,32}`, and defaults to `asset`;
- `deny_unknown_fields`.

**Unit conversion (`StandardGoods`).** The factor is the number of quote units in one record unit. It is held as an exact rational `(num, den)`:

| record `unit` | `quote_unit` | factor | basis |
|---|---|---|---|
| `Mt`, `Dmt` | `TroyOz` | `10_000_000_000 / 311_035` | 1 t = 1e6 g / 31.1035 g. This is the constant `collateral_valuation` already uses, for parity with the CCR waterfall. |
| `Mt`, `Dmt` | `Mt` | `1 / 1` | |
| `Mt`, `Dmt` | `Lb` | `100_000_000_000 / 45_359_237` | 1 lb = 0.45359237 kg exactly |
| `Bbl` | `Bbl` | `1 / 1` | |
| anything else | | none | `unsupported_unit` |

`Dmt` is treated as a mass in tonnes, and moisture is not applied. A `Dmt` record of a standard good is valued per dry tonne.

**Standard goods.** `value_per_unit_raw = floor(price × factor × 1e7)`, where `price` is the latest `loan_asset_prices.price_usd` for `(asset, price_provider)`. It is computed exactly in `BigInt`: `price = int × 10^-scale` → `floor(int × num × 10^7 / (den × 10^scale))`, with a negative scale multiplied in. The result must fit `i128` and is clamped at `≥ 0`; otherwise the status is `unreadable`.

**Metal concentrate** (proposal):

- The record must be in `Dmt`, else `unsupported_unit`.
- Inputs are the **loan's** latest `loan_assays` and `loan_offtake_terms` (by `effective_at`, keyed by the on-chain `(chain_id, loan_id)`). They apply to every concentrate record of that loan. The record's `reference_grade` and the inspection `grade` are single unspecified scalars, so they are not used.
- `value_per_unit = max(0, NSR per dmt)`. `NSR per dmt = gross − treatment − refining − penalties` at `quantity_dmt = 1`, with `realisation_costs = 0` and `haircut = 0`. It reuses the existing waterfall through a new `collateral_valuation::nsr_per_dmt`.
- Each payable metal is priced at `(asset_for_metal(metal), mapping.price_provider)`.
- A missing assay or offtake, or a payable metal with no asset symbol, gives `inputs_missing`. A metal with no price gives `no_price`.

**Statuses** (`suggestion_status`):

- `ok`
- `unmapped` (map unset, or commodity not in it)
- `unsupported_unit`
- `no_price`
- `inputs_missing`
- `unreadable` (a stored number is out of bounds or malformed, or the result overflows)

`suggestion_status` and `suggested_mark` are `null` for non-goods records and for closed records (`Released` / `Enforced`). They are served for every **open** goods record, `PendingPerfection` and `UnderEnforcement` included, so that the Trustee can mark before `perfect`. `suggested_mark` is non-null only when the status is `ok`.

### `suggested_mark` object

| field | encoding | meaning |
|---|---|---|
| `value_per_unit` | 7-dp string (`format_7dp_i128`) | The value to pass to `revalue`. The frontend drops the dot to get the `i128`. |
| `benchmark` | string (Soroban Symbol) | From the map |
| `source_price` | plain decimal string, bounded | Latest `price_usd` of the mapping `asset`, per `quote_unit` |
| `source_at` | unix-seconds string | `timestamp` of that price row. For concentrates, the oldest metal price used. |
| `asset`, `price_provider`, `quote_unit`, `mode` | strings | `quote_unit` is `null` for concentrates |
| `assay_id`, `offtake_id` | id strings or `null` | Concentrate inputs. These tables are append-only, so the ids stay traceable. |
| `report` | string | Canonical price snapshot, see below |
| `report_hash` | 64 lowercase hex | `sha256(report)`, i.e. the `report_hash` guidance |

**Canonical report** (versioned and newline-joined, fixed key order, no trailing newline):

```
pipeline-mark/v1
chain_id=<i64>
security_registry=<C…>
record_id=<u32>
commodity=<normalized key>
unit=<Dmt|Mt|Bbl>
mode=<StandardGoods|MetalConcentrate>
asset=<asset>
price_provider=<key>
price=<source_price>
price_at=<unix>
quote_unit=<unit or ->
value_per_unit=<7dp>
benchmark=<symbol>
```

Concentrates append these lines:

- `assay_id=` and `offtake_id=`;
- one `metal.<ASSET>=<price>@<unix>` line per priced metal, sorted by asset.

Anyone who holds the report can verify the hash. The report carries every input, so the mark stays traceable even after `loan_asset_prices` retention prunes the price row. If the Trustee overrides the value, the suggestion's hash no longer describes the mark. The spec then tells the UI to hash its own evidence. That decision belongs to the frontend (#1859).

### `mark_due` and `move_bps` (per record)

The inputs are:

- `policy.max_age` (`SECURITY_MARK_MAX_AGE_SECS`, `0` = off);
- `policy.move_bps` (`SECURITY_MARK_MOVE_BPS`, `0` = off);
- the loan's `Terms.price_stale_after` (`psa`);
- the projected on-chain mark (`security_records.mark_value_per_unit` / `mark_at`, the same source `mark_stale` uses).

- `effective_max_age = min(max_age, psa)` when both are > 0. Otherwise it is whichever one is > 0, or `0` (no age trigger) when both are 0. When `terms` is `null`, `psa` is treated as 0.
- `move_bps`, signed (market vs mark):
  - `null` without a mark or without a suggestion;
  - `0` when both are 0;
  - `null` when the mark is 0 and the suggestion is > 0;
  - else `trunc((suggested − mark) × 10_000 / mark)`, saturated to `i32`, as a JSON number.
- `moved` is `|suggested − mark| × 10_000 > policy.move_bps × mark`, in exact `BigInt`. That makes the move strictly greater than the threshold, so exactly 2 % is not due. It is also `true` when the mark is 0 and the suggestion is > 0. It is `false` when the policy is off or there is no suggestion.
- `mark_due` is computed for **counted goods records** (`counts_toward_value && is_goods`), the records the contract's staleness reads. It is due when any reason holds:
  - `missing`: no mark;
  - `age`: `effective_max_age > 0 && now − mark_at > effective_max_age` (strict, like the contract);
  - `moved`.
- Other records get `mark_due: false` and `[]`. `mark_due: null` (with `[]`) when the mark time, the mark value or `price_stale_after` cannot be decoded. This follows the #1780 rule that unknown is never `false`.
- `mark_due_reasons` lists the reasons in the order `missing`, `age`, `moved`.
- `mark_due_at` is `mark_at + effective_max_age` as a string. It is `null` without a mark, with the age trigger off, or on overflow.
- `prices` gains these fields:
  - `mark_max_age` (effective seconds, string, `"0"` = off);
  - `mark_move_bps` (`u32`);
  - `marks_due` (`u32` count of due counted goods records; `null` if any of them is `null`).

### Out of scope

- No contract change (contracts are frozen).
- No AccessManager or `can_call` indexing, and no record-NFT indexing (human decisions).
- No worker key and no automatic `revalue`.
- No persistence of served suggestions (no new table).
- No change to the CCR or valuations endpoints, or to the EVM path.
- No user-docs rewrite. `risk-management.md:60` ("the platform feeds market prices … daily and on any move above 2 %") belongs to #1787; its wording is noted there.
- No frontend work (#1859).

## Assumptions and Risks

- **Merge order.**
  - Safe on pipeline-test on its own.
  - The API with the key unset serves every new field as `null`, `unmapped` or `[]`, with `mark_due` still computed from `missing` and `age`. The route is still `404` while the API SecurityRegistry key is unset.
  - The worker with `SECURITY_MARK_COMMODITIES` unset runs no new SQL, so its collected list is byte-for-byte today's.
  - No migration and no new required key, so the previous images keep booting and rollback works.
- **Malformed `SECURITY_MARK_COMMODITIES` fails boot.** This matches the existing Strkey validation. On the worker, it is read only when `JOB_ASSET_PRICE_COLLECTOR_ENABLED`, but a boot failure there stops every worker job. The coder adds a `chains_config`-style parse test with the exact message, and the rollout note says to set the value on the API first, then the worker.
- **API and worker must carry the same map.** If they differ, the API can map a commodity whose series the worker never collects. That is visible as `no_price`, never a wrong price. It is documented in backend.md.
- **Metalprice coverage and quote units are unverified here** (no API key). Precious metals (`XAU` / `XAG` / `XPT` / `XPD`) are quoted per troy ounce (`metal_price.rs` header). For base metals the quote unit must be checked by ops before mapping. The map makes `quote_unit` explicit instead of assuming it. Non-metal goods (oil in `Bbl`, grain) have no provider today, so they stay `unmapped` or `no_price` until a provider is added.
- **Price freshness.** The collector default is a daily 12:00 UTC grid, so the latest price can be up to ~24 h old. A suggestion is served with `source_at` and never withheld for age. The `moved` comparison uses that price. A source-age gate is not proposed, and the UI shows `source_at`.
- **Testnet has no SecurityRegistry records yet** (as of ledger ~5 585 400). Acceptance is unit-level, and the end-to-end check runs in QA #1777.
- **DoS bounds.** These are the two findings this week.
  - `loan_asset_prices.price_usd` is unbounded `NUMERIC`, and sqlx can return a negative scale (`125E+8`).
  - The assay and offtake JSON decimals are stored strings. Today's `validate_assay` / `validate_offtake` do not bound exponents, so `1e999999999` passes.
  - New code never does arithmetic or `to_plain_string()` on an unchecked decimal. Every price and every assay or offtake decimal used here goes through `security_marks::bounded_dec` / `bounded_dec_str`: string ≤ 64 bytes, exponent (scale) in `[-40, 40]`, ≤ 60 significant digits. Anything else gives status `unreadable` and a `warn!`.
  - The existing CCR and valuations path (`collateral_valuation::dec` → `compute_collateral`) has the same unbounded parse. It is not fixed here. The coder logs it as a new `BUG-` entry in `docs/exec-plans/known-bugs.md` (AGENTS: do not fix unrelated bugs inline).
- **Concentrate inputs need an anchor.** `POST …/assay` and `…/offtake` require a `loan_collateral_valuations` anchor (`get_anchor`), so a SecurityRegistry loan without a submission-time anchor has no assay or offtake. Its concentrate records read `inputs_missing`. That is correct and documented.
- **Public data.** The route is public. It now also serves off-chain price data and the NSR derived from offtake terms. The public `GET /v1/loan-book/{id}/valuations` already exposes the full waterfall, so nothing new is disclosed. The spec's Security section is updated ("on-chain data only" no longer holds).
- **Degradation.** A failing price, assay or offtake read on the security route is logged, and the affected records get `no_price` / `inputs_missing`. The route never answers `500` for the enrichment alone. The #1780 projection read keeps its current error behaviour.
- **AppState gains a field.** About 17 test constructors (`grep -rl "security_registry_addresses:" packages/api`) need `security_marks: Default::default()`, the same churn as #1780.

## Open Questions

_None_

### Resolved questions (human, 2026-11-09)

1. **Concentrate value per unit:** NSR per dry tonne from the loan's latest assay + offtake, applied to every concentrate record of the loan; no realisation costs, no haircut, the record's own grade unused — as proposed.
2. **Mapping:** the shared optional env key `SECURITY_MARK_COMMODITIES` (API + worker); a DB table may come later if ops need to edit it.
3. **Testnet values:** decided at rollout; until then the key is unset and the feature ships dark.

## Implementation Steps

1. **`packages/shared/src/security_marks.rs`** (new; `pub mod security_marks;` in `lib.rs`; spec header `// spec: docs/product-specs/loan-security-state.md#mark-suggestions`). It is pure: no I/O and no env reads, except a thin `MarkSettings::from_env()` that only reads the three keys and calls `parse`.
   - Types:
     - `MarkMode { StandardGoods, MetalConcentrate }`;
     - `QuoteUnit { TroyOz, Mt, Lb, Bbl }`;
     - `CommodityMapping { commodity, mode, asset, price_provider, quote_unit: Option<QuoteUnit>, benchmark }`;
     - `CommodityMap` (normalized key → mapping; `is_empty`, `get(raw_commodity)`, `pairs()`);
     - `MarkPolicy { max_age: u64, move_bps: u32 }`, with `Default` 86400 / 200;
     - `MarkSettings { map, policy }`, with `Default` = empty map plus the default policy.
   - `MarkSettings::parse(commodities: Option<&str>, max_age: Option<&str>, move_bps: Option<&str>) -> anyhow::Result<Self>`. It applies every validation in Scope, with messages that name the key. Blank counts as unset.
   - `normalize_commodity(&str) -> Option<String>`.
   - `quote_factor(record_unit: &str, quote: QuoteUnit) -> Option<(u64, u64)>`.
   - Bounded parsing:
     - `bounded_dec(&BigDecimal) -> Option<BigDecimal>`: exponent in `[-40, 40]`, `digits() <= 60`; a negative scale is rescaled to 0.
     - `bounded_dec_str(&str) -> Option<BigDecimal>`: length ≤ 64 before `from_str`, then `bounded_dec`.
     - `plain(&BigDecimal) -> String`, only on a bounded value.
   - `standard_vpu_raw(price, (num, den)) -> Option<i128>` (exact `BigInt` floor, clamp ≥ 0).
   - `concentrate_vpu_raw(assay, offtake, prices) -> Result<i128, SuggestionStatus>`. It pre-validates every decimal string and NUMERIC it reads through `bounded_dec_str` / `bounded_dec` (`step > 0` included), then calls `collateral_valuation::nsr_per_dmt`, then `max(0, ·)`, `with_scale_round(7, Down)` and `→ i128`.
   - `SuggestionStatus` (`as_str`: `ok`, `unmapped`, `unsupported_unit`, `no_price`, `inputs_missing`, `unreadable`).
   - `Suggestion { value_per_unit: i128, benchmark, source_price: String, source_at: i64, asset, price_provider, quote_unit, mode, assay_id, offtake_id, report, report_hash }`.
   - `suggest(ctx: &SuggestCtx, record_commodity, record_unit) -> Result<Suggestion, SuggestionStatus>`. `SuggestCtx` carries `chain_id`, `security_registry`, `record_id`, `&CommodityMap`, the prices `HashMap<(String, String), (BigDecimal, DateTime<Utc>)>` and `Option<(&AssayRow, &OfftakeTermsRow)>`.
   - `report_text(...)` and `report_hash(text) -> String` (`sha2::Sha256`, lowercase hex).
   - `effective_max_age(max_age, psa) -> u64`, `move_bps(mark: i128, suggested: i128) -> Option<i32>` and `moved(mark, suggested, threshold_bps) -> bool`.
   - `MarkDue { due: bool, reasons: Vec<&'static str>, due_at: Option<u64> }`.
   - `mark_due(now, mark: Option<(i128, u64)>, suggested: Option<i128>, psa: u64, policy) -> MarkDue`.
2. **`packages/shared/src/collateral_valuation/mod.rs`**: add `pub fn nsr_per_dmt(assay, offtake, prices) -> anyhow::Result<Option<BigDecimal>>`. It reuses the private `assemble_metals` / `assemble_penalties` and builds `ConcentrateInputs { quantity_dmt: 1, realisation_costs: 0, haircut: 0, .. }.valuate().nsr`. The CCR path and its signatures are unchanged. Also expose `pub fn troy_oz_factor_per_tonne() -> (u64, u64)`, or keep the constant in `security_marks` with a parity test against `31.1035`.
3. **`packages/shared/src/loan_asset_price_repo.rs`**: add `pub const LATEST_PRICES_FOR_PAIRS_SQL` and `latest_prices_for(&[(String, String)]) -> Result<Vec<(String, String, BigDecimal, DateTime<Utc>)>>`. The query is `SELECT DISTINCT ON (p.asset, p.price_provider) p.asset, p.price_provider, p.price_usd, p.timestamp FROM loan_asset_prices p JOIN UNNEST($1::text[], $2::text[]) AS w(asset, price_provider) ON w.asset = p.asset AND w.price_provider = p.price_provider ORDER BY p.asset, p.price_provider, p.timestamp DESC`, and it uses `loan_asset_prices_asset_prov_ts_idx`. It is not called when the pair list is empty.
4. **`packages/shared/src/security_registry_repo.rs`**: add two collector queries as `pub const` plus methods.
   - `LIST_OPEN_GOODS_COMMODITIES_SQL`: `SELECT DISTINCT commodity FROM security_records WHERE commodity IS NOT NULL AND protection IN ('EndorsedBl','WarehousePledge','CollateralManagement') AND status NOT IN ('Released','Enforced')`.
   - `LIST_OPEN_GOODS_OFFTAKE_METALS_SQL`: `SELECT DISTINCT r.commodity, term ->> 'metal' AS metal FROM security_records r JOIN loan_offtake_terms o ON o.chain_id = r.chain_id AND o.loan_id = r.loan_id CROSS JOIN LATERAL jsonb_array_elements(o.payable_terms) AS term WHERE …same open-goods filter… AND term ->> 'metal' IS NOT NULL`.
   - Methods `list_open_goods_commodities()` and `list_open_goods_offtake_metals()`. They are not contract-scoped on purpose: keeping a price series warm for a de-configured registry is harmless. The spec says so.
5. **`packages/worker/src/asset_price_collector/`**:
   - `config.rs`: `AssetPriceCollectorSettings` gains `security_marks: shared::security_marks::CommodityMap`, from `MarkSettings::from_env()?.map`. The struct is no longer `Copy`; adjust it to `Clone` and pass by reference.
   - `mod.rs`: extract the union in `cycle` into `pub fn collection_pairs(anchor_pairs, concentrate_metals, map: &CommodityMap, sr_commodities: &[String], sr_offtake_metals: &[(String, String)]) -> Vec<AssetProvider>`.
     - It keeps today's order and dedup exactly.
     - It then appends `(mapping.asset, mapping.price_provider)` for each mapped SecurityRegistry commodity, and `(asset_for_metal(metal), mapping.price_provider)` for each mapped `MetalConcentrate` commodity's offtake metals, deduped.
   - `cycle` takes `Option<&SecurityRegistryRepo>`. It runs the two SecurityRegistry queries only when the map is non-empty, and a query error is logged and treated as empty, so the cycle never aborts.
   - `run_asset_price_collector_job` takes the repo.
   - `main.rs`: build `SecurityRegistryRepo::new(pool.clone())` for the collector. Extend the boot guard input with the map's providers (`non_market_providers_in_use(anchor_providers ∪ map providers, allow_non_market)`).
6. **`packages/api`**:
   - `lib.rs`: `AppState.security_marks: shared::security_marks::MarkSettings`.
   - `main.rs`: `MarkSettings::from_env()?` with a `tracing::info!` of the mapped keys and the policy.
   - Every `AppState { … }` literal in `packages/api/tests/*.rs` and `src`: add `security_marks: Default::default()`.
7. **`packages/api/src/security_state.rs`**:
   - New `pub struct MarkInputs { settings: MarkSettings (or &), prices: HashMap<(String, String), (BigDecimal, DateTime<Utc>)>, concentrate: Option<(AssayRow, OfftakeTermsRow)> }`, with `Default`.
   - New `pub fn mark_price_pairs(rows: &LoanSecurityRows, map: &CommodityMap, concentrate: Option<&OfftakeTermsRow>) -> Vec<(String, String)>` and `pub fn needs_concentrate_inputs(rows, map) -> bool`. These are pure, so the route knows what to read.
   - `build_security_response(chain_id, contract, loan_id, rows, now, marks: &MarkInputs)` gains the last parameter. Update the three call sites in `tests/loan_security.rs`.
   - New `SuggestedMarkDto` (fields per Scope, all strings except `quote_unit`, `assay_id` and `offtake_id` as `Option<String>`).
   - `SecurityRecordDto` gains `suggested_mark: Option<SuggestedMarkDto>`, `suggestion_status: Option<String>`, `move_bps: Option<i32>`, `mark_due: Option<bool>`, `mark_due_reasons: Vec<String>` and `mark_due_at: Option<String>`, filled in `record_dto`:
     - the on-chain mark comes from `dec_to_i128(mark_value_per_unit)` and `Unreadable::u64(mark_at)`;
     - `psa` comes from `ctx.un.u64(&terms.price_stale_after)`, or 0 without terms;
     - `price_stale_after` does not apply when terms are `null`.
   - `PricesDto` gains `mark_max_age: Option<String>`, `mark_move_bps: u32` and `marks_due: Option<u32>`.
   - Field docs follow the existing style. Doc comments on DTOs are rendered into OpenAPI, the same as #1780's `/// …` lines.
8. **`packages/api/src/routes/loan_security.rs`**: after `load_loan_security`, when `!state.security_marks.map.is_empty()`:
   - If `needs_concentrate_inputs`, read `CollateralValuationRepo::latest_assay` / `latest_offtake(chain_id, &BigDecimal::from(id))`.
   - Compute `mark_price_pairs`, then read `state.loan_asset_price_repo.latest_prices_for(&pairs)`.
   - Every enrichment error is `warn!`-logged and leaves the inputs empty.
   - Register `SuggestedMarkDto` in `LoanSecurityDoc` `components(schemas(...))`, and extend the 200 description ("… and a suggested mark per open goods record").
9. **`.env.example`**: add `SECURITY_MARK_COMMODITIES` (commented example), `SECURITY_MARK_MAX_AGE_SECS=86400` and `SECURITY_MARK_MOVE_BPS=200` with "optional, API + worker / API". Place them next to the `PRICE_PROVIDER_ALLOW_NON_MARKET` block and the API SecurityRegistry key.
10. **Docs** (see Docs to Update), the user-stories doc, and the known-bugs entry.
11. `cargo fmt`, `cargo clippy --all -- -D warnings`, `cargo test -p shared -p pipeline-api -p pipeline-worker` (package names per `Cargo.toml`), and `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts`. The code is comment-less: one spec-pointer header per new file, and no body or test comments.

## Test Strategy

The tests are pure units. None reads `DATABASE_URL`, `POSTGRES_URL` or any env var, and none connects to Postgres; `connect_lazy` in AppState fixtures is fine as today. Tests live in `packages/<pkg>/tests/<topic>.rs` and are never inline.

- **`packages/shared/tests/security_marks.rs`** (new):
  - **Mapping per unit:**
    - `Mt` and `Dmt` × `TroyOz` (gold at `4000` → `floor(4000 × 1e17 / 311035)` raw, exact);
    - `Mt` × `Mt`;
    - `Mt` × `Lb`;
    - `Bbl` × `Bbl`;
    - `Bbl` × `TroyOz` and `Mt` × `Bbl` → `unsupported_unit`;
    - `Usd` → not goods.
  - **Normalization:** case, `-` / `_` / whitespace collapse, trim; non-ASCII, empty and 65-byte keys never match.
  - **Unmapped:** commodity not in the map, and an empty map → `unmapped`, with no price lookup.
  - **Concentrates:** the spec's worked example (50 g/t Au, 80 % payable, 1 g/t deduction, TC 220, RC 6, As 2 % with tier 0.2 / 0.1 / 5) at `XAU = 4000`.
    - The `vpu` equals `floor(nsr_per_dmt × 1e7)`, and `nsr_per_dmt × 100` equals `valuate(quantity 100).nsr` to 7 dp.
    - A record in `Mt` → `unsupported_unit`; no assay or no offtake → `inputs_missing`; `copper` payable → `inputs_missing`; `XAG` unpriced → `no_price`.
    - A negative NSR (penalty larger than gross) → `0`.
  - **7-dp encoding:**
    - `100` per `Mt`/`Mt` → `"100.0000000"` and raw `1_000_000_000`;
    - a price with more than 7 decimals floors;
    - `sqlx`-style negative scale (`BigDecimal::new(125.into(), -8)`) is accepted;
    - the result overflowing `i128` → `unreadable`.
  - **Bounded parsing:**
    - `bounded_dec_str("1e999999999")`, `"1e-41"`, a 65-byte string and 61 digits → `None` without hanging (assert it runs under a trivial time budget, e.g. the test simply completes);
    - an exponent of exactly ±40 is accepted;
    - an assay containing `1e999999999` → `unreadable`.
  - **`mark_due` edges:**
    - **Missing mark:** `missing`.
    - **24 h edge:** policy 86400, psa 0: age 86400 is not due; 86401 is due with `age` and `due_at = mark_at + 86400`.
    - **`price_stale_after` edge:** psa 3600 < 86400: 3600 is not due, 3601 is due.
    - **psa larger than the policy:** psa 172800 still gives 86400.
    - **Both off:** both 0 → no age trigger.
    - **2 % edge:** `m = 1_000_000_000`, `s = 1_020_000_000` → not moved, `move_bps = 200`; `s = 1_020_000_001` → moved; `s = 979_999_999` → moved, `move_bps = -200`.
    - **Mark 0:** mark 0 with suggestion 0 → `move_bps 0`, not moved; mark 0 with suggestion > 0 → `move_bps null`, moved.
    - **Policy off:** move policy 0 never moves.
    - **No suggestion:** only `missing` / `age` apply.
    - **Reason order:** the reasons come in a stable order.
  - **Report:** a golden `report` text and `report_hash` for a fixed input. The hash changes when any field changes. Concentrate metal lines are sorted.
  - **Config parsing:**
    - unset → empty map plus defaults;
    - a valid two-entry JSON;
    - errors, each naming `SECURITY_MARK_COMMODITIES`: duplicate normalized key, unknown provider, bad asset, a benchmark over 32 characters or with `-`, `quote_unit` missing for `StandardGoods`, `quote_unit: Mt` on a concentrate, an unknown field, more than 64 entries, more than 16 KiB;
    - `SECURITY_MARK_MAX_AGE_SECS` and `SECURITY_MARK_MOVE_BPS`: non-numeric fails, blank uses the default, `0` is accepted.
- **`packages/shared/tests/collateral_valuation.rs`:** `nsr_per_dmt` linearity against `compute_collateral` (StandardGoods unchanged), and `None` when a metal is unpriced.
- **`packages/shared/tests/security_registry_repo_sql.rs`:** needles for both new consts:
  - `FROM security_records`, `status NOT IN ('Released','Enforced')`, the three goods protections, `commodity IS NOT NULL`;
  - `JOIN loan_offtake_terms o ON o.chain_id = r.chain_id AND o.loan_id = r.loan_id`, `jsonb_array_elements(o.payable_terms)`.
- **`packages/shared/tests/loan_asset_price_repo_sql.rs`** (new): needles for `LATEST_PRICES_FOR_PAIRS_SQL` (`DISTINCT ON (p.asset, p.price_provider)`, `UNNEST($1::text[], $2::text[])`, `ORDER BY p.asset, p.price_provider, p.timestamp DESC`).
- **`packages/worker/tests/asset_price_collector.rs`:**
  - **Regression (the acceptance item):** `collection_pairs` with an empty map, or with no SecurityRegistry rows, is identical (order included) to the legacy union for a fixture of anchors plus concentrate metals.
  - **Mapped goods:** a mapped SecurityRegistry commodity appends its pair once, even when it is already present.
  - **Concentrates:** a mapped concentrate appends each metal asset, and an unknown metal is skipped.
  - **Unmapped:** an unmapped SecurityRegistry commodity adds nothing.
  - **Boot guard:** the guard flags a map provider `static` without the escape hatch.
- **`packages/api/tests/loan_security.rs`:**
  - **Default (unset) `MarkInputs`:**
    - every goods record has `suggestion_status: "unmapped"`, `suggested_mark: null` and `move_bps: null`;
    - a counted unmarked goods record has `mark_due: true` with `["missing"]`;
    - a USD record has `suggestion_status: null` and `mark_due: false`;
    - a `Released` goods record has `suggestion_status: null`.
  - **Mapped `MarkInputs` with a price:**
    - the exact `value_per_unit`, `benchmark`, `source_price`, `source_at`, `report_hash` length 64, and `move_bps`;
    - `mark_due` with `["moved"]`, and `prices.marks_due` / `mark_max_age` / `mark_move_bps`.
  - **`PendingPerfection` goods record:** a suggestion is served and `mark_due` is `false`.
  - **Unreadable mark time:** `mark_due: null` and `marks_due: null`.
  - **Pure helpers:** `mark_price_pairs` and `needs_concentrate_inputs`.
  - **OpenAPI:** the document lists `SuggestedMarkDto` and the new record and prices properties.
  - **EVM unchanged:** the EVM chain still answers `404 security_registry_not_configured` with a mapped `security_marks` in AppState.
- **Existing tests:** all keep passing with only the `build_security_response` arity and `security_marks: Default::default()` edits.

## Docs to Update

- **`docs/product-specs/loan-security-state.md`:**
  - Overview: mark suggestions and the off-chain price inputs.
  - Behavior table: new rows for `suggested_mark` / `suggestion_status` (computed from `loan_asset_prices` and the latest loan assay and offtake), `move_bps`, `mark_due*` and `prices.mark_*`.
  - A new `## Mark Suggestions` section (anchor `#mark-suggestions`) with:
    - the map format and normalization;
    - the unit table;
    - the standard and concentrate formulas;
    - the statuses;
    - the report format and hash;
    - the `mark_due` rule with the policy keys;
    - the guidance that `report_hash` is the suggestion's, so an overridden price needs the UI's own evidence hash.
  - Computed Fields: list the `shared::security_marks` functions.
  - API Contract example: the new fields.
  - Data Model: reads `loan_asset_prices`, `loan_assays` and `loan_offtake_terms`; still no migration.
  - Security: no longer on-chain-only; the same disclosure as `/valuations`; bounded parsing.
- **`docs/product-specs/collateral-valuation.md`:** the price collector also collects the mapped SecurityRegistry commodities and their payable metals (additive), plus a pointer to `nsr_per_dmt` and to the mark-suggestion section.
- **`docs/references/backend.md`:**
  - in the SecurityRegistry paragraph (around line 468), the three keys (optional; the same `SECURITY_MARK_COMMODITIES` on API and worker; malformed fails boot; set the API first);
  - the collector source change;
  - a rollout step after step 6 for the testnet argocd values.
- **`.env.example`:** the three keys.
- **`docs/user-stories/epic-1775/1783-manual-marks-suggested-price.md`** (new, same format as `1780-…`): unset key; mapped standard good; unmapped commodity; concentrate; mark due by age / move / missing; collector unchanged without the map. Add it to `docs/user-stories/index.md`.
- **`docs/exec-plans/known-bugs.md`:** a new `BUG-` entry. Assay and offtake validation (`routes/collateral_valuation.rs` `parse_dec`) accepts unbounded exponents, which `collateral_valuation::dec` / `compute_collateral` then expand on `/valuations`, the loan book and `ccr-history`. It records the location, symptom, root cause and workaround: bounded parse, as done in `security_marks`.
- **`docs/product-specs/index.md`:** no new spec file, so no change unless the security-state entry's one-liner is updated to mention marks.
- **Note for #1787 (not edited here):** `risk-management.md:60` should say the Trustee pushes marks manually, with backend suggestions and a due flag at 24 h or a 2 % move.
