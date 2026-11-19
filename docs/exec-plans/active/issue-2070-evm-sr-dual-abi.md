# Issue #2070: EVM SecurityRegistry: support the deployed f92d719 ABI alongside 150631a (indexer + API)

Source: https://github.com/eq-lab/pipeline/issues/2070

Parent epic: #1937. Replaces the closed upgrade request #1944. Branch `feat/2070-evm-sr-dual-abi`, draft PR #2073.

**Binding rule (2026-11-19).** Contracts and their deployments are never changed, on either chain. Hoodi stays on SecurityRegistry and Reader code from `pipeline-contracts@f92d719`, and the backend adapts. This plan proposes no upgrade, redeploy or contract change.

## Scope

The EVM SecurityRegistry indexer (#1938) and API (#1940) are built against `pipeline-contracts@150631a` ("Credit policy v2", PR #55). Hoodi runs `f92d719` (PR #53). The worker and API must accept both versions at the same time. They pick the shape per log by topic0 and per view read by a strict decode. Fields that `f92d719` lacks are stored as `NULL` / `None`, never as invented defaults.

### ABI diff, `f92d719` → `150631a` (`git diff f92d719 150631a -- src/`)

Files changed in `src/`: `securityRegistry/SecurityRegistryUpgradeable.sol`, `interfaces/ISecurityRegistry.sol`, `PipelineSecurityRegistryReader.sol` and `interfaces/ILoanRegistry.sol`. The range also has Minter and `PipelineMinterReader` changes from `1be6871`, PR #54; they are out of scope here, see #2074. **`PipelineSecurityRecordNft.sol` and `ISecurityRecordNft.sol` have no diff.**

| Item | Kind | `f92d719` (Hoodi) | `150631a` | Effect on us |
|---|---|---|---|---|
| `ISecurityRegistry.Terms` | struct | 12 fields: `advanceRatioBps, marginCallRatioBps, curePeriod, priceStaleAfter, paymentTerm, gracePeriod, defaultRate, attestationInterval, inspectionInterval, toleranceBps, gradeToleranceBps, marginCallAt` | 15 fields. Adds `defaultRatioBps` (u32, after `marginCallRatioBps`), `originatorFeeRate` (u32, after `defaultRate`) and `defaultBreachAt` (u64, last) | Changes every item below that carries `Terms` |
| `TermsSet(uint256 indexed, Terms)` | event | topic0 `0xafe2a37a11f39e6c1aabcfeee99c2838f1dca51206b72e457790877f82f19005`, data 12 words | topic0 `0x35ef31a2f77f591c834f93ab744e2d6d2e96c49d289cda4237b7193b684365f0`, data 15 words | Today the old topic is classified `Unknown` and dropped with a warning |
| `DefaultBreach(uint256 indexed, uint32, uint32)` | event | absent | `0x37628b827703d616bfd00f47e8d13ecabe347fa729ad6abf0724235fbe934ecb` | Never emitted on Hoodi |
| `DefaultBreachPriceStale(uint256 indexed, uint32, uint32)` | event | absent | `0xed206567f71e87007acd11d033569eff156928e672e2d81a3c9c19872997cea7` | Never emitted on Hoodi |
| `DefaultBreachCleared(uint256 indexed, uint32)` | event | absent | `0xa6f25b5ed69f7384a6b641cd7ca5aede8fdfcd848bac4ae4d25897129be9e1e0` | Never emitted on Hoodi |
| `SecurityRegistry.terms(uint256)` | view | selector `0xc0aa0e8a`, returns 12 static words (384 bytes) | same selector, returns 15 static words (480 bytes) | `decode_terms` fails, and the sync loop retries forever |
| `SecurityRegistry.setTerms(uint256,Terms)` | write | selector `0x36b14cd2` | selector `0x45f225f5` | The AccessManager calldata decoder does not recognise the old selector. The Trustee and wallet-connect write path sends `0x45f225f5`, which reverts on Hoodi (Open Question 1) |
| `Reader.CoverageDetail` | struct | 10 head fields: `value, staleValue, flaggedValue, debt, coverageBps, ltvBps, marginCallAt, cureBy, priceStale, records[]` | 11 head fields. Adds `defaultBreachAt` (u64) after `cureBy` | — |
| `Reader.coverageDetail(uint256)` | view | selector `0x3efdbfe9`. Returns outer offset `0x20`, a 10-word head, and a `records` offset of `0x140` | same selector. 11-word head, `records` offset `0x160` | `decode_coverage_detail` fails, and the valuation step retries forever |
| `CoverageDetail.debt`, SR `_loanDebt` / LTV / release check | semantics (ABI unchanged) | pool debt `outstanding + accruedInterest` | `_facilityDebt`: `ceil(pool × originalFacilitySize / originalSeniorTranche)` | No code change. The API's EVM `agent_release` already reads `valuation.debt` from the Reader, so on Hoodi it gets the pool debt, which matches Hoodi's `_requireReleasable` |
| `ILoanRegistry.immutableLoanData(uint256)` | interface (consumer side) | not called by the Hoodi Reader (selector `0xe070e9b7` absent from its bytecode) | called by the `150631a` Reader and SR | None for us |
| `setTerms` validation | semantics | `marginCallRatioBps >= advanceRatioBps` | also `defaultRatioBps >= marginCallRatioBps` | Trustee form only (Open Question 1) |

Unchanged between the two commits, and confirmed in the Hoodi bytecode below:
- the registry events `RecordRegistered`, `RecordPerfected`, `RecordHandedOver`, `RecordAttested`, `RecordReleased`, `MandateBreach`, `EnforcementStarted`, `RecordEnforced`, `Revalued`, `MarginCall`, `PriceStale`, `MarginCallCured`, `FlagResolved`, `ExtensionConsent`, `LoanRegistrySet`, `Paused` and `Unpaused`;
- all four RecordNft events and the whole RecordNft ABI;
- `Record`, `RecordDetails`, `Inspection`, `InspectionContext` and `LatestInspection`;
- the views `record`, `records`, `activeRecords`, `extensionConsents`, `paused`, `loanRegistry`, `inspection` and `inspectors`.

### Hoodi findings (read-only, RPC `https://ethereum-hoodi-rpc.publicnode.com`, head about 4 046 540, 2026-11-19)

- **Implementations.** The SR proxy `0xB51E7f13…BE15` has implementation `0x502ff7b5…a683`. The RecordNft proxy `0xf6430233…bA09` has implementation `0x21fa2857…9652`. The Reader `0x8e7078c7…1b6B` is not a proxy.
- **SR implementation bytecode.**
  - It contains the old `TermsSet` topic `0xafe2a37a…` and does not contain the new `0x35ef31a2…`.
  - It contains none of the three `DefaultBreach*` topics.
  - It contains all 14 unchanged registry topics listed above, including `Paused` and `Unpaused`.
  - Its `setTerms` selector is `0x36b14cd2`; `0x45f225f5` is absent.
- **RecordNft implementation.** It contains `DocAdded` `0x50d35272…`, `InspectionRecorded` `0x761da8f1…`, `InspectionApproved` `0x40cf2919…` and `InspectorsSet` `0xe4ba83f4…`.
- **Reader bytecode.** It calls `terms` (`0xc0aa0e8a`) and not `immutableLoanData` (`0xe070e9b7`), so it is the `f92d719` Reader.
- **Events since deploy.** `eth_getLogs` over SR + RecordNft from block 3 900 000 to head returned 8 logs, all lifecycle:
  - Block **3 955 455** (both proxies deployed): `Upgraded`, `AuthorityUpdated` and `Initialized` on each proxy, plus SR `LoanRegistrySet`.
  - Block 3 955 478: RecordNft `SecurityRegistrySet`.
  - **No `TermsSet`, record, margin or inspection event has ever been emitted.**
- **AccessManager `0x3dF345BF…5992` since 3 955 455.** 91 logs at blocks 3 955 474–3 955 492, all role or target configuration (`TargetFunctionRoleUpdated` and role events). There is no `OperationScheduled`, which is consistent with the 0 role delays on Hoodi.
- **Views today.**
  - `terms(n)` reverts `SecurityRegistryNoTerms` (`0x3a418dcd`) for every loan tried (0, 1, 2, 3, 5, 10).
  - `Reader.coverageDetail(1)` reverts with the same error.
  - `Reader.record(1)` reverts `SecurityRegistryNonExistentRecord` (`0xd281f404`).
  - `paused() = false`, `loanRegistry() = 0xdF08fdf0…0231`, `recordIds(1) = []`, `extensionConsents(1) = []`, `inspectors() = []`.
- **Actual return shapes.** No record or terms exist, so the shapes were captured with `eth_call` state overrides. Nothing was written to the chain.
  - **`terms(1)`**: set `hasTerms[1]` and three packed `terms[1]` slots at the ERC-7201 base `0xe4c932a8…a900`. It returns exactly **384 bytes / 12 words**: `6000, 7500, 259200, 86400, 1, 432000, 20000, 604800, 2592000, 500, 200, 0`.
  - **`coverageDetail(1)`**: same override, plus a stub LoanRegistry code returning `LoanMoney{1e12, 0, 0, 5e11, 1e9, false}`. It returns **384 bytes / 12 words**: `0x20 | value 0 | stale 0 | flagged 0 | debt 0x74a5ed5200 (= 501 000e6, pool debt) | coverageBps 0 | ltvBps 0xffffffff | marginCallAt 0 | cureBy 0 | priceStale 0 | records offset 0x140 | records length 0`.
  - The exact hex of both payloads is pinned in the tests (Step 6).

### In scope

- Worker:
  - decode the `f92d719` `TermsSet` (topic0 `0xafe2a37a…`) into the same stored name `SecurityTermsSet` with the 12 shared keys only;
  - decode both shapes of `terms()` and `Reader.coverageDetail()`;
  - make the AccessManager calldata decoder recognise the old `setTerms` selector `0x36b14cd2`.
- API: serve `default_breach: null` when the terms row has no `default_ratio_bps`, which is the `f92d719` signature. Every other `/security` and loan-book field already handles `NULL` (verified below).
- Tests: pure decoder, fold and DTO tests in `packages/*/tests/`, with the Hoodi topic0s and payloads pinned.
- Docs: narrow edits to `docs/references/security-registry-events.md`, `docs/product-specs/loan-security-state-evm.md` and `docs/references/backend.md`. Add a user-story file under `docs/user-stories/epic-1937/`.

### Out of scope

- Any contract or deploy change.
- The Trustee and wallet-connect EVM `setTerms` write path and the Trustee pending-operation `setTerms` decoder. Both are 15-field only (Open Question 1).
- The Minter delta from `1be6871` (#2074).
- `tech-debt-tracker.md`, `access-manager-events.md`, `FRONTEND.md` and `trustee-flows.md`: the parallel docs PR for #2071 edits these.
- The argocd PR. It follows the merge; its exact content is in "Rollout".

### What already handles absence (verified, no change needed)

- `shared::security_registry::TermsView` and `CoverageDetailView` already carry `default_ratio_bps`, `originator_fee_rate` and `default_breach_at` as `Option`.
  - `terms_from_view` and `terms_from_params` map a missing value or key to `None` (`packages/shared/src/security_registry.rs:603-647`).
  - The repo binds `NULL` (`security_registry_repo.rs:948-950, 1306`).
  - The columns are nullable (migration `20261118000001_security_registry_evm.sql`).
  - Stellar takes this path today (`indexer/stellar/security_registry_views.rs:173-175, 206`).
- API `terms_dto` maps these fields to `null` (`packages/api/src/security_state.rs:471-472`). The audit-log `SecurityTermsSet` renderer adds `default_ratio_pct` or `originator_fee_rate_pct` only when the key exists (`routes/audit_log.rs:1214-1251`).
- The loan-book `ltv_bps`, `margin_call_open` and `price_stale` come from fields that both versions have (`security_state::loan_book_security_fields`).
- Trustee:
  - `-risk-council-terms.ts:24-35` hides the "Default ratio" and "Originator fee" rows when they are `null`.
  - No Trustee code reads `default_breach` (TD-189).
  - The read pages therefore render correctly with `null`.
- `agent_release` on EVM uses `valuation.debt`, the Reader's `debt`. The Hoodi Reader returns the pool debt, the same debt Hoodi's SR uses in `_requireReleasable`, so the result is right for both versions without a version switch.

### Decision: how view reads pick a version

**One `eth_call`, decode as `150631a` first, fall back to `f92d719` on a decode error, both with `validate = true`.** Reasons:

- The selectors are the same in both versions (`terms(uint256)` `0xc0aa0e8a`, `coverageDetail(uint256)` `0x3efdbfe9`), so a single call serves both, with no extra RPC.
- The strict decode is exclusive. In alloy-sol-types 0.8.26, `abi::decode_sequence` with `validate = true` re-encodes the result and rejects it unless it equals the input byte for byte (`if validate && encode_sequence(&result) != data`).
  - `terms` is 480 bytes in the new shape and 384 in the old.
  - `coverageDetail` has an 11-word head with records offset `0x160` in the new shape, and a 10-word head with offset `0x140` in the old.
  - At most one shape can therefore accept a payload, so there is no silent mis-decode. In the old payload, word 10 is `0x140`, which the new decoder rejects as a `bool`.
- The approach is stateless. Nothing is cached per address, and the source would follow a different implementation behind the proxy without a restart (no change is planned).

**Rejected alternatives:**
- *Probe once per address and cache.* A probe needs a loan that has terms, and Hoodi has none, because every `terms()` reverts `NoTerms`. Otherwise it needs an EIP-1967 slot read, `eth_getCode` and a bytecode search, which is a heuristic. Either way it adds mutable state to `EvmSecurityViewSource`.
- *A config key per chain naming the version.* This is an ops burden, and a wrong value means permanent decode failures.

Events use the BUG-39 / #1892 pattern: one `sol!` module per version, with the shape chosen by topic0 because the `Spec` table is keyed by `(emitter, topic0)`.

## Assumptions and Risks

- **No `TermsSet` or record exists on Hoodi yet.** The old-shape fixtures are therefore the captured state-override payloads plus `sol!`-encoded logs from the `f92d719` module, not real logs. Risk: low, because the bytecode contains the exact topic0 and the captured payload layout matches the `f92d719` source.
- **The stage Trustee cannot set terms on Hoodi until Open Question 1 is resolved.** The Trustee sends the 15-field `setTerms` (`0x45f225f5`), which the Hoodi proxy does not dispatch, so the call reverts. Every SR feature on Hoodi starts from `setTerms`, so end-to-end QA (#1945) on stage depends on that follow-up, not on this PR.
- **`sol!` overloads in the AccessManager `#[sol(abi)] interface SecurityRegistryAbi`.** Two `setTerms` functions with different tuple types are valid Solidity, and alloy suffixes the generated call types. If the macro rejects it, put the old `setTerms` in a separate one-function `#[sol(abi)] interface SecurityRegistryF92d719Abi` and merge its selector into the `security_registry` table in `abi_tables()`. The selectors differ, so there is no collision.
- **Test rewrites.** The stored-name uniqueness tests in `packages/worker/tests/evm_security_registry_parsers.rs` assume 25 specs and 25 distinct names (`topic_table_matches_the_shared_names`, `no_topic_is_duplicated`, and `topic_hashes_match_forge_inspect_at_150631a` uses `find` by name). Adding a second `SecurityTermsSet` spec breaks them, and they must be rewritten as described in Step 6. This is expected.
- **Shared EVM cursor rewind (see Rollout).**
  - Every EVM handler on the chain re-reads the rewound range.
  - `index_once` (`packages/worker/src/indexer/mod.rs:398`) gates every mapper on `is_duplicate`, the `contract_logs` unique key `(chain_id, contract_address, block_number, log_index)`. This holds for `ContractLogMapper` and `LoanEventMapper` (`loan_mapper.rs:709`). Replayed rows are skipped before `insert`, so no domain side effect runs twice.
  - The AccessManager projection's id-order hazard (`access-manager-events.md#evm-cursor-and-rollout`) only concerns `OperationScheduled` / `OperationExecuted` pairs, and there are none in the range.
  - The price poller has its own cursor (`CHAIN_560048_EVM_PRICE_POLLER_START_BLOCK`) and is unaffected.
  - Catch-up is about 91 k blocks at `POLLING_BLOCK_RANGE=1000` and a 6 s interval, roughly 10 minutes.
- **Dependency.** None blocking. #2071 (docs only) runs in parallel; this plan avoids the files it edits.

## Open Questions

All three were answered by the user on 2026-11-19 (latest comment on #2070).

1. **The Trustee and wallet-connect EVM `setTerms` against `f92d719`.** Decision: this PR stays backend-only. The Trustee and wallet-connect `setTerms` for `f92d719` is a separate frontend issue; `packages/trustee` and `packages/wallet-connect` are not touched here. Affected code for that issue: `packages/wallet-connect/src/evm/contracts/securityRegistry.ts:102-160, 298-345`, `routes/-risk-council-security.ts:293-322` and `routes/-risk-council-pending.ts:163-180, 340-395`.
2. **The rewind block.** Decision: 3955455 (the SR and RecordNft proxy deploy block), `UPDATE log_collector_state SET last_indexed_block = 3955455 WHERE chain_id = 560048`. The cursor is the next block to poll, so the deploy block is included.
3. **When to set the Trustee `VITE_EVM_SECURITY_REGISTRY_ADDRESS` / `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS`.** Decision: all argocd keys (worker, API and Trustee) go in one PR after this one merges.

## Implementation Steps

1. [x] **Worker event parser: old `TermsSet`** (`packages/worker/src/indexer/security_registry_parsers.rs`).
   - Add `pub mod sr_f92d719 { sol! { struct Terms { /* 12 fields, f92d719 order */ } event TermsSet(uint256 indexed loanId, Terms terms); } }` next to `pub mod sr`. Field order: `uint32 advanceRatioBps; uint32 marginCallRatioBps; uint64 curePeriod; uint64 priceStaleAfter; uint8 paymentTerm; uint64 gracePeriod; uint32 defaultRate; uint64 attestationInterval; uint64 inspectionInterval; uint32 toleranceBps; uint32 gradeToleranceBps; uint64 marginCallAt;`.
   - Add a `Spec` `{ emitter: REGISTRY, topic: sr_f92d719::TermsSet::SIGNATURE_HASH, name: "SecurityTermsSet", decode: … }`. It emits exactly the 12 shared keys (`loan_id`, `advance_ratio_bps`, `margin_call_ratio_bps`, `default_rate`, `tolerance_bps`, `grade_tolerance_bps`, `cure_period`, `price_stale_after`, `grace_period`, `attestation_interval`, `inspection_interval`, `margin_call_at`, `payment_term`) and **omits** `default_ratio_bps`, `originator_fee_rate` and `default_breach_at`. Do not write them as `null` or `0`; this is the Stellar shape.
   - Factor the 12 shared keys into one private helper used by both `TermsSet` specs, so the key names cannot drift.
   - Grow `SPECS`, `derive_topics()` and `SECURITY_REGISTRY_EVENT_TOPICS` from 25 to 26 entries.
   - `classify_security_topic`, `parse_security_event`, `dispatch_security_registry` and `is_security_only_topic` need no change: they key on `(emitter, topic0)`, and `is_security_only_topic` picks up the new spec automatically.
2. [x] **Worker view decoders: both shapes** (`packages/worker/src/indexer/security_registry_views.rs`).
   - Add `pub mod rd_f92d719 { sol! { … } }`. It defines the 12-field `Terms` (same order as Step 1), `CountedRecord` (unchanged, redeclared locally), the 10-field `CoverageDetail` (`value, staleValue, flaggedValue, debt, coverageBps, ltvBps, marginCallAt, cureBy, priceStale, CountedRecord[] records`), `function terms(uint256 loanId) external view returns (Terms memory);` and `function coverageDetail(uint256 loanId) external view returns (CoverageDetail memory);`.
   - `decode_terms(result)`: try `rd::termsCall::abi_decode_returns(result, true)` and map it as today. On `Err`, try `rd_f92d719::termsCall::abi_decode_returns(result, true)` and map the 12 fields with `default_ratio_bps: None`, `originator_fee_rate: None`, `default_breach_at: None`. If both fail, return an error whose context names both shapes ("decode terms return: neither the 150631a (15-field) nor the f92d719 (12-field) shape").
   - `decode_coverage_detail(result)`: the same pattern, with `default_breach_at: None` on the old shape. Share the `records` mapping (`CountedRecordView`) through a small generic or closure, so the u32 refusal stays in one place.
   - The encode side (`rd::termsCall { loanId }`, `rd::coverageDetailCall { loanId }`) stays as is: the selectors are identical.
   - `EvmSecurityViewSource` needs no change. Do not add a per-address cache (see Decision).
3. [x] **Worker AccessManager calldata: old `setTerms`** (`packages/worker/src/indexer/access_manager_evm_parsers.rs:266-295`).
   - In `#[sol(abi)] interface SecurityRegistryAbi`, add `struct TermsF92d719 { … 12 fields … }` and `function setTerms(uint256 loanId, TermsF92d719 newTerms) external;` next to the existing one. Use the fallback interface from "Assumptions and Risks" if the macro refuses the overload.
   - `decode_call` then returns `function = "setTerms"`, and `loan_ref` resolves `LoanRef::Loan(loanId)` for selector `0x36b14cd2` as well. `args_json` carries the 12 camelCase keys.
   - No change to `loan_ref`: it matches on the name `"setTerms"`.
4. [x] **API: `default_breach` on an `f92d719` deployment** (`packages/api/src/security_state.rs:1183-1185`).
   - Gate it: `terms.filter(|t| params.has_default_breach && t.default_ratio_bps.is_some())`. `default_ratio_bps` is `None` on EVM only for `f92d719` data, from either the event fold or the view snapshot, and is never `None` for `150631a`. Serving `null` matches Stellar ("this deployment has no default-breach mechanism") and avoids an object of `null`s.
   - Update the `LoanSecurityResponse.default_breach` doc comment (`security_state.rs:312`) to "EVM `150631a`+ only; `null` on Stellar and on an EVM deployment whose `Terms` has no `defaultRatioBps` (`f92d719`, Hoodi)". It is the utoipa schema text, already present.
   - No other API change: `terms_dto`, `margin_call_dto`, `agent_release_of` (FacilityDebt via `valuation.debt`), the loan-book fields and `audit_log` already handle `None` (see Scope).
5. [x] **Lint.** `cargo clippy --all -- -D warnings`, `cargo fmt --all`, then `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx tsx scripts/lint-docs.ts`. Keep to one spec-pointer header per file and no new comments (AGENTS.md "Comment-less code").
6. [x] **Tests.** See Test Strategy.
7. [x] **Docs.** See Docs to Update.

## Test Strategy

Pure tests in `packages/<pkg>/tests/<topic>.rs` only. Nothing inline under `#[cfg(test)]`, no `DATABASE_URL` / `POSTGRES_URL`, no env and no Postgres. Run `cargo test -p pipeline-worker --test evm_security_registry_parsers --test evm_security_registry_views --test evm_security_registry_replay --test evm_access_manager_parsers`, `cargo test -p shared --test security_registry_fold` and `cargo test -p pipeline-api --test loan_security --test loan_book_security`. Run the full `cargo test --workspace` before handing off. Use the package names from `Cargo.toml`.

**Worker parsers** (`packages/worker/tests/evm_security_registry_parsers.rs`, `evm_security_support/mod.rs`):
- Add `terms_f92d719(margin_call_at, payment_term) -> sr_f92d719::Terms` and `terms_set_f92d719(loan, margin_call_at, block, ts, seq) -> Ev` helpers to the support module.
- `terms_set_f92d719_stores_the_twelve_shared_keys_only`:
  - The params equal the 12-key JSON.
  - `params.get("default_ratio_bps")`, `params.get("originator_fee_rate")` and `params.get("default_breach_at")` are all `None`, not `null`.
  - The stored name is `SecurityTermsSet`.
- `hoodi_topics_are_pinned`. Topic0s checked against the deployed bytecode (`0x502ff7b5…`) on 2026-11-19:
  - The old `TermsSet` `0xafe2a37a11f39e6c1aabcfeee99c2838f1dca51206b72e457790877f82f19005` is in `SECURITY_REGISTRY_EVENT_TOPICS` as `(Registry, …, "SecurityTermsSet")`.
  - The new `0x35ef31a2…` stays as well.
  - `DefaultBreach` `0x37628b82…`, `DefaultBreachPriceStale` `0xed206567…` and `DefaultBreachCleared` `0xa6f25b5e…` stay, so `150631a` deployments keep working.
- Rewrite the existing table tests:
  - In `FORGE_TOPICS`, match by `(name, topic)` pairs instead of `find` by name, and add the `f92d719` `TermsSet` row (26 entries).
  - `topic_table_matches_the_shared_names`: 26 entries.
  - `no_topic_is_duplicated`: 26 unique topics and 25 unique names, with `SecurityTermsSet` as the only name that occurs twice.
- Cross-shape safety: an old-shape `TermsSet` data blob under the **new** topic0 fails to decode (the "failed to decode; dropped" path), and the reverse also fails. This proves that topic0 alone chooses the decoder.
- Add the old log to `all_logs()` / the `is_security_only_topic` check, so the legacy CollateralRegistry trap also warns on it.

**Worker views** (`packages/worker/tests/evm_security_registry_views.rs`):
- `hoodi_terms_payload_decodes_as_f92d719`: the pinned 384-byte hex captured on Hoodi (see Scope; copy the exact hex) decodes to `advance 6000, margin_call 7500, cure "259200", price_stale_after "86400", payment_term "Dp", grace "432000", default_rate 20000, attestation "604800", inspection "2592000", tolerance 500, grade_tolerance 200, margin_call_at "0"`, with all three `Option`s `None`.
- `hoodi_coverage_detail_payload_decodes_as_f92d719`: the pinned 384-byte hex decodes to `debt "501000000000"`, `coverage_bps 0`, `ltv_bps u32::MAX`, `price_stale false`, `records []` and `default_breach_at None`.
- `f92d719_coverage_with_records`: a `sol!`-encoded `rd_f92d719::CoverageDetail` with two `CountedRecord`s round-trips through `decode_coverage_detail`. A record id above `u32::MAX` is refused in the old shape too.
- `the_two_shapes_are_exclusive`:
  - `rd::termsCall::abi_decode_returns(old, true)` is `Err`, and `rd_f92d719::termsCall::abi_decode_returns(new, true)` is `Err`.
  - The same holds for `coverageDetail` in both directions, including a non-empty `records`.
  - The existing 150631a tests (`terms_decode_with_the_evm_extras`, `coverage_detail_with_counted_records_and_default_breach`) still pass unchanged.
- `garbage_fails_naming_both_shapes`: 100 zero bytes and a 13-word blob fail, and the error chain mentions both shapes.

**Worker AccessManager** (`packages/worker/tests/evm_access_manager_parsers.rs`):
- `set_terms_selectors_are_pinned`: `0x36b14cd2` (`f92d719`) and `0x45f225f5` (`150631a`) both appear in the security-registry table.
- `f92d719_set_terms_calldata_decodes`: old-shape calldata to the configured SR decodes as `setTerms`, `args_json[1]` has exactly 12 keys, and `loan_ref` is `LoanRef::Loan(7)`. The existing 15-field test stays green.

**Fold / replay** (`packages/worker/tests/evm_security_registry_replay.rs` and/or `packages/shared/tests/security_registry_fold.rs`):
- `f92d719_terms_fold_to_null_extras`:
  - A parsed old `TermsSet` row is folded with `EVM_SECURITY_PARAMS`, with no snapshot, and again with a snapshot built from `decode_terms(old_payload)`.
  - Expect `TermsRow { default_ratio_bps: None, originator_fee_rate: None, default_breach_at: None, .. }` with the 12 shared fields set.
  - A later `MarginCall` / `MarginCallCured` still folds into `security_margin_call_events`, and no `default_breach*` row appears.
- `CoverageDetailView { default_breach_at: None }` gives a `ValuationRow` with `default_breach_at: None`.

**API** (`packages/api/tests/loan_security.rs`, `packages/api/tests/loan_book_security.rs`, pure `build_on(EVM, &EVM_SECURITY_PARAMS, …)`):
- `evm_f92d719_terms_serve_null_extras_and_no_default_breach`:
  - A `TermsRow` with the three fields `None` and a valuation gives `terms.default_ratio_bps == null`, `terms.originator_fee_rate == null` and `default_breach == null`.
  - `margin_call` is served as before.
  - `agent_release` uses `valuation.debt`.
- Keep the existing `150631a` EVM test (`default_breach` present).
- `loan_book_security_fields` on the same rows gives `ltv_bps`, `margin_call_open` and `price_stale` as for `150631a`.

No Trustee test change: the read rendering with `null` is already covered by `-risk-council-security-page.test.tsx` and `-loanSecurity.test.ts`. Run `PATH=/opt/homebrew/opt/node@22/bin:$PATH yarn workspace @pipeline/trustee test` only to confirm that nothing regressed.

## Docs to Update

Keep the edits narrow. Do not touch `tech-debt-tracker.md`, `access-manager-events.md`, `FRONTEND.md` or `docs/frontend/trustee-flows.md` (#2071 edits them).

- `docs/references/security-registry-events.md`:
  - Source-of-truth line (line 7): `150631a`, plus "the deployed Hoodi SR and Reader are `f92d719`; both shapes are decoded".
  - EVM event table (around lines 90-119): add a row "`TermsSet(loanId, Terms)` `f92d719` shape, topic0 `0xafe2a37a…`, registry, `SecurityTermsSet`, the 12 Stellar keys only (no EVM extras)".
  - Change "25 stored events" to "26 decoders, 25 stored names".
  - Add a short **Deployed versions** paragraph:
    - per-log choice by topic0;
    - per-view strict decode (`150631a` first, then `f92d719`, `validate = true`, exclusive by length);
    - `NULL` for the missing fields;
    - no `DefaultBreach*` on `f92d719`;
    - the Reader's `debt` is the pool debt on `f92d719`.
- `docs/product-specs/loan-security-state-evm.md`:
  - Differences table rows `terms.default_ratio_bps` / `terms.originator_fee_rate`: "served; `null` on an `f92d719` deployment (Hoodi)".
  - Row `default_breach`: "served when terms exist and carry `default_ratio_bps`; `null` on `f92d719`".
  - Row `agent_release` debt: add "on `f92d719` the Reader's `debt` is the pool debt `outstanding + accrued`, matching that deployment's release check".
  - Line 46: add the `f92d719` source pointer.
- `docs/references/backend.md`:
  - Line 474 paragraph: "25 events" becomes "25 event names (26 decoders: both `TermsSet` shapes)", plus one sentence that Hoodi runs `f92d719` and the new-only fields are `NULL`.
  - Hoodi rollout bullet (around line 983): the rewind block 3955455 and the key list from "Rollout" below.
- `docs/user-stories/epic-1937/2070-evm-sr-dual-abi.md` (new file, no conflict), with two stories:
  1. With the keys set on Hoodi, `GET /v1/loan-book/<id>/security?chain_id=560048` answers `200` and `terms: null` while no terms exist, and the worker logs no "failed to decode" or "unrecognised topic" warnings for the SR.
  2. After terms are set on Hoodi (needs the Open Question 1 follow-up), `terms.default_ratio_bps` and `terms.originator_fee_rate` are `null`, `default_breach` is `null`, and the Trustee Security page shows no "Default ratio" or "Originator fee" rows.

## Rollout (after merge; argocd `pipeline/test.yaml`, Hoodi chain 560048)

1. Wait for the worker and API images that contain this PR.
2. Open an argocd PR with the following changes:
   - **Worker env** (with the other `CHAIN_560048_EVM_INDEXER_*` keys, around line 216):
     - `CHAIN_560048_EVM_INDEXER_SECURITY_REGISTRY_ADDRESS: "0xB51E7f13420D106946376A67Fe5921C63B09BE15"`
     - `CHAIN_560048_EVM_INDEXER_SECURITY_RECORD_NFT_ADDRESS: "0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09"`
     - `CHAIN_560048_EVM_INDEXER_SECURITY_REGISTRY_READER_ADDRESS: "0x8e7078c73068F9F3d4e2210cfe5B4981eB7f1b6B"`
   - **API env** (next to `CHAIN_560048_EVM_API_LOAN_REGISTRY_ADDRESS`, around line 89):
     - `CHAIN_560048_EVM_API_SECURITY_REGISTRY_ADDRESS: "0xB51E7f13420D106946376A67Fe5921C63B09BE15"`
     - `CHAIN_560048_EVM_API_SECURITY_RECORD_NFT_ADDRESS: "0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09"`
   - **Trustee env** (with the other `VITE_EVM_*` keys, around line 474):
     - `VITE_EVM_SECURITY_REGISTRY_ADDRESS: "0xB51E7f13420D106946376A67Fe5921C63B09BE15"`
     - `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS: "0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09"`
     - `VITE_EVM_START_BLOCK: "3808700"` (the worker's `CHAIN_560048_EVM_START_BLOCK`, per `docs/FRONTEND.md`)
3. **Cursor rewind** (Open Question 2). Stop the worker. Run `UPDATE log_collector_state SET last_indexed_block = 3955455 WHERE chain_id = 560048;` in the same step as the worker keys, then start the worker.
   - The rewind is safe for the shared cursor: every EVM mapper is gated by `is_duplicate` on the `contract_logs` unique key, the AccessManager range has no schedule or execute pairs, and the price poller has its own cursor.
   - Expected new rows: the 8 SR and RecordNft lifecycle logs. Their topics are allow-listed (`Initialized`, `Upgraded`, `AuthorityUpdated`, `SecurityRegistrySet`) or stored (`LoanRegistrySet` as `SecurityLoanRegistrySet`).
4. Set the API keys only after the worker cursor has passed the head again.
5. Verify:
   - The worker logs "EVM SecurityRegistry indexer enabled".
   - There are no "SecurityRegistry emitted an unrecognised topic" or "failed to decode" warnings for `0xB51E…`.
   - `GET /v1/loan-book/<loan>/security?chain_id=560048` answers `200` with `terms: null`.
   - The loan-book `ltv_bps` stays `null` until terms exist.
