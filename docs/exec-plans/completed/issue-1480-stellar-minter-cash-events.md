# Issue #1480: Stellar indexer: index the remaining minter cash events

Source: https://github.com/eq-lab/pipeline/issues/1480

Parent epic: #1478. Sibling arm for the same contract: #1483 (EVM Minter cash events).

## Scope

Index 13 of the remaining business events of the Stellar `minter` contract into `contract_logs`,
alongside the already-indexed `wire_in` / `wire_in_assigned` (#1416):

`wire_in_returned`, `cash_disbursed`, `cash_disbursement_reversed`, `cash_repaid`,
`cash_repayment_reversed`, `wire_out_requested`, `wire_out_settled`, `wire_out_cancelled`,
`ramp_opened`, `ramp_closed`, `cash_recorded`, `mint_corrected`, `loss_absorbed`.

Source of truth (verified on `pipeline-stellar-contracts` @ `b4d4a57`):
`contracts/minter/src/event.rs`, `contracts/minter/src/types.rs`, emitting code in
`contracts/minter/src/lib.rs`. soroban-sdk 25 `#[contractevent]` defaults to
`data_format = "map"` (confirmed in `soroban-sdk-macros-25.3.1/src/derive_event.rs`): `topics[0]` is
the snake_case struct name, `#[topic]` fields follow in declaration order, data is an `ScMap` keyed
by Symbol field names, sorted. An event with no data fields (`wire_out_cancelled`) carries an empty
map. `#[contracttype]` unit enums encode as `ScVal::Vec([ScVal::Symbol("Variant")])`.

Out of scope:

- `snapshot` (stored name would be `Snapshot`, Stellar only): **not indexed** — diagnostic snapshot
  callable by anyone, not a state change (human decision 2026-10-14). Emitted only by the
  permissionless `snapshot()` entry point; the `event.rs:168` "sync_debt failed" doc comment is
  wrong. Dispatch returns `None` for it silently, like the config events.
- Config/role events (`treasury_set`, `custodians_set`, `rate_limit_applied`, `tx_limit_set`,
  `window_limit_set`) and `Ownable` / `Pausable` events: they stay un-collected (dispatch returns
  `None`, no warn).
- Any consumer (API, relayer, dashboards) of the new rows. This issue only writes rows.
- TD-116's deposit terminal state (`returned_at` / status column on `lp_bank_deposits`): this issue
  indexes `WireInReturned`, which TD-116 needs, but does not change the wire-in matching phase.
- The EVM arm (#1483) and the other contracts (#1481, #1482, #1484, #1485).
- No new env var: the contract id is already `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS`
  (`yield_minter_id` in `packages/worker/src/indexer/config.rs`).
- No schema migration: `contract_logs.params` is JSONB.

### Stored shape (cross-arm contract with #1483)

`event_name` = the EVM PascalCase event name. `params` keys = snake_case of the EVM Solidity field
names. Ids (`id`, `loan_id`, `entry_id`, `original_id`, `repayment_id`, `sale_id`), amounts and dates are
decimal strings on both arms (settled with #1483; EVM stores `uint256.to_string()`); signed
amounts keep their sign (`"-500"`). `ref_hash` is 64-char lowercase hex, no `0x` (same as the
existing `WireIn` on both arms). Addresses are Stellar strkeys (EVM: checksummed hex). Enums are the
variant name, identical on both chains: `CashReason` → `Disbursed` | `DisbursementReversed` |
`Income` | `Expense` | `Correction`; `RampDirection` → `UsdcToBank` | `BankToUsdc`. Amounts are
the raw on-chain value (Stellar 7 decimals, unnormalized, as #901 established).

| Stellar topic | `event_name` | `params` keys | Stellar → EVM field mapping / notes |
|---|---|---|---|
| `wire_in_returned` [id] | `WireInReturned` | `id`, `amount`, `ref_hash` | identical |
| `cash_disbursed` [loan_id] | `CashDisbursed` | `loan_id`, `entry_id`, `amount`, `value_date`, `ref_hash` | identical |
| `cash_disbursement_reversed` [loan_id] | `CashDisbursementReversed` | `loan_id`, `entry_id`, `original_id`, `amount`, `ref_hash` | identical |
| `cash_repaid` [loan_id] | `CashRepaid` | `loan_id`, `repayment_id`, `sale_id`, `cash`, `interest_minted`, `fee_shares`, `value_date`, `ref_hash` | identical (`sale_id = "0"` means not a sale on both) |
| `cash_repayment_reversed` [loan_id] | `CashRepaymentReversed` | `loan_id`, `repayment_id`, `cash`, `ref_hash` | identical |
| `wire_out_requested` [id] | `WireOutRequested` | `id`, `lp`, `amount` | identical |
| `wire_out_settled` [id] | `WireOutSettled` | `id`, `amount`, `value_date`, `ref_hash` | identical |
| `wire_out_cancelled` [id] | `WireOutCancelled` | `id` | identical; empty data map |
| `ramp_opened` [id] | `RampOpened` | `id`, `direction`, `amount`, `ref_hash` | identical; `direction` is a map field holding the enum |
| `ramp_closed` [id] | `RampClosed` | `id`, `received`, `loss`, `ref_hash` | identical |
| `cash_recorded` [kind] | `CashRecorded` | `reason`, `entry_id`, `delta`, `value_date`, `ref_hash` | Stellar topic field `kind` → EVM `reason`. `delta` is signed |
| `mint_corrected` [] | `MintCorrected` | `amount`, `ref_hash` | identical |
| `loss_absorbed` [] | `LossAbsorbed` | `requested`, `pulled` | identical (the `data - [requested, pulled]` doc comment in `event.rs` predates the map format; the macro emits a map) |
| — | `CashCorrected` | — | **EVM only.** Stellar's `record_correction` emits `cash_recorded` with `kind = Correction` instead, with no `original_id` and the reason hash in `ref_hash`; stored as `CashRecorded` with `reason = "Correction"` (resolved decision 1) |

Known semantic drift the rows carry (documented, not normalized):

- `close_ramp` with a loss: EVM emits `CashRecorded(Expense, …)` for the loss entry; Stellar books
  the `Expense` cash entry silently (no `cash_recorded`), so on Stellar the loss is visible only as
  `RampClosed.loss` (plus `LossAbsorbed`).
- `cash_recorded` with `kind = Correction` on Stellar stamps `value_date` with the ledger
  timestamp.
- Pre-existing (#1416), left as-is: Stellar `WireIn` / `WireInAssigned` store `params.id` as a JSON
  number, EVM as a decimal string (resolved decision 3).

## Assumptions and Risks

- **Cross-arm alignment depends on #1483 agreeing on the table above.** The EVM field names were
  read from `pipeline-contracts/src/minter/MinterUpgradeable.sol` (@ `3b74e98`); the only rename on
  the Stellar side is `kind` → `reason`. If #1483 picks different key spellings or enum string
  forms, one arm must change before either merges.
- **`log_index` synthesis.** `repay` / `reverse_repay` emit several minter events in one op
  (`rate_limit_applied`, `cash_repaid`, up to two `loss_absorbed`) plus cross-contract events. The
  dedup key is `(chain, contract_address, block, log_index)` and `event_index_in_op` comes from the
  RPC event id, so distinct events stay distinct; the existing `>100 events per op` collapse risk
  in `synthesise_log_index` is unchanged.
- **Historical backfill.** The minter is deployed on testnet and mainnet; events emitted before this
  ships are only indexed if the cursor is rewound / `START_BLOCK` re-seeded. Not done here; note it
  in the PR so the operator can decide.
- **Existing `WireIn` / `WireInAssigned` `id` type drift.** The Stellar arm stores `params.id` as a
  JSON number, the EVM arm as a string. The only consumer
  (`lp_bank_deposit_repo.rs:132`) compares with `->>`, which yields the same text either way. The
  new events use strings; the old two are left alone as a known divergence (resolved decision 3).
- Enum variant names are read verbatim from the Symbol; an unknown future variant is stored as-is
  rather than rejected (consistent with `extract_loan_status`).

## Resolved decisions (human, 2026-10-14)

1. Corrections: Stellar's `cash_recorded` with `kind = Correction` is stored as `CashRecorded` with
   `reason = "Correction"`; no rename to `CashCorrected`, no synthetic `original_id`. Cross-chain
   consumers read EVM `CashCorrected` + Stellar `CashRecorded{reason=Correction}`.
2. `Snapshot` is not indexed: diagnostic snapshot callable by anyone, not a state change. Removed
   from parsers, tests and docs; dispatch returns `None` for `snapshot` like the config events.
3. Existing Stellar `WireIn` / `WireInAssigned` `params.id` stays a JSON number (EVM: string) —
   recorded as a known divergence, not changed here.
4. Settled with #1483: all new id fields (`id`, `entry_id`, `original_id`, `repayment_id`,
   `sale_id`, plus `loan_id`) are decimal strings on both arms.

## Open Questions

_None_

## Implementation Steps

1. **Expose an enum-variant helper** — `packages/worker/src/indexer/stellar/loan_registry_parsers.rs`:
   split the private `extract_enum_variant_name(b64)` into a `pub fn enum_variant_name(val: &ScVal)
   -> Option<String>` (matches `ScVal::Vec([ScVal::Symbol(s)])`, len 1) and keep
   `extract_enum_variant_name` as a thin base64 wrapper over it. No behavior change for the loan
   parsers.

2. **New module** `packages/worker/src/indexer/stellar/minter_parsers.rs` (register `pub mod
   minter_parsers;` in `stellar/mod.rs`). One `pub fn parse_<topic>(raw: &RawEvent) ->
   Option<StellarLog>` per event in the table, following the `parse_disbursed` shape: guard on
   `raw.event_name`, guard `topics_base64.len()`, decode topics with `extract_u32` /
   `extract_enum_variant_name`-style helper, decode data with the existing
   `extract_u32_from_map`, `extract_u64_from_map`, `extract_i128_from_map`,
   `extract_bytes32_from_map`, `extract_address_from_map`, and build `params` exactly as the
   table specifies (every numeric `.to_string()`). Specifics:
   - `parse_cash_recorded`: topic 1 is the `CashReason` enum → `params.reason`.
   - `parse_ramp_opened`: `direction` comes from `get_map_entry(value, "direction")` →
     `enum_variant_name`.
   - `parse_wire_out_cancelled`: reads only topic 1; does not require or inspect the data value.
   - `parse_mint_corrected` / `parse_loss_absorbed`: no topic beyond the name
     (`topics_base64.len() >= 1`).
   - Follow the comment-less rule from `AGENTS.md`: one 2–3 line header pointing at this plan /
     `contracts/minter/src/event.rs`, no per-function doc comments.

3. **Dispatch** — `packages/worker/src/indexer/stellar/parsers.rs`, `dispatch_parser` minter
   branch: replace the `parse_wire_in().or_else(...)` chain with a `match raw.event_name.as_str()`
   over all 15 collected topics, each calling its parser; any other topic → `None` silently.
   Keep the existing warn, but trigger it for every collected topic whose parser returned `None`
   (introduce `const MINTER_COLLECTED_EVENTS: &[&str]` listing the 15 topic names and use it for
   both the match guard and the warn). Update the branch comment to say the minter's config/role
   events and `snapshot` are the only ones not collected.

4. **Poller** — `packages/worker/src/indexer/stellar/poller.rs`: no functional change. The new
   names fall through to the `StellarLogMapper` branch; none collides with
   `is_loan_registry_event` (`CashDisbursed` ≠ `Disbursed`) or with `is_position_event_name` /
   `AssetTransfer`. Covered by a test (step 5), not code.

5. **Tests** — new file `packages/worker/tests/stellar_minter_cash_parsers.rs` (pure unit tests,
   locally built `RawEvent`s, no RPC, no DB, no env vars; same encode-helper pattern as
   `tests/stellar_minter_parsers.rs`). See Test Strategy.

6. **Docs** — see Docs to Update.

7. **Verify** — `cargo fmt --all`, `cargo clippy --all -- -D warnings`,
   `cargo test -p pipeline-worker --test stellar_minter_cash_parsers --test stellar_minter_parsers
   --test stellar_loan_parsers --test stellar_parsers`, then `cargo test -p pipeline-worker`;
   `npx tsx scripts/lint-docs.ts` after the doc edits.

## Test Strategy

All in `packages/worker/tests/stellar_minter_cash_parsers.rs`:

- **Happy path, one per event (13):** build the exact topics + sorted data map the macro emits and
  assert `event_name`, `contract_address`, `block_number`, `block_timestamp`, `log_index`, and the
  full `params` object equals the expected `json!` (whole-object equality, so a stray or missing
  key fails).
- **Cross-arm key contract:** a table-driven test listing, per `event_name`, the expected sorted
  key set from the shape table above (the EVM snake_case names); assert each parsed `params`
  object has exactly those keys. This is the guard #1483 should mirror.
- **Enums:** every `CashReason` variant through `parse_cash_recorded` maps to its name;
  both `RampDirection` variants through `parse_ramp_opened`; a non-enum `ScVal` in either slot →
  `None`.
- **Signed / large values:** `cash_recorded` with negative `delta` → `"-…"`; an i128 above
  `u64::MAX` survives as a decimal string; `ref_hash` is lowercase hex; a 31-byte `ref_hash` →
  `None`.
- **Rejections (per parser):** foreign `event_name` → `None`; missing indexed topic → `None`;
  missing required data field → `None`; wrong ScVal type for an id (e.g. `U64` where `U32`
  expected) → `None`.
- **Edge shapes:** `wire_out_cancelled` with an empty data map and with a `Void` value both parse;
  `wire_out_requested` with a `G…` and a `C…` `lp`.
- **Dispatch:** each of the 13 topics from the configured minter id routes to the expected
  `event_name` via `dispatch_parser`; `snapshot` / `treasury_set` / `rate_limit_applied` /
  `tx_limit_set` from the minter → `None` (and no warn); a minter topic with the minter unset (`yield_minter_id = None`) → `None`;
  a `cash_disbursed` from the loan-registry id → `None` (fail-closed per contract).
- **Poller routing guard:** for every new `event_name`, `is_loan_registry_event(name)` is `false`.
- Existing `tests/stellar_minter_parsers.rs`, `tests/stellar_loan_parsers.rs` and
  `tests/stellar_parsers.rs` must stay green unchanged (the enum-helper refactor in step 1 must not
  alter loan parser output).

## Docs to Update

- `docs/references/backend.md`, "Stellar (Soroban) events" minter paragraph (~lines 299–315):
  additive rows in the existing table for the 13 new events (topic → stored name → why), replace
  the "not collected yet" sentence with "`snapshot` (diagnostic, callable by anyone) and the
  config/role setters are not collected", and correct
  the env var name there to `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS`. Keep the edit confined to
  the minter rows/paragraph — #1481 and #1482 add their own rows to the same section.
- `docs/exec-plans/tech-debt-tracker.md` TD-116: append one line noting `WireInReturned` is now
  indexed (#1480), so the remaining gap is only the deposit's terminal state in
  `lp_bank_deposits` / the matching phase.
- No product-spec change: no user- or agent-facing behavior changes until a consumer reads the rows.
