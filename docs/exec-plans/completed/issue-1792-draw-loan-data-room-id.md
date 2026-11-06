# Issue #1792: Loan submission: data_room_id → borrower_ref and the HEAD draw_loan inputs

Source: https://github.com/eq-lab/pipeline/issues/1792

Parent epic: #1776 (merge-order step 5). Frontend follow-up: #1805 (blocked on this issue being deployed on pipeline-test).

## Scope

The loan submission must carry what the HEAD `draw_loan` takes. Source of truth is `pipeline-stellar-contracts` @ `7646cef`:

- `contracts/loan-registry/src/lib.rs:75`: `draw_loan(e, metadata_uri: String, economics: ImmutableLoanData) -> u32`. It takes 2 args and has `#[only_owner]`, so it is reached through `access_manager.execute(target, "draw_loan", args, caller)`.
- `contracts/loan-registry/src/types.rs:42-52`: `ImmutableLoanData { borrower_ref: BytesN<32>, original_facility_size: u128, original_senior_tranche: u128, original_equity_tranche: u128, original_offtaker_price: u128, senior_interest_rate: u32, origination_date: u64, original_maturity_date: u64 }`.

Units, checked against the contract code:

| Field | Contract unit | Evidence |
|---|---|---|
| money (`original_*`) | `u128`, 7-dp base units (USDC-SAC / PLUSD scale) | `lib.rs:28-29`: "Money and quantities are 7 decimals (the PLUSD / SAC scale)". Also `shared::chains::normalize_usdc_amount` (#901). |
| `senior_interest_rate` | `u32`, fixed-point with `ONE = 1_000_000` = 100 %/yr, so the value is bps × 100 | `lib.rs:30` `ONE`; `storage.rs:269` `elapsed * rate * outstanding / (YEAR * ONE)`; `test.rs:20` `DEFAULT_RATE = ONE / 10` (10 % = `100_000` = 1000 bps × 100) |
| `origination_date`, `original_maturity_date` | `u64` unix seconds | compared against `e.ledger().timestamp()` (`storage.rs:268`); `test.rs:221` `original_maturity_date: YEAR` |
| `borrower_ref` | `BytesN<32>`, "sha256 of the borrower's data-room id" | `types.rs:44` |

The contract's own checks are `senior + equity == facility`, `maturity > origination` and `offtaker >= facility` (`lib.rs:77-88`). `validate_submission` already mirrors all three.

### In scope (backend, `packages/api` only)

1. **New optional input `data_room_id`** on `SubmitLoanRequest`, used by both `POST /v1/loan-book/loan` and `POST /v1/loan-book/submissions/{id}/resubmit`.
   - At ingest it is trimmed. If it is empty after trimming, it becomes absent.
   - It is persisted in `loan_data` under the key `data_room_id`.
2. **`borrower_ref = sha256(UTF-8 bytes of the trimmed data_room_id)`**, served as 64 lowercase hex characters with no `0x`. This is the same convention as `lp_bank_deposits.rs` `ref_hash` / `reference_hash`.
   - It is computed at read time from `loan_data`, never stored. That is why existing rows need no migration: they serve `borrower_ref: null`.
3. **A served, contract-ready `draw_loan` block**, derived purely from `loan_data` plus the target chain's kind. It is added (additive only) to:
   - `SubmissionView`, the item of the public `GET /v1/loan-book/submissions` that the Trustee review reads;
   - `SubmitLoanResponse`, returned by `POST /loan` and `POST /resubmit`.

   Shape:

   ```json
   "draw_loan": {
     "metadata_uri": "ipfs://…",
     "economics": {
       "borrower_ref": "aeaa7d34…d5d7",
       "original_facility_size": "1000000000000",
       "original_senior_tranche": "800000000000",
       "original_equity_tranche": "200000000000",
       "original_offtaker_price": "1050000000000",
       "senior_interest_rate": 120000,
       "origination_date": 1700000000,
       "original_maturity_date": 1715000000
     },
     "missing_inputs": []
   }
   ```

   - The `economics` keys are exactly the 8 `ImmutableLoanData` field names.
   - Money values are u128 base-unit decimal strings at the Stellar loan-registry scale (7 dp).
   - `senior_interest_rate` is `senior_interest_rate_bps × 100` as a JSON number.
   - Dates are passed through as JSON numbers (unix seconds).
   - Any input that is absent or cannot be represented in the contract type is served as `null`, and its name goes into `missing_inputs`. The names are `metadata_uri`, `data_room_id`, and `economics.<input key>`.
   - A missing `data_room_id` gives `borrower_ref: null` and the entry `"data_room_id"`.
   - **Only Stellar-target submissions get the block** (human decision, 2026-10-30). It is `null` when:
     - the submission's `target_chain_id` is an EVM chain, until EVM `draw_loan` lands in #1573;
     - the `target_chain_id` is not in `CHAINS`, because the kind is unknown.
4. **Stop requiring `to`, `initial_ccr` and `initial_location`, but keep accepting them.**
   - They become `Option<…>` with `#[serde(default, skip_serializing_if = "Option::is_none")]` and are marked deprecated in OpenAPI.
   - Their validation is removed from `validate_submission`: `to` non-empty, `initial_ccr >= CCR_ONE`, and the `location_type` enum.
   - When a client sends them, they are still persisted verbatim in `loan_data`. The old Trustee detail page (Location row, `-origination-detail.ts:236,290`) and the old wallet-connect encoder keep finding them.
   - When a client omits them, `loan_data` has no such keys, rather than `null` values.
   - They never appear in the `draw_loan` block.
5. **`collateral_valuation` and `fee_schedule` stay required.** That is unchanged (#1786).
6. **Correct the stale doc comments** that claim the DTO carries "every input required by the on-chain `draw_loan`":
   - `SubmitLoanRequest`;
   - `SubmissionView.loan_data`;
   - `EconomicsInput`, whose amounts are human-unit USDC decimal strings with up to 6 fractional digits (#1620), not base-6 integers;
   - `SubmittedLoanRow.loan_data` in `packages/shared`, which is a comment-only change.
7. **Update the product specs.** See Docs to Update.

### Out of scope

- **Any contract change.** Contracts are frozen.
- **All frontend work.** That is the frontend follow-up #1805:
  - the Trustee form's `data_room_id` field;
  - dropping `to`, `initial_ccr` and `initial_location` from the form and the detail page;
  - wallet-connect `encodeDrawLoanArgs` → `[metadata_uri, economics]` with `borrower_ref`;
  - the TS types in `packages/trustee`, `packages/frontend` and `packages/wallet-connect`.
- **Making `data_room_id` required.** That is step 2, a later issue filed after #1805 is deployed.
- **Migrating existing `loan_data` rows**, and any DB migration at all.
- **Worker / indexer changes.** For example, cross-checking the on-chain `borrower_ref` against the submission.
- **EVM `draw_loan` wiring (#1573), and any EVM economics scale.** EVM-target rows serve `draw_loan: null` until #1573 decides the EVM shape.
- **New routes.** None are added; the data is inlined into the existing payloads, per the minimal-endpoint-surface rule.
- **New submit-time validation of amounts.** Amounts that cannot be represented are reported at read time through `missing_inputs`, so nothing that is accepted today starts being rejected.

### Rollout safety (pipeline-test), checked against the mandatory section

| Constraint | How this plan honours it |
|---|---|
| Migrations additive only | **No migration.** `loan_data` is schemaless JSONB, and the new key `data_room_id` simply appears on new rows. |
| Previous image keeps booting / rollback works | No schema change. The previous API image reads `loan_data` as `serde_json::Value` (list), so rows written by the new image without `to` and others list fine. The old image's typed deserialization applies only to incoming requests, and the old frontend still sends the legacy fields. |
| New env keys optional | **None added.** The Stellar-only gate uses the existing `ConfiguredChain.kind`. |
| EVM unchanged | EVM rows get no new non-null field: `draw_loan` is always `null` for an EVM target, and no existing field changes meaning. A regression test pins `draw_loan: null` for an EVM row and the unchanged `SubmissionView` fields. Validation is relaxed identically for every chain, since `validate_submission` is chain-agnostic. |
| Indexer best-effort | Indexer untouched. The API does no RPC. |
| API additive | `draw_loan` and `data_room_id` are new and optional. The legacy fields are still accepted and still persisted when sent; nothing is removed or renamed in the request, the response or `loan_data`. `SubmitLoanResponse.id` is unchanged. |
| API and worker roll independently | Worker untouched. |

## Assumptions and Risks

**Assumptions**

- **"Submission and review payloads"** means `SubmitLoanResponse` (`POST /loan` and `POST /resubmit`) and `SubmissionView` (`GET /submissions`, which the Trustee review reads). `POST /submissions/{id}/review` returns only `200` and is not changed.
- **The economics strings in `loan_data` are human-unit USDC decimals**, for example `"100000.000000"`. This matches the Trustee form (`USDC_AMOUNT_PATTERN`, at most 6 fractional digits) and wallet-connect `parseUsdcToU128`, which multiplies by `10^7` exactly and refuses to truncate (#1620). The backend conversion mirrors it:
  - `BigDecimal` × `10^scale`;
  - the result must be a non-negative integer that fits in `u128`;
  - otherwise the field is `null` and goes into `missing_inputs`. It is never rounded.
- **Trim semantics are Rust `str::trim`**, which strips Unicode `White_Space`.
  - JS `String.prototype.trim` also strips U+FEFF, so the two differ for that one character.
  - This does not matter because only the backend hashes; #1805 explicitly says the browser must not hash.
  - No Unicode normalisation (NFC/NFD) is applied. The bytes hashed are the UTF-8 the client sent, after trimming.
- **`data_room_id` has no format or length constraint** beyond being non-empty after trimming. Its format is not specified anywhere.
- **The access manager on testnet** is `CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW`, and the loan registry is `CDWN5B3FFX25TSL6T2NEW5LPTW4VYFUXCXPMNIFRBMJYILEOAL5TVXZQ` (`pipeline-stellar-contracts/deployments/networks/testnet/addresses.json`).
  - `draw_loan` is mapped to `TRUSTEE` (`deployments/justfile:717`).
  - The delay-0 trustee members are listed in `deployments/networks/testnet/config.json` `access.trustee`.
  - `.env.example` still lists pre-#36 ids; #1794 fixes that, so do not use `.env.example` for the simulate.

**Risks**

- **Approve stays broken on pipeline-test until #1805 ships.** That is expected per the epic merge order; this issue only makes the backend ready. #1805 should read:
  - `draw_loan.economics.borrower_ref`;
  - `draw_loan.missing_inputs`;
  - optionally the served economics instead of re-converting.

  After merge, the coder or manager should post on #1805 the exact JSON paths that ship.
- **Merge conflicts in `packages/api/src/routes/loan_book.rs`** with #1789, which inlines pocket state in the loan book and merges earlier in the epic order. The two touch different regions (`handle_loan_book` versus the submission DTOs), but the `#[openapi(components(...))]` list may conflict. Rebase before opening the PR.
- **The testnet simulate can fail for reasons unrelated to this change**: a paused registry, `capital_wallet` not set, or the trustee account unfunded. Read the simulate error before blaming the encoding. `InvalidTranches`, `InvalidMaturityDate` and `InvalidOfftakerPrice` mean the payload itself is wrong.
- **`CCR_ONE` may become an unused import** in `loan_book.rs` once the `initial_ccr` check is removed. Clippy (`-D warnings`) will flag it, so remove the import if it is unused.
- **Removing `impl From<SubmittedLoanRow> for SubmissionView`** in favour of a kind-aware constructor affects only `packages/api/tests/loan_submission.rs`; there are no other users (verified by grep). If the coder prefers to keep `From`, it must not silently produce `draw_loan: null` for configured chains.

## Resolved questions (human, 2026-10-30)

1. **Public exposure of `data_room_id`: serve it verbatim.**
   - `GET /v1/loan-book/submissions` is public, so the raw `data_room_id` in `loan_data` is world-readable, like `borrower_id`.
   - Accepted as is; nothing is stripped from `SubmissionView.loan_data`.
2. **EVM-target submissions: `draw_loan: null` until #1573.**
   - Only Stellar-target submissions get the block.
   - There is no EVM scale and no `Evm => 6` path anywhere in this issue.
   - `null` also stays for an unconfigured target chain.

## Open Questions

_None_

## Implementation Steps

All code changes are in `packages/api/src/routes/loan_book.rs`, except step 8. Keep the file's existing doc-comment style: field docs on DTOs are the OpenAPI descriptions.

1. **`SubmitLoanRequest`: new and relaxed fields.**
   - Add `data_room_id: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`. Doc comment: the borrower's data-room id, whose trimmed sha256 is `borrower_ref`; optional for now and required in a later release.
   - Change `to: String` → `Option<String>`, `initial_ccr: u32` → `Option<u32>`, and `initial_location: LocationInput` → `Option<LocationInput>`.
     - Each gets `#[serde(default, skip_serializing_if = "Option::is_none")]` and `#[schema(deprecated)]` (utoipa 5).
     - Each gets a one-line doc: "Deprecated: no longer a `draw_loan` input; accepted and stored verbatim, never validated."
     - Do not use Rust `#[deprecated]`: it would trip `-D warnings` at every use.
   - Rewrite the struct doc comment. The request carries the `draw_loan` inputs (`metadata_uri`, `economics`, `data_room_id`), the off-chain metadata document fields, and the collateral-valuation and fee-schedule anchors. It is persisted for trustee review.
   - Fix the `EconomicsInput` doc comments: amounts are human-unit USDC decimal strings (up to 6 fractional digits), and `senior_interest_rate_bps` is basis points.
   - Leave `LocationInput` unchanged (still a schema component).
2. **Normalisation helper.**
   - Add `pub fn normalize_data_room_id(raw: Option<String>) -> Option<String>`, which trims and maps empty to `None`.
   - In `submit_loan` and `resubmit_loan`, make `payload` `mut` and apply it to `payload.data_room_id` before `validate_submission`. The value persisted in `loan_data` is then exactly the hashed preimage.
3. **`validate_submission`.**
   - Delete the `to` non-empty check, the `initial_ccr >= CCR_ONE` check and the `location_type` match.
   - Keep the `metadata_uri`, economics, `collateral_valuation` and `fee_schedule` checks exactly as they are.
   - Do not add a `data_room_id` check: absent is valid in step 1.
   - Drop the `CCR_ONE` import if it is now unused.
4. **Pure derivation functions.** All are `pub` so tests in `packages/api/tests/` can reach them; none do I/O.
   - `pub fn borrower_ref_hex(data_room_id: &str) -> Option<String>`: trim; `None` if empty; else `hex::encode(Sha256::digest(trimmed.as_bytes()))`. Uses the `sha2` and `hex` dependencies already in `packages/api/Cargo.toml`.
   - `pub const STELLAR_LOAN_MONEY_DECIMALS: u32 = 7;`. There is no EVM counterpart and no kind-to-decimals function. The one-line doc points at the Units table in `api-authorization-loan-submission.md`.
   - `pub fn usdc_to_base_units(amount: &str, decimals: u32) -> Option<String>`: parse `BigDecimal`; reject negatives; multiply by `10^decimals`; require an integral result (no fractional remainder) and `<= u128::MAX`; return the plain integer string (scale 0).
   - `pub fn draw_loan_args(loan_data: &serde_json::Value) -> DrawLoanArgs` computes the Stellar args; it takes no kind. It reads keys from the JSON, not the typed struct, so legacy or odd rows degrade per field instead of failing:
     - `metadata_uri` (string, non-empty after trim);
     - `data_room_id` (string) → `borrower_ref_hex`;
     - `economics.original_facility_size`, `original_senior_tranche`, `original_equity_tranche`, `original_offtaker_price` → `usdc_to_base_units(_, STELLAR_LOAN_MONEY_DECIMALS)`;
     - `economics.senior_interest_rate_bps` (u32) → `checked_mul(100)`;
     - `economics.origination_date` and `economics.original_maturity_date` (u64).

     Each `None` pushes a name into `missing_inputs`, in a fixed order: `metadata_uri`, `data_room_id`, then `economics.original_facility_size`, `economics.original_senior_tranche`, `economics.original_equity_tranche`, `economics.original_offtaker_price`, `economics.senior_interest_rate_bps`, `economics.origination_date`, `economics.original_maturity_date`. The names are the input keys the submitter must fix, not the contract field names.
5. **New DTOs.** Both derive `Debug, Clone, Serialize, ToSchema`.
   - `DrawLoanArgs { metadata_uri: Option<String>, economics: DrawLoanEconomics, missing_inputs: Vec<String> }`.
   - `DrawLoanEconomics { borrower_ref: Option<String>, original_facility_size: Option<String>, original_senior_tranche: Option<String>, original_equity_tranche: Option<String>, original_offtaker_price: Option<String>, senior_interest_rate: Option<u32>, origination_date: Option<u64>, original_maturity_date: Option<u64> }`.
     - The field names must match `ImmutableLoanData` exactly, and every field is serialized, with `null` when absent; do not use `skip_serializing_if`. The "exact keys" test depends on this.
     - Doc comments state the units, as in the Scope table.
   - Register both in `LoanBookDoc` `components(schemas(...))`.
6. **Serve the block.**
   - Add `pub fn draw_loan_for(kind: Option<ChainKind>, loan_data: &serde_json::Value) -> Option<DrawLoanArgs>`: `Some(ChainKind::Stellar)` gives `Some(draw_loan_args(loan_data))`; `Some(ChainKind::Evm)` and `None` give `None`. Every handler goes through this single gate.
   - `SubmissionView`: add `pub draw_loan: Option<DrawLoanArgs>`, documented as "Stellar-target submissions only; `null` for an EVM target (until #1573) or an unconfigured `target_chain_id`". Fix the `loan_data` doc: "the submitted payload, verbatim (legacy rows may carry `to`/`initial_ccr`/`initial_location`)".
   - Replace `impl From<SubmittedLoanRow> for SubmissionView` with `impl SubmissionView { pub fn from_row(r: SubmittedLoanRow, kind: Option<ChainKind>) -> Self }`, which sets `draw_loan: draw_loan_for(kind, &r.loan_data)` before moving `loan_data`.
   - `list_submissions`: build each view with `SubmissionView::from_row(r, kind_of(r.target_chain_id))`, where the kind comes from `state.chains.iter().find(|c| c.chain_id == id).map(|c| c.kind)`. The pattern is the same as `audit_log.rs:219`. The on-chain status override stays as it is.
   - `SubmitLoanResponse`: add `pub draw_loan: Option<DrawLoanArgs>`.
     - `submit_loan` uses `draw_loan_for(Some(chain.kind), &loan_data)`.
     - `resubmit_loan` takes the kind from the row it already fetches via `find(id)` (`target_chain_id`). Keep that row instead of `.is_some_and(...)` so its `target_chain_id` is available.
     - Update the `utoipa::path` response descriptions accordingly; the status codes are unchanged.
7. **Update the `submit_loan` doc comment**: "Validates the payload against the same invariants `draw_loan` enforces". This stays true, but it should mention that `data_room_id` is optional for now.
8. **Comment-only change** in `packages/shared/src/submitted_loan_repo.rs`: `SubmittedLoanRow.loan_data` → "The submitted loan payload, stored verbatim." Remove the "(all `draw_loan` inputs)" claim, and fix the module header line 5 the same way if it repeats the claim.
9. **Lint and build.** Run `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-api` and `npx tsx scripts/lint-docs.ts` (docs changed).
10. **Manual testnet simulate (acceptance).** This is not committed; use a throwaway script in the session scratchpad.
    1. Run the API locally (or use pipeline-test once deployed), submit a payload with `data_room_id`, and read the served `draw_loan` block from `GET /v1/loan-book/submissions`.
    2. With `@stellar/stellar-sdk` (already a dependency of `packages/wallet-connect`), encode `args = [scvString(metadata_uri), scMap(economics)]`. The map keys are sorted lexicographically, so `borrower_ref` comes first.
       - `borrower_ref` is `scvBytes(Buffer.from(hex, "hex"))`.
       - The four money fields are `u128` from the served decimal strings.
       - `senior_interest_rate` is `scvU32`; the two dates are `u64`.
    3. Build `execute(target = loan_registry CDWN5…, function = "draw_loan", args, caller = <a delay-0 trustee G…>)` against access_manager `CDP7T…` on testnet (`https://soroban-testnet.stellar.org`), with the trustee as source account, and call `simulateTransaction`.
    4. It must succeed and return a `u32` loan id. Paste the simulate result summary (the success, and the returned loan id) into the PR description.
    5. Do **not** submit the transaction.

## Test Strategy

These are pure unit tests only, under `packages/api/tests/`. There is no inline `mod tests`, no `DATABASE_URL`/`POSTGRES_URL`, and no Postgres.

**Update `packages/api/tests/loan_submission.rs`:**

- `valid_request()` sets:
  - `to: Some(..)`;
  - `initial_ccr: Some(1_500_000)`;
  - `initial_location: Some(LocationInput {..})`;
  - `data_room_id: Some("DR-0001".into())`.
- Remove `empty_to_is_rejected`, `ccr_below_one_is_rejected`, `ccr_exactly_one_is_allowed` and `unknown_location_type_is_rejected`. Replace them with:
  - `legacy_fields_are_not_validated`: `to: Some("  ")`, `initial_ccr: Some(0)` and `location_type: "Moon"` together still give `Ok`.
  - `submission_still_sending_legacy_fields_is_accepted`: the existing full legacy JSON (with `to`, `initial_ccr` and `initial_location`, without `data_room_id`) deserializes and validates `Ok`, and `serde_json::to_value` of it still contains `to`, `initial_ccr` and `initial_location` verbatim. This is the persistence round-trip the old frontend relies on.
  - `submission_without_legacy_fields_is_accepted`: JSON without the three fields deserializes and validates `Ok`, and the serialized value has **no** `to`, `initial_ccr` or `initial_location` keys (absent, not `null`).
  - `submission_without_data_room_id_is_accepted`: deserializes and validates `Ok`; `data_room_id` is `None`; the serialized value has no `data_room_id` key.
  - `collateral_valuation_is_still_required`: JSON missing `collateral_valuation` fails to deserialize.
- `normalize_data_room_id`:
  - `"  DR-0001\n"` gives `Some("DR-0001")`;
  - `"   "` gives `None`;
  - `None` gives `None`.
- Update `submit_request_round_trips_through_json` for the `Option` fields and add a `data_room_id` assertion.
- Change `submission_view_*` to `SubmissionView::from_row(row, Some(ChainKind::Stellar))`. Add `submission_view_unconfigured_chain_has_null_draw_loan` (`from_row(row, None)` gives `draw_loan: null`).
- OpenAPI:
  - The `SubmitLoanRequest` schema's `required` no longer lists `to`, `initial_ccr` or `initial_location`; it still lists `metadata_uri`, `economics`, `collateral_valuation` and `fee_schedule`.
  - `data_room_id` is present and not required.
  - `SubmissionView` and `SubmitLoanResponse` have a `draw_loan` property.
  - `DrawLoanArgs` and `DrawLoanEconomics` schemas exist.

**New `packages/api/tests/draw_loan_args.rs`:**

- `borrower_ref_known_vector`: `borrower_ref_hex("DR-0001")` == `"aeaa7d34d7793d5e132013aa6ef9bdc6623cc3c0ece3a723edd4887316b7d5d7"` (`printf 'DR-0001' | shasum -a 256`).
- `borrower_ref_trims_whitespace`: `"  DR-0001\t\n"` gives the same hex.
- `borrower_ref_hashes_utf8_bytes`: `"Data-Room-Ünï"` (precomposed, NFC) == `"ef1fb63e931b9e2743158911a490fcc9e15619eb3f33671edb7f94c786776ee1"`.
- `borrower_ref_empty_is_none`: `""` and `"  "` give `None`. In particular, never the sha256 of the empty string (`e3b0c442…b855`).
- `borrower_ref_is_64_lowercase_hex_without_prefix`.
- `served_economics_has_exactly_immutable_loan_data_fields`: serialize `draw_loan_args(..).economics` and assert the key set equals {`borrower_ref`, `original_facility_size`, `original_senior_tranche`, `original_equity_tranche`, `original_offtaker_price`, `senior_interest_rate`, `origination_date`, `original_maturity_date`}. It must have no `to`, `initial_ccr`, `initial_location`, `senior_interest_rate_bps` or `data_room_id`.
- `stellar_units_match_contract`, using `valid_request()`'s values:
  - `"100000.000000"` → `"1000000000000"` (× 10^7);
  - `"80000.000000"` → `"800000000000"`;
  - `"20000.000000"` → `"200000000000"`;
  - `"105000.000000"` → `"1050000000000"`;
  - `1200` bps → `120000`;
  - the dates pass through unchanged.

  Also assert `senior + equity == facility` on the parsed u128 strings.
- `evm_row_gets_null_draw_loan` (the EVM regression):
  - `draw_loan_for(Some(ChainKind::Evm), &complete_loan_data)` is `None`;
  - `SubmissionView::from_row(evm_row, Some(ChainKind::Evm))` serializes `draw_loan: null`;
  - every other `SubmissionView` field (`status`, `target_chain_id`, `chain_id`, `loan_id`, `documents`, `loan_data`) equals what the same row gives for a Stellar target.
- `stellar_row_gets_draw_loan`: `draw_loan_for(Some(ChainKind::Stellar), ..)` is `Some`.
- `unconfigured_chain_gets_null_draw_loan`: `draw_loan_for(None, ..)` is `None`.
- `missing_data_room_id_yields_null_borrower_ref_and_missing_input`: the other fields are populated; `missing_inputs == ["data_room_id"]`.
- `legacy_row_with_old_keys_serves_contract_shape`: `loan_data` with `to`, `initial_ccr` and `initial_location` and no `data_room_id` gives `borrower_ref: null`, and the economics are still served.
- `complete_submission_has_no_missing_inputs`.
- `non_representable_amount_is_reported`:
  - each of `"1.12345678"` (8 dp at scale 7), `"-1"`, `"abc"` and a value above `u128::MAX / 10^7` gives that field `null` and `"economics.original_facility_size"` in `missing_inputs`;
  - `"1.1234567"` is fine (`"11234567"`).
- `rate_overflow_is_reported`: `senior_interest_rate_bps = 50_000_000` gives `senior_interest_rate: null` and `"economics.senior_interest_rate_bps"`.
- `missing_inputs_order_is_stable`: an empty `{}` `loan_data` lists all 9 names in the documented order.
- `usdc_to_base_units` edge cases:
  - `"0"` → `"0"`;
  - `"1"` → `"10000000"`;
  - `"1."` and `"1.0000000"` are accepted;
  - trailing zeros beyond the scale (`"1.000000000"`) are accepted, since the value is exactly representable.

**Acceptance outside unit tests:**

- The testnet `simulateTransaction` of `execute(registry, "draw_loan", [metadata_uri, economics], trustee)`, built from a served `draw_loan` block, succeeds (step 10).
- `cargo clippy --all -- -D warnings` is green.

## Docs to Update

- **`docs/product-specs/api-authorization-loan-submission.md`**: rewrite the **Payload** paragraph.
  - `POST /v1/loan-book/loan` carries `metadata_uri`, the off-chain metadata document fields, `economics`, optional `data_room_id` (required in a later release), `collateral_valuation` and `fee_schedule`.
  - `to`, `initial_ccr` and `initial_location` are deprecated: accepted and stored verbatim if sent, never validated, not `draw_loan` inputs.
  - Validation is now the three `draw_loan` invariants plus the valuation and fee checks; drop the `initial_ccr` and `location_type` bullets.
  - Correct "base-6 USDC amount strings" to "human-unit USDC decimal strings (≤ 6 fractional digits)".

  Then add a new **"`draw_loan` arguments"** subsection:
  - the served `draw_loan` block shape;
  - the units table (money in 7-dp u128 base units, rate = bps × 100 on `ONE = 1e6`, unix seconds);
  - the block is served for Stellar-target submissions only: `null` for an EVM target until #1573, and `null` for an unconfigured target chain;
  - `borrower_ref = sha256(UTF-8 of trimmed data_room_id)`, lowercase hex without `0x`, computed at read time;
  - the `missing_inputs` semantics and name order;
  - `null` for an unconfigured target chain;
  - the note that existing rows are not migrated and serve `borrower_ref: null` with `missing_inputs: ["data_room_id"]`;
  - the two-step rollout, where step 2 makes `data_room_id` required after #1805.

  Also add to the table that `loan_data` may carry `data_room_id`.
- **`docs/product-specs/api-authorization.md`** (API contract table, rows 89-92):
  - `POST /v1/loan-book/loan` → `201 { id, draw_loan }`;
  - `POST …/resubmit` → `200 { id, draw_loan }`;
  - `GET /v1/loan-book/submissions` → each item also carries `draw_loan` (contract-ready Stellar `draw_loan` args with `borrower_ref` and `missing_inputs`; `null` for an EVM target until #1573, or for an unconfigured target chain).
  - On POST /loan and /resubmit, `draw_loan` is likewise `null` for an EVM target.
- **`docs/exec-plans/tech-debt-tracker.md` TD-43**: add one dated line. Since #1792, the API serves contract-ready `draw_loan` args (`SubmissionView.draw_loan`), so the wallet-connect transform can shrink to ScVal encoding in the frontend follow-up #1805. The hand-mirrored `SubmitLoanRequest` copies remain.
- **No change** to `docs/frontend/trustee-flows.md`, `docs/product-specs/trustee-dashboard.md` or `docs/product-specs/dashboards.md`. They describe frontend behaviour that #1805 changes.
- **No `docs/generated/` change.** There is no checked-in OpenAPI dump; the schema is served by utoipa at runtime.
