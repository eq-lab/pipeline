# Issue #620: Stellar/Soroban: LoanRegistry event indexer

Source: https://github.com/eq-lab/pipeline/issues/620

## Scope

Extend the Stellar/Soroban event indexer foundation (delivered in #528) with the `LoanRegistry`
contract's 9 events plus the view-call enrichment path delivered for EVM in #336 / #442 / #363.
After this lands, a Stellar `draw_loan` call produces the same downstream effects as the EVM
`_drawLoan` path: a `contract_logs` row with `event_name = 'LoanDrawn'` and a fully populated
`params.snapshot` JSONB that `list_latest_loan_snapshots_for_chain(stellar_chain_id)` can read.

**Events parsed (verified against `pipeline-stellar-contracts/contracts/loan-registry/src/event.rs`):**

| Soroban event       | Topic key            | Topic args                              | Data                                                   | Stored `event_name`     |
|---------------------|----------------------|-----------------------------------------|--------------------------------------------------------|-------------------------|
| `LoanDrawn`         | `loan_drawn`         | `loan_id: u32, holder: Address`         | `metadata_uri: String`                                 | `LoanDrawn`             |
| `StatusUpdated`     | `status_updated`     | `loan_id: u32, new_status: LoanStatus`  | —                                                      | `LoanStatusUpdated`     |
| `CcrUpdated`        | `ccr_updated`        | `loan_id: u32`                          | `new_ccr: u32`                                         | `LoanCCRUpdated`        |
| `LocationUpdated`   | `location_updated`   | `loan_id: u32, new_location: String`    | —                                                      | `LoanLocationUpdated`   |
| `LoanDefaulted`     | `loan_defaulted`     | `loan_id: u32`                          | `ccr: u32`                                             | `LoanDefaulted`         |
| `LoanClosed`        | `loan_closed`        | `loan_id: u32, reason: ClosureReason`   | —                                                      | `LoanClosed`            |
| `PaymentRecorded`   | `payment_recorded`   | `loan_id: u32, repayment_id: u32`       | `repayment: RepaymentData` (7 × u128)                  | `PaymentRecorded`       |
| `LoanRolledOver`    | `loan_rolled_over`   | `loan_id: u32`                          | `new_rate: u32, new_maturity_timestamp: u64`           | `LoanRolledOver`        |
| `EconomicsAmended`  | `economics_amended`  | `loan_id: u32`                          | `new_rate: u32, new_maturity_timestamp: u64`           | `EconomicsAmended`      |

The 9 stored `event_name` strings are the same the EVM indexer uses (verified against
`packages/shared/src/contract_logs_repo.rs:166-178`), so the existing API and `LoanSnapshot`
read paths are chain-agnostic with **zero SQL change**.

**In scope:**

- New `loan_registry_id: Option<String>` field on `StellarIndexerSettings`
  (`packages/worker/src/indexer/config.rs`), read from `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID`.
  Optional so an existing testnet chain that has not deployed the registry yet still boots.
- New parsers in `packages/worker/src/indexer/stellar/loan_registry_parsers.rs` (a new sibling
  file under `stellar/` — keeps the existing `parsers.rs` small) covering all 9 events plus
  the `LoanStatus` / `ClosureReason` enum topic decoders and the `RepaymentData` ScVal::Map
  decoder. The dispatcher in `parsers.rs::dispatch_parser` grows one new branch.
- New `Strkey`-typed resolver traits + concrete Stellar reader at
  `packages/worker/src/indexer/stellar/loan_registry_reader.rs` that issues
  `simulateTransaction` view calls against `immutable_loan_data`, `mutable_loan_data`, and
  `cumulative_repayment_data`. Returns the existing plain-Rust
  `ImmutableLoanDataView` / `MutableLoanDataView` / `RepaymentDataView` projections from
  `packages/worker/src/indexer/loan_metadata.rs` (these are already alloy-free — see
  decision Q1 below).
- New `StellarLoanEventMapper` in `packages/worker/src/indexer/stellar/loan_mapper.rs` —
  mirrors `LoanEventMapper`'s composer pipeline 1:1 but on a `StellarLog` and with
  Strkey-keyed resolver traits. Reuses the alloy-free composer helpers
  (`compose_drawn_snapshot`, `compose_lifecycle_snapshot`, `maybe_fetch_refreshed_json`,
  `loan_status_name`, `closure_reason_name`) from the EVM mapper unchanged — they only
  touch the alloy-free view projections.
- A small refactor in `packages/worker/src/indexer/loan_mapper.rs` to lift the four pure
  helpers out of the `impl LoanEventMapper` block so the Stellar mapper can import them
  directly. They are already free functions; the refactor is just making sure they live
  next to the views and not behind alloy-typed glue.
- Dispatch in `packages/worker/src/indexer/stellar/poller.rs::StellarEventPoller`:
  conditional contract id + the new mapper plumb-through. The poller now constructs the
  Stellar loan reader + fetcher once per spawn and wraps each `LoanDrawn` / lifecycle
  raw event in a `StellarLoanEventMapper` instead of a plain `StellarLogMapper`.
- `.env.example` extension documenting `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID`.
- Unit tests for all 9 parsers (fabricated base64 XDR fixtures via `stellar-xdr`),
  plus tests for the enum-topic decoder, the `RepaymentData` Map decoder, and the
  Stellar reader's `ScVal` → view projection.

**Out of scope (file separately when needed):**

- Frontend wiring for Stellar loans (covered by epic #444).
- Stellar mainnet deployment of the loan-registry contract.
- AccessManager governance event indexing (#528 Open Q5 — still deferred).
- Yield-mint relayer Stellar parity (Phase 4 analogue).
- `mark_minted` indexing — the contract method exists but emits no event; would need
  a contract change. Out of scope here.
- Touching the EVM `LoanEventMapper`'s alloy-typed write path or its tests.

## Assumptions and Risks

- **Contract not yet deployed to testnet.** `pipeline-stellar-contracts/deployments/testnet.json`
  (read at planning time) contains `usdc`, `plusd`, `access_manager`, `deposit_manager`,
  `withdrawal_queue`, `staked_pl_usd` — but **no `loan_registry`** entry. The contract source
  exists at `contracts/loan-registry/` and builds. Resolution: deploy the contract to testnet
  as a **prerequisite** for closing this Issue (Open Q6 below). Until deployed, the indexer
  ships dark — `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID` stays unset and the new branch is a no-op.
- **`loan_id` is `u32` on Stellar, `U256` on EVM.** Serialised as a decimal string in
  `params.loan_id` matching the EVM convention (`packages/worker/src/indexer/parsers.rs:190`).
  The downstream API reads it as `(params->>'loan_id')::numeric` (`contract_logs_repo.rs:159`),
  which accepts both. **No DDL change.** Open Q2 below records this decision.
- **`LoanStatus` / `ClosureReason` topic encoding.** Soroban encodes unit enum variants as
  `ScVal::Vec([Symbol("Performing")])` per `#[contracttype]` macro convention. The parser
  emits the **string variant name** (e.g. `"Performing"`, `"Default"`) into `params`, matching
  the EVM convention which already stores variant names via `loan_status_name` /
  `closure_reason_name` in `loan_mapper.rs:29-48`. Open Q3 below records this.
- **`LocationUpdated.new_location` is a `String` topic.** Soroban (unlike EVM) stores
  string topics as the full `ScVal::String(…)`, not a keccak hash. The parser decodes
  and emits the literal string. Open Q4 below documents the verification path.
- **`metadata_uri` schemes.** The EVM `LoanDrawnMapper` (now `LoanEventMapper`) fetches
  the off-chain JSON document via the shared `MetadataFetcher::fetch_json` which supports
  `http(s)://` and `ipfs://CID[/path]`. The Stellar `draw_loan` call accepts a `String`
  metadata URI — the same scheme set works as-is. No new resolver needed. Open Q5 records
  the verification step.
- **Soroban RPC `simulateTransaction` is current-state-only** (no historical block pin).
  EVM lifecycle reads pin to `event.block_number` via `BlockId::Number(...)`; on Stellar,
  the simulate request reads the **current ledger**. **Implication:** during a backfill,
  if two lifecycle events for the same loan land in the same polling cycle, the reader
  may observe the post-second-event state for the first event's snapshot. **Mitigation:**
  the polling cycle is short (~5s ledgers, default `JOB_INDEXER_POLLING_INTERVAL_MS=500`,
  `polling_ledger_range=1000` — but Soroban RPC's 7-day window keeps real-world backfill
  ranges small) and the operator running `draw_loan` against the testnet smoke recipe
  generally lets a tick pass between calls. Documented in the mapper's doc comment;
  tracked as **TD-19** for later (a future "ledger-pinned simulate" via `getLedgerEntries`
  on the loan storage slots would close this gap, but that's bigger than this Issue).
- **`RepaymentData` `u128` precision.** Seven `u128` fields per repayment, each capped at
  `2^128 - 1 ≈ 3.4 × 10^38`. The existing EVM cumulative path stores `U256` as decimal
  strings via `u256_to_bigdecimal` (`shared::json_numeric`). The Stellar reader produces
  `u128`, which fits inside `BigDecimal` losslessly via `BigDecimal::from(u128_value)`.
- **Mapper dispatch.** `StellarEventPoller::poll` already iterates raw events and routes
  via `dispatch_parser`. The new path needs to *branch on the parsed log's `event_name`*
  to pick `StellarLoanEventMapper` for the 9 loan events and keep `StellarLogMapper` for
  the existing 5. Cleanest implementation: the poller checks `event_name.starts_with("Loan")
  || event_name == "PaymentRecorded" || event_name == "EconomicsAmended"` and constructs
  the appropriate mapper. Documented inline with a table of the 9 names.
- **Test policy: pure unit tests only.** The MEMORY rule forbids env-gated DB or live-RPC
  tests. Parsers and the reader's `ScVal` → view projection are tested against fabricated
  base64 XDR (constructed in-test via `stellar-xdr`, no fixture files — keeps the test
  hermetic and avoids needing a live testnet deployment to capture fixtures). Mapper tests
  reuse the trait-mocked pattern from `packages/worker/tests/loan_mapper.rs` (#363) but
  with Strkey-typed mocks.
- **Soroban event payload structure.** `#[contractevent]` emits topics as
  `[Symbol("snake_case_name"), ...#[topic] fields]` and value as `ScVal::Map({ field_name:
  ScVal })` alphabetised. `record_payment` emits one event per call; the cumulative
  totals are derived from a separate view (`cumulative_repayment_data`). The
  `PaymentRecorded` event itself carries the **delta** (`repayment: RepaymentData`) under
  the `repayment` key in the value map — the parser stores those 7 fields in `params`
  (matching the EVM `parse_payment_recorded` shape at `parsers.rs:234-258`); the mapper
  then reads cumulative state separately. This is byte-for-byte the same shape the EVM
  path already uses, including the cumulative-vs-delta split.

## Open Questions / Resolutions

All six Open Questions from the Issue body are resolved here, with file/line evidence.

### Q1. Chain-agnostic mapper shape — **Resolved: option (b)+(c) hybrid — Stellar-specific mapper class, but reuse the alloy-free composer helpers in place**

After reading the actual EVM `LoanEventMapper` (`packages/worker/src/indexer/loan_mapper.rs`),
two facts pin the answer:

1. **The composer helpers are already alloy-free.** `compose_drawn_snapshot`,
   `compose_lifecycle_snapshot`, `maybe_fetch_refreshed_json`, `loan_status_name`,
   `closure_reason_name` (lines 29-236) take only the plain-Rust view structs from
   `loan_metadata.rs` (`ImmutableLoanDataView`, `MutableLoanDataView`, `RepaymentDataView`,
   `LoanMetadataJson`) — no alloy types. They can be reused **as-is** by a Stellar mapper.
2. **The trait surface is already chain-agnostic, except for two method signatures.**
   `ImmutableDataResolver::immutable_loan_data` and `MutableDataResolver::mutable_loan_data`
   take `contract: alloy::primitives::Address` and `loan_id: alloy::primitives::U256`.
   Making them generic-over-address (option a) ripples generics through 6 files plus the
   alloy-specific reader implementation. Extracting to a shared crate (option c) duplicates
   the view structs and is high-blast-radius.

**Chosen shape (b+c hybrid):**

- **Keep** the EVM `LoanEventMapper` exactly as it is — alloy-typed, EVM-only. Tests under
  `packages/worker/tests/loan_mapper.rs` keep passing untouched.
- **Add** a parallel Stellar `StellarLoanEventMapper` in `indexer/stellar/loan_mapper.rs`.
  Its struct holds Strkey-typed contract address (`String`), Stellar-typed loan id (`u32`),
  the same alloy-free `LoanMetadataFetcher` trait (no chain leakage), and **new
  Strkey-typed resolver traits** `StellarImmutableDataResolver` /
  `StellarMutableDataResolver` whose methods take `contract: &str, loan_id: u32` and
  return the same `ImmutableLoanDataView` / `MutableLoanDataView` / `RepaymentDataView`
  the EVM path uses.
- **Reuse** the four composer helpers from `loan_mapper.rs` verbatim (import them as
  `use super::super::loan_mapper::{compose_drawn_snapshot, compose_lifecycle_snapshot,
  maybe_fetch_refreshed_json, loan_status_name, closure_reason_name};`). Move them out
  of `impl LoanEventMapper` only if they're currently `impl` methods (they're already
  free functions — verified at lines 80, 141, 220, 29, 39).
- **Reuse** `ContractLogsRepo::get_latest_loan_snapshot` unchanged — it already takes
  `contract_address: &str` and `loan_id: &BigDecimal` (`contract_logs_repo.rs:232-237`),
  so Strkey + `u32→BigDecimal` slot in directly.

**Code reuse delta:** ~150 lines for the new mapper struct (mostly the new resolver-trait
bodies and the `do_insert` orchestration); ~0 lines duplicated from the composer helpers.
A future third chain family (e.g. Solana) revisits the generic-over-address (option a)
refactor with two concrete impls to inform the API.

### Q2. `loan_id` shape mismatch (EVM `U256` vs Stellar `u32`) — **Resolved: serialise both as decimal strings in `params.loan_id`**

The EVM parser already calls `decoded.loanId.to_string()` (`parsers.rs:190`) and the
downstream SQL reads `(params->>'loan_id')::numeric` (`contract_logs_repo.rs:159`). A `u32`
fits inside `numeric` losslessly. The Stellar parser does `loan_id.to_string()` symmetrically
and the API needs zero change. The mapper's `extract_loan_id` helper (`loan_mapper.rs:50-62`)
parses back to `BigDecimal` via `BigDecimal::from_str` — a Stellar `"42"` decodes the same
way an EVM `"42"` does. No DDL, no API, no API-test change.

### Q3. `LoanStatus` / `ClosureReason` topic decoding — **Resolved: emit the variant name string, not the numeric rank**

Soroban's `#[contracttype]` macro encodes unit enum variants as
`ScVal::Vec(vec![ScVal::Symbol("Performing")])` (per `soroban-sdk` 23.x `IntoVal` impl). The
EVM side already stores the **string name** in `params.status` / `params.closure_reason`
via `loan_status_name` / `closure_reason_name` (`loan_mapper.rs:29-48`). The Stellar parser
decodes the inner `Symbol` and emits the same string, modulo the variant set being identical
between the two (verified against
`pipeline-stellar-contracts/contracts/loan-registry/src/types.rs:7-12, 28-34` vs
`packages/worker/src/indexer/loan_registry_reader.rs:18-32`). **No `rank()` numeric
conversion.** Downstream queries that filter on `params->>'status' = 'Default'` work
unchanged across chains.

### Q4. `LocationUpdated.new_location` topic — **Resolved: decode the `ScVal::String` verbatim**

Soroban stores `String` topics as `ScVal::String(StringM<…>)` (the actual UTF-8 string,
unlike Solidity's indexed-string which is the keccak hash). The parser decodes via
`ScVal::String(s) => Some(s.to_utf8_string_lossy())` and emits as `params.new_location`.
The EVM analogue **does not** carry the value in `params` (it's hashed in the topic — see
`parsers.rs:296-313` which only stores `loan_id`); on Stellar we can carry it. The mapper's
`snapshot_for_lifecycle` path re-reads `mutable_loan_data.current_location` on every
lifecycle event anyway (`loan_mapper.rs:351-421`), so the `new_location` topic is **not**
the canonical source of the location — but storing it in `params` keeps debugging tractable
and matches the natural Stellar shape. No conflict with EVM analytics.

### Q5. `metadata_uri` fetch path — **Resolved: reuse `MetadataFetcher::fetch_json::<LoanMetadataJson>` unchanged**

`MetadataFetcher` already handles `http(s)://` and `ipfs://CID[/path]` schemes
(`packages/shared/src/metadata_fetcher.rs`, verified earlier in #363). The Stellar
`draw_loan` call accepts a `String` for `metadata_uri` and stores it verbatim in
`MutableLoanData.metadata_uri`. The deployment operator agrees to use `ipfs://...` URIs
in line with EVM practice; no new scheme required. If a future Stellar-only URI scheme
(e.g. `darkscan://`) is ever introduced, `MetadataFetcher` would need a new branch, but
that's a separate Issue. Verification: have the operator confirm the URI scheme before
the first `draw_loan` on testnet (smoke test step).

### Q6. Deploy gate (blocking dependency) — **Resolved: option (b) — implement parsers/reader/mapper now, gate the integration smoke on deployment**

Confirmed by reading `pipeline-stellar-contracts/deployments/testnet.json`: no
`loan_registry` entry exists. Two paths were considered:

- **(a) deploy first, then merge** — couples this Issue's merge to a contract deployment
  that may itself require KMS / multisig coordination. High risk of the PR sitting open.
- **(b) merge dark, deploy independently** — `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID` is
  optional. Until set, the new code is a no-op branch. Unit tests prove the parsers and
  reader work against fabricated XDR. The smoke recipe is **documented in the PR
  description** with the exact `stellar contract invoke draw_loan` line, but its
  acceptance is **deferred** until the contract is actually deployed (a follow-up Issue
  to flip the env var in `.env.example` and capture the smoke evidence).

**Chosen: (b).** Rationale: the EVM analogue (#336) shipped the parser before any LoanRegistry
contract was deployed anywhere — same precedent. The Stellar contracts repo's `justfile`
has a `deploy-loan-registry` recipe ready; the operator runs it whenever convenient. The PR
description includes:
1. The intended `CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID` value, blank until deployment.
2. A "smoke recipe pending" checkbox tied to a follow-up Issue.

This unblocks the indexer work without coupling it to a deploy-shaped second task.

## File-by-file change list

Grouped by package, with brief signatures and intent — full bodies follow patterns set by
the EVM analogue and the #528 Stellar foundation.

### `packages/worker/src/indexer/config.rs`

```rust
pub struct StellarIndexerSettings {
    // ...existing fields unchanged...
    pub loan_registry_id: Option<String>,   // NEW — read from CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID
}

impl StellarIndexerSettings {
    pub fn from_chain_env(chain_id: i64) -> Result<Self> {
        // ...existing code unchanged...
        let lr_key = format!("{p}LOAN_REGISTRY_ID");
        let loan_registry_id = match env::var(&lr_key) {
            Ok(raw) if !raw.trim().is_empty() => Some(validate_contract_id(&lr_key, raw)?),
            _ => None,
        };

        // Extend the distinctness check to include loan_registry_id when present.
        let mut seen = HashSet::new();
        let mut roles = vec![
            ("DEPOSIT_MANAGER_ID", &deposit_manager_id),
            ("WITHDRAWAL_QUEUE_ID", &withdrawal_queue_id),
            ("STAKED_PLUSD_ID", &staked_plusd_id),
        ];
        if let Some(id) = &loan_registry_id {
            roles.push(("LOAN_REGISTRY_ID", id));
        }
        // ...same loop body as today...

        Ok(Self { /* ..., loan_registry_id */ })
    }
}
```

No change to the `IndexerSettings::all_from_env` dispatcher — the new field rides along.

### `packages/worker/src/indexer/stellar/loan_registry_parsers.rs` (new file)

```rust
// One pure decoder per #[contractevent], following the same shape as parsers.rs.
// Each returns Option<StellarLog>; topic[0] mismatch returns None.

pub fn parse_loan_drawn(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [loan_drawn, u32, Address]
    // value:  Map { metadata_uri: String }
}

pub fn parse_status_updated(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [status_updated, u32, LoanStatus]
    // event_name = "LoanStatusUpdated" (remapped — matches EVM analytics)
}

pub fn parse_ccr_updated(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [ccr_updated, u32]
    // value:  Map { new_ccr: u32 }
    // event_name = "LoanCCRUpdated"
}

pub fn parse_location_updated(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [location_updated, u32, String]
    // event_name = "LoanLocationUpdated"
}

pub fn parse_loan_defaulted(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [loan_defaulted, u32]
    // value:  Map { ccr: u32 }
}

pub fn parse_loan_closed(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [loan_closed, u32, ClosureReason]
}

pub fn parse_payment_recorded(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [payment_recorded, u32, u32]
    // value:  Map { repayment: RepaymentData (struct of 7 × u128) }
    // params shape mirrors EVM parse_payment_recorded: flatten the 7 fields
    //  into top-level keys: offtaker_received, senior_principal_repaid, ...
}

pub fn parse_loan_rolled_over(raw: &RawEvent) -> Option<StellarLog> {
    // topics: [loan_rolled_over, u32]
    // value:  Map { new_rate: u32, new_maturity_timestamp: u64 }
}

pub fn parse_economics_amended(raw: &RawEvent) -> Option<StellarLog> {
    // same shape as parse_loan_rolled_over but different topic key
}

// New ScVal helpers (pub for unit tests):

pub fn extract_u32(b64: &str) -> Option<u32>;
pub fn extract_u64(b64: &str) -> Option<u64>;
pub fn extract_string(b64: &str) -> Option<String>;     // for LocationUpdated.new_location
pub fn extract_loan_status(b64: &str) -> Option<String>;
pub fn extract_closure_reason(b64: &str) -> Option<String>;
pub fn extract_u128_from_map(b64: &str, key: &str) -> Option<u128>;
pub fn extract_u32_from_map(b64: &str, key: &str) -> Option<u32>;
pub fn extract_u64_from_map(b64: &str, key: &str) -> Option<u64>;
pub fn extract_string_from_map(b64: &str, key: &str) -> Option<String>;
pub fn extract_repayment_data_from_map(b64: &str, key: &str) -> Option<RepaymentDataView>;
```

`extract_loan_status` / `extract_closure_reason` decode the unit-variant `ScVal::Vec(
[Symbol("Performing")])` shape into a `&'static str` matching `loan_status_name` /
`closure_reason_name` from `loan_mapper.rs`.

### `packages/worker/src/indexer/stellar/parsers.rs` (modify)

```rust
// Extend the dispatcher's signature + the if-ladder.
pub fn dispatch_parser(
    raw: &RawEvent,
    deposit_manager_id: &str,
    withdrawal_queue_id: &str,
    staked_plusd_id: &str,
    loan_registry_id: Option<&str>,   // NEW — None when registry unconfigured
) -> Option<StellarLog> {
    // ...existing three branches unchanged...
    } else if loan_registry_id == Some(raw.contract_id.as_str()) {
        parse_loan_drawn(raw)
            .or_else(|| parse_status_updated(raw))
            .or_else(|| parse_ccr_updated(raw))
            .or_else(|| parse_location_updated(raw))
            .or_else(|| parse_loan_defaulted(raw))
            .or_else(|| parse_loan_closed(raw))
            .or_else(|| parse_payment_recorded(raw))
            .or_else(|| parse_loan_rolled_over(raw))
            .or_else(|| parse_economics_amended(raw))
    } else { /* unchanged warn */ }
}
```

### `packages/worker/src/indexer/stellar/loan_registry_reader.rs` (new file)

```rust
use std::sync::Arc;
use anyhow::Result;
use async_trait::async_trait;
use crate::stellar::tx::build_invoke_envelope;          // promoted in #568
use crate::indexer::stellar::rpc::StellarRpc;
use crate::indexer::loan_metadata::{
    ImmutableLoanDataView, MutableLoanDataView, RepaymentDataView, LocationUpdateView, LocationType,
};

#[async_trait]
pub trait StellarImmutableDataResolver: Send + Sync {
    async fn immutable_loan_data(&self, contract: &str, loan_id: u32)
        -> Result<ImmutableLoanDataView>;
}

#[async_trait]
pub trait StellarMutableDataResolver: Send + Sync {
    async fn mutable_loan_data(&self, contract: &str, loan_id: u32)
        -> Result<MutableLoanDataView>;
    async fn cumulative_repayment_data(&self, contract: &str, loan_id: u32)
        -> Result<RepaymentDataView>;
}

pub struct StellarLoanRegistryReader {
    rpc: Arc<StellarRpc>,
    network_passphrase: String,
}

impl StellarLoanRegistryReader {
    pub fn new(rpc: Arc<StellarRpc>, network_passphrase: String) -> Self { /* ... */ }

    // Private: build the simulate envelope, call simulate, decode the return ScVal.
    async fn call_view(&self, contract: &str, fn_name: &str, loan_id: u32) -> Result<ScVal>;
}

#[async_trait]
impl StellarImmutableDataResolver for StellarLoanRegistryReader {
    async fn immutable_loan_data(&self, contract: &str, loan_id: u32) -> Result<ImmutableLoanDataView> {
        let scval = self.call_view(contract, "immutable_loan_data", loan_id).await?;
        decode_immutable_loan_data(&scval)
    }
}

#[async_trait]
impl StellarMutableDataResolver for StellarLoanRegistryReader {
    async fn mutable_loan_data(&self, contract: &str, loan_id: u32) -> Result<MutableLoanDataView> { /* ... */ }
    async fn cumulative_repayment_data(&self, contract: &str, loan_id: u32) -> Result<RepaymentDataView> { /* ... */ }
}

// Pure decoders (pub for unit tests):
fn decode_immutable_loan_data(scval: &ScVal) -> Result<ImmutableLoanDataView>;
fn decode_mutable_loan_data(scval: &ScVal) -> Result<MutableLoanDataView>;
fn decode_cumulative_repayment_data(scval: &ScVal) -> Result<RepaymentDataView>;
```

The `call_view` helper does the simulate envelope construction in the same shape as
`packages/worker/src/price_poller/stellar/poller.rs::fetch_share_price` (#568):

1. Build a dummy `Ed25519Pub([0u8; 32])` source account (simulate-only, no sign / submit).
2. Build envelope via `crate::stellar::tx::build_invoke_envelope` with
   `contract = Contract::from_string(contract)?`, `function_name = fn_name`,
   `args = vec![ScVal::U32(loan_id)]`, `seq_num = 0, fee = 0, no auth, no soroban_data`.
3. `rpc.simulate_transaction(envelope_b64)` — bail on `Some(error)` or empty `results`.
4. Decode `results[0].return_value_xdr_base64` as `ScVal::from_xdr_base64(...)`.

The three decoders translate the on-wire `ScVal::Map({ original_facility_size: U128, ... })`
into the existing alloy-free views. For `u128 → U256`, use `U256::from(u128_value)` to keep
the view-struct field type unchanged.

### `packages/worker/src/indexer/stellar/loan_mapper.rs` (new file)

Parallel of `loan_mapper.rs::LoanEventMapper` with Strkey-typed deps. The pure composer
helpers (`compose_drawn_snapshot`, `compose_lifecycle_snapshot`, `maybe_fetch_refreshed_json`,
`loan_status_name`, `closure_reason_name`) are imported from `super::super::loan_mapper`
and reused **unchanged**.

```rust
use std::str::FromStr;
use std::sync::Arc;
use bigdecimal::BigDecimal;
use sqlx::PgConnection;
use shared::{
    contract_logs_repo::ContractLogsRepo,
    db::EventRepo,
    events::EventRow,
    log_mapper::LogMapper,
};
use crate::indexer::loan_metadata::{LoanMetadataFetcher, LoanMetadataJson};
use crate::indexer::loan_mapper::{
    closure_reason_name, compose_drawn_snapshot, compose_lifecycle_snapshot,
    loan_status_name, maybe_fetch_refreshed_json,
};
use crate::indexer::stellar::loan_registry_reader::{
    StellarImmutableDataResolver, StellarMutableDataResolver,
};
use crate::indexer::stellar::parsers::StellarLog;

pub struct StellarLoanEventMapper {
    pub log: StellarLog,
    chain_id: i64,
    event_repo: Arc<EventRepo>,
    contract_logs_repo: Arc<ContractLogsRepo>,
    fetcher: Arc<dyn LoanMetadataFetcher>,
    immutable_resolver: Arc<dyn StellarImmutableDataResolver>,
    mutable_resolver: Arc<dyn StellarMutableDataResolver>,
}

impl StellarLoanEventMapper {
    // snapshot_for_drawn — parallels EVM mapper at lines 292-341
    // snapshot_for_lifecycle — parallels EVM mapper at lines 351-421
    // do_insert — calls EventRepo::insert_row (not insert_log)
}

#[async_trait]
impl LogMapper for StellarLoanEventMapper {
    async fn is_duplicate(&self, conn: &mut PgConnection) -> Result<bool> {
        self.event_repo.is_duplicate(
            conn, self.chain_id, &self.log.contract_address,
            self.log.block_number, self.log.log_index,
        ).await
    }
    async fn insert(&self, conn: &mut PgConnection) -> Result<()> { self.do_insert(conn).await }
    fn block_number(&self) -> u64 { self.log.block_number }
    fn set_block_timestamp(&mut self, _ts: u64) {} // pre-populated; no-op
}
```

The `do_insert` flow assembles the enriched `params = { loan_id, event, snapshot }` JSON
just like the EVM mapper (`loan_mapper.rs:425-470`) and then builds an `EventRow` for
`insert_row`. The Stellar mapper writes to `contract_logs` via the chain-agnostic write
path (`EventRepo::insert_row`), so the row carries the Strkey contract address verbatim
— the read-side query `WHERE contract_address = $2` in `get_latest_loan_snapshot` then
matches byte-for-byte.

### `packages/worker/src/indexer/stellar/poller.rs` (modify)

```rust
pub struct StellarEventPoller {
    rpc: StellarRpc,
    chain_id: i64,
    repo: Arc<EventRepo>,
    contract_logs_repo: Arc<ContractLogsRepo>,                     // NEW
    deposit_manager_id: String,
    withdrawal_queue_id: String,
    staked_plusd_id: String,
    loan_registry_id: Option<String>,                              // NEW
    // Loan-mapper deps; None when loan_registry_id is None.
    loan_fetcher: Option<Arc<dyn LoanMetadataFetcher>>,            // NEW
    loan_immutable: Option<Arc<dyn StellarImmutableDataResolver>>, // NEW
    loan_mutable: Option<Arc<dyn StellarMutableDataResolver>>,     // NEW
}

#[async_trait]
impl ChainEventPoller for StellarEventPoller {
    async fn poll(&self, from: u64, to: u64) -> Result<Vec<Box<dyn LogMapper>>> {
        let mut contract_ids = vec![
            self.deposit_manager_id.clone(),
            self.withdrawal_queue_id.clone(),
            self.staked_plusd_id.clone(),
        ];
        if let Some(id) = &self.loan_registry_id { contract_ids.push(id.clone()); }
        let filter = EventFilter { contract_ids };
        let (raw_events, _latest) = self.rpc.get_events(from, to, &filter).await?;

        let mut mappers: Vec<Box<dyn LogMapper>> = Vec::new();
        for raw in raw_events {
            if let Some(log) = dispatch_parser(
                &raw,
                &self.deposit_manager_id,
                &self.withdrawal_queue_id,
                &self.staked_plusd_id,
                self.loan_registry_id.as_deref(),
            ) {
                if is_loan_event(&log.event_name) {
                    // Construct StellarLoanEventMapper — unwrap the loan deps which
                    // must exist when loan_registry_id is Some (panicking is fine here
                    // since it's a wiring invariant, not an input bug).
                    mappers.push(Box::new(StellarLoanEventMapper::new(
                        log, self.chain_id,
                        self.repo.clone(),
                        self.contract_logs_repo.clone(),
                        self.loan_fetcher.clone().expect("loan_fetcher set with loan_registry_id"),
                        self.loan_immutable.clone().expect("…"),
                        self.loan_mutable.clone().expect("…"),
                    )));
                } else {
                    mappers.push(Box::new(StellarLogMapper::new(log, self.chain_id, self.repo.clone())));
                }
            }
        }
        Ok(mappers)
    }
}

fn is_loan_event(name: &str) -> bool {
    matches!(
        name,
        "LoanDrawn" | "LoanStatusUpdated" | "LoanCCRUpdated" | "LoanLocationUpdated"
            | "LoanDefaulted" | "LoanClosed" | "PaymentRecorded"
            | "LoanRolledOver" | "EconomicsAmended"
    )
}
```

`run_stellar_indexer_job` then constructs the loan-mapper deps once at job start,
mirroring the EVM `run_indexer_job` at `packages/worker/src/indexer/mod.rs:85-95`:

```rust
let contract_logs_repo = Arc::new(ContractLogsRepo::new(pool.clone()));
let (loan_fetcher, loan_immutable, loan_mutable) = if settings.loan_registry_id.is_some() {
    let fetcher: Arc<dyn LoanMetadataFetcher> = Arc::new(HttpLoanMetadataFetcher::new(
        MetadataFetcher::new(reqwest::Client::new(), ipfs_gateway_url),
    ));
    let rpc_arc = Arc::new(StellarRpc::new(&settings.rpc_url));
    let reader = Arc::new(StellarLoanRegistryReader::new(rpc_arc, settings.network_passphrase.clone()));
    (Some(fetcher), Some(reader.clone() as Arc<dyn StellarImmutableDataResolver>),
                    Some(reader as Arc<dyn StellarMutableDataResolver>))
} else { (None, None, None) };
```

`ipfs_gateway_url` is read from `JOB_INDEXER_IPFS_GATEWAY_URL` (same env var the EVM
indexer already uses — defaulting to `https://ipfs.io/ipfs/`) — promoted to a parallel
field on `StellarIndexerSettings` (a small follow-up addition in `config.rs`).

### `packages/worker/src/indexer/stellar/mod.rs`

```rust
pub mod loan_mapper;             // NEW
pub mod loan_registry_parsers;   // NEW
pub mod loan_registry_reader;    // NEW
pub mod mappers;
pub mod parsers;
pub mod poller;
pub mod rpc;

pub use poller::run_stellar_indexer_job;
```

### `.env.example`

Append next to the existing `CHAIN_99000001_STELLAR_STAKED_PLUSD_ID` line:

```env
# Optional — set only after the LoanRegistry contract is deployed to testnet.
# See pipeline-stellar-contracts/deployments/testnet.json for the assigned id.
# CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID=
```

## Implementation Steps

Execute in this order; each step is independently lint-clean and unit-tested.

1. **Config field.** Add `loan_registry_id: Option<String>` to `StellarIndexerSettings`,
   read from `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID`. Extend the distinctness loop. Add
   `ipfs_gateway_url: String` (default `https://ipfs.io/ipfs/`) for the metadata fetcher.
   Tests: extend `packages/worker/tests/stellar_indexer_config.rs` (or wherever the existing
   config tests live; reuse the `ENV_LOCK` pattern) with two cases:
   - `loan_registry_id_unset_yields_none`
   - `loan_registry_id_rejects_duplicate_of_dm`

2. **New parsers.** Create `packages/worker/src/indexer/stellar/loan_registry_parsers.rs`
   with the 9 parsers and the 10 ScVal helpers listed above. Each parser tested in
   `packages/worker/tests/stellar_loan_parsers.rs` against a fabricated base64 XDR
   (constructed in-test via `stellar_xdr::curr::WriteXdr` + `base64::encode`). Cover the
   happy path plus a topic-mismatch `None` case per parser.

3. **Dispatch ladder.** Add the new branch to `dispatch_parser` in
   `packages/worker/src/indexer/stellar/parsers.rs`. Extend the existing dispatcher tests
   with a `loan_registry_branch_routes_to_parsers` case and an
   `unconfigured_loan_registry_id_skips_branch` (i.e. `loan_registry_id = None`).

4. **Stellar loan reader.** Create `packages/worker/src/indexer/stellar/loan_registry_reader.rs`
   with the two resolver traits, the concrete `StellarLoanRegistryReader`, and three pure
   decoder helpers. Tests in `packages/worker/tests/stellar_loan_reader.rs`:
   - `decode_immutable_loan_data_decodes_fabricated_scval`
   - `decode_mutable_loan_data_decodes_fabricated_scval`
   - `decode_cumulative_repayment_data_decodes_fabricated_scval`
   - `call_view_builds_correct_envelope` — verifies the envelope shape with a
     `simulate_transaction` mock (use the `rpc` type without hitting the network —
     wrap the envelope-build logic into a pure helper if needed to test it without
     spinning up a fake server).

5. **Stellar loan mapper.** Create `packages/worker/src/indexer/stellar/loan_mapper.rs`
   with `StellarLoanEventMapper` and the `LogMapper` impl. Lift the four composer helpers
   to public scope in `loan_mapper.rs` if any are currently private (none are — verified).
   Tests in `packages/worker/tests/stellar_loan_mapper.rs`:
   - `loan_drawn_writes_snapshot_with_fetched_metadata` (mocks all three deps)
   - `lifecycle_event_carries_prior_snapshot_forward`
   - `lifecycle_event_refetches_metadata_when_uri_changed`
   - `loan_id_serialised_as_decimal_string` — asserts `params.loan_id == "42"` for a
     `u32 = 42` event, matching the EVM convention.

6. **Poller wiring.** Modify `StellarEventPoller` to carry the new optional fields and
   branch on `is_loan_event` inside `poll`. Modify `run_stellar_indexer_job` to construct
   the loan-mapper deps when `loan_registry_id.is_some()`. No new test file — the existing
   `stellar_indexer_integration.rs` (if present) gains a case that constructs a poller
   with a `None` `loan_registry_id` and verifies it ignores any loan events fed through
   the dispatcher.

7. **`.env.example`** — append the optional `CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID` line.

8. **Lint gates.** `cargo clippy --workspace --all-targets -- -D warnings` clean.
   `cargo nextest run --workspace` green. `npx tsx scripts/lint-docs.ts` green
   (since `.env.example` is touched).

## Test Strategy

All tests are **pure unit tests** — no live network, no DB, no env-gated `DATABASE_URL`
(per the MEMORY rule).

### Unit tests (new files)

| File | Coverage |
|---|---|
| `packages/worker/tests/stellar_loan_parsers.rs` | 9 parsers × 2 cases (happy + topic mismatch) = 18 tests; 10 ScVal helpers × 1 happy-path each = 10 tests. Total ≈ 28 tests. |
| `packages/worker/tests/stellar_loan_reader.rs` | 3 decoders × 1 happy-path = 3 tests; 1 envelope-shape test = 1 test. Total = 4 tests. |
| `packages/worker/tests/stellar_loan_mapper.rs` | 4 mapper flows (LoanDrawn + 3 lifecycle variants). Reuses the trait-mock pattern from `packages/worker/tests/loan_mapper.rs`. Total = 4 tests. |
| `packages/worker/tests/stellar_indexer_config.rs` | Extend with 2 new cases for the new field. |

### Fixture construction policy

The Issue body suggests "fixture base64 XDR captured from `soroban-cli events` (or
constructed in-test via `stellar-xdr`)." **Choose in-test construction** for hermetic
tests: each test builds the `ScVal` via `stellar_xdr::curr::*` types, encodes via
`ScVal::to_xdr_base64(Limits::none())`, hands it to the parser, asserts. No fixture files
checked in. The fixture-capture path is documented in the smoke recipe but not used in
CI. Reason: the contract isn't deployed yet, so a fixture file isn't capturable without
first running the smoke recipe — and once the contract is deployed, the smoke recipe is
the authoritative end-to-end check anyway.

### Regression gates

- EVM `LoanEventMapper` tests under `packages/worker/tests/loan_mapper.rs` continue
  to pass untouched (chain-agnostic composer helpers are unmodified; the alloy-typed
  wrapper is unchanged).
- `packages/worker/tests/stellar_parsers.rs` — extend the existing dispatcher tests
  to include a `loan_registry_id` parameter; cases that didn't supply one still pass
  by passing `None`.

### Smoke recipe (PR description; **deferred** until contract is deployed)

```bash
# Set in .env.local (after testnet deployment lands):
CHAINS=99000001
CHAIN_99000001_TYPE=stellar
CHAIN_99000001_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID=<deployed-C…-id>
# ...all existing CHAIN_99000001_STELLAR_* vars unchanged...
JOB_INDEXER_ENABLED=true

# Bring up the worker:
cargo run -p pipeline_worker

# In another shell, invoke draw_loan against the deployed registry:
stellar contract invoke \
  --id $CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID \
  --source <owner-G…-key> \
  --network testnet \
  -- draw_loan \
    --to <holder-G…-key> \
    --metadata_uri "ipfs://bafy…/loan.json" \
    --economics <ImmutableLoanData JSON> \
    --initial_ccr 1500000 \
    --initial_location <LocationUpdate JSON>

# After one polling cycle, verify:
SELECT chain_id, event_name, params->>'loan_id' AS loan_id,
       params->'snapshot'->>'originator' AS originator
FROM contract_logs
WHERE chain_id = 99000001 AND event_name = 'LoanDrawn'
ORDER BY block_number DESC LIMIT 1;
```

Expected: one `LoanDrawn` row whose `params.snapshot` matches the IPFS metadata document
served at the configured URI. Repeat for one of each lifecycle event; expected behaviour
identical to EVM.

## Risks / open items left for the executor

- **`stellar-xdr` API surface for in-test ScVal construction** — the precise constructors
  for `ScVal::U128(UInt128Parts { hi, lo })`, `ScVal::Address(ScAddress::Contract(...))`,
  `ScVal::Map(Some(ScMap(VecM::try_from(...)?)))`, etc. require some boilerplate. Borrow
  the encoder-side patterns already in `packages/worker/src/stellar/tx.rs::map_entry` and
  `address_account` / `address_contract` to keep tests legible. Budget ~30 min for the
  first fixture, then copy.
- **`MutableLoanData` mapping completeness** — the contract's `MutableLoanData` includes
  fields the EVM analogue's `MutableLoanDataView` does not name identically
  (`next_economics_epochs_id` vs `nextEconomicsEpochsId`, etc.). The Stellar `decode_mutable_loan_data`
  function maps the ScVal-Map field names (snake_case) into the existing camelCase-derived
  Rust struct fields. No struct change required — the projection is alloy-free already.
- **`LocationType` enum mapping** — Stellar emits as `ScVal::Vec([Symbol("Vessel")])`. The
  decoder maps to the existing `LocationType` enum via `LocationType::from_ordinal`
  (`loan_metadata.rs:54-65`) by reverse-lookup of the symbol to the ordinal. Add an
  `as_ordinal` helper if it doesn't exist — verified at planning time, `as_str` does the
  forward direction; add the reverse.
- **`U256` from `u128`** — the view structs hold `alloy::primitives::U256`. Use
  `U256::from(value: u128)` (alloy's `From` impl) — this is the same coupling the EVM
  reader already has and does **not** force the Stellar reader to import alloy beyond
  the U256 type alias. If we want truly-zero alloy in the Stellar reader, swap the view
  field types to `BigDecimal`-or-similar; that's a larger refactor for a future Issue
  and out of scope here. Documented as **TD-20**.

## Rollout / deploy gate notes

- **Merge dark.** The Issue ships before the contract is deployed to testnet. With
  `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID` unset, the new branch in `dispatch_parser` is
  inert and the new mapper code is never constructed.
- **Post-merge follow-up** (file as a separate Issue, blocked-by #620):
  1. Deploy `loan_registry` to Stellar testnet via the contracts repo's `justfile`.
  2. Add `loan_registry: "C…"` to `pipeline-stellar-contracts/deployments/testnet.json`.
  3. Set `CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID=<deployed-id>` in the stage/prod env.
  4. Run the smoke recipe above; paste the resulting `contract_logs` row into the
     follow-up Issue as evidence.
- **No production impact.** Stellar mainnet (`99_000_002`) is not exercised. EVM chains
  are not touched. The migration set is unchanged.
- **EVM regression check.** A local smoke against chain 99999 (existing fixture chain)
  confirms the EVM `LoanRegistryReader` + `LoanEventMapper` path still works byte-for-byte —
  no shared code path was modified, but ship-time confidence costs nothing.

## Acceptance criteria

Lifted from the Issue body, refined where planning surfaced additional precision:

1. With `CHAIN_<stellar_chain_id>_STELLAR_LOAN_REGISTRY_ID` set, the Stellar indexer routes
   the 9 Soroban events (`loan_drawn` / `status_updated` / `ccr_updated` / `location_updated`
   / `loan_defaulted` / `loan_closed` / `payment_recorded` / `loan_rolled_over` /
   `economics_amended`) into `contract_logs` with the 9 stable EVM-aligned `event_name`
   strings (`LoanDrawn` / `LoanStatusUpdated` / `LoanCCRUpdated` / `LoanLocationUpdated` /
   `LoanDefaulted` / `LoanClosed` / `PaymentRecorded` / `LoanRolledOver` /
   `EconomicsAmended`).
2. A `draw_loan` call on the deployed Stellar testnet LoanRegistry produces a
   `contract_logs` row with `event_name = 'LoanDrawn'`, `params.loan_id` (decimal string),
   `params.event.holder` (Strkey G…), `params.event.metadata_uri` (URI), and
   `params.snapshot` populated with originator / borrower_id / commodity / corridor / etc.
   from the off-chain metadata document. (Deferred until deployment — see Rollout.)
3. `list_latest_loan_snapshots_for_chain(stellar_chain_id, to_unix)` returns the new loan
   with all snapshot fields populated, **with no SQL change** — the existing query
   filters on the same 9 `event_name` strings on any `chain_id`.
4. `cargo clippy --workspace --all-targets -- -D warnings` clean;
   `cargo nextest run --workspace` green.
5. New unit tests cover all 9 Stellar event decodings, the 10 ScVal helpers, the 3 reader
   view projections, and the 4 mapper flows (LoanDrawn + 3 lifecycle variants including
   metadata-URI re-fetch).
6. EVM LoanRegistry indexer behaviour unchanged on a smoke run against the existing local
   fixture (chain 99999) — verified by `cargo test -p pipeline_worker loan_mapper` passing
   against the unmodified EVM tests.

## Docs to Update

- `.env.example` — append the optional `CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID` line
  (Implementation Step 7).
- `docs/exec-plans/tech-debt-tracker.md` — open **TD-19** (Stellar simulate is
  current-state-only; lifecycle reads not block-pinned) and **TD-20** (Stellar reader
  imports alloy `U256` only for view-struct field types).
- This exec plan stays in `docs/exec-plans/active/` until the PR merges; the manager
  moves it to `completed/` on close.
- **No product spec update.** This is worker-internal infrastructure for a contract that
  already has an EVM-side spec. No user-facing behaviour change in the API.
