# Issue #1940: API: /security and loan-book LTV fields for EVM chains

Source: https://github.com/eq-lab/pipeline/issues/1940

Parent epic: #1937 (EVM parity). Stellar counterparts: #1780 (`GET /v1/loan-book/{loan_id}/security`), #1786 Phase 1 (loan-book `ltv_bps` / `margin_call_open` / `price_stale`), #1781 (audit-log `Security*` rows), #1783 (mark suggestions). Depends on #1938 (EVM SecurityRegistry indexer), which is merged on `main` (PR #1947). Runs alongside #1941 (`pending_operations` for EVM), which stays out of scope. No Figma reference, so there is no visual verification step.

Contracts are frozen: `pipeline-contracts@150631a`, Hoodi `deployments/hoodi-v5.json` (`PipelineSecurityRegistry` `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, `PipelineSecurityRecordNft` `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`).

## Scope

**Guiding rule (human, 2026-11-17, epic #1937): everything on EVM uses the same approach as on Stellar.** The API serves EVM SecurityRegistry data through the same code that serves Stellar: the same config loader pattern, route, response builder, loan-book attach, attention count, tests and docs. Where Stellar code can serve both chains, it is generalized with a chain parameter, not copied. Every remaining difference is listed in [Differences from Stellar](#differences-from-stellar) with its chain-level reason.

### The Stellar API this issue reuses (from `main`)

- **Config.** `packages/api/src/config.rs` `load_security_registry_address` reads the optional `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` through `load_optional_contract`. A blank key means dark, and a malformed key fails boot naming the key. Today it returns early for EVM, so `security_registry_addresses` never holds an EVM chain.
- **Route.** `packages/api/src/routes/loan_security.rs` `get_loan_security`:
  - `resolve_security_registry` answers 404 `security_registry_not_configured` before any database read.
  - `parse_loan_id` accepts a `u32`.
  - The handler calls `SecurityRegistryRepo::load_loan_security`, then `load_mark_inputs`, then `build_security_response`, then the pending AccessManager operations.
- **Builder.** `packages/api/src/security_state.rs`:
  - DTOs and computed flags.
  - Amounts go through `shared::security_state::format_7dp`.
  - Per-record value and `agent_release` use `UNIT = 1e7`.
  - Mark suggestions come from `shared::security_marks`, which also uses `1e7`.
- **Loan book.** `routes/loan_book.rs` `security_by_loan` / `attach_security` and `LIST_LOAN_BOOK_SECURITY_SQL` are keyed only by `security_registry_addresses`, so they are chain-neutral once the map holds the EVM chain.
- **Attention counts.** `routes/attention_counts.rs` `chain_counts` → `list_open_margin_call_loans`. This is also keyed only by `security_registry_addresses`, so it is chain-neutral.
- **Audit log.** `routes/audit_log.rs` renders `Security*` rows by name, with amounts per `ChainKind`. EVM rows already render. The three `SecurityDefaultBreach*` names are not in `AUDIT_EVENT_NAMES`: `docs/references/security-registry-events.md#known-limitations` says "not in its allow-list until #1940".

### In scope

1. **EVM config.** Add `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_API_SECURITY_RECORD_NFT_ADDRESS`. Both are optional, dark while unset, and set together. A partial set fails boot naming the missing key.
2. **Log watermarks over the chain's log addresses.** `refresh_pending` counts RecordNft events (`SecurityDocAdded`, `SecurityInspectionRecorded`, `SecurityInspectionApproved`), as the worker's projection and valuation watermarks already do (#1938 D2).
3. **Decimals awareness (the API half of TD-188).**
   - One chain parameter, `SecurityChainParams` (already in `shared::security_registry` for the fold's par mark), gains `decimals`.
   - Amount and quantity strings, per-record values, `agent_release` and mark suggestions read the scale from it instead of `1e7`.
   - Stellar output stays byte-identical.
4. **Release-check debt.** On EVM, `agent_release` uses the contract's facility debt, which is the coverage view's `debt`. On Stellar it stays `outstanding + accrued_interest`. The EVM contract's `_requireReleasable` uses `_facilityDebt`.
5. **EVM-only fields, additive and `null` on Stellar.**
   - `terms.default_ratio_bps` and `terms.originator_fee_rate`.
   - A top-level `default_breach` object that mirrors `margin_call` for the `DefaultBreach*` state and history.
6. **`pending_operations` on `/security` stays `[]` for EVM** until #1941. The loan book already gates on Stellar; the route gets the same gate. This keeps rows that the #1939 indexer will write (calldata, no `args_xdr`) from being served half-decoded. Superseded: #1941 removed the gate; EVM `/security` serves `pending_operations` like Stellar.
7. **Audit log.** Render `SecurityDefaultBreach`, `SecurityDefaultBreachPriceStale` and `SecurityDefaultBreachCleared` (hand-off from #1938). `SecurityTermsSet` details gain `default_ratio_pct` and `originator_fee_rate_pct` when the row carries them.
8. **Docs, user story and tech debt**, in the Stellar layout.

### Out of scope

- `pending_operations` for EVM (calldata, EVM target scope): #1941.
- Trustee and wallet-connect (security page, inspectors, LTV cells): #1942 and #1943. The Trustee still hides EVM security data until #1942.
- Contract or deploy-script changes (#1944), stage and prod env values (epic merge order, step 3).
- Any worker change. The indexer (#1938) already stores everything this issue reads.
- Loan-book or attention-count fields for the default breach. See Open Questions.

## Differences from Stellar

Anything not listed here is identical: the route path and method, the 400 / 404 / 500 rules, every Stellar response key and its meaning, the freshness and `refresh_pending` logic, the `cure_by` event-over-snapshot rule, the staleness rules, the closed-loan rule, the repayment join, the loan-book SQL, the attention-count rule and the audit-log conventions.

| # | Area | Stellar | EVM | Chain-level reason |
|---|---|---|---|---|
| A1 | API keys | One optional key, `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` (Strkey `C…`) | Two optional keys, set together: `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_API_SECURITY_RECORD_NFT_ADDRESS` (EVM address, normalised to EIP-55). A partial set fails boot naming the missing key. There is no Reader key. | The EVM splits the registry in three contracts (#1938 D1). RecordNft events are stored under the RecordNft address (D2), so the API needs that address to see them. The Reader emits no events, and the API has no RPC, so the API never needs its address. |
| A2 | Log addresses for `refresh_pending` (`LOAN_LOG_WATERMARKS_SQL`) | `[registry]` for the projection watermark; `[registry, loan_registry]` for the valuation watermark | `[registry, nft]` and `[registry, nft, loan_registry]` | Same as D2. The sets must equal the worker's (`log_contracts`, and `log_contracts ++ [loan_registry]` for valuation). Otherwise an inspection or doc written to the RecordNft never makes `refresh_pending` true, and a Trustee poll stops early. |
| A3 | Amount and quantity strings (`valuation.*`, quantities, grades, marks, record valuations, suggested marks, repayments) | Exact 7-dp strings, `raw / 1e7` | Exact 6-dp strings, `raw / 1e6` (see Open Questions, Q1) | The contract constants: `PAR_VALUE = 1_000_000` (registry and Reader), PLUSD / sPLUSD have 6 decimals, and quantities are at the same scale (D6). |
| A4 | Per-record value and `agent_release` arithmetic | Goods `qty × vpu / 1e7`; other `qty × 1e7 / 1e7` | The same with `1e6` | The Reader's `_recordTerm` and `numerator / PAR_VALUE` use `PAR_VALUE = 1e6`. |
| A5 | Mark suggestions (`standard_vpu_raw`, `concentrate_vpu_raw`, report `value_per_unit=` line) | `floor(price × factor × 1e7)` | `floor(price × factor × 1e6)` | `revalue(recordId, valuePerUnit, …)` takes `valuePerUnit` at `PAR_VALUE` scale. |
| A6 | Debt used by `agent_release` | `outstanding + accrued_interest` (`ensure_releasable`, `lib.rs:1211`) | The valuation snapshot's `debt`, which is the Reader's `_facilityDebt`: `ceil((outstanding + accrued) × originalFacilitySize / originalSeniorTranche)`, or the pool debt when the senior tranche is 0 | EVM `_requireReleasable` calls `_ltvBps(_facilityDebt($, loanId, money), value)`. The coverage view's `debt` is the same formula, read at `detail_ledger`. |
| A7 | `valuation.debt` against `outstanding + accrued_interest` | Equal up to one ledger of interest (TD-171) | `debt` is the facility debt, so it is larger by design whenever the senior tranche is below the facility | Same as A6. The served `ltv_bps` / `coverage_bps` are the contract's, verbatim, on both chains. |
| A8 | `terms.default_ratio_bps`, `terms.originator_fee_rate` | `null` | Served (`u32` numbers; `originator_fee_rate` is on the 1e6 economics scale, like `default_rate`) | These fields exist only in the EVM `Terms` struct (D9). |
| A9 | `default_breach` | `null` | Served when terms exist: open state, the last breach and price-stale events, the no-on-chain-breach flag, the clearable flag and the breach history | `DefaultBreach` / `DefaultBreachPriceStale` / `DefaultBreachCleared` and `Terms.defaultBreachAt` exist only on EVM (D10). |
| A10 | Audit log | 21 `Security*` names | Plus the three `SecurityDefaultBreach*` names. `SecurityTermsSet` details add `default_ratio_pct` / `originator_fee_rate_pct` and the action adds ", default ratio X%", only when the row carries them. | Same as D9 and D10. Stellar rows are unchanged because the keys are present only when stored, following the existing shape-tolerant `PaymentUnrecorded` precedent. |
| A11 | Address text (`security_registry`, `inspectors`, `attested_by`, `entered_by`, `approved_by`, `inspector`, report `security_registry=`) | Strkey | EIP-55 | Chain address format (D8). This is served as stored. |
| A12 | `pending_operations` on `/security` | Served (#1922) | `[]` until #1941 | EVM AccessManager rows carry calldata, not `args_xdr` (#1939). The DTO and target scope for EVM are #1941's. This is temporary, and the spec already lists "EVM chains" under "Empty array". |

**Not differences:**

- **`loan_id`.** It stays a `u32` on both chains. An EVM id above `u32::MAX` answers 400, which is the API side of D7: EVM ids are counters, and the indexer keeps the same bound.
- **Response keys.** Every Stellar key is present on EVM with the same meaning. The EVM-only keys are additive.
- **Margin-call fields.** `margin_call.*` reads the same `open` / `price_stale` / `cured` rows on both chains. The breach rows go to `default_breach.events`, never to `margin_call.events`.
- **Loan book and attention counts.** The loan-book `ltv_bps` / `margin_call_open` / `price_stale` and the attention-count `margin_call_open` need no code change. They are served on EVM as soon as `security_registry_addresses` holds the chain.

## Assumptions and Risks

- **Stellar stays byte-identical.** The changes visible on Stellar are two new keys:
  - `terms.default_ratio_bps` / `terms.originator_fee_rate` (both `null`);
  - a top-level `default_breach: null`.

  Every Stellar amount string, report text and `report_hash` is unchanged, because `decimals = 7` reproduces `format_7dp` and `1e7` exactly. The existing tests in `loan_security.rs`, `security_state.rs` and `security_marks.rs` pin this; only their call sites gain the parameter.
- **EVM grade scale.** `pipeline-contracts` documents no scale for `referenceGrade` / inspection `grade`. Quantities are at `1e6` (`test/SecurityRegistryTest.t.sol` `UNIT = 1e6`, counted value `/ PAR_VALUE`), and grade is assumed to be at the same scale, as it is on Stellar (7 dp, with quantity at 7 dp). If that is wrong, only the grade strings are off. Grade feeds no arithmetic in the API.
- **Facility debt for `agent_release` (A6)** comes from the valuation snapshot at `detail_ledger`, the same read as the counted terms. The contract reads both at the release block. This is the same snapshot-lag caveat as every other computed flag (TD-171), not a new one.
- **`default_breach_at` NULL on an EVM terms row.** The column is nullable, and #1938 fills it on every EVM row. A NULL on EVM serves `default_breach.open: null` (unknown), never `false`, following the "undecodable is null" rule.
- **AppState churn.** A new `AppState.security_record_nft_addresses` field means a mechanical update to every `AppState { … }` literal in `packages/api/tests` (about 20 files), as with `plusd_addresses` before.
- **Parallel work.**
  - **#1941** will read `security_registry_addresses` / `security_record_nft_addresses` for its EVM target scope and flip the pending gate added here (`pending_operations_served`). Whichever PR merges second rebases.
  - **#1939** (PR #1948, open) changes `shared::access_manager_repo`. The gate keeps its EVM rows out of `/security`.
  - **The main checkout's uncommitted #1786 Phase 2** (`chore/1786-retire-ccr-phase2`) also edits `docs/product-specs/loan-security-state.md`, `docs/references/backend.md` and `packages/api/src/routes/loan_book.rs`. Expect doc merge conflicts. This issue does not need to touch `loan_book.rs`.
- **Ops ordering.** Set the API keys only after the worker's three EVM keys are live and the cursor is rewound (epic merge order, step 3). Before that, the route answers `200` with empty state (`terms: null`), as Stellar does before its first write.

## Decisions (human, 2026-11-18)

All open questions were resolved with the recommended defaults:

1. EVM amount strings are native 6 dp (exact `raw / 10^decimals`), not padded to 7.
2. Default breach is a top-level `default_breach` object mirroring `margin_call`, `null` on Stellar. Breach rows stay out of `margin_call.events`.
3. Default breach is not added to the loan book or attention counts in this issue; that comes with #1942 if needed.
4. Audit-log rendering of the three `SecurityDefaultBreach*` events and the EVM `SecurityTermsSet` extras is included here.

## Open Questions

_None_ (resolved 2026-11-18, see Decisions).

## Implementation Steps

### 1. Chain parameter — `packages/shared/src/security_registry.rs`

Extend the existing struct. The fold keeps using only `par_value_per_unit`.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseDebt { OutstandingPlusAccrued, FacilityDebt }

pub struct SecurityChainParams {
    pub par_value_per_unit: &'static str,
    pub decimals: u32,
    pub release_debt: ReleaseDebt,
    pub has_default_breach: bool,
}
// STELLAR_SECURITY_PARAMS: decimals 7, OutstandingPlusAccrued, has_default_breach false
// EVM_SECURITY_PARAMS:     decimals 6, FacilityDebt,           has_default_breach true
pub fn security_params(kind: ChainKind) -> &'static SecurityChainParams
```

`par_value_per_unit` stays as is (`10^decimals`, asserted by a test).

### 2. Scale-aware helpers — `packages/shared/src/security_state.rs`

- Add `pub fn unit(decimals: u32) -> i128` (`10^decimals`), `pub fn format_dp(raw: &BigDecimal, decimals: u32) -> Option<String>` and `pub fn format_dp_i128(raw: i128, decimals: u32) -> String`. These generalize today's bodies: padding to `decimals + 1` digits, split at `len − decimals`, sign handling and no exponent.
- Keep `UNIT`, `format_7dp` and `format_7dp_i128` as Stellar aliases (`format_dp(raw, 7)`), so their existing callers and tests are unchanged.
- `counted_value_excluding(terms, exclude, unit: i128)` and `record_term_value(t, unit: i128)` take the unit; `term_numerator` uses it for non-goods records.
- `agent_release(status, protection, outstanding: u128, debt: Option<u128>, terms, record_id, advance_ratio_bps, unit: i128)`.
  - The caller supplies the debt.
  - `debt == None` (overflow) → `NeedsConsent`, which keeps today's overflow behaviour.
  - The caller (`agent_release_of`) serves `null` when the facility `debt` is undecodable, the same rule as Stellar for an undecodable `accrued_interest`.
  - `release_unconditional` is unchanged.

### 3. Scale-aware mark suggestions — `packages/shared/src/security_marks.rs`

- `standard_vpu_raw(price, factor, decimals: u32)` replaces `pow10(7)` with `pow10(decimals)`.
- `concentrate_vpu_raw(assay, offtake, prices, decimals: u32)` replaces `UNIT` with `unit(decimals)`.
- `SuggestCtx` gains `pub decimals: u32`. `compute_standard` / `compute_concentrate` pass it through. `report_text` prints `value_per_unit=` with `format_dp_i128(v, ctx.decimals)`. The Stellar report text and hash are unchanged.
- `mark_due`, `move_bps` and `effective_max_age` are scale-free and unchanged. The worker's `asset_price_collector` uses only `mark_pairs` / `CommodityMap` and is unaffected.

### 4. API config — `packages/api/src/config.rs`, `lib.rs`, `main.rs`

- Add `pub security_record_nft_addresses: HashMap<i64, String>` to `ChainsConfig` and to `AppState`, and wire it in `main.rs` next to `security_registry_addresses`.
- Rewrite `load_security_registry_address(chain_id, kind, registries, nfts)`:
  - **Stellar:** unchanged. `load_optional_contract(…, "CHAIN_{id}_STELLAR_API_SECURITY_REGISTRY_ADDRESS", "SecurityRegistry", registries)`.
  - **EVM:**
    - Read `CHAIN_{id}_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_{id}_EVM_API_SECURITY_RECORD_NFT_ADDRESS` (trimmed).
    - Exactly one set → `bail!("{missing} must be set when {present} is set; the SecurityRegistry and RecordNft keys are set together")`, the worker's wording minus the Reader.
    - Both set → `load_optional_contract` each (EIP-55, an error names the key, logs "API SecurityRegistry scope loaded" / "API SecurityRecordNft scope loaded").
    - Both blank → nothing.
- Update the `ChainsConfig` doc block's env list with the two EVM keys. `validate_chain_kind_keys` already rejects a `…_EVM_…` key on a Stellar chain and the reverse.

### 5. Repo — `packages/shared/src/security_registry_repo.rs`

- `LOAN_LOG_WATERMARKS_SQL`: `COALESCE(MAX(id) FILTER (WHERE contract_address = ANY($2)), 0) AS sr_log_id`, where `$2` is the log-address list. `$4` stays `ANY($4)`.
- `load_loan_security(chain_id, contract, log_contracts: &[String], loan_id, configured_loan_registry)`:
  - binds `log_contracts` as `$2`;
  - builds `$4` as `log_contracts ++ [valuation.loan_registry]` (today `[contract] ++ …`);
  - keeps every projection-table read on `contract` (projection tables stay keyed by the registry, D2).
- `LIST_SALE_REPAYMENTS_SQL` keeps `e.contract_address = $4` = the registry, because `EnforcementStarted` / `RecordEnforced` are registry events on EVM too.

### 6. Route — `packages/api/src/routes/loan_security.rs`

- `pub fn security_log_contracts<S: BuildHasher>(chain: ConfiguredChain, contract: &str, nfts: &HashMap<i64, String, S>) -> Vec<String>` returns `[contract]`, plus the chain's RecordNft when present.
- `pub fn pending_operations_served(kind: ChainKind) -> bool { kind == ChainKind::Stellar }`. The handler skips the AccessManager read and leaves `pending_operations: []` when it is false. This mirrors `loan_book::pending_ops_by_loan`'s Stellar check; #1941 flips both. Superseded: #1941 removed the gate; EVM `/security` serves `pending_operations` like Stellar.
- The handler passes `security_log_contracts(..)` to `load_loan_security`, and `security_params(chain.kind)` to `load_mark_inputs` (unchanged) and `build_security_response`.
- OpenAPI:
  - Tag description: "SecurityRegistry state of a loan (Stellar and EVM), read from the indexed projection".
  - Register `DefaultBreachDto` and `DefaultBreachEventDto` in `LoanSecurityDoc`.
  - The 404 text names both keys.

### 7. Builder — `packages/api/src/security_state.rs`

- `build_security_response(chain_id, params: &SecurityChainParams, contract, loan_id, rows, now, marks)`. `Ctx` gains `params`.
- **Formatting.**
  - Every `format_7dp(x)` → `format_dp(x, params.decimals)`, and every `format_7dp_i128(x)` → `format_dp_i128(x, params.decimals)`.
  - This covers `valuation_dto`, `qty_opt`, `repayment_dto`, `record_valuation`, `suggested_mark_dto` and the record mark.
  - `repayment_dto` and `valuation_dto` take the decimals.
- **Arithmetic.** `record_valuation` uses `record_term_value(&term, unit(params.decimals))`.
- **`agent_release_of`.**
  - `debt` is `outstanding.checked_add(accrued_interest)` under `OutstandingPlusAccrued`, and `dec_to_u128(&valuation.debt)` under `FacilityDebt`.
  - Call `agent_release(.., outstanding, debt, .., unit(params.decimals))`.
- **Suggestions.** `suggestion_of` sets `SuggestCtx.decimals = params.decimals`.
- **Terms.**
  - `SecurityTermsDto` adds `default_ratio_bps: Option<u32>` and `originator_fee_rate: Option<u32>` (from `TermsRow`, `clamp_u32`).
  - Both are always serialized and are `null` on Stellar.
  - `default_breach_at` is not added to terms; it is served as `default_breach.opened_at`, as `margin_call_at` is served as `margin_call.opened_at`.
- **Margin call.** `margin_call_dto` filters `events` to the three margin kinds (`open`, `price_stale`, `cured`) before mapping. Stellar has no other kinds, so nothing changes there.
- **New `DefaultBreachEventDto`:** `{ kind: "default_breach" | "default_breach_price_stale" | "default_breach_cleared", ltv_bps: u32, default_ratio_bps: Option<u32>, at, block_number, tx_hash }`.
- **New `DefaultBreachDto`:**
  - `open: Option<bool>` = `terms.default_breach_at` decoded ≠ 0. `null` when the column is NULL or undecodable.
  - `opened_at: Option<String>` (when open).
  - `last_default_breach_ltv_bps: Option<u32>` (last `default_breach` row).
  - `last_price_stale: Option<LastPriceStaleDto>` (last `default_breach_price_stale` row).
  - `ltv_above_ratio_no_onchain_breach: Option<bool>` = `open.map(|o| !o && !closed && ltv.is_some_and(|l| l > default_ratio))`. It is `null` when `default_ratio_bps` is `None`. This mirrors `ltv_above_ratio_no_onchain_call`.
  - `open_breach_clearable: Option<bool>` = `open.map(|o| o && ltv.is_some_and(|l| l <= default_ratio))`. It is `null` without the ratio. This mirrors `open_call_curable`; the contract clears at `ltvBps <= defaultRatioBps` (`_signalOrClearDefaultBreach`).
  - `events: Vec<DefaultBreachEventDto>`.
- **`LoanSecurityResponse.default_breach: Option<DefaultBreachDto>`.** It is `None` when `terms` is `None` or `!params.has_default_breach` (Stellar).
- **Doc comments.** Update the existing `SecurityValuationDto` doc comments ("7-dp" → "the chain's decimals").

### 8. Audit log — `packages/api/src/routes/audit_log.rs`

- Append `SecurityDefaultBreach`, `SecurityDefaultBreachPriceStale` and `SecurityDefaultBreachCleared` to `AUDIT_EVENT_NAMES` (scope `Loan #<id>`).
- `render_security`:
  - `SecurityDefaultBreach` → `"Default breach — LTV {l} above {d}% default ratio"`, details `{ ltv_pct, default_ratio_pct }`.
  - `SecurityDefaultBreachPriceStale` → `"Price stale — LTV {l} above {d}% default ratio, no default breach until revalued"`, with the same details.
  - `SecurityDefaultBreachCleared` → `"Default breach cleared — LTV {l}"`, details `{ ltv_pct }`.
  - All three reuse `ltv_label` / `ltv_pct` / `bps_pct`, so the `4294967295` "LTV unbounded" rule applies. A missing param falls back to the bare title, as the margin-call arms do.
- `SecurityTermsSet`:
  - When `default_ratio_bps` is present, append `, default ratio {d}%` to the action and add `details.default_ratio_pct`.
  - When `originator_fee_rate` is present, add `details.originator_fee_rate_pct` through the `default_rate_pct` conversion (1e6 scale), generalized to take the param key.
  - Stellar rows lack both params and render exactly as today.

### 9. Env example — `.env.example`

In the EVM API block, after `CHAIN_1_EVM_API_PLUSD_ADDRESS`, add:

```
# CHAIN_1_EVM_API_SECURITY_REGISTRY_ADDRESS=      # optional — GET /v1/loan-book/{loan_id}/security, loan-book ltv_bps / margin_call_open / price_stale, attention-count margin calls; must equal the indexer key (Hoodi v5: 0xB51E7f13420D106946376A67Fe5921C63B09BE15); set together with the RecordNft key
# CHAIN_1_EVM_API_SECURITY_RECORD_NFT_ADDRESS=    # must equal the indexer's …_SECURITY_RECORD_NFT_ADDRESS (Hoodi v5: 0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09); scopes refresh_pending to RecordNft events
```

`scripts/check-chain-env-names.sh` needs no change, because the new names follow the scheme. Confirm it passes.

### 10. User story

- Add `docs/user-stories/epic-1937/1940-evm-security-api.md`. It mirrors `epic-1775/1780-loan-security-state-api.md` and `1786-retire-ccr.md` on Hoodi (chain 560048):
  1. The keys are unset, partial, or Stellar-named on EVM: 404, or the named boot error.
  2. A loan with no terms returns empty state.
  3. Terms (with `default_ratio_bps` / `originator_fee_rate`), a record and a revalue are served as 6-dp strings and match `Reader.coverageDetail`.
  4. A margin call keeps its `cure_by`, and a default breach is served under `default_breach`, then cleared.
  5. An inspection approved on the RecordNft flips `refresh_pending` until it is projected, then is served inline.
  6. An open goods record gets a 6-dp suggested mark (with `SECURITY_MARK_COMMODITIES` set).
  7. The loan-book `ltv_bps` / `margin_call_open` / `price_stale` and the attention-count `margin_call_open` are served for EVM loans.
  8. `/v1/audit-log` lists the `SecurityDefaultBreach*` rows.
- Add the row to the "Epic #1937" table in `docs/user-stories/index.md`.

### 11. Clean-up and lint

- Comment-less rule: no new comments. A new file only gets its spec-pointer header (the user story is a doc).
- Run `cargo fmt`, `cargo clippy --all -- -D warnings`, `scripts/check-chain-env-names.sh` and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

All tests live in `packages/<pkg>/tests/*.rs` and are pure: no DB, and nothing reads `DATABASE_URL` or `POSTGRES_URL`. Route tests use the existing `connect_lazy` `AppState` pattern and assert only refusals that happen before any database read. EVM fixtures use Hoodi EIP-55 addresses and 6-dp raw values.

- **`packages/api/tests/chains_config.rs`** (counterparts of the four `stellar_security_registry_*` tests):
  - `evm_security_registry_and_record_nft_are_parsed_and_checksummed`: lowercase input → EIP-55 in both maps.
  - `evm_security_keys_unset_or_blank_give_no_entry`.
  - `evm_security_registry_without_record_nft_is_error` and the reverse: the message names the missing key and contains "set together".
  - `evm_security_registry_bad_address_is_error`, naming the key.
  - `stellar_chain_with_evm_security_registry_key_is_error` (the existing kind-key check).
  - The Stellar tests stay unchanged, and a Stellar chain never gets a `security_record_nft_addresses` entry.
- **`packages/api/tests/loan_security.rs`:**
  - **Route.** `an_evm_chain_has_no_security_registry` becomes `an_unconfigured_evm_chain_has_no_security_registry` and `a_configured_evm_chain_resolves`. The route-level `an_evm_chain_is_404_security_registry_not_configured` keeps an unconfigured EVM state.
  - **Helpers.** `security_log_contracts` gives `[registry]` on Stellar, `[registry, nft]` on EVM, and `[registry]` on EVM without an NFT entry. `pending_operations_served` is true for Stellar and false for EVM.
  - **EVM builder** (`build(.., &EVM_SECURITY_PARAMS)`):
    - amounts are exact 6-dp strings (`1_000_000` → `"1.000000"`, negative and large values, a negative-exponent decode);
    - the per-record goods value floors at `1e6`, and the non-goods value equals the quantity;
    - a suggested mark and the report `value_per_unit=` line are at 6 dp;
    - `agent_release` uses `valuation.debt`: build a case where `outstanding + accrued` passes the advance ratio and the facility `debt` does not → `needs_consent`, and the mirror case → `allowed`;
    - the terms extras are served.
  - **`default_breach` truth table:**
    - `null` on Stellar and when `terms` is `null`;
    - `open` true / false / `null` (NULL column, undecodable);
    - `opened_at`;
    - `last_default_breach_ltv_bps` and `last_price_stale` pick the last row of each kind;
    - `ltv_above_ratio_no_onchain_breach`: strictly above the ratio, equal is false, a closed loan is false, no valuation is false, no ratio is `null`;
    - `open_breach_clearable` at and above the ratio;
    - `events` keep order and carry `default_ratio_bps`.
  - **Separation.** `margin_call.events` excludes breach kinds; `margin_call.last_price_stale` ignores `default_breach_price_stale`.
  - **Stellar regression.**
    - Every existing test passes with `&STELLAR_SECURITY_PARAMS`. Only the `build` / `build_marked` helpers change.
    - A Stellar response serializes `terms.default_ratio_bps: null`, `terms.originator_fee_rate: null` and `default_breach: null`.
    - An existing 7-dp golden value and an existing `report_hash` are unchanged.
  - **OpenAPI.** It lists `DefaultBreachDto` and `DefaultBreachEventDto`.
- **`packages/api/tests/loan_book_security.rs`:**
  - `attach_security` fills an EVM entry whose fields are present.
  - An EVM entry and a Stellar entry with the same loan id each get their own values. The existing "EVM is null" case remains for a missing map entry.
- **`packages/api/tests/attention_counts.rs`:** `build_response` with an EVM chain whose `margin_call_open` is `Some(n)` sums it with the Stellar chain. A chain with `None` stays out of the sum (the existing nullable rule).
- **`packages/api/tests/audit_log_security_registry.rs`:**
  - the three `SecurityDefaultBreach*` actions and details, including `4294967295` → "LTV unbounded" and missing-param fallbacks;
  - EVM `SecurityTermsSet` with the extras (action suffix, `default_ratio_pct`, `originator_fee_rate_pct` from `10_000` → `"1.00"`);
  - a Stellar `SecurityTermsSet` produces exactly today's details object (no new keys);
  - the names are in `AUDIT_EVENT_NAMES`.
- **`packages/shared/tests/security_state.rs`:**
  - `format_dp` / `format_dp_i128` at 6 and 7 dp (zero, sub-unit, negative, large, negative exponent);
  - `format_7dp` equals `format_dp(_, 7)`;
  - `counted_value_excluding` / `record_term_value` with `unit(6)`;
  - `agent_release` with an explicit debt, `None` debt → `NeedsConsent`, and the unconditional cases unchanged;
  - the existing tests pass `UNIT`.
- **`packages/shared/tests/security_marks.rs`:**
  - `standard_vpu_raw(.., 6)` and `concentrate_vpu_raw(.., 6)` (exact floors);
  - the report `value_per_unit=` line at 6 dp;
  - every existing Stellar golden (`value_per_unit`, report text, `report_hash`) is unchanged with `decimals: 7`.
- **`packages/shared/tests/security_registry_fold.rs`:**
  - `STELLAR_SECURITY_PARAMS` / `EVM_SECURITY_PARAMS` carry `decimals` 7 / 6, `release_debt`, `has_default_breach` false / true and `par_value_per_unit == 10^decimals`;
  - `security_params(ChainKind::…)` returns each.
- **`packages/shared/tests/security_registry_repo_sql.rs`:** `the_log_watermarks_are_scoped_to_the_chain_loan_and_contract_list` asserts `MAX(id) FILTER (WHERE contract_address = ANY($2))`. The projection reads keep `contract_address = $2`.
- **Full regression:** `cargo test -p shared`, `cargo test -p pipeline-api` and `cargo test -p pipeline-worker` (the worker only compiles against the extended `SecurityChainParams` consts).

## Docs to Update

- **`docs/product-specs/loan-security-state.md`:**
  - **Overview.** "Stellar SecurityRegistry" → "SecurityRegistry (Stellar and EVM)".
  - **Scope.** Replace "Scope is Stellar only… every EVM chain answers 404" with the two-chain key rule: the Stellar key; the two EVM keys, set together and equal to the worker's; 404 without them.
  - **Behavior table.**
    - `records[].valuation.value` divides by the chain unit (`1e7` / `1e6`).
    - `agent_release` uses `outstanding + accrued_interest` on Stellar and the facility `debt` on EVM (A6).
    - `refresh_pending` counts the chain's log addresses (A2).
    - Add a `default_breach.*` row.
  - **Computed Fields.** `format_dp`; `counted_value_excluding` / `record_term_value` / `agent_release` with the unit and debt; add the EVM contract line references (`SecurityRegistryUpgradeable.sol` `_requireReleasable`, `_signalOrClearDefaultBreach`; Reader `coverageDetail`).
  - **API Contract → Encoding.**
    - Amounts are exact decimal strings at the chain's scale (7 dp Stellar `"1250.0000000"`, 6 dp EVM `"1250.000000"`).
    - Addresses are Strkeys on Stellar and EIP-55 on EVM.
    - Add the EVM-only keys to the JSON example and a short "EVM-only fields" table (`terms.default_ratio_bps`, `terms.originator_fee_rate`, `default_breach.*`), each `null` on Stellar.
  - **Loan book fields.** Drop "`null` on EVM entries"; the keys are `null` on chains without the chain's API SecurityRegistry key.
  - **Pending operations → Empty array.** Keep "EVM chains", with "(until #1941)".
  - **Mark Suggestions.** `value_per_unit` is USD per record unit at the chain's scale (7 dp Stellar, 6 dp EVM); the standard-goods formula reads `10^decimals`.
  - **Data Model.** No migration.
- **`docs/product-specs/trustee-risk-watchlist.md`:**
  - "LTV (Stellar loans only)" / "EVM loans show no LTV…" → the backend serves LTV, margin-call state and price staleness for both chains; the Trustee shows them on EVM once #1942 ships.
  - "from the Stellar SecurityRegistry" → "from the chain's SecurityRegistry".
- **`docs/product-specs/trustee-attention-counts.md`:** "An EVM chain contributes … its minter and margin-call fields are `null`" → only its minter fields are `null`, and `margin_call_open` is served when the chain's API SecurityRegistry key is set.
- **`docs/product-specs/audit-logging.md`:** the SecurityRegistry bullet becomes "24 names (Stellar and EVM; the three `SecurityDefaultBreach*` are EVM only)", with their renderings and the `SecurityTermsSet` EVM extras (A10).
- **`docs/product-specs/index.md`:** the `loan-security-state.md` description becomes "SecurityRegistry (Stellar and EVM) …".
- **`docs/references/security-registry-events.md`:**
  - Configuration: the API keys for EVM.
  - Known limitations: drop the "EVM marks" bullet (resolved) and the "not in its allow-list until #1940" clause.
- **`docs/references/backend.md`:**
  - Line 440 (loan-book bullet): drop "`null` on EVM"; name both keys.
  - The "EVM SecurityRegistry indexing" paragraph: replace "The API does not serve this data yet…" with the two API keys and the route.
  - Add an EVM rollout note after the Stellar step 6: set the two API keys after the worker keys and the cursor rewind; verify `200` / `404`.
- **`.env.example`** (step 9), **user story and index** (step 10).
- **`docs/exec-plans/tech-debt-tracker.md`:** TD-188 → `[RESOLVED 2026-11-xx / #1940]` for the shared and API scope. Add a note that the Trustee parses the `/security` strings at the chain's decimals for EVM writes (#1942).
- **`ARCHITECTURE.md`:** no change. The line-64 listener note already says "Stellar and EVM", and no new module boundary is added.
