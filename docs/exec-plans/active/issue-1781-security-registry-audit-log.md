# Issue #1781: Audit log: SecurityRegistry events, legacy CollateralRegistry rows as history

Source: https://github.com/eq-lab/pipeline/issues/1781

Parent epic: #1775, merge-order step 3 (in parallel with #1780). Depends on #1779, which is merged
(`193ba5ee`). Base: `origin/main` at `193ba5ee`, branch `feat/1781-security-audit-log`.

## Scope

### Source of truth (checked 2026-11-06)

- Contracts: `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/{event,types,lib}.rs`,
  `contracts/minter/src/{lib,types}.rs`.
- Stored names and params: `docs/references/security-registry-events.md#event-table` and
  `packages/worker/src/indexer/stellar/security_registry_parsers.rs` (`SPECS`). All `Security…` rows are
  flat (`ContractLogMapper`), carry `loan_id` at the top level when the event has one, and no `snapshot`.
- Decisions from the issue, its comment, epic #1775 and the manager:
  - Record NFT `mint` / `burn` are allow-listed in #1779, so no `contract_logs` row exists. They are not
    rendered; the allow-list test pins that no such name can reach the feed.
  - The AccessManager is not indexed. Nothing to render.
  - The existing CollateralRegistry renderers stay byte-identical on EVM. Stellar rows of those names get a
    legacy marker in `action` only; `details` and `event_name` stay unchanged.
  - The Trustee app renders `action` verbatim (`packages/trustee/src/routes/-useAuditLog.ts`). Its only
    `event_name` dependency is `"CashRepaid"` with `details.repayment_id` / `details.value_date`
    (`packages/trustee/src/routes/-repayment-recovery.ts:206`). `CashRepaid` rendering is not touched.
  - Contracts #41 inspection events are in scope.

### What changes

Only `packages/api/src/routes/audit_log.rs` (pure rendering and the allow-list), tests and docs. No
migration, no SQL change, no worker change, no new env key, no new endpoint, no DTO field change.

1. **Allow-list.** Append 21 SecurityRegistry names to `AUDIT_EVENT_NAMES` (the 19 below plus `SecurityRegistryPaused` and `SecurityRegistryUnpaused`, per the resolved questions):
   `SecurityRecordRegistered`, `SecurityRecordPerfected`, `SecurityRecordHandedOver`,
   `SecurityRecordAttested`, `SecurityDocAdded`, `SecurityRecordReleased`, `SecurityMandateBreach`,
   `SecurityEnforcementStarted`, `SecurityRecordEnforced`, `SecurityTermsSet`, `SecurityRevalued`,
   `SecurityMarginCall`, `SecurityPriceStale`, `SecurityMarginCallCured`, `SecurityInspectionRecorded`,
   `SecurityInspectionApproved`, `SecurityFlagResolved`, `SecurityExtensionConsent`,
   `SecurityInspectorsSet`.
   Not listed: `SecurityLoanRegistrySet` (contract wiring). The pause rows are listed (resolved questions).
2. **Renderers.** One `format_action` arm per new name (table below).
3. **Enforcement proceeds link.** `SecurityRecordEnforced` shows the minter `CashRepaid` rows that booked
   its proceeds. The contract books them with `repay(..., sale_id = record_id)`
   (`security-registry/src/event.rs` `RecordEnforced`, `lib.rs:331-332`; `sale_id = 0` means "not a sale",
   `minter/src/types.rs:140`). The link is resolved in `build_response`, from the rows of the same response.
4. **Legacy marker.** On `ChainKind::Stellar` only, the 11 CollateralRegistry names (`Pledged`,
   `HaircutSet`, `FloorSet`, `Revalued`, `StageUpdated`, `ControlUpdated`, `DocAdded`, `QuantityAdjusted`,
   `Released`, `Liquidated`, `MarginCall`; `worker/src/indexer/stellar/collateral_registry_parsers.rs`
   `TOPICS`) get the suffix ` (legacy collateral registry)` on `action`. No other Stellar contract writes
   these names (checked by grep over `packages/worker/src`). `LoanCCRUpdated` keeps rendering unchanged on
   both chains.

### Rendering conventions (taken from the existing arms)

- Ids (`record_id`, `lot_id`, `inspection_id`, `from_record_id`, `to_record_id`, `repayment_id`) are
  strings in `details` (`param_str`).
- Amounts use the row's chain decimals: `param_amount` (Stellar 7 dp → 6 dp string, e.g.
  `"10000000"` → `"1.000000"`). Raw amounts are parsed as plain `i128` decimal integers only (`-?\d{1,39}`);
  exponent, decimal-point, sign-plus, underscore and overflowing strings count as missing (null amount, bare
  label). Sums use `checked_add`; overflow skips the repayment. This hardens every audit-log amount. Only `value_per_unit` and the linked `CashRepaid.cash` are amounts. No
  SecurityRegistry event carries a quantity (inspection quantities live only in the `inspection(id)` view).
- Bps become percent strings with 2 dp, keys suffixed `_pct`: `8750` → `"87.50"`, `-250` → `"-2.50"`,
  `-5` → `"-0.05"`, `0` → `"0.00"`. Computed with `BigDecimal::from(bps) / 100` at scale 2. The action adds
  `%`; variances in the action carry an explicit `+` when positive (`+0.10%`).
- `ltv_bps == 4294967295` (`u32::MAX`: debt with no counted value, or overflow) is not a percentage:
  `ltv_pct` is `null` and the action says `LTV unbounded`.
- `default_rate` is on the loan-registry 1e6 scale (`types.rs` `Terms`). It goes through `u32::try_from`
  (negative or out of range → `null`), the existing `economics_rate_to_bps`, then `default_rate_pct`.
- Times (`cure_by`, `new_maturity`) stay raw unix-second strings in `details`. The action shows them as ISO
  when the `u64` fits chrono's range; out of range, the `cure by …` clause (margin call) or the maturity
  (extension consent) is dropped, never a raw integer. Durations (`cure_period`, `price_stale_after`, `grace_period`,
  `attestation_interval`, `inspection_interval`) stay raw second strings in `details`. The action shows
  `cure_period` as the largest exact unit: `1209600` → `14d`, `7200` → `2h`, `90` → `90s`, `0` → `0s`.
- Hashes (`evidence_hash`, `sha256`, `reason_hash`, `proceeds_hash`, `report_hash`, `consent_hash`) are
  passed through verbatim in `details` and never appear in `action`. This matches `DocAdded.hash`,
  `Revalued.report_hash` and `Released.ref_hash` today.
- Addresses (`attested_by`, `inspector`, `approved_by`, `inspectors[]`) are verbatim Strkeys in `details`
  only; no address appears in any action (resolved questions).
- Enum variants (`protection`, `kind`, `outcome`, `payment_term`) are rendered verbatim, like
  `Document added — Assay` and `Lot control updated → Cma`.
- Booleans (`by_consent`, `flagged`) stay JSON booleans, like `PocketClaimed.paid_zero`.
- A missing or malformed field degrades to the bare label and `null` in `details`, never a panic.
- Scope: every new name except `SecurityInspectorsSet` has a top-level `loan_id`, so it is
  `Loan #<id>`; `SecurityInspectorsSet` is `Protocol`. `reference` is `""` (no snapshot).

### Action and details per event

`{r}` = `record_id`, `{i}` = `inspection_id`; the bare label applies when a field the action needs is
missing.

| `event_name` | `action` | `details` |
|---|---|---|
| `SecurityRecordRegistered` | `Security record #{r} registered — {protection}, lot #{lot_id}` | `record_id`, `lot_id`, `protection` |
| `SecurityRecordPerfected` | `Security record #{r} perfected` | `record_id`, `evidence_hash` |
| `SecurityRecordHandedOver` | `Security handed over — record #{from} → #{to}` | `from_record_id`, `to_record_id`, `evidence_hash` |
| `SecurityRecordAttested` | `Security record #{r} attested` | `record_id`, `attested_by` |
| `SecurityDocAdded` | `Security document added — {kind}, record #{r}` | `record_id`, `kind`, `sha256` |
| `SecurityRecordReleased` | `Security record #{r} released` or `Security record #{r} released with Risk Council consent` | `record_id`, `by_consent`, `reason_hash` |
| `SecurityMandateBreach` | `Mandate breach reported` | `evidence_hash` |
| `SecurityEnforcementStarted` | `Enforcement started — security record #{r}` | `record_id` |
| `SecurityRecordEnforced` | unlinked: `Security record #{r} enforced`; linked: `Security record #{r} enforced — proceeds $X repaid (repayment #2)` / `(repayments #2, #3)` | `record_id`, `proceeds_hash`, `repayment_ids` (array of strings, `[]` when unlinked), `proceeds` (6-dp string, `null` when unlinked) |
| `SecurityTermsSet` | `Security terms set — advance ratio 80.00%, margin call ratio 85.00%, cure period 14d` | `advance_ratio_pct`, `margin_call_ratio_pct`, `cure_period`, `price_stale_after`, `payment_term`, `grace_period`, `default_rate_pct`, `attestation_interval`, `inspection_interval`, `tolerance_pct`, `grade_tolerance_pct` |
| `SecurityRevalued` | `Security record #{r} revalued — $V/unit (BENCH)` (`dollars()`: `-$V` when negative) | `record_id`, `value_per_unit`, `benchmark`, `report_hash` |
| `SecurityMarginCall` | `Margin call — LTV 87.50%, margin call ratio 85.00%, cure by 2026-11-20T00:00:00Z` | `ltv_pct`, `margin_call_ratio_pct`, `cure_by` |
| `SecurityPriceStale` | `Price stale — LTV 87.50% above 85.00% margin call ratio, no margin call until revalued` | `ltv_pct`, `margin_call_ratio_pct` |
| `SecurityMarginCallCured` | `Margin call cured — LTV 78.00%` | `ltv_pct` |
| `SecurityInspectionRecorded` | `Inspection #{i} recorded — {kind}, security record #{r}` | `inspection_id`, `record_id`, `lot_id`, `kind`, `inspector` |
| `SecurityInspectionApproved` | `Inspection #{i} approved — variance vs reference -2.50%, vs previous +0.10%, grade 0.00%` and the suffix `, flagged` when `flagged` | `inspection_id`, `record_id`, `approved_by`, `variance_reference_pct`, `variance_previous_pct`, `variance_grade_pct`, `flagged` |
| `SecurityFlagResolved` | `Inspection flag resolved — {outcome}, security record #{r} (inspection #{i})` | `record_id`, `inspection_id`, `outcome`, `reason_hash` |
| `SecurityExtensionConsent` | `Buyer extension consent — new maturity 2027-01-31T00:00:00Z` | `new_maturity`, `consent_hash` |
| `SecurityInspectorsSet` | `Inspector panel set — 3 inspectors` (`1 inspector`, `0 inspectors`) | `inspectors` (array of Strkeys, in order) |

`SecurityTermsSet` leaves out `margin_call_at`: the contract keeps it, it is not a Risk Council input.
`SecurityMarginCall` uses neutral wording (no "above"): a call opened by `resolve_flag(TopUpRequired)`
only needs LTV above the advance ratio (`lib.rs` `require_top_up`), so it can sit at or below the margin
call ratio. `SecurityPriceStale` is only emitted above the ratio, so "above" is correct there.

### Enforcement link rule

Inside `build_response`, before mapping, over the already chain-filtered rows of this response:

- candidate `CashRepaid` rows: same `chain_id` as the enforced row, `row.loan_id` equal, `sale_id` equal
  to the enforced `record_id`, `sale_id != "0"`;
- drop a candidate when a `CashRepaymentReversed` row with the same `(chain_id, loan_id, repayment_id)`
  exists in the rows;
- `repayment_ids` sorted ascending numerically; `proceeds` = sum of the raw `cash` values, then the same
  chain-decimal normalisation as `param_amount`;
- order-independent: a repay before or after `mark_enforced` links the same way.

`format_action` keeps its public signature and renders the unlinked form. It delegates to a private
`format_linked(…, link: Option<&Proceeds>)`, which `map_item` calls with the looked-up link, so
`SecurityRecordEnforced` has one dispatch (`render` → `render_security` → `render_enforced`). The link is only
computed when the response holds a `SecurityRecordEnforced` row, and only for repayments whose
`(chain, loan, sale_id)` matches one. `CashRepaid` items are not changed.

### Out of scope

- Enriching rows from the projection tables (inspection quantity and grade, record commodity). The feed
  reads `contract_logs` only. The read model is #1780.
- EVM SecurityRegistry (not indexed; `pipeline-contracts` is still on the lot model).
- Retiring the CCR rows (`LoanCCRUpdated` keeps rendering; #1786).
- Removing the existing doc comments in `audit_log.rs` (see step 7).
- Frontend changes. The Trustee app renders `action` verbatim, and no `event_name` mapping exists.

## Assumptions and Risks

- **Dark until the key is set.** Until `…_SECURITY_REGISTRY_ADDRESS` is set on pipeline-test, no
  `Security…` row exists, so the feed is unchanged. Rollout-safe: API-only, additive, no schema change. A
  rolled-back API simply stops listing the new names.
- **Legacy marker changes Stellar `action` text** for existing rows on pipeline-test. The frontend does
  not parse `action`, so this is display-only, as the issue requires.
- **Enforcement link collisions.** `AuditLogRow` has no `contract_address`. A `CashRepaid` with
  `sale_id = n` on the same loan from another source (a legacy CollateralRegistry `Liquidated` sale id on
  that loan, or an old minter) would also link. #42 did not redeploy the LoanRegistry, so loan ids stay
  unique on the chain, and a loan is on either the lot model or the security model. A sale id equal to a
  record id on the same loan from a different source is unlikely and accepted.
- **Partial seeded history.** Events emitted before the key was set and beyond RPC retention are not in
  `contract_logs` (`security-registry-events.md#known-limitations`), so the audit log shows the history
  that was indexed only. Testnet had no SecurityRegistry events at ledger ~5 585 900, so nothing is lost
  if #1779's rollout is done before 2026-11-12.
- **`SecurityPriceStale` repeats.** The contract emits it on every write or `check_coverage` while the
  loan stays above the margin call ratio with a stale price (`lib.rs` `update_margin_call`). Each row is
  rendered; no dedupe, because these are distinct on-chain events.
- **Merge conflict with #1780.** Both may touch `docs/references/security-registry-events.md`; this plan
  edits only its last "Known limitations" bullet.
- **Comment-less rule vs. the existing file.** `audit_log.rs` has many doc comments from before the rule.
  New code adds none. Existing doc comments whose content becomes false are corrected in place (step 7);
  the rest are left, to keep the diff reviewable.

## Open Questions

_None_

### Resolved questions (human, 2026-11-06)

- **Pause / wiring rows:** render `SecurityRegistryPaused` ("SecurityRegistry paused") and
  `SecurityRegistryUnpaused` ("SecurityRegistry unpaused"), Protocol scope, `details: {}` — a pause blocks
  every SecurityRegistry write. Do **not** render `SecurityLoanRegistrySet`. The allow-list therefore has
  **21** `Security…` names (the 19 above plus the two pause rows); adjust the allow-list tests
  (`only_the_expected_security_names_are_allow_listed` excludes only `SecurityLoanRegistrySet`) and add
  renderer tests for both pause rows.
- **Legacy marker:** the suffix ` (legacy collateral registry)` is confirmed.
- **`SecurityRecordAttested`:** no address in `action`; the full attester Strkey stays in `details` only, like
  every other address. Drop `short_address` if nothing else uses it, and update the renderer test and the
  audit-logging spec wording.

## Implementation Steps

1. [x] **Regression test first (EVM byte-identity).** Before any change in `src/`, add
   `evm_collateral_registry_rows_render_byte_identically` to `packages/api/tests/dashboard_auditlog_chain.rs`.
   Build one EVM feed (`build_response(rows, &[EVM])`) with one row of each of the 11 CollateralRegistry
   names plus `LoanCCRUpdated`, `CashRepaid` and `CashRepaymentReversed`, using the params of the existing
   `collateral_registry_events_render_on_both_arms` and `cash_repaid_and_reversal_render_on_both_arms`.
   Assert `serde_json::to_value(&resp)` equals a literal `json!` of the full items (action, details, scope,
   reference, event_name, timestamp, chain_id). Run it on the unchanged code and confirm it is green.
2. [x] **Allow-list** (`packages/api/src/routes/audit_log.rs`). Append the 21 names to `AUDIT_EVENT_NAMES` in a
   block after `PocketClaimed`, in the order of the table above. Add
   `const LEGACY_COLLATERAL_REGISTRY_NAMES: [&str; 11]` with the 11 names.
3. [x] **Legacy marker.** Rename the current `format_action` body to a private `render(event_name, params,
   chain_kind) -> (String, Value)`. The new `pub fn format_action` calls `render`. When
   `chain_kind == ChainKind::Stellar` and the name is in `LEGACY_COLLATERAL_REGISTRY_NAMES`, it appends
   ` (legacy collateral registry)` to the action. `details` are untouched.
4. [x] **Helpers** (private, same file, no comments):
   - `parse_raw_amount(&str) -> Option<i128>` and `amount_from_raw(raw: i128, chain_kind) -> String`;
     `param_amount` reuses both;
   - `bps_pct(params, key) -> Option<String>` (2-dp percent string, `None` when missing);
   - `ltv_pct(params) -> Option<String>` (`None` also for `4294967295`) and
     `ltv_label(params) -> Option<String>` (`"87.50%"` or `"unbounded"`);
   - `signed_bps_pct(params, key) -> Option<String>` (sign from the integer bps; `+` when positive, for the variance actions);
   - `duration_label(secs: u64) -> String` (`d` / `h` / `m` / `s`, largest exact unit);
    - `iso_param(params, key) -> Option<String>` (parse a unix-seconds string, `iso_utc_from_unix`);
   - `default_rate_pct(params)` via `economics_rate_to_bps`.
5. [x] **Renderers.** In `render`, one arm per new name, as specified in
   [Action and details per event](#action-and-details-per-event). `details` keys appear exactly as
   listed; ids, amounts and percents use `json!(Option<String>)` (string or `null`); `by_consent` /
   `flagged` use `param_value(..).and_then(Value::as_bool)`; `inspectors` is the stored array or `null`.
   `SecurityRecordEnforced` goes through `render_enforced(params, chain_kind, link: Option<&Proceeds>)`,
   and `render` passes `None`.
6. [x] **Enforcement link** in `build_response`. After sorting, build
   `HashMap<(i64, String, String), Proceeds>` keyed by `(chain_id, loan_id, sale_id)` from `CashRepaid`
   rows with `sale_id != "0"`. Skip any whose `(chain_id, loan_id, repayment_id)` is in the set built
   from `CashRepaymentReversed` rows. `Proceeds { repayment_ids: Vec<String>, cash_raw: BigDecimal }`.
   `map_item` gets the map. For `SecurityRecordEnforced` it calls `render_enforced` with the entry for
   `(row.chain_id, row.loan_id, params.record_id)`. Other rows go through `format_action` as today.
7. [x] **Stale doc comments, corrected in place, nothing added:** the module header list of sources (add "the
   SecurityRegistry events (#1781)" and "Stellar CollateralRegistry rows are marked legacy"), the
   `AUDIT_EVENT_NAMES` doc (add SecurityRegistry), and `AuditLogItem::reference` (add SecurityRegistry
   to the no-snapshot list, since it feeds OpenAPI).
8. [x] **Existing tests.** In `packages/api/tests/dashboard_auditlog_chain.rs`,
   `collateral_registry_events_render_on_both_arms`: the Stellar-arm assertions (`HaircutSet`, `Revalued`,
   `StageUpdated`, `DocAdded`, `QuantityAdjusted`, `Released`) gain the ` (legacy collateral registry)`
   suffix; EVM assertions unchanged. Extend `allow_list_has_the_new_events_and_not_deal_token_transfer` with
   the 21 names.
9. [x] **New test file** `packages/api/tests/audit_log_security_registry.rs` (see Test Strategy). Header: one
   2-line spec pointer to `docs/product-specs/audit-logging.md#trustee-dashboard-feed-get-v1audit-log`;
   no other comments.
10. [x] **Docs** (see Docs to Update).
11. [x] **Verify:** `cargo fmt --all`, `cargo clippy --all -- -D warnings`,
    `cargo test -p pipeline-api --test audit_log --test audit_log_security_registry --test dashboard_auditlog_chain`,
    then `cargo test -p pipeline-api`. Run the docs linter as
    `/Users/aabliazimov/Documents/work/pipeline/node_modules/.bin/tsx scripts/lint-docs.ts` from the
    worktree.

## Test Strategy

All pure unit tests in `packages/api/tests/`. No Postgres, no `DATABASE_URL` / `POSTGRES_URL` or any env
var. Fixtures use params exactly as `security_registry_parsers.rs` writes them: ids as strings, bps and
variances as JSON numbers, `u64` as strings, `i128` as 7-dp strings, hashes as 64-char lowercase hex,
enums as variant names, addresses as Strkeys. No comments in test code.

`packages/api/tests/audit_log_security_registry.rs`:

- **Allow-list:**
  - `security_registry_names_are_allow_listed`: the 21 names are in `AUDIT_EVENT_NAMES`.
  - `only_the_expected_security_names_are_allow_listed`: the `Security`-prefixed subset of
    `AUDIT_EVENT_NAMES` equals the 21 exactly. This excludes only `SecurityLoanRegistrySet`.
  - `record_nft_topics_never_reach_the_feed`: none of `mint`, `burn`, `Mint`, `Burn`,
    `ownership_transfer`, `ownership_transfer_completed`, `ownership_renounced` is in `AUDIT_EVENT_NAMES`.
- **One renderer test per event** (21, with the two pause rows). Each asserts the full `action` string and the full `details`
  object (`assert_eq!(details, json!({...}))`) on `ChainKind::Stellar`:
  - `record_registered_…` / `record_perfected_…` / `record_handed_over_…` / `record_attested_…` (the
    no address in the action, the full one in details) / `doc_added_…`.
  - `record_released_…`: both `by_consent` values.
  - `mandate_breach_…` / `enforcement_started_…`.
  - `record_enforced_unlinked_…`: `repayment_ids: []`, `proceeds: null`.
  - `terms_set_…`: 80.00 / 85.00 / `14d`, `default_rate` 150000 → `"15.00"`, durations raw.
  - `revalued_…`: `"10000000"` → `$1.000000/unit (LME)`.
  - `margin_call_…`: ISO `cure_by` in the action, raw in details.
  - `price_stale_…` / `margin_call_cured_…`.
  - `inspection_recorded_…`.
  - `inspection_approved_…`: negative, positive and zero variances, and both `flagged` values.
  - `flag_resolved_…`: `Accepted`, `TopUpRequired`, `Escalated`.
  - `extension_consent_…`.
  - `inspectors_set_…`: 0, 1 and 3 inspectors; Protocol scope via `build_response`.
- **Edge cases:**
  - `ltv_u32_max_renders_unbounded_with_null_pct` (margin call, price stale, cured).
  - `bps_pct_handles_small_negatives` (`-5` → `"-0.05"`).
  - `missing_fields_degrade_to_bare_labels` (every new name with `json!({})` gives the bare label, no
    panic).
  - `cure_period_label_units` (`0`, `90`, `7200`, `1209600`, `90000` → `25h`).
- **Enforcement link via `build_response`** (Stellar chain config):
  - links one `CashRepaid` with `sale_id = record_id` on the same loan;
  - sums two and lists ids ascending;
  - ignores `sale_id = "0"`, another loan, another record, and another chain (EVM `CashRepaid` with the
    same loan and sale ids);
  - excludes a repayment reversed by `CashRepaymentReversed`;
  - links when the repay is newer than the enforcement;
  - the `CashRepaid` items themselves are unchanged: same `action` and `details` as without the
    enforcement row, `event_name == "CashRepaid"`.
- **Scope and reference:** a loan-scoped row gets `Loan #<id>` with `reference == ""`.
- **Legacy marker:**
  - each of the 11 CollateralRegistry names on Stellar gets exactly the suffix, and its `details` equal
    the EVM-shaped details for the same params;
  - `LoanCCRUpdated` on Stellar is unchanged;
  - `Security…` and non-CollateralRegistry Stellar rows (`CashRepaid`, `PocketOpened`) get no suffix.

`packages/api/tests/dashboard_auditlog_chain.rs`: the EVM golden regression (step 1), the updated
Stellar assertions and the extended allow-list test (step 8). `packages/api/tests/audit_log.rs` has no
Stellar CollateralRegistry assertion and is unchanged; it must stay green.

## Docs to Update

- `docs/product-specs/audit-logging.md`, section "Trustee dashboard feed":
  - add a **SecurityRegistry events (#1781)** bullet: the 21 names, scope, the rendering conventions
    (`_pct` from bps, `LTV unbounded`, raw times and durations in `details`, hashes and addresses in `details` only), the enforcement-proceeds link rule, and that NFT `mint` / `burn` and
    `SecurityLoanRegistrySet` are not listed;
  - rename the CollateralRegistry bullet to "CollateralRegistry lot events (#1478, legacy)" and state that
    Stellar rows of those names carry the ` (legacy collateral registry)` suffix in `action` (details
    unchanged) while EVM rows render as before;
  - add SecurityRegistry rows to the "carry no loan snapshot, so their `reference` is empty" sentence.
- `docs/references/security-registry-events.md`: replace the last "Known limitations" bullet ("stay out of
  `/v1/audit-log` until #1781") with a pointer to the audit-logging spec section.
- `docs/references/collateral-registry-events.md`: one sentence that Stellar rows render with the legacy
  suffix in `/v1/audit-log` (#1781).
- No change to `docs/frontend/trustee-flows.md` (the frontend contract is unchanged) and no generated docs.
