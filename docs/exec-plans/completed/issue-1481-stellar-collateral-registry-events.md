# Issue #1481: Stellar indexer: index collateral-registry events

Source: https://github.com/eq-lab/pipeline/issues/1481

Parent epic: #1478 (QA: #1479). Direct EVM counterpart: #1484 (EVM CollateralRegistry).
Siblings planned in parallel: #1480 (Stellar minter cash), #1482 (Stellar deal-token-factory),
#1483 (EVM Minter cash), #1485 (EVM DealTokenFactory).

Backend-only. No Figma reference on the Issue or the epic, so there is no visual verification step.

## Scope

### In scope

1. **New optional config**: `CHAIN_<id>_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS` becomes
   `StellarIndexerSettings::collateral_registry_id: Option<String>`. When it is unset the feature
   ships dark, the same way `loan_registry_id` does.
2. **New pure parser module** `packages/worker/src/indexer/stellar/collateral_registry_parsers.rs`.
   It decodes the 11 business events of `pipeline-stellar-contracts/contracts/collateral-registry`
   (`src/event.rs`, checked against mainnet deployment commit `b4d4a57`) into `StellarLog` rows. The
   rows use the **EVM event names and EVM field names (snake_case)** described in the cross-arm
   contract below.
3. **Poller wiring** in `packages/worker/src/indexer/stellar/poller.rs`:
   - Add the id to the `getEvents` contract filter. `build_contract_filters` already splits ids
     into chunks of 5.
   - Route events by contract id to the new dispatcher.
   - Persist the result through the existing `StellarLogMapper` into `contract_logs`.
4. **Docs**:
   - A new cross-arm reference, `docs/references/collateral-registry-events.md`.
   - `.env.example`.
   - A short additive paragraph in `docs/references/backend.md`.
   - A user-stories doc for epic #1478.
   - Two tech-debt entries.

### Cross-arm `contract_logs` contract (shared with #1484)

Encoding rules:

- `event_name` is the PascalCase EVM event name.
- `params` keys are the snake_case EVM Solidity field names.
- Ids (`loan_id`, `lot_id`, `sale_id`) are decimal **strings**. This matches the existing
  `loan_id` precedent in `loan_registry_parsers.rs` and the EVM `parsers.rs`.
- `u32` bps fields are JSON **numbers**. This matches the `new_rate: u32` precedent on both arms.
- `i128` / `uint256` amounts are decimal **strings**.
- `BytesN<32>` / `bytes32` hashes are **lowercase hex without `0x`**. This matches the existing
  `ref_hash` on both arms.
- Enums are stored as their **variant name** (for example `"InStorage"`).
- Amounts are stored **raw at native scale**: Stellar quantity and value use 7dp (`PAR_VALUE =
  10_000_000`) and EVM uses 6dp (`PAR_VALUE = 1_000_000`). Normalisation is a read-time concern,
  following the `shared::chains::normalize_usdc_amount` policy.

| Stellar topic | `event_name` | `params` (Stellar source to stored key) |
|---|---|---|
| `pledged` | `Pledged` | topics `loan_id`, `lot_id` to `loan_id`, `lot_id` (data map is empty) |
| `haircut_set` | `HaircutSet` | `loan_id`, `lot_id`, `bps` (number) |
| `floor_set` | `FloorSet` | `loan_id` (single topic), `bps` (number) |
| `revalued` | `Revalued` | `loan_id`, `lot_id`, `value_per_unit` (i128 string), `benchmark` (Symbol stored as its string, e.g. `"PAR"`; R3), `report_hash` (hex) |
| `stage_updated` | `StageUpdated` | `loan_id`, `lot_id`, `stage` (LotStage name), `location`: `null` when `Option` is `None` (ScVal `Void`), else `{ "location_type": <LocationType name>, "identifier": str, "tracking_url": str }`. EVM `hasLocation` is folded into `null`/object and is not stored (R4) |
| `control_updated` | `ControlUpdated` | `loan_id`, `lot_id`, `control`: `{ "kind": <ControlKind name>, "ref": str }`. The Stellar field `reference` maps to the EVM field `ref` |
| `doc_added` | `DocAdded` | `loan_id`, `lot_id`, `kind` (DocKind name), `sha256` maps to **`hash`** (hex) |
| `quantity_adjusted` | `QuantityAdjusted` | `loan_id`, `lot_id`, `old` maps to **`old_quantity`**, `new` maps to **`new_quantity`** (i128 strings), `reason` (string), `sha256` maps to **`hash`** (hex) |
| `released` | `Released` | `loan_id`, `lot_id`, `qty` maps to **`quantity`** (string), `reason` (ReleaseReason name), `ref_hash` (hex) |
| `liquidated` | `Liquidated` | `loan_id`, `lot_id`, `sale_id` (string), `qty` maps to **`quantity`** (string) |
| `margin_call` | `MarginCall` | `loan_id` (single topic), `coverage_bps`, `floor_bps` (numbers) |

Not collected: `loan_registry_set` (an admin event, out of scope per the epic) and the
OpenZeppelin ownable and pausable events. They fall through as `None` without a warning.

### Out of scope

- Enriching `Pledged` with lot details, and deriving implicit stage changes. The decisions and
  reasoning are below (R1, R2).
- Backfilling events older than the Soroban RPC retention window. Accepted as a known limitation (R5); there is no backfill and no follow-up issue.
- Reconciling on-chain coverage with the off-chain CCR, and any API or frontend surface. These
  are follow-ups per the Issue.
- `packages/shared/src/chains.rs`: the Issue lists it as affected, but it only holds generic
  validators (`validate_contract_id`). Per-contract keys live in `worker/src/indexer/config.rs`,
  so `chains.rs` needs no change.
- The EVM arm (#1484).

### Design decisions (confirmed by the human decisions R1–R6 below)

- **D1. `Pledged` is not enriched.** Soroban `simulateTransaction` reads only current state; the
  existing `loan_registry_reader.rs` header documents that `BlockHint` is ignored for this reason.
  A `lot()` read at index time would therefore return later state, such as quantity after
  releases or a later stage, during any catch-up or replay. That silently corrupts the row it
  claims to describe. The only ledger-accurate source would be the pledge tx's
  `resultMetaXdr` ledger-entry diff, or the `pledge(loan_id, PledgeLot)` invocation args from
  `getTransaction`. Both are heavier than this Issue warrants, and the invocation args are fragile
  when a multisig or admin contract wraps the call. These are logged as tech debt (follow-up).
  The params stay `{loan_id, lot_id}` on **both** arms, so the cross-arm shape holds even though
  EVM *could* block-pin (R1).
- **D2. No synthetic stage rows.** The indexer does not invent `StageUpdated` rows for:
  - `release` / `liquidate` to quantity 0, which moves the lot to `Delivered` / `Sold` / `Paid`;
  - `set_control(kind = Acknowledged)` on an `Assigned` receivable, which moves it to
    `Acknowledged`.

  The first cannot be derived without knowing the remaining quantity, and that needs D1's
  enrichment. `contract_logs` stays a faithful mirror of on-chain events. The derivation rules
  are documented in `docs/references/collateral-registry-events.md` for future consumers (R2).
- **D3. `MarginCall` is stored as emitted.** Every emission becomes its own row. Repeats from the
  permissionless `check_coverage`, or from the trailing `maybe_margin_call` inside any CR
  mutation, are distinct `(block_number, log_index)` events, so the existing
  `UNIQUE (chain_id, contract_address, block_number, log_index)` key keeps them all. There is no
  dedup and no synthetic "recovered" row. Consumers treat each row as a point-in-time observation.
- **D4. Routing by contract id, not by name.** The poller checks
  `raw.contract_id == collateral_registry_id` *before* calling `dispatch_parser`, so a
  same-named event from another contract (for example Pocket's `released`) never reaches the CR
  parsers.
  - `dispatch_parser`'s 7-arg signature is deliberately **not** extended. It has 20 positional
    call sites in `tests/stellar_parsers.rs` and `tests/stellar_minter_parsers.rs`, and #1482
    adds another contract id. Leaving the signature alone avoids a three-way merge conflict.
  - The poller branch is the second line of defence after the RPC `contractIds` filter, the same
    role `dispatch_parser`'s ladder plays.
  - Add a one-line note on `dispatch_parser` pointing to the poller pre-route.
- **D5. Decode failures warn, then drop.** This mirrors the minter branch in `dispatch_parser`.
  If a known CR topic (one of the 11 snake_case names) does not decode, the code emits
  `tracing::warn!` with `contract_id`, `event_name` and `tx_hash` and returns `None`, so an
  encoding drift is visible rather than silent.
- **D6. Enum names are stored verbatim.** The parser reads `ScVal::Vec([Symbol(name)])` and
  stores `name` as-is, with no allow-list. Stellar names are self-describing, so a new contract
  variant is stored rather than dropped.
  - Note for #1484: EVM ordinals differ from Stellar declaration order for `ControlKind`. EVM is
    `None=0, EblToOrderOfTrust, NegotiableWr, Cma, Acknowledged`; Stellar declares `None` last.
  - The EVM arm must therefore map by the **EVM** ordinal table so the names match.

## Assumptions and Risks

- **Contract source of truth**: the `pipeline-stellar-contracts` checkout at `b4d4a57`
  ("Mainnet deployment (#37)").
  - Deployed ids: testnet `CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS`, mainnet
    `CA76K5CUD3C2TX6IZDOB7Z6QGPD6FJ73KFYNNQZ6BOHMVJXGFCIZBOT3`.
  - A contract upgrade that renames fields breaks decoding. D5 makes that visible.
- **`#[contractevent]` encoding.** `topics[0]` is the snake_case Symbol and `topics[1..]` are the
  `#[topic]` fields in order. `value` is an `ScVal::Map` of the non-topic fields, keys sorted.
  - `Pledged` has no non-topic fields, so its value is an empty `Map` (possibly `Map(None)` /
    `Void`). The parser must not read `value_base64` for `pledged`.
  - `Option<Location>` is `ScVal::Void` when `None`, and the bare struct `Map` when `Some`.
  - Structs (`Location`, `Control`) are Symbol-keyed `Map`s. Enum unit variants are
    `Vec([Symbol])`. `Symbol` fields (`benchmark`) are `ScVal::Symbol`.
  - Tests must build fixtures in exactly these shapes.
- **Enabling on a running chain does not backfill.** The per-chain cursor is shared by every
  Stellar contract, so turning the key on starts CR indexing from the current cursor. Historic
  events need a cursor rewind via `CHAIN_<id>_STELLAR_START_BLOCK` on a fresh cursor, and Soroban
  RPC `getEvents` only retains roughly the last 7 days by default. CR was deployed before this
  ships, so early events are unrecoverable from RPC. This is accepted as a known limitation (R5): no backfill, no follow-up issue. It is documented in the reference doc.
- **RPC filter capacity.** The filter currently holds 3 required ids plus up to 3 optional ones.
  Adding CR makes 7, and #1482 adds DealTokenFactory plus dynamically discovered DEBT/CARGO
  tokens. The `build_contract_filters` limit is 25 ids (5 filters of 5). That is not a concern
  for this Issue, but it is flagged for #1482.
- **Parallel sibling edits** to `poller.rs` (struct field, `new()` args, `contract_ids` push,
  `run_stellar_indexer_job` wiring), `config.rs` (settings field, distinctness roles),
  `stellar/mod.rs` (`pub mod`), `.env.example`, `docs/references/backend.md` and
  `docs/user-stories/index.md` will conflict textually with #1480/#1482. Every edit here is
  additive and placed after the existing minter/asset entries; the coder rebases onto whichever
  sibling merges first.
- **No API consumer reads these rows yet.** `/v1/audit-log` filters on an explicit
  `AUDIT_EVENT_NAMES` allow-list (`packages/api/src/routes/audit_log.rs`), so the new
  `event_name`s do not leak into any existing feed. `is_loan_registry_event` and
  `is_position_event_name` do not match any CR name, so the poller's name-based post-routing
  sends CR rows to the plain `StellarLogMapper` path.
- **Cross-arm drift risk.** Mitigated: the human decisions R3/R4 fix the `benchmark` and nested-struct encodings for both arms, and #1484 matches this shape. The reference doc is the single source both arms test against.

## Resolved decisions (human, 2026-10-14)

1. **R1. `Pledged` stores ids only.**
   - `params` are `{loan_id, lot_id}` on **both** arms, with no `lot()` enrichment on either.
   - The tech-debt entry for a precise, ledger-accurate enrichment stays.
2. **R2. No synthetic or derived stage rows.**
   - The indexer never materialises the implicit transitions: release/liquidate to zero, and `set_control(Acknowledged)` on an `Assigned` receivable.
   - The derivation rules go in `docs/references/collateral-registry-events.md`.
3. **R3. `benchmark` is a plain string on both arms.**
   - Stellar: the `Symbol` is stored as its string (for example `"PAR"`). The Soroban Symbol charset is `[a-zA-Z0-9_]`, so the value is always printable ASCII.
   - EVM (#1484): trims trailing NULs from the `bytes32`. If the result is not printable ASCII, it falls back to hex.
4. **R4. `location` and `control` are nested objects.**
   - `location` is `{location_type, identifier, tracking_url}` or `null`.
   - `control` is `{kind, ref}`.
   - `has_location` is not stored.
   - #1484 matches this shape.
5. **R5. History older than the Soroban RPC retention window is accepted as lost.**
   - No backfill and no backfill follow-up issue.
   - Documented as a known limitation in the reference doc.
6. **R6. Every event is stored as emitted.**
   - This includes repeated `MarginCall` rows.
   - No dedup.

## Open Questions

_None_

## Implementation Steps

1. **Config**, in `packages/worker/src/indexer/config.rs`:
   - Add the field `pub collateral_registry_id: Option<String>` to `StellarIndexerSettings`,
     after `yield_minter_id`, with a short doc comment naming the env key and "ships dark".
   - In `from_chain_env`, read `format!("{ip}COLLATERAL_REGISTRY_ADDRESS")`.
     - Treat empty or whitespace as `None`.
     - Otherwise validate it with `validate_contract_id`, then
       `stellar_strkey::Contract::from_string` (the CRC check, mirroring the minter key's
       handling).
   - Push `("COLLATERAL_REGISTRY_ADDRESS", id)` into the `roles` distinctness check when it is
     `Some`.
   - Set the field in the `Ok(Self { … })` literal.
2. **Parser module**: create `packages/worker/src/indexer/stellar/collateral_registry_parsers.rs`.
   Give it a 2–3 line spec-pointer header to `docs/references/collateral-registry-events.md` and
   no other comments, per the AGENTS.md comment-less rule for new files.
   - One `pub fn parse_<event>(raw: &RawEvent) -> Option<StellarLog>` per event:
     `parse_pledged`, `parse_haircut_set`, `parse_floor_set`, `parse_revalued`,
     `parse_stage_updated`, `parse_control_updated`, `parse_doc_added`,
     `parse_quantity_adjusted`, `parse_released`, `parse_liquidated`, `parse_margin_call`.
   - Each one:
     - checks `raw.event_name` and the minimum topic count (3, or 2 for `floor_set` /
       `margin_call`);
     - decodes topics with `loan_registry_parsers::extract_u32`;
     - builds the params per the cross-arm table;
     - fills the common `StellarLog` fields exactly like `parse_wire_in` does, using
       `synthesise_log_index` and `ledger_closed_at_unix`.
   - Reuse the existing helpers:
     - `parsers::{extract_i128_from_map, extract_bytes32_from_map, synthesise_log_index, StellarLog}`
     - `loan_registry_parsers::{extract_u32, extract_u32_from_map, extract_string_from_map, get_map_entry}`
   - Add private helpers in this module:
     - `scval_enum_name(&ScVal) -> Option<String>` for `Vec([Symbol])`;
     - `scval_symbol(&ScVal) -> Option<String>`;
     - `scval_string(&ScVal) -> Option<String>`;
     - `map_field<'a>(&'a ScMap, key) -> Option<&'a ScVal>` for nested struct maps;
     - `decode_location(&ScVal) -> Option<Value>`, returning `Value::Null` for `ScVal::Void`;
     - `decode_control(&ScVal) -> Option<Value>`, mapping `reference` to `ref`.
   - Keep them module-private, which avoids touching `crate::stellar::scval` while siblings edit
     nearby. Note in the PR that they are candidates for promotion if #1480/#1482 need the same.
   - Add `pub fn dispatch_collateral_registry(raw: &RawEvent) -> Option<StellarLog>`:
     - chain the 11 parsers with `.or_else`;
     - on `None` where `raw.event_name` is one of the 11 known snake_case names, emit the D5
       `tracing::warn!`;
     - return the result.
   - Add `pub fn is_collateral_registry_event(event_name: &str) -> bool` over the 11 stored
     PascalCase names, for tests and docs parity, in the style of `is_loan_registry_event`.
3. **Module registration**: add `pub mod collateral_registry_parsers;` to
   `packages/worker/src/indexer/stellar/mod.rs`, plus one bullet in its header list.
4. **Poller**, in `packages/worker/src/indexer/stellar/poller.rs`:
   - Add the field `collateral_registry_id: Option<String>` to `StellarEventPoller` and a
     parameter to `new`. It already carries `#[allow(clippy::too_many_arguments)]`.
   - In `poll`, push the id into `contract_ids` when it is `Some`.
   - In the event loop, compute the parsed log with the D4 pre-route:

     ```rust
     let parsed = if self.collateral_registry_id.as_deref() == Some(raw.contract_id.as_str()) {
         dispatch_collateral_registry(&raw)
     } else {
         dispatch_parser(...)
     };
     ```

     The rest of the loop is unchanged. CR names fall into the final `else`, the
     `StellarLogMapper` branch.
   - In `run_stellar_indexer_job`, log `tracing::info!(collateral_registry_id, chain_id,
     "Stellar CollateralRegistry indexer enabled")` when it is `Some`, and pass
     `settings.collateral_registry_id.clone()` to `StellarEventPoller::new`.
   - Add a one-line pointer on `dispatch_parser`'s doc comment in `parsers.rs`: the collateral
     registry is routed in the poller before this ladder. Keep it minimal, because #1480 edits
     the same doc comment.
5. **`.env.example`**: add, after the `…_MINTER_ADDRESS` line (around line 128), the line
   `# CHAIN_99000001_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS=   # optional — indexes CollateralRegistry events; testnet CBSMJS5QIFSSH5LPPYPZ23SMGJP5LK5GTKTFCTUVQNQECNMCNGG77PGS`.
6. **Docs**: see Docs to Update.
7. **Verify**:
   - `cargo clippy --all -- -D warnings`
   - `cargo test -p pipeline-worker` (at least the new test files and `stellar_config`,
     `stellar_parsers`, `stellar_minter_parsers`, `stellar_event_poller`)
   - `npx tsx scripts/lint-docs.ts`

## Test Strategy

All tests are pure unit tests in external files under `packages/worker/tests/`. There is no
`DATABASE_URL` / `POSTGRES_URL` and no RPC. Fixtures are built with `stellar_xdr` encode helpers
in the style of `tests/stellar_minter_parsers.rs`.

1. **New `packages/worker/tests/stellar_collateral_registry_parsers.rs`**:
   - **Happy path per event (11 tests).** Each test asserts the exact `event_name`, all
     `params` keys and values (including number vs string types), `contract_address`,
     `block_number`, `log_index` (`synthesise_log_index`) and `block_timestamp`.
     - `pledged` with an empty-map value, and with `Void`/`Map(None)` value variants.
     - `revalued`: a negative-free large i128 (> u64) rendered as a decimal string, `benchmark`
       `"PAR"`, `report_hash` lowercase hex.
     - `stage_updated` with `location` `Void` gives `null`. With `Some(Location{Vessel, …})` it
       gives a nested object with `location_type`, `identifier`, `tracking_url`.
     - `control_updated`: `reference` maps to `ref`, and `kind` is the enum name, including the
       `"None"` variant.
     - `doc_added`: `sha256` maps to `hash`.
     - `quantity_adjusted`: `old`/`new` map to `old_quantity`/`new_quantity`, `sha256` maps to
       `hash`, and `reason` is a string.
     - `released`: `qty` maps to `quantity`, `reason` is the ReleaseReason name, `ref_hash` is
       hex.
     - `liquidated`: `sale_id` is a string and `qty` maps to `quantity`.
     - `floor_set` / `margin_call` use their two-topic shape, with bps as JSON numbers.
   - **Negative cases:**
     - wrong topic name gives `None`;
     - too few topics gives `None`;
     - a missing map field gives `None`;
     - a wrong ScVal type (for example `bps` as `I128`) gives `None`;
     - a 31-byte hash gives `None`;
     - an enum encoded as a bare Symbol instead of `Vec([Symbol])` gives `None`.
   - **Exhaustive enum round-trips:**
     - every `LotStage` (9), `ControlKind` (5), `DocKind` (10), `ReleaseReason` (6) and
       `LocationType` (4) variant name is stored verbatim;
     - an unknown variant name is also stored verbatim (D6).
   - **`dispatch_collateral_registry`:**
     - routes each of the 11 topics;
     - returns `None` for `loan_registry_set`, `paused` and an unrelated `transfer`;
     - returns `None` (no panic) for a known topic with a malformed body.
   - **`is_collateral_registry_event`:**
     - true for all 11 PascalCase names;
     - false for loan-registry names, `AssetTransfer` and the raw snake_case topics;
     - also assert that no CR name satisfies `is_loan_registry_event`, which guards the poller's
       name-based post-routing.
2. **New `packages/worker/tests/stellar_collateral_registry_config.rs`.** It is a separate file
   so it does not conflict with sibling edits to `stellar_config.rs`. Each test uses a unique
   chain id in the `99_014_81x` range, because env-var tests share one process.
   - unset gives `None`;
   - whitespace-only gives `None`;
   - a valid lowercase id is uppercased into `Some`;
   - a bad Strkey CRC gives `Err` mentioning the key;
   - an id duplicating `LOAN_REGISTRY_ADDRESS` or `DEPOSIT_MANAGER_ADDRESS` gives `Err`
     containing `"duplicates"` and `COLLATERAL_REGISTRY_ADDRESS`.
3. **Regression**: the existing `stellar_parsers.rs`, `stellar_minter_parsers.rs`,
   `stellar_event_poller.rs` and `stellar_config.rs` must pass unchanged. The `dispatch_parser`
   signature is untouched (D4).

## Docs to Update

- **New `docs/references/collateral-registry-events.md`**, the cross-arm reference. It contains:
  - the event table above (Stellar topic and fields, EVM event, stored keys);
  - the field-name mapping notes (qty, sha256, old/new, reference, `Option<Location>`, Symbol
    benchmark);
  - the encoding rules (id strings, bps numbers, amount strings, hex, enum names, raw native
    scale);
  - the D2 derivation rules for implicit stages;
  - the D3 MarginCall semantics (R6: every emission stored, no dedup);
  - a "Known limitations" section:
    - events older than the Soroban RPC `getEvents` retention window (about 7 days) before enablement are not indexed;
    - enabling the key on a running chain does not backfill;
    - there is no backfill (R5);
  - the env key.

  If #1484 has merged first and created an equivalent doc, extend it with the Stellar column
  instead of creating a second one. Link it from `docs/references/index.md` (lint-docs
  reachability).
- **`docs/references/backend.md`** (Stellar events paragraph, around line 299): add one short,
  additive paragraph after the minter paragraph. It says the CollateralRegistry's 11 events are
  collected when `CHAIN_<id>_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS` is set, routed by
  contract id, and links to the new reference doc. Do not rewrite the surrounding stale
  `*_ID`-named prose; #1480 is likely to touch it.
- **`.env.example`**: see step 5.
- **New user-stories doc** `docs/user-stories/epic-1478/1481-stellar-collateral-registry-events.md`
  (ISSUE_PROTOCOL §6). It covers these stories:
  - lot pledge indexed as `Pledged`;
  - revaluation indexed with hex `report_hash`;
  - stage update with and without location;
  - release/liquidation quantities;
  - repeated margin calls stored as separate rows;
  - key unset gives no CR rows and no warnings;
  - same-named `released` from another contract not attributed to CR.

  Add an `Epic #1478` section and row in `docs/user-stories/index.md`. This is additive, and
  siblings add rows to the same section.
- **`docs/exec-plans/tech-debt-tracker.md`**: two additive entries.
  - Stellar `Pledged` lacks lot details: a ledger-accurate enrichment via the tx-meta
    ledger-entry diff is the follow-up.
  - Implicit stage transitions are not materialised in `contract_logs`.
- No product-spec change. There is no user- or agent-facing behaviour yet; API surface is out of
  scope.
