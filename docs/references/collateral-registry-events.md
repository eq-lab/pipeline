# CollateralRegistry events in `contract_logs`

Cross-arm reference for how the indexer stores CollateralRegistry events (epic #1478). The
Stellar arm (#1481) writes these rows; the EVM arm (#1484) must produce the same shape. Both
arms test against this document.

Source of truth for Stellar: `pipeline-stellar-contracts/contracts/collateral-registry/src/event.rs`
at mainnet deployment commit `b4d4a57`. Deployed ids: testnet
`CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS`, mainnet
`CA76K5CUD3C2TX6IZDOB7Z6QGPD6FJ73KFYNNQZ6BOHMVJXGFCIZBOT3`.

## Configuration

`CHAIN_<id>_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS` (optional). Unset or whitespace means the
feature ships dark: the contract is not added to the `getEvents` filter and no rows are written.
When set, the value is validated as a Strkey `C...` contract id (including the CRC) and must be
distinct from every other configured indexer contract. Parser: `packages/worker/src/indexer/stellar/collateral_registry_parsers.rs`.

## Encoding rules

- `event_name` is the PascalCase EVM event name.
- `params` keys are the snake_case EVM Solidity field names.
- Ids (`loan_id`, `lot_id`, `sale_id`) are decimal strings.
- `u32` bps fields are JSON numbers.
- `i128` / `uint256` amounts are decimal strings, stored raw at native scale. Stellar quantity and
  value use 7dp (`PAR_VALUE = 10_000_000`), EVM uses 6dp (`PAR_VALUE = 1_000_000`). Normalising is a
  read-time concern, following `shared::chains::normalize_usdc_amount`.
- `BytesN<32>` / `bytes32` hashes are lowercase hex without `0x`.
- Enums are stored as their variant name (for example `"InStorage"`), verbatim with no allow-list,
  so a variant added by a contract upgrade is stored rather than dropped. EVM ordinals differ from
  Stellar declaration order for `ControlKind` (EVM `None=0, EblToOrderOfTrust, NegotiableWr, Cma,
  Acknowledged`; Stellar declares `None` last), so the EVM arm maps by its own ordinal table to
  produce the same names.
- `benchmark` is a plain string. Stellar stores the `Symbol` as is (for example `"PAR"`). EVM trims
  trailing NULs from the `bytes32` and falls back to hex when the result is not printable ASCII.
- `location` is `null` or `{ "location_type", "identifier", "tracking_url" }`. EVM `hasLocation` is
  folded into `null` / object and not stored. `control` is `{ "kind", "ref" }`.

## Event table

| Stellar topic | `event_name` | `params` |
|---|---|---|
| `pledged` | `Pledged` | `loan_id`, `lot_id` |
| `haircut_set` | `HaircutSet` | `loan_id`, `lot_id`, `bps` |
| `floor_set` | `FloorSet` | `loan_id`, `bps` |
| `revalued` | `Revalued` | `loan_id`, `lot_id`, `value_per_unit`, `benchmark`, `report_hash` |
| `stage_updated` | `StageUpdated` | `loan_id`, `lot_id`, `stage`, `location` |
| `control_updated` | `ControlUpdated` | `loan_id`, `lot_id`, `control` (Stellar field `reference` stored as `ref`) |
| `doc_added` | `DocAdded` | `loan_id`, `lot_id`, `kind`, `hash` (Stellar `sha256`) |
| `quantity_adjusted` | `QuantityAdjusted` | `loan_id`, `lot_id`, `old_quantity` (Stellar `old`), `new_quantity` (Stellar `new`), `reason`, `hash` (Stellar `sha256`) |
| `released` | `Released` | `loan_id`, `lot_id`, `quantity` (Stellar `qty`), `reason`, `ref_hash` |
| `liquidated` | `Liquidated` | `loan_id`, `lot_id`, `sale_id`, `quantity` (Stellar `qty`) |
| `margin_call` | `MarginCall` | `loan_id`, `coverage_bps`, `floor_bps` |

Not collected: `loan_registry_set` (admin event) and the OpenZeppelin ownable and pausable events.
They are dropped without a warning.

Stellar events are routed by emitting contract id in the poller before `dispatch_parser`, so a
same-named event from another contract (for example a Pocket `released`) is never attributed to the
registry. A known topic that fails to decode is dropped with a `tracing::warn!` carrying
`contract_id`, `event_name` and `tx_hash`.

## Semantics

- `Pledged` stores ids only. Lot details are not enriched: Soroban `simulateTransaction` reads only
  current state, so a `lot()` read at index time would return later state during any catch-up. A
  ledger-accurate enrichment is tracked as tech debt.
- Implicit stage changes are not materialised as `StageUpdated` rows. A consumer derives them:
  - a `Released` or `Liquidated` that brings the remaining lot quantity to zero moves the lot to
    `Delivered`, `Sold` or `Paid`. This is not derivable from indexed rows alone: no stored row
    carries the remaining quantity, and the lot quantity comes from the `Pledged` lot read, which
    is not indexed (tech debt TD-142 / TD-143 for Stellar, TD-145 for EVM);
  - `ControlUpdated` with `kind = Acknowledged` on an `Assigned` receivable moves it to
    `Acknowledged`.
- `MarginCall` is stored as emitted. Repeats from the permissionless `check_coverage`, or from the
  trailing check inside any mutation, are distinct `(block_number, log_index)` rows. There is no
  dedup and no synthetic "recovered" row; each row is a point-in-time observation.

## Known limitations

- Events older than the Soroban RPC `getEvents` retention window (about 7 days) before the key is
  enabled are not indexed, and there is no backfill.
- Enabling the key on a running chain does not backfill: the per-chain cursor is shared by every
  Stellar contract, so indexing starts at the current cursor.

## EVM arm

Issue #1484. Source of truth: `pipeline-contracts` `src/collateralRegistry/CollateralRegistryUpgradeable.sol`
at `3b74e98`. Parser: `packages/worker/src/indexer/collateral_registry_parsers.rs`
(`parse_collateral_registry_log`, an `.or_else` chain over the 11 events), registered as one more
handler in `packages/worker/src/indexer/evm_parsers.rs` through the plain `ContractLogMapper` (no loan
snapshot, no on-chain reads).

### Configuration

`CHAIN_<id>_EVM_INDEXER_COLLATERAL_REGISTRY_ADDRESS` (optional). Unset or whitespace means the
feature ships dark: the handler contributes no addresses to the `eth_getLogs` filter (the other
handlers always do, so the filter never goes empty) and no rows are written. When set, the value must
be a valid EVM address and distinct from every other configured EVM indexer contract address (deposit manager, withdrawal queue, staked PLUSD, loan registry, minter) or startup aborts naming the chain key. The EVM cursor is shared per chain, so enabling the key on a running chain does not backfill earlier CollateralRegistry events; to index them, rewind the chain cursor or set the key from the start block. The `PipelineCollateralRegistry` proxy
is deployed on hoodi (`pipeline-contracts/deployments/hoodi-v5.json`), but no environment runs the
EVM indexer arm yet, so the key stays unset everywhere.

### EVM field mapping

`params` keys are the snake_case of the Solidity field names (`valuePerUnit` is `value_per_unit`,
`reportHash` is `report_hash`, `oldQuantity` is `old_quantity`, ...). Enum fields are declared as `uint8` in the decoder, so an ordinal
outside the table below is stored as `"Unknown"` rather than failing the decode. The `ref` of `Control`
is a Rust keyword and is decoded as `reference`, stored under `ref`.

EVM ordinals (decoding is positional, so this order is load-bearing and pinned by tests):

| Enum | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| `LotStage` | Pledged | Afloat | InStorage | Delivered | Sold | Assigned | Acknowledged | Presented | Paid | |
| `LocationType` | Vessel | Warehouse | TankFarm | Other | | | | | | |
| `ControlKind` | None | EblToOrderOfTrust | NegotiableWr | Cma | Acknowledged | | | | | |
| `DocKind` | Ebl | WarehouseReceipt | Assay | Insurance | SupplyContract | OfftakeContract | NoticeOfAssignment | LC | Inspection | Other |
| `ReleaseReason` | Payment | LCAcceptance | LOIDischarge | Substitution | Loss | ConsentedSale | | | | |

`benchmark` is an on-chain `bytes32` (EVM `PAR_BENCHMARK = "PAR"`). It is stored as the ASCII string
with trailing zero bytes trimmed. When the trimmed bytes are empty, contain an interior NUL, or are not
printable ASCII, the full 32 bytes are stored as 64 lowercase hex characters.

### EVM-only notes

- Events are routed by topic0 only; the handler does not check the emitting address. None of the 11
  signatures collides with another indexed signature. Pocket's
  `Released(uint256 indexed,uint256,uint256,uint256)` has a different topic0 and is rejected (pinned by a
  test), and Pocket is not indexed on EVM anyway.
- `StageUpdated` emits the caller's calldata `location` even when `hasLocation` is false (the contract
  deletes the stored location but echoes the argument). The parser keys off `hasLocation` and stores
  `location: null`, never testing whether the tuple is zeroed.
- `value_per_unit` and quantities are stored raw. EVM uses 6 decimals (`PAR_VALUE = 1_000_000`),
  Stellar 7 (`PAR_VALUE = 10_000_000`), so a consumer must scale per chain kind.
- The automatic USD par mark emits no `Revalued`, and `checkCoverage` is permissionless, so a
  `MarginCall` can repeat. Nothing fires on recovery. Each repeat is a distinct
  `(block_number, log_index)` row; only a re-polled log is deduplicated.
- No row is read back by an existing query: the audit-log allowlist and every `params->>'loan_id'`
  query filter on `event_name`, and none of the 11 names appears in them.
