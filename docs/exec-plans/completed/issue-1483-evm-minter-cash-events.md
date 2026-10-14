# Issue #1483: EVM indexer: index the remaining Minter cash events

Source: https://github.com/eq-lab/pipeline/issues/1483

Parent epic: #1478. Direct Stellar counterpart: #1480. Other siblings, planned in parallel:
#1481, #1482 (Stellar CollateralRegistry, DealTokenFactory), #1484, #1485 (EVM
CollateralRegistry, DealTokenFactory). QA: #1479.

There is no Figma reference on this Issue or on #1478. The work is backend-only, so the plan
has no Figma verification step.

## Ground truth

Checked on 2026-10-13 against `/Users/aabliazimov/Documents/work/pipeline-contracts` at
`3b74e98` ("Deploy updated contracts to hoodi testnet (#50)"). The checkout is on `main`, clean,
and in sync with `origin/main`. Events: `src/minter/MinterUpgradeable.sol:88-118`. Enums:
`:35-46`.

```solidity
enum RampDirection { UsdcToBank, BankToUsdc }                                   // 0..1
enum CashReason { Disbursed, DisbursementReversed, Income, Expense, Correction } // 0..4

event WireInReturned(uint256 indexed id, uint256 amount, bytes32 refHash);
event CashDisbursed(uint256 indexed loanId, uint256 entryId, uint256 amount, uint64 valueDate, bytes32 refHash);
event CashDisbursementReversed(uint256 indexed loanId, uint256 entryId, uint256 originalId, uint256 amount, bytes32 refHash);
event CashRepaid(uint256 indexed loanId, uint256 repaymentId, uint256 saleId, uint256 cash, uint256 interestMinted, uint256 feeShares, uint64 valueDate, bytes32 refHash);
event CashRepaymentReversed(uint256 indexed loanId, uint256 repaymentId, uint256 cash, bytes32 refHash);
event WireOutRequested(uint256 indexed id, address indexed lp, uint256 amount);
event WireOutSettled(uint256 indexed id, uint256 amount, uint64 valueDate, bytes32 refHash);
event WireOutCancelled(uint256 indexed id);
event RampOpened(uint256 indexed id, RampDirection direction, uint256 amount, bytes32 refHash);
event RampClosed(uint256 indexed id, uint256 received, uint256 loss, bytes32 refHash);
event CashRecorded(CashReason indexed reason, uint256 entryId, int256 delta, uint64 valueDate, bytes32 refHash);
event CashCorrected(uint256 indexed originalId, uint256 entryId, int256 delta, bytes32 reasonHash);
event MintCorrected(uint256 amount, bytes32 refHash);
event LossAbsorbed(uint256 requested, uint256 pulled);
```

Facts about where these events are emitted:

- The contract emits `CashRecorded` only from `_recordCash`. Its callers are `recordIncome`
  (`Income`), `recordExpense` (`Expense`) and `closeRamp` when a ramp closes at a loss
  (`Expense`, with `valueDate = block.timestamp` and the ramp's `refHash`). On EVM the other
  three reasons are never emitted: `disburse` emits `CashDisbursed`, `reverseDisburse` emits
  `CashDisbursementReversed`, and `recordCorrection` emits `CashCorrected`. All five ordinals
  are still mapped, because the enum is part of the ABI.
- `LossAbsorbed` comes from `_absorb`, called by `recordExpense` and by a lossy `closeRamp`. One
  tx can therefore emit `LossAbsorbed`, `CashRecorded` and `RampClosed` together. Each one is its
  own `contract_logs` row with its own `log_index`, so nothing is deduplicated across them.
- In the ABI an enum is a `uint8`, and the event signature hash uses `uint8`. The `sol!`
  declarations therefore use `uint8`. That keeps decoding total, and an unknown ordinal maps to
  `"Unknown"`, which is the existing `loan_status_name` / `closure_reason_name` convention in
  `loan_mapper.rs:33-54`.

The Stellar counterpart (`pipeline-stellar-contracts/contracts/minter/src/event.rs`) has the same
fields under snake_case names, with two exceptions. First, the `CashRecorded` topic is called
`kind`, not `reason`. Second, Stellar has no `CashCorrected` but has `Snapshot`. Both enums have
the same variant names on both arms.

## Scope

In scope:

1. Fourteen new EVM parse functions in `packages/worker/src/indexer/parsers.rs`, one per event
   above. Each writes a `ContractLog` whose `event_name` is the PascalCase Solidity event name.
2. Two `pub` enum-name helpers, `cash_reason_name(u8)` and `ramp_direction_name(u8)`.
3. One `pub fn parse_minter_event(log) -> Option<ContractLog>` dispatcher that chains the
   existing `parse_wire_in` and `parse_wire_in_assigned` with the fourteen new parsers.
   `evm_parsers.rs` then registers the minter group with a single call.
4. Pure unit tests in a new `packages/worker/tests/evm_minter_parsers.rs`.
5. Docs: an additive EVM paragraph in `docs/references/backend.md`, and the user-stories doc
   that the definition of done requires.

### Cross-arm params contract

This table is the key part to align with #1480. Rules that apply to every row:

- `event_name` is the Solidity event name.
- Keys are snake_case versions of the Solidity field names.
- Amounts, ids, signed deltas and `value_date` are decimal strings.
- Hashes are lowercase hex with no `0x` prefix (64 characters). This is the existing
  `WireIn.ref_hash` / `InterestAdjusted.reason_hash` shape on both arms.
- The address `lp` is in EVM checksum form. On Stellar it is a strkey.

| `event_name` | `params` keys |
|---|---|
| `WireInReturned` | `id`, `amount`, `ref_hash` |
| `CashDisbursed` | `loan_id`, `entry_id`, `amount`, `value_date`, `ref_hash` |
| `CashDisbursementReversed` | `loan_id`, `entry_id`, `original_id`, `amount`, `ref_hash` |
| `CashRepaid` | `loan_id`, `repayment_id`, `sale_id`, `cash`, `interest_minted`, `fee_shares`, `value_date`, `ref_hash` |
| `CashRepaymentReversed` | `loan_id`, `repayment_id`, `cash`, `ref_hash` |
| `WireOutRequested` | `id`, `lp`, `amount` |
| `WireOutSettled` | `id`, `amount`, `value_date`, `ref_hash` |
| `WireOutCancelled` | `id` |
| `RampOpened` | `id`, `direction` (`"UsdcToBank"` \| `"BankToUsdc"` \| `"Unknown"`), `amount`, `ref_hash` |
| `RampClosed` | `id`, `received`, `loss`, `ref_hash` |
| `CashRecorded` | `reason` (`"Disbursed"` \| `"DisbursementReversed"` \| `"Income"` \| `"Expense"` \| `"Correction"` \| `"Unknown"`), `entry_id`, `delta` (signed, e.g. `"-500"`), `value_date`, `ref_hash` |
| `CashCorrected` | `original_id`, `entry_id`, `delta` (signed), `reason_hash` (EVM only; Stellar stores corrections as `CashRecorded{reason:"Correction"}` with no `original_id`, so consumers must read both) |
| `MintCorrected` | `amount`, `ref_hash` |
| `LossAbsorbed` | `requested`, `pulled` |

Stellar's `CashRecorded` topic `kind` must be stored as `reason` to satisfy this contract. That
is #1480's job, and the shared alignment rule already requires it.

Corrections differ by arm:

- EVM emits `CashCorrected` (with `original_id` and `reason_hash`) and never emits
  `CashRecorded{reason:"Correction"}`.
- Stellar has no `CashCorrected`. It stores a correction as `CashRecorded{reason:"Correction"}`,
  which carries no `original_id`.
- So a correction-aware consumer has to read both shapes. This is an intentional divergence that
  comes from the contracts.

Stellar `Snapshot` is not indexed on either arm.

Out of scope:

- Any env var or config change. `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS` (`config.rs:341`,
  `mod.rs:79`) already feeds `yield_minter_contracts`. The poller filters by address only
  (`poller.rs:98-101`), so the new logs already arrive and are dropped today because no decoder
  matches them.
- Consumers. These include the Trustee audit feed: `AUDIT_EVENT_NAMES` in
  `packages/api/src/routes/audit_log.rs:49` is an allow-list, so new rows stay invisible there.
  Also out of scope are wire-in matching in `lp_bank_deposit_repo.rs` (TD-116, which concerns
  `WireInReturned` and the deposit state) and any cash-ledger projection or API.
- Renaming `EvmContractAddresses::yield_minter_contracts`, or the stored `WireIn` name for
  `WireInRecorded`. The latter is an existing cross-arm decision.
- Config and role events: `TreasurySet`, `CustodiansSet`, rate-limit events.
- The Stellar arm (#1480), and CollateralRegistry and DealTokenFactory on either arm.

## Assumptions and Risks

- **Finding: correction to the Issue — the reworked contracts are deployed.** The Issue says that
  no reworked EVM Minter is live, but `pipeline-contracts/deployments/hoodi-v5.json` (#50,
  2026-10-08) deploys three reworked contracts:
  - `PipelineMinter`, proxy `0xE75814d9618285AE4d789D4424672597DC494D3E`;
  - `PipelineCollateralRegistry`;
  - `PipelineDealTokenFactory`.

  The change still ships dark, because no environment configures an EVM chain. Rows only appear
  once a chain points `..._EVM_INDEXER_MINTER_ADDRESS` at a post-rework minter.
- **Re-indexing history.** Existing deployments have their cursor past blocks that held these
  logs. Those logs will not be backfilled unless the cursor is reset. This is acceptable, because
  no EVM chain is live.
- **ABI drift.** If `MinterUpgradeable.sol` changes field order or types, `decode_log` silently
  returns `None` (the signature hash changes). The tests pin the current signatures via
  `SIGNATURE_HASH` taken from re-declared `sol!` events in the test file. That catches parser
  regressions, but it cannot catch upstream contract changes.
- **`decode_log(.., true)` validation.** An out-of-range enum is not a decode error, because the
  `sol!` type is `uint8`. A topic count that does not match makes the decode fail, and the parser
  returns `None`.
- **Merge conflicts with #1484/#1485.** Both siblings add to `parsers.rs`, `evm_parsers.rs`,
  `docs/references/backend.md` and `docs/user-stories/index.md`. To keep the overlap small:
  - new parsers stay inside the existing `// --- Minter parsers ---` section;
  - minter tests go in their own file rather than `tests/parsers.rs`;
  - `evm_parsers.rs` changes only the minter handler body and one import;
  - the docs edits are additive.

  The first of the three to merge creates the `## Epic #1478` heading in
  `docs/user-stories/index.md`. The others rebase onto it.
- **Cross-arm id encoding.** This plan stores ids as decimal strings, matching EVM `loan_id` and
  Stellar `loan_id` (`stellar/loan_registry_parsers.rs:50`). Stellar's existing `WireIn.id` /
  `WireInAssigned.id` are JSON numbers (`stellar/parsers.rs:255`). That is pre-existing drift and
  is not touched here. See Resolved decisions.

## Resolved decisions (human, 2026-10-14)

1. **Id encoding.** Every new id field (`id`, `entry_id`, `original_id`, `repayment_id`,
   `sale_id`) is stored as a decimal string, and #1480 matches. The numeric `id` in the existing
   Stellar `WireIn`/`WireInAssigned` rows stays as it is. That divergence is known and is not
   this issue's concern.
2. **Corrections.** Stellar stores corrections as `CashRecorded{reason:"Correction"}`, with no
   `original_id`. EVM keeps `CashCorrected` as planned. The cross-arm table notes that consumers
   must read both.
3. **Stellar `Snapshot`.** It is not indexed. It is out of scope on both arms.
4. **Issue correction.** hoodi-v5 (2026-10-08) deploys the reworked `PipelineMinter`,
   `CollateralRegistry` and `DealTokenFactory`. This is recorded as a finding under Assumptions
   and Risks. The change still ships dark, because no environment configures an EVM chain.

## Open Questions

_None_

## Implementation Steps

1. **`sol!` declarations.** Extend `mod minter` in `packages/worker/src/indexer/parsers.rs`
   (currently `:53-59`) with the fourteen events exactly as in Ground truth, with two changes:
   `RampDirection direction` becomes `uint8 direction`, and `CashReason indexed reason` becomes
   `uint8 indexed reason`. Keep `WireInRecorded` and `WireInAssigned` unchanged.

2. **Enum helpers.** In `parsers.rs`, next to the minter parsers, add these `pub` functions:
   - `pub fn cash_reason_name(ordinal: u8) -> &'static str`: 0 `Disbursed`, 1
     `DisbursementReversed`, 2 `Income`, 3 `Expense`, 4 `Correction`, anything else `Unknown`.
   - `pub fn ramp_direction_name(ordinal: u8) -> &'static str`: 0 `UsdcToBank`, 1 `BankToUsdc`,
     anything else `Unknown`.

3. **Parse functions.** In `parsers.rs`, under `// --- Minter parsers ---`, add these `pub`
   functions. Each follows the existing `parse_wire_in` shape (`extract_log_meta`,
   `block_timestamp: 0`, `json!` params per the Scope table):
   - `parse_wire_in_returned`
   - `parse_cash_disbursed`
   - `parse_cash_disbursement_reversed`
   - `parse_cash_repaid`
   - `parse_cash_repayment_reversed`
   - `parse_wire_out_requested`
   - `parse_wire_out_settled`
   - `parse_wire_out_cancelled`
   - `parse_ramp_opened`
   - `parse_ramp_closed`
   - `parse_cash_recorded`
   - `parse_cash_corrected`
   - `parse_mint_corrected`
   - `parse_loss_absorbed`

   Encoding:
   - U256 and I256 values use `.to_string()`.
   - `value_date` (`u64`) uses `.to_string()`, the same as `parse_wire_in`.
   - `bytes32` values use `hex::encode(x.as_slice())`.
   - `lp` uses `.to_checksum(None)`.
   - Enums go through the helpers from step 2.

   The code stays comment-free: no doc comments on the new functions (AGENTS.md comment-less
   rule).

4. **Dispatcher.** In `parsers.rs`, add
   `pub fn parse_minter_event(log: &Log) -> Option<ContractLog>`. It returns
   `parse_wire_in(log)`, chained with `.or_else` through `parse_wire_in_assigned` and the
   fourteen new parsers in Ground-truth order.

5. **Registration.** In `packages/worker/src/indexer/evm_parsers.rs`:
   - Replace the `yield_minter_contracts` closure body (`:127-134`) with
     `parse_minter_event(log).map(|ev| Box::new(ContractLogMapper::new(ev, chain_id, minter_repo.clone())) as Box<dyn shared::log_mapper::LogMapper>)`.
   - In the `parsers::{...}` import list, swap `parse_wire_in, parse_wire_in_assigned` for
     `parse_minter_event`.

   Keep `parse_wire_in` and `parse_wire_in_assigned` `pub`, because `tests/parsers.rs` imports
   them.

6. **Lint and build.** Run `cargo fmt --all`, then
   `cargo clippy --all -- -D warnings`, then `cargo test -p pipeline-worker`. Confirm the crate
   name in `packages/worker/Cargo.toml` first. Then run `npx tsx scripts/lint-docs.ts` for the
   docs edits.

7. **Docs.** Make the edits in "Docs to Update".

## Test Strategy

The tests go in a new file, `packages/worker/tests/evm_minter_parsers.rs`. They are pure unit
tests over ABI-encoded fixtures: no DB, and no env var reads (`DATABASE_URL`, `POSTGRES_URL`
or other). Tests stay in the external file, never inline `#[cfg(test)]`. The file
re-declares the sixteen minter events with `alloy::sol!`, using `uint8` for both enums. It
copies the local `make_log` helper pattern from `tests/parsers.rs:56-68`. The helper is about
12 lines, and duplicating it is preferred over adding a shared test module.

1. **One decode test per event (14 tests).**
   - Build the log from `<Event>::SIGNATURE_HASH`, the indexed topics (`U256` into
     `FixedBytes<32>`, `address.into_word()`, and `U256::from(ordinal)` for the `reason` topic)
     and `.encode_data()`.
   - Assert `event_name`, every `params` key and value from the Scope table, and `block_number`
     and `log_index`.
   - Assert that the key set is exactly the table's: `params.as_object().unwrap().len()`
     equals the expected count, so extra keys cannot drift in silently.
2. **Signed deltas.**
   - `CashRecorded` with `delta = -500_000` stores `"-500000"`, and with a positive delta
     stores `"500000"`.
   - `CashCorrected` with a negative delta stores the negative decimal string.
3. **Enums.**
   - `cash_reason_name` maps each of 0..=4 and maps 5 / 255 to `"Unknown"`.
   - `ramp_direction_name` maps 0 and 1 and maps 2 to `"Unknown"`.
   - `CashRecorded` with the reason topic set to 3 parses `reason == "Expense"`.
   - `RampOpened` with direction 1 parses `"BankToUsdc"`.
4. **Hash shape.**
   - For one `ref_hash` event and the `CashCorrected` `reason_hash`, the value is lowercase,
     64 characters, with no `0x` prefix.
   - A fixture with mixed-nibble bytes (`abcd...`) checks the exact hex string.
5. **Large values.** A `CashRepaid` with `cash = U256::MAX` round-trips as the full decimal
   string. This shows there is no `u64`/`f64` truncation.
6. **Dispatcher.**
   - `parse_minter_event` returns `Some` with the right `event_name` for a fixture of each of
     the 16 minter events, `WireIn` and `WireInAssigned` included.
   - It returns `None` for a LoanRegistry `Disbursed` log and for a log whose topic0 is random.
   - `WireOutCancelled` with a missing indexed topic returns `None`.
7. **Regression.** The existing `tests/parsers.rs` `wire_in_decodes` and
   `wire_in_assigned_decodes` must still pass unchanged.

There is no integration or e2e test, because no EVM chain is live. QA (#1479) verifies through
the user-stories doc.

## Docs to Update

- `docs/references/backend.md`: an additive edit only. After the Stellar minter paragraph that
  ends "...are not collected yet." (`:309-316`, which #1480 will rewrite), add a short **EVM
  Minter** paragraph with these points:
  - The EVM poller routes every `PipelineMinter` log, found by
    `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS`, through `parse_minter_event`.
  - It stores the sixteen events listed in the Scope table under their Solidity names, except
    `WireInRecorded`, which is stored as `WireIn`.
  - It states the params conventions: decimal strings, hex hashes with no `0x`, enum names.
  - It points to the cross-arm alignment with the Stellar minter (#1480).

  Do not edit the Stellar sentences.
- `docs/user-stories/epic-1478/1483-evm-minter-cash-events.md` (new). Follow the format of
  `epic-1431/1434-evm-loan-parsers-realignment.md`. Stories:
  1. A disbursement and its reversal are indexed with `entry_id`/`original_id` linkage.
  2. A repayment carries `sale_id`, the link to CollateralRegistry `Liquidated` from #1484.
  3. The wire-out lifecycle (`Requested`, then `Settled` or `Cancelled`) and `WireInReturned`.
  4. Ramps open and close with a direction name. A lossy close also yields `LossAbsorbed` and
     `CashRecorded(reason="Expense")` in the same tx.
  5. Income and expense records, plus `CashCorrected` and `MintCorrected` with signed deltas.
  6. The params match the Stellar arm key for key, with one exception for corrections: EVM
     stores `CashCorrected`, and Stellar stores `CashRecorded{reason:"Correction"}`.

  Include the deployment note: hoodi-v5 deploys the reworked contracts, but the change ships
  dark because no environment configures an EVM chain.
- `docs/user-stories/index.md`: add a `## Epic #1478` section if it is absent, and add a row for
  #1483.
- No product-spec change: there is no user- or agent-facing behaviour change, and the rows are
  not surfaced by any API. No ARCHITECTURE.md change: no new dependency direction or module.
- `docs/exec-plans/tech-debt-tracker.md`: no edit. TD-116 is Stellar-specific and concerns the
  deposit-state model. #1480 owns any update to it.
