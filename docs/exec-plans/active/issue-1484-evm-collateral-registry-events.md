# Issue #1484: EVM indexer: index CollateralRegistry events

Source: https://github.com/eq-lab/pipeline/issues/1484

Parent epic: #1478. Direct counterpart: #1481 (Stellar arm, CollateralRegistry). EVM
siblings touching the same files: #1483 (Minter cash), #1485 (DealTokenFactory). No Figma
reference on the Issue or the epic; backend-only, so no Figma verification step applies.

## Ground truth

Verified 2026-10-13 against `/Users/aabliazimov/Documents/work/pipeline-contracts` at
`3b74e98` ("Deploy updated contracts to hoodi testnet (#50)"),
`src/collateralRegistry/CollateralRegistryUpgradeable.sol`.

Events (`:158-182`). Topic0 is computed from types only, so the declarations below are the
contract of this Issue; enum fields ABI-encode as `uint8`, struct fields as tuples:

```solidity
event Pledged(uint256 indexed loanId, uint256 indexed lotId);
event HaircutSet(uint256 indexed loanId, uint256 indexed lotId, uint32 bps);
event FloorSet(uint256 indexed loanId, uint32 bps);
event Revalued(uint256 indexed loanId, uint256 indexed lotId, uint256 valuePerUnit, bytes32 benchmark, bytes32 reportHash);
event StageUpdated(uint256 indexed loanId, uint256 indexed lotId, LotStage stage, bool hasLocation, Location location);
event ControlUpdated(uint256 indexed loanId, uint256 indexed lotId, Control control);
event DocAdded(uint256 indexed loanId, uint256 indexed lotId, DocKind kind, bytes32 hash);
event QuantityAdjusted(uint256 indexed loanId, uint256 indexed lotId, uint256 oldQuantity, uint256 newQuantity, string reason, bytes32 hash);
event Released(uint256 indexed loanId, uint256 indexed lotId, uint256 quantity, ReleaseReason reason, bytes32 refHash);
event Liquidated(uint256 indexed loanId, uint256 indexed lotId, uint256 saleId, uint256 quantity);
event MarginCall(uint256 indexed loanId, uint32 coverageBps, uint32 floorBps);
```

`struct Location { LocationType locationType; string identifier; string trackingUrl; }`,
`struct Control { ControlKind kind; string ref; }`.

Enum ordinals (`:19-89`). EVM order is load-bearing; ABI decode is positional:

| Enum | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| `LotStage` | Pledged | Afloat | InStorage | Delivered | Sold | Assigned | Acknowledged | Presented | Paid | |
| `LocationType` | Vessel | Warehouse | TankFarm | Other | | | | | | |
| `ControlKind` | **None** | EblToOrderOfTrust | NegotiableWr | Cma | Acknowledged | | | | | |
| `DocKind` | Ebl | WarehouseReceipt | Assay | Insurance | SupplyContract | OfftakeContract | NoticeOfAssignment | LC | Inspection | Other |
| `ReleaseReason` | Payment | LCAcceptance | LOIDischarge | Substitution | Loss | ConsentedSale | | | | |

The Stellar contract (`pipeline-stellar-contracts/contracts/collateral-registry/src/types.rs`)
has the same variant **names** for every enum, but `ControlKind::None` is **last** there and
**first** on EVM. Stellar decodes enums by symbol name, EVM by ordinal, so storing the
**name** is what keeps the arms aligned. Pinning the EVM ordinal table in tests is mandatory.

## Findings

- **F1: the EVM CollateralRegistry is deployed on hoodi.** The Issue and epic say "not yet
  deployed on any EVM network". `pipeline-contracts/deployments/hoodi-v5.json` (2026-10-08)
  lists `PipelineCollateralRegistry` proxy `0xb3D45A8E4816321F806a5eDCB62330CAaC23b26f`. This
  does not change the plan: no environment runs the EVM indexer arm (#1434 F9; `CHAINS` in
  argocd is Stellar only), and the new key stays optional, so the change still ships dark.
  It does give a real contract to spot-check topic0 against (optional Step 10).
- **F2: handlers do not check the emitting address.** `EvmEventPoller::poll`
  (`packages/worker/src/indexer/poller.rs`) offers every log to every handler in order and
  takes the first `Some`; routing relies on topic0 alone. Pocket's
  `Released(uint256 indexed,uint256,uint256,uint256)` has a different signature from CR's
  `Released(uint256 indexed,uint256 indexed,uint256,uint8,bytes32)`. Pocket is not indexed on
  EVM at all, and none of the 11 CR signatures collides with any registered signature
  (DM/WQ/sPLUSD/LoanRegistry/Minter), so no address guard is needed. A test pins the Pocket
  `Released` topic0 being rejected.
- **F3: an empty address list is safe.** `poll` flat-maps every handler's addresses into one
  `eth_getLogs` filter. With `collateral_registry_address = None` the CR handler contributes
  `vec![]` and the other five handlers always contribute addresses, so the filter never goes
  empty.
- **F4: no new readers pick these rows up.** `audit_log.rs` reads an allowlist
  (`AUDIT_EVENT_NAMES`), and every `contract_logs_repo.rs` query that reads
  `params->>'loan_id'` filters on `event_name` (`LOAN_LIFECYCLE_EVENT_NAMES` or literals). None
  of the 11 names (`Released`, `Pledged`, ...) appears in any of them. Rows are written and
  not read back, which is the epic's intent.
- **F5: `value_per_unit` scale differs per arm.** EVM `PAR_VALUE = 1_000_000` (6 decimals),
  Stellar `PAR_VALUE = 10_000_000` (7). The indexer stores the raw on-chain value on both arms,
  following `contract_logs`' convention (`shared::chains::normalize_usdc_amount` normalises
  only on read). Consumers must scale per chain kind. This goes into tech debt; it is not
  normalised here.
- **F6: `StageUpdated` emits the caller's calldata `location` even when `hasLocation` is
  false** (`:340`; storage is deleted at `:336`, but the event echoes the argument). The
  parser must key off `hasLocation` and must not test whether the tuple is zeroed.

## Scope

In scope:

- Decode all 11 CR events on EVM and persist each as one `contract_logs` row through the
  plain `ContractLogMapper` (no loan-snapshot mapper, no on-chain reads).
- New optional per-chain key `CHAIN_<id>_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS`. When it is
  unset or blank, the CR handler has no addresses (ships dark).
- Unit tests, a user-stories doc, and the env and indexer reference docs.

Out of scope:

- Enriching `Pledged` with lot details through a block-pinned `lot()` read, and synthesising
  the implicit stage changes (release or liquidate to 0, and `setControl` moving Assigned to
  Acknowledged). Recorded as tech debt.
- Any consumer (API, CCR reconciliation, coverage UI) of these rows.
- `LoanRegistrySet` and other admin events (epic: config and role events out of scope).
- Normalising `value_per_unit` across arms (F5).
- `packages/shared/src/chains.rs`: it has no per-key allowlist. `validate_chain_kind_keys`
  only rejects keys of the *other* chain kind by prefix, so the new `EVM_` key needs no
  change there (the Issue lists it as affected; verified it is not).

### Cross-arm params contract (must match #1481 byte-for-byte)

Conventions, following existing precedent on both arms. Ids and `uint256`/`i128` amounts are
decimal strings (`loan_id.to_string()` on both arms today). `uint32`/`u32` bps are JSON
numbers (precedent: `new_rate` on both arms). `bytes32` is lowercase hex with no `0x`
(`hex::encode`, as `ref_hash`/`reason_hash` already are, and as Stellar's
`extract_bytes32_from_map` does). Enums are the variant name string. Strings are stored
verbatim.

| `event_name` | `params` |
|---|---|
| `Pledged` | `loan_id`, `lot_id` |
| `HaircutSet` | `loan_id`, `lot_id`, `bps` (number) |
| `FloorSet` | `loan_id`, `bps` (number) |
| `Revalued` | `loan_id`, `lot_id`, `value_per_unit`, `benchmark` (see below), `report_hash` |
| `StageUpdated` | `loan_id`, `lot_id`, `stage` (LotStage name), `location`: `{ "location_type": <LocationType name>, "identifier": str, "tracking_url": str }` or `null` when `hasLocation` is false |
| `ControlUpdated` | `loan_id`, `lot_id`, `control`: `{ "kind": <ControlKind name>, "ref": str }` |
| `DocAdded` | `loan_id`, `lot_id`, `kind` (DocKind name), `hash` |
| `QuantityAdjusted` | `loan_id`, `lot_id`, `old_quantity`, `new_quantity`, `reason` (str), `hash` |
| `Released` | `loan_id`, `lot_id`, `quantity`, `reason` (ReleaseReason name), `ref_hash` |
| `Liquidated` | `loan_id`, `lot_id`, `sale_id`, `quantity` |
| `MarginCall` | `loan_id`, `coverage_bps` (number), `floor_bps` (number) |

There is no `has_location` key; `location: null` carries that information. `benchmark`:
EVM `bytes32` vs Stellar `Symbol`. The proposed encoding stores the **ASCII string** with
trailing zero bytes trimmed (`"PAR"` on both arms, from EVM `PAR_BENCHMARK = "PAR"`). When the
trimmed bytes are empty, contain an interior NUL, or are not printable ASCII, the parser falls
back to lowercase hex of the full 32 bytes (Resolved decision 1).

## Assumptions and Risks

- **Cross-arm drift is the main risk.** #1481 is planned in parallel. If either arm deviates
  from the table above (nested `control` vs flat `control_kind`/`control_ref`, bps as number
  vs string, `benchmark` encoding), rows for the same logical event diverge silently. Before
  implementing, the coder must diff this table against #1481's plan
  (`docs/exec-plans/active/issue-1481-*.md` on its branch or `main`) and stop if they differ.
- **Merge conflicts with #1483/#1485.** All three EVM arms edit `evm_parsers.rs`
  (`EvmContractAddresses` field and `.add_event_handler`), `config.rs` (`IndexerJobSettings`
  field), `mod.rs` (address parse), `.env.example` and `docs/references/backend.md`. To
  shrink the overlap, the CR parsers go in a **new module**
  (`indexer/collateral_registry_parsers.rs`) with a **new test file**, not in
  `parsers.rs` / `tests/parsers.rs`. The remaining edits are purely additive, so conflicts
  resolve by keeping both sides.
- **Unknown enum ordinals.** The CR contract is upgradeable; an appended enum variant would
  decode as a valid `uint8` with no name. Following the precedent of
  `loan_mapper::loan_status_name`, map it to `"Unknown"` rather than dropping the event.
  Declaring the fields as `uint8` in `sol!` (not as Solidity enums) is what prevents a hard
  decode failure.
- **`ref` is a Rust keyword.** ABI decoding is positional and field names do not enter
  topic0, so name the `sol!` struct field `reference` (stored under the key `ref`).
- **Semantics consumers must know** (epic pitfalls; documented, not solved): `Pledged` carries
  only ids; the automatic USD par mark emits no `Revalued`; implicit stage changes emit
  nothing; `Released`/`Liquidated` carry no remaining quantity; `MarginCall` can repeat
  (permissionless `checkCoverage`) and nothing fires on recovery. Each `MarginCall` has a
  distinct `(block_number, log_index)`, so duplicates are distinct rows by design. The
  existing `is_duplicate` dedupes only re-polled logs. No synthetic stage rows are written
  (Resolved decision 4).
- No DB schema change: `contract_logs.params` is JSONB.

## Resolved decisions (human, 2026-10-14)

1. **`benchmark`**: EVM `bytes32` is stored as an ASCII string with trailing NULs trimmed
   (`"PAR"`). It falls back to lowercase hex of the full 32 bytes when the trimmed bytes are
   empty, contain an interior NUL, or are not printable ASCII. Stellar stores the `Symbol`
   string.
2. **`control`** is nested `{ "kind", "ref" }`. **`location`** is nested
   `{ "location_type", "identifier", "tracking_url" }`, or `null`. Both match #1481.
3. **`Pledged`** stores ids only on both arms. A block-pinned `lot()` read is out of scope.
4. **No synthetic stage rows** for implicit stage changes. A repeated **`MarginCall`** is
   stored exactly as emitted, one row per log, with no dedup beyond the existing
   `(contract_address, block_number, log_index)` re-poll check.
5. **Cross-arm reference doc**: #1481 plans to create
   `docs/references/collateral-registry-events.md`. Whichever of #1481 / #1484 merges
   **second** extends that file rather than creating a parallel one (see **Docs to Update**).

## Open Questions

_None_

## Implementation Steps

1. **Pre-flight alignment check.** Read #1481's plan and compare its params table with
   **Cross-arm params contract** and **Resolved decisions**. If anything differs, stop and
   report; do not pick a side.
2. **Expose the log-meta helper.** In `packages/worker/src/indexer/parsers.rs`, change
   `fn extract_log_meta` to `pub(crate) fn extract_log_meta`. No other change to this file.
3. **New module `packages/worker/src/indexer/collateral_registry_parsers.rs`.** Add
   `pub mod collateral_registry_parsers;` in `indexer/mod.rs`. Contents:
   - A private `mod cr { alloy::sol! { ... } }` declaring the 11 events exactly as in
     **Ground truth**, with every enum-typed field declared as `uint8`, and
     `struct Location { uint8 locationType; string identifier; string trackingUrl; }`,
     `struct Control { uint8 kind; string reference; }`.
   - `pub fn lot_stage_name(u8)`, `location_type_name(u8)`, `control_kind_name(u8)`,
     `doc_kind_name(u8)`, `release_reason_name(u8) -> &'static str`, each a `match` over the
     EVM ordinal table with `_ => "Unknown"`.
   - `pub fn benchmark_string(&B256) -> String` implementing the encoding in **Cross-arm
     params contract**.
   - One `pub fn parse_cr_<event>(log: &Log) -> Option<ContractLog>` per event
     (`parse_cr_pledged`, `parse_cr_haircut_set`, `parse_cr_floor_set`, `parse_cr_revalued`,
     `parse_cr_stage_updated`, `parse_cr_control_updated`, `parse_cr_doc_added`,
     `parse_cr_quantity_adjusted`, `parse_cr_released`, `parse_cr_liquidated`,
     `parse_cr_margin_call`). Each follows the existing shape:
     `decode_log(log.as_ref(), true).ok()?`, then `extract_log_meta`, `block_timestamp: 0`,
     `event_name` as the PascalCase EVM name, and `params` per the table. Bytes use
     `hex::encode(x.as_slice())`. `StageUpdated` emits `serde_json::Value::Null` for
     `location` whenever `hasLocation` is false (F6).
   - `pub fn parse_collateral_registry_log(log: &Log) -> Option<ContractLog>`, the
     `.or_else` chain over all 11 parsers, so the handler and tests share one entry point.
   - The file header is a single 2–3 line spec pointer (to `docs/references/backend.md`'s CR
     section). Add no other comments (AGENTS.md comment-less rule).
4. **Config.** In `packages/worker/src/indexer/config.rs`, `IndexerJobSettings`:
   - Add `pub collateral_registry_address: Option<String>`.
   - In `from_chain_env`, read `{ip}COLLATERAL_REGISTRY_ADDRESS` and map it to `None` when it
     is unset or `trim().is_empty()`, and to `Some(trimmed)` otherwise (mirroring the Stellar
     `loan_registry_id` optional pattern). Leave the existing `env_require` keys untouched.
5. **Wire the address.** In `packages/worker/src/indexer/mod.rs::run_indexer_job`, build
   `collateral_registry_contracts: Vec<Address>`. Use
   `parse_address("COLLATERAL_REGISTRY_ADDRESS", raw)` when the setting is `Some` (an invalid
   address aborts startup with the chain-named key, as for the other roles), and `vec![]`
   when it is `None`. Pass it in `EvmContractAddresses`.
6. **Register the handler.** In `packages/worker/src/indexer/evm_parsers.rs`:
   - Add `pub collateral_registry_contracts: Vec<Address>` to `EvmContractAddresses`.
   - In `register_evm_handlers`, clone `repos.repo` into `cr_repo` and append
     `.add_event_handler(contracts.collateral_registry_contracts, move |log| parse_collateral_registry_log(log).map(|ev| Box::new(ContractLogMapper::new(ev, chain_id, cr_repo.clone())) as Box<dyn shared::log_mapper::LogMapper>))`.
     `Released` is reachable only through this handler (Issue note).
7. **`.env.example`.** Under the EVM block, after `CHAIN_1_EVM_INDEXER_MINTER_ADDRESS`, add
   `# CHAIN_1_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS=      # optional — PipelineCollateralRegistry; unset ships dark`.
8. **Docs.** See **Docs to Update**.
9. **Lint and test.** Run `cargo clippy --all -- -D warnings`, `cargo test -p pipeline-worker`
   and `npx tsx scripts/lint-docs.ts`.
10. **Optional manual spot-check (not CI).** If a hoodi RPC is at hand, fetch one log from
    the hoodi-v5 CR proxy (F1) and confirm that `parse_collateral_registry_log` decodes it.
    Record the outcome in the PR description; skip it if no RPC is available.

## Test Strategy

Pure unit tests only. Nothing reads `DATABASE_URL`/`POSTGRES_URL` or any env var for a DB.
Tests live in external files, not inline `#[cfg(test)]`.

`packages/worker/tests/collateral_registry_parsers.rs` (new). It re-declares the 11 events
in a test-local `alloy::sol!` block, with a `make_log` helper like `tests/parsers.rs`.
Fixtures are built with `SIGNATURE_HASH` plus `abi_encode` of the data tuple, so the tests
exercise real ABI layout, including the dynamic tuples:

- One decode test per event, asserting `event_name`, every params key and value type
  (string vs number vs object vs null), and that **no extra keys** exist. Compare the whole
  `params` against a `json!` literal so that drift from the cross-arm table fails.
- `StageUpdated` with `hasLocation = true` produces the nested object with all three keys.
  With `hasLocation = false` **and a non-zero location tuple** it produces `location: null`
  (F6).
- `ControlUpdated` produces nested `control.kind` and `control.ref`; `ControlKind` ordinal 0
  produces `"None"` (the ordinal that differs from Stellar).
- Ordinal tables: one test per `*_name` fn asserting every ordinal from the **Ground truth**
  table, plus one out-of-range value producing `"Unknown"`.
- `benchmark_string`: `"PAR"` right-padded produces `"PAR"`; all-zero produces 64-char hex;
  non-ASCII bytes produce hex; a full 32-char ASCII value has no trimming.
- `uint256` max for `quantity` and `value_per_unit` round-trips as a decimal string.
- Negative routing: a Pocket `Released(uint256 indexed,uint256,uint256,uint256)` log returns
  `None` from `parse_collateral_registry_log` (F2), and an unrelated topic0 (for example
  `WireInAssigned`) returns `None`.
- Missing log meta (`block_number: None`) returns `None`.
- Wrong topic count or truncated data returns `None`, with no panic.

`packages/worker/tests/evm_collateral_registry_config.rs` (new). It uses its own `ENV_LOCK`
mutex and sets and clears the required EVM keys as `tests/indexer_tuning_overrides.rs` does:

- Key unset gives `collateral_registry_address == None`.
- Key blank or whitespace gives `None`.
- Key set with surrounding spaces gives `Some(trimmed)`.
- The required keys still error when missing (regression guard that the new key is optional).

Existing suites (`tests/parsers.rs`, `chain_kind_keys.rs`, `indexer_tuning_overrides.rs`) must
stay green unchanged.

## Docs to Update

- `docs/user-stories/epic-1478/1484-evm-collateral-registry-events.md` (new; ISSUE_PROTOCOL
  §6). Stories cover: the key is unset so the worker boots and nothing is indexed; a pledge
  and stage update with location are indexed with the documented params; a stage update
  without location stores `location: null`; repeated margin calls are distinct rows; an
  out-of-range enum is stored as `"Unknown"`. State the deployment reality (F1).
- `docs/user-stories/index.md`: add the link. This file is shared with siblings, so the edit
  is additive only; create the `epic-1478` heading if no sibling has.
- `docs/references/collateral-registry-events.md`: the cross-arm reference that #1481 plans
  to create (Resolved decision 5). If #1481 has **not** merged when this lands, create the
  file with:
  - the shared params table from **Cross-arm params contract**, including the EVM ordinal
    table and the `benchmark` encoding;
  - an EVM section naming `CHAIN_<id>_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS` (optional,
    ships dark);
  - the consumer caveats from **Assumptions and Risks**, together with F5 and F6.

  If #1481 **has** merged, extend its file with the EVM section and EVM-only notes (the
  ordinal table, F2, F5, F6) instead of duplicating the table. Either way, link it from
  `docs/references/index.md` if it is not linked already.
- `docs/references/backend.md` (Event Indexer section, after the Stellar minter paragraph):
  add one additive sentence that points to `collateral-registry-events.md`. Skip it if a
  sibling has already added the pointer.
- `ARCHITECTURE.md` (`packages/worker` responsibilities, the event-listener line): append
  "CollateralRegistry lot/coverage events (EVM and Stellar)". Skip this if a sibling already
  added it.
- `.env.example`: Step 7.
- `docs/exec-plans/tech-debt-tracker.md`: one entry (or extend #1481's if it exists),
  "CollateralRegistry rows are raw events". It covers: `Pledged` without lot details (a
  block-pinned `lot()` read is needed); implicit stage changes unevented; no remaining
  quantity on `Released`/`Liquidated`; repeatable `MarginCall` with no recovery event; and
  `value_per_unit` scale of 6 decimals on EVM vs 7 on Stellar, stored raw.
- The Issue/epic "not deployed on EVM" statement (F1): mention it in the PR description; do
  not edit the Issue.
- This plan moves to `docs/exec-plans/completed/` at the end.
