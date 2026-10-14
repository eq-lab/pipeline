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
  - a `Released` or `Liquidated` that brings the remaining quantity to zero moves the lot to
    `Delivered`, `Sold` or `Paid`;
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
