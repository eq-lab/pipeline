# Issue #1433: Stellar indexer silently drops every LoanDrawn and LoanDefaulted against current contracts

Source: https://github.com/eq-lab/pipeline/issues/1433

Parent epic: #1431. Sibling: #1434 (EVM arm). Blocked on #1432, which **has landed**
(`9133dc73` on `main`; plan archived at
`docs/exec-plans/completed/issue-1432-shared-loan-data-model.md`).

No Figma reference is attached to this Issue or to #1431 — it is backend-only, so no
Figma-driven verification step applies.

## Ground truth (read from the contract repo, not the Issue body)

Verified 2026-10-08 against `/Users/aabliazimov/Documents/work/pipeline-stellar-contracts`
at `e7c5b47` ("Updated contracts testnet deployment (#36)").

`contracts/loan-registry/src/event.rs` — every claim in the Issue body confirmed:

| Event | topics | data |
|---|---|---|
| `LoanDrawn` | `["loan_drawn", loan_id: u32]` — **2 topics, no `holder`** | `metadata_uri: String` |
| `StatusUpdated` | `["status_updated", loan_id, new_status: LoanStatus]` | — |
| `Disbursed` | `["disbursed", loan_id]` | `amount: u128, outstanding: u128` |
| `Undisbursed` | `["undisbursed", loan_id]` | `amount: u128, outstanding: u128` |
| `PaymentRecorded` | `["payment_recorded", loan_id, repayment_id]` | `repayment: RepaymentData, outstanding: u128` |
| `PaymentUnrecorded` | `["payment_unrecorded", loan_id, repayment_id]` | `repayment: RepaymentData, outstanding: u128` |
| `LoanDefaulted` | `["loan_defaulted", loan_id]` | `outstanding: u128, moved: u128` — **no `ccr`** |
| `LoanWrittenDown` | `["loan_written_down", loan_id]` | `amount, outstanding, burned, unabsorbed` (4 × u128) |
| `InterestAdjusted` | `["interest_adjusted", loan_id]` | `delta: i128, reason_hash: BytesN<32>` |
| `InterestSettled` | `["interest_settled", loan_id]` | `accrued, paid, waived` (3 × u128) |
| `LoanClosed` | `["loan_closed", loan_id, reason: ClosureReason]` | — |
| `LoanRolledOver` | `["loan_rolled_over", loan_id]` | `new_rate: u32, new_maturity_timestamp: u64` |
| `EconomicsAmended` | `["economics_amended", loan_id]` | `new_rate: u32, new_maturity_timestamp: u64` |

No `CcrUpdated`. No `LocationUpdated`. Four admin events also exist (`MinterSet`,
`CapitalWalletSet`, `MaxFeeBpsSet`, `MaxResidualSet`) — none carries a `loan_id`.

`contracts/minter/src/event.rs` — no `yield_minted` event. The Minter's 20 events are
wire/cash/ramp/limit events; `WireIn` and `WireInAssigned` are the two already indexed.

`contracts/loan-registry/src/types.rs`:

```rust
pub struct ImmutableLoanData {
    pub borrower_ref: BytesN<32>,        // sha256 of the borrower's data-room id
    pub original_facility_size: u128, pub original_senior_tranche: u128,
    pub original_equity_tranche: u128, pub original_offtaker_price: u128,
    pub senior_interest_rate: u32, pub origination_date: u64, pub original_maturity_date: u64,
}
pub struct MutableLoanData {
    pub next_economics_epochs_id: u32, pub next_repayment_id: u32,
    pub status: LoanStatus, pub current_maturity_timestamp: u64,
    pub current_rate: u32, pub closure_reason: ClosureReason,
    pub metadata_uri: String, pub disbursed: u128, pub repaid: u128,
    pub written_down: u128, pub carved_out: bool, pub interest_adjustment: i128,
}
```

Enum variant order matches `loan_mapper.rs` exactly (`Approved..Closed`,
`None..OtherWriteDown`) — the reader's symbol→ordinal maps at
`stellar/loan_registry_reader.rs:225-230` and `:246-253` are **already correct**
(#1432 fixed them). Do not touch them.

`cumulative_repayment_data(loan_id)` **still exists** (`contracts/loan-registry/src/lib.rs:714`)
and still returns the 7-field `RepaymentData` — it is assembled on the fly from the
6-field `RepaymentTotals` plus `MutableLoanData.repaid` as `senior_principal_repaid`.
So `decode_cumulative_repayment_data` stands unchanged, and the shared
`MutableDataResolver::cumulative_repayment_data` trait method stays honest on this arm.
(The EVM arm has no such getter — that is #1434's problem, not ours.)

## Findings that correct or extend the Issue body

**F1 — `current_rate` scale confirmed, independently of the #1434 comment.**
`contracts/loan-registry/src/lib.rs:30` declares `pub const ONE: u128 = 1_000_000;`.
`current_rate` is assigned straight from `economics.senior_interest_rate` (`lib.rs:102`),
is copied verbatim into an epoch's `senior_interest_rate` (`storage.rs:292`), and that
value is divided by `ONE` in the accrual formula (`storage.rs:269`:
`elapsed * rate * outstanding / (YEAR * ONE)`). `current_rate` therefore carries the
**identical** scale to `senior_interest_rate` and needs the **same `/100`** the reader
already applies at `:187-193`. This matches the doc comment #1432 left on
`MutableLoanDataView.current_rate` (`worker/src/indexer/loan_metadata.rs`), which
already instructs each arm to divide by 100.

**F2 — a third registration site the Issue body does not mention:
`stellar/poller.rs:40`.** The body is right that the dispatch ladder is in
`stellar/parsers.rs:576-585` and not in `poller.rs`. But `poller.rs` carries a separate
`is_loan_registry_event(event_name: &str)` allowlist (`:40-54`) listing the nine stored
event names, used at `:185` to branch between `LoanEventMapper` (which builds a
snapshot) and `StellarLogMapper` (which does not). **A stored event name missing from
that list writes a `contract_logs` row with no snapshot and no error** — the same class
of silent defect this Issue exists to fix. Every name added or removed must be mirrored
here.

**F3 — five SQL `event_name IN (…)` allowlists in `shared/contract_logs_repo.rs` are
load-bearing for any newly indexed event.** `:273`, `:341`, `:423`, `:489` and `:983`
each select loan-lifecycle rows ordered `block_number DESC, log_index DESC` to find the
**latest** snapshot per loan — `list_latest_loan_snapshots`, `..._for_chain`,
`get_loan_snapshot_as_of`, `latest_status_by_loans`, and `get_latest_loan_snapshot`
(the last of which the indexer's own carry-forward path calls at
`loan_mapper.rs:388`). A newly indexed event name absent from these lists means its
snapshot is written but never read as "latest": the loan book silently serves the
previous event's figures. This is the dominant cost of indexing each new event, and it
drives decision **D1**.

**F4 — the `.env` contract ids are identifiable, contrary to the Issue body: they are
the #26 testnet deployment.** `git show c834c37:deployments/networks/testnet/addresses.json`
(commit `c834c37`, "Update deployment justfile; new testnet deployment (#26)",
2026-07-06) lists exactly the two ids the local `.env` configures:

| `.env` key | configured | deployment generation |
|---|---|---|
| `CHAIN_99000001_STELLAR_LOAN_REGISTRY_ID` (`.env:206`) | `CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH` | `loan_registry`, #26 (`c834c37`) |
| `CHAIN_99000001_STELLAR_YIELD_MINTER_ID` (`.env:177`, `:207`) | `CBAHV27X6LNFR6QC6TYVMFSKF6EWHWS66Q7N7WOKTGPDVRI4UL3CFUM6` | `yield_minter`, #26 (`c834c37`) |

`c834c37` (#26) is a verified ancestor of `f284509` (#32, the LoanRegistry rework,
2026-09-24) — `git merge-base --is-ancestor` returns true. So **by address identity the
configured contracts are pre-rework**, the existing parsers match them, and the data
loss is **latent on today's `.env`, not active**. The #36 deploy (`e7c5b47`) issued new
ids (`CDWN5B3F…` / `CAPL5WN3…`).

**This does not close the question, and the Issue body's caution is right for a reason
it does not name:** `LoanRegistry` implements `stellar_contract_utils::upgradeable::Upgradeable`
with a live `fn upgrade(e, new_wasm_hash, _operator)` at
`contracts/loan-registry/src/lib.rs:956` (the Minter likewise at `lib.rs:970`). A
Soroban contract upgraded in place keeps its id. So `CDYKALTK…` carrying post-#32 WASM
is possible and **cannot be ruled out from either repo**. See **Step 0** for the live
check and **Open Question Q1**.

**F5 — retiring `parse_yield_minted` stops indexing the contract `.env` actually names.**
Per F4, `CHAIN_99000001_STELLAR_YIELD_MINTER_ID` points at the #26 **`yield_minter`**,
not the #36 **`minter`**, and `CHAIN_99000001_RELAYER_STELLAR_YIELD_MINTER_ID` (`.env:208`)
targets the same id as the relayer's `mint_yield` destination. So the relayer is still
minting against a contract whose `yield_minted` event this change would stop decoding —
`contract_logs_repo::list_yield_mints` (`:673`) and `minted_yield_for_loan` (`:725`) read
exactly those rows for the Protocol Dashboard's cumulative yield and the loan-financials
yield attribution. Historical rows keep working; new ones stop appearing. See **Q2**.

**F6 — the stale minter-branch comment is doubly wrong.** `stellar/parsers.rs:588-597`
asserts "the minter has never been deployed". The #36 deployment lists
`minter: CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK`, so it has. And its
claim that "`YieldMinted` comes from a pre-#33 deployment; `WireIn`/`WireInAssigned`
from a post-#33 one. No deployment emits both" is correct but becomes moot once
`parse_yield_minted` goes. Rewrite the comment rather than leave the contradiction.

**F7 — `holder` has no production consumer.** `grep` for `"holder"` across `packages/`
finds it only in the EVM parser (`indexer/parsers.rs:180`, #1434's scope) and two tests
(`worker/tests/parsers.rs:279`, `worker/tests/stellar_loan_parsers.rs:237`), plus an
`audit_log` test fixture that passes it but never projects it (`format_action("LoanDrawn", …)`
ignores it). Dropping it from Stellar `LoanDrawn` params is safe.

**F8 — `new_rate` on `LoanRolledOver` / `EconomicsAmended` is `ONE`-scaled and stored
raw.** `storage.rs:344` assigns `mutable.current_rate = new_rate`, so the event's
`new_rate` is the same `ONE = 1_000_000` fixed-point value — yet
`parse_loan_rolled_over` and `parse_economics_amended` write it into `params` with no
conversion, and `audit_log.rs` projects it verbatim into the Trustee feed's `details`.
A 10% rate renders as `100000`. **Out of scope** (it is a `params` value, not a snapshot
field; changing the stored shape has its own back-compat question and touches two events
this Issue is not otherwise reshaping) — record the unit in each parser's doc comment and
log it as tech debt. See **Docs to Update**.

**F9 — `docs/product-specs/loans-data.md:143-158` "Key events" is v1 design-era drift,
not rework drift.** It lists `LoanMinted`, `LoanStatusChanged`, `MetadataUpdated` and a
flat 8-arg `PaymentRecorded` — names the indexer has never used on either arm, alongside
the deleted `LocationUpdated`. Rewriting a v1 design section is out of scope for a
parser-realignment bug fix; log it as tech debt.

**F10 — name collision to avoid.** `LoanBookEntry.disbursed` on the API is an existing
**off-ramp-complete boolean flag** (`docs/product-specs/trustee-dashboard.md:172`), while
`LoanSnapshot.disbursed` added by #1432 is a **u128 cumulative amount**. Different
concepts, same word. Do not wire one into the other.

**F11 — `map_i128` must reuse the existing helper, not restate its arithmetic.**
Step 10 proposes `((parts.hi as i128) << 64) | (parts.lo as i128)`. That expression already
exists, character for character, as `i128_from_parts` in
`packages/worker/src/stellar/scval.rs:20`, backing the `extract_i128` this very parser
module re-exports. It is private (`fn`, not `pub fn`). Make it `pub` and call it; do not
write the shift/or a third time. (`u128_from_parts` is already duplicated between
`loan_registry_parsers.rs:521` and `parsers.rs:492` — that is the pattern to stop
repeating, and worth folding into the same step while the file is open.)

**F12 — the Trustee audit feed renders every amount at base-6, which is wrong on Stellar
by 10x — and Step 12 would widen that fivefold.**
`api/src/routes/audit_log.rs:207` formats amounts via `param_amount` →
`base6_to_decimal_string` (`:40`), i.e. it assumes 6 decimals unconditionally. The route
resolves a `chain_id` (`:138`) but carries **no** chain-kind awareness — `grep` for
`ChainKind` / `normalize_usdc_amount` in that file returns nothing. Stellar's Soroban
contracts store monetary fields at the native USDC-SAC scale of 7 decimals
(`shared/src/chains.rs:46-57`, issue #901), so a $1,000 payment renders as $10,000.

This is **pre-existing**, not introduced here: `:224-225` already reads
`senior_interest` / `senior_principal_repaid` from Stellar `PaymentRecorded` rows this
way. It is also **live**, because `.env` currently runs `CHAINS="99000001"` — a
Stellar-only deployment — so every amount in today's audit feed is 10x high.

Step 12 adds five amount-bearing events (`Disbursed`, `Undisbursed`, `PaymentUnrecorded`,
`LoanWrittenDown`, `InterestAdjusted`) to exactly this surface. Landing it as planned
multiplies a known-wrong rendering rather than fixing it. Note this is the same class as
**F8** (the `ONE`-scaled `new_rate` rendered raw) — F8 caught the rate scale and missed the
amount scale.

**Resolution:** do not silently widen it. Either make `param_amount` chain-aware
(`normalize_usdc_amount(kind, …)` before `base6_to_decimal_string`, which needs the route to
resolve `ChainKind` from the already-resolved `chain_id`) as part of Step 12, or hold Step 12
entirely until a separate issue fixes the scale — in which case the five parsers still land
and only the audit surface waits. This is a Q3 input: the answer changes what Step 12 costs.

## Scope

### In scope

`packages/worker/src/indexer/stellar/loan_registry_parsers.rs`:

1. `parse_loan_drawn` — two-topic form; drop the `holder` read and the `holder` param.
2. `parse_loan_defaulted` — `outstanding` / `moved`; drop `ccr` ÷ 100 and `ccr_bps`.
3. `parse_payment_recorded` — capture `outstanding` alongside the flattened `RepaymentData`.
4. Delete `parse_ccr_updated` and `parse_location_updated`, and the now-unused
   `extract_string` helper if nothing else calls it.
5. Add five new parsers per **D1**.

`packages/worker/src/indexer/stellar/parsers.rs`:

6. Delete `parse_yield_minted`; fix the imports at `:18-20` and the two dispatch-ladder
   branches at `:576-597`; rewrite the stale minter comment (F6).

`packages/worker/src/indexer/stellar/poller.rs`:

7. `is_loan_registry_event` (`:40`) — mirror the stored-name set (F2).

`packages/worker/src/indexer/stellar/loan_registry_reader.rs`:

8. `decode_immutable_loan_data` — decode `borrower_ref`.
9. `decode_mutable_loan_data` — decode the six placeholder fields; `current_rate / 100`.
10. New decoder primitives: `map_bool`, `map_i128`, `map_bytes32`.

`packages/shared/src/contract_logs_repo.rs`:

11. Add the five new stored names to all five allowlists (F3). **Keep** every legacy name.

`packages/api/src/routes/audit_log.rs`:

12. Shape-tolerant `LoanDefaulted` projection (`:277`) — **D4**.

`packages/worker/src/indexer/config.rs` + `.env.example`:

13. Correct the `yield_minter_id` doc comments to stop promising `YieldMinted`.

`ARCHITECTURE.md`, `docs/product-specs/audit-logging.md`,
`docs/exec-plans/tech-debt-tracker.md`, `docs/exec-plans/known-bugs.md` — see
**Docs to Update**.

Tests: `packages/worker/tests/stellar_loan_parsers.rs`,
`packages/worker/tests/stellar_loan_reader.rs` — see **Test Strategy**.

### Out of scope

- **Any EVM-arm file** — `indexer/parsers.rs`, `evm_parsers.rs`,
  `indexer/loan_registry_reader.rs`. #1434 owns all three, including the EVM
  `parse_yield_minted` at `parsers.rs:342` / `evm_parsers.rs:125`.
- Repointing `.env` at the #36 deployment. The local `.env` is not in the repo and
  changing which contracts run is an operational decision — see **Q1/Q2**.
- `InterestSettled` and the four admin events (**D1**).
- `shared::collateral_valuation::ccr_bps`, `ccr_history.rs`, `loan_book.rs` CCR — the
  product's CCR is computed off-chain and was never touched by the rework.
- `new_rate` unit normalization (**F8**) and `loans-data.md`'s v1 event block (**F9**) —
  both logged as tech debt instead.
- `docs/references/smart-contracts.md`, which documents the v2.3 *designed* EVM contract
  (`updateCCR`, `updateLocation`, `ccrBps`, `location`) rather than either shipped repo.
  Realigning a 1,600-line design reference is its own Issue.
- `LoanSnapshot` JSONB back-compat — settled in #1432 (TD-124: roll the API before the
  worker).

## Decisions

**D1 — index five of the six new events now; defer `InterestSettled`.**

Index: `Disbursed`, `Undisbursed`, `PaymentUnrecorded`, `LoanWrittenDown`,
`InterestAdjusted`. Defer: `InterestSettled`.

The line is drawn on a single test: *does the event mutate a field that #1432 added to
`LoanSnapshot`?*

- `Disbursed` / `Undisbursed` mutate `MutableLoanData.disbursed`.
- `PaymentUnrecorded` mutates `repaid` and the cumulative repayment totals.
- `LoanWrittenDown` mutates `written_down`.
- `InterestAdjusted` mutates `interest_adjustment`.
- `InterestSettled` mutates **nothing** — it is a closure-time breakdown
  (`accrued`, `paid`, `waived`) of values already derivable, and the contract emits
  `LoanClosed` in the same call, which already triggers a snapshot. Indexing it would add
  a second snapshot row at the same ledger carrying identical state.

This is not a nicety. #1432 put `disbursed`, `written_down` and `interest_adjustment` on
the persisted snapshot and Step 9 below makes them real. If the events that change them
are not indexed, each field is decoded correctly once and then goes stale until some
unrelated lifecycle event happens to fire — a worse failure than the zero placeholders
TD-123 describes, because the value looks plausible. The five are mechanical additions
on an established pattern; the cost is F3's five allowlists and two extra
`simulateTransaction` calls per occurrence (`mutable_loan_data` +
`cumulative_repayment_data`, via `snapshot_for_lifecycle`).

The four admin events (`MinterSet`, `CapitalWalletSet`, `MaxFeeBpsSet`,
`MaxResidualSet`) are excluded outright: none carries a `loan_id`, so
`loan_mapper::extract_loan_id` (`:53-66`) would error on every one.

**Parity instruction for #1434:** apply the same test. The five EVM equivalents land
there; `InterestSettled` is deferred on both arms or neither. Record the stored event
names from **D1a** so the two arms write one name set.

**D1a — stored `event_name` values.** Follow the existing convention: PascalCase, EVM
spelling where one exists, and the `Loan`-prefixed remap only where the file already does
it (`status_updated` → `LoanStatusUpdated`). New names, matching the contract's own
struct names so #1434 can mirror them without a lookup table:

| Soroban topic | stored `event_name` |
|---|---|
| `disbursed` | `Disbursed` |
| `undisbursed` | `Undisbursed` |
| `payment_unrecorded` | `PaymentUnrecorded` |
| `loan_written_down` | `LoanWrittenDown` |
| `interest_adjusted` | `InterestAdjusted` |

**D2 — `current_rate` is divided by 100 to reach basis points.** Verified in **F1**
against the contract implementation (not the interface): `ONE = 1_000_000`. Carry the
existing `senior_interest_rate` comment's reasoning onto `current_rate` and name
`lib.rs:30` / `lib.rs:102` / `storage.rs:269,292` in it so the next rename cannot erase
the unit again.

**D3 — every read-side legacy event name stays.** `LoanCCRUpdated`,
`LoanLocationUpdated` and `YieldMinted` are removed from the **write** path only. They
remain in `shared/contract_logs_repo.rs`'s five snapshot allowlists and its two yield
queries, in `audit_log.rs`'s `AUDIT_EVENT_NAMES` and `format_action`, and in
`docs/product-specs/audit-logging.md`. Rationale: rows bearing those names were written
by the pre-rework parsers and still sit in `contract_logs`. Stripping the names from the
read side would make historical audit entries vanish from the Trustee feed and would
drop pre-rework rows out of the "latest snapshot" ordering — a retroactive data loss
committed while fixing a data loss. The EVM arm also still produces all three until
#1434 lands.

**D4 — the `LoanDefaulted` audit projection becomes shape-tolerant, not replaced.**
`audit_log.rs:277` currently emits `json!({ "ccr_bps": params.get("ccr_bps") })`. Per
#1432's finding F5 this renders `null` once the parser stops writing `ccr_bps`. Project
`outstanding` and `moved` when present and fall back to `ccr_bps` otherwise, so legacy
rows keep rendering (**D3**). Concretely: emit the keys that exist rather than a fixed
three-key object with nulls.

**D5 — the five new events join the Trustee audit feed.** They are loan-lifecycle events,
which is exactly what `AUDIT_EVENT_NAMES` is for, and the feed is the only surface where
a disbursement or a write-down becomes visible to a human. This means `AUDIT_EVENT_NAMES`
(`audit_log.rs:48`), a `format_action` arm per event, and the
`docs/product-specs/audit-logging.md:66` event list. Proposed copy, to be confirmed —
see **Q3**: "Disbursed", "Disbursement reversed", "Payment reversed", "Loan written
down", "Interest adjusted".

**D6 — `holder` is dropped from `LoanDrawn` params with no replacement.** Safe per **F7**.
Note it in the parser's doc comment: the contract no longer emits it, and the loan's
holder is reachable from the snapshot chain.

## Assumptions and Risks

- **A1.** #1432 is on `main` at `9133dc73`; `MutableLoanDataView` / `ImmutableLoanDataView`
  / `LoanSnapshot` carry the post-rework field set and `loan_mapper.rs`'s name tables are
  canonical on the post-rework ordinals. Verified by reading
  `worker/src/indexer/loan_metadata.rs` and `loan_mapper.rs:32-50`.
- **A2.** The Stellar reader is key-addressed (map lookup by field name), so the
  `MutableLoanData` field-order difference from EVM is irrelevant here. Verified: every
  decode goes through `map_entry(map, key)`.
- **R1 — the live contract's generation is unverified (Q1).** If `CDYKALTK…` was upgraded
  in place to post-#32 WASM, the data loss is active today and `contract_logs` is already
  missing `LoanDrawn` rows for drawn loans; the realignment then also needs a resync
  decision for the gap. If it was not, this ships as a latent fix. **Step 0 settles it
  before any code is written** — the branch of R1 changes what else the Issue must do,
  not just its urgency.
- **R2 — the fix is the inverse of the bug against the *currently configured* contract.**
  Per F4 the configured LoanRegistry is pre-rework, so after this change the parsers stop
  matching it: three-topic `loan_drawn`, `Map { ccr }` defaults and `ccr`-bearing
  `mutable_loan_data` all cease to decode. This is the epic's accepted decision 2
  ("parsers are rewritten against the current ABI, not pinned to the old deployment") and
  mirrors the Hoodi breakage accepted in #1434. But it means **`.env` must be repointed to
  the #36 deployment for the Stellar arm to index anything at all after this lands** — a
  deploy-coordination item, not a code one. See **Q2**.
- **R3 — `interest_adjustment` is the first signed value on this path.**
  `i128_from_parts` is private to `worker/src/stellar/scval.rs:21`; the new `map_i128`
  must sign-extend `hi` correctly. A negative waiver decoded as a huge positive is
  silent. Covered by a dedicated negative-value test.
- **R4 — adding event names without F3's allowlists is a silent regression.** Steps 7 and
  11 are not optional bookkeeping; a new name present in the parser but absent from
  `poller.rs:40` or the five SQL lists produces exactly the class of invisible defect this
  Issue fixes. Both are called out in Test Strategy.
- **R5 — snapshot RPC load grows.** Five new indexed event names each cost two
  `simulateTransaction` calls plus a conditional IPFS check per occurrence
  (`loan_mapper.rs:380-450`). `Disbursed` and `PaymentRecorded`/`PaymentUnrecorded` are
  the high-frequency ones. Acceptable at current loan volume; if it bites, the mitigation
  is batching in the mapper, not dropping the events.
- **R6 — conflict window with #1434 on three shared files.** `ARCHITECTURE.md:64`,
  `shared/contract_logs_repo.rs` and `api/src/routes/audit_log.rs` are edited by both
  Issues. Make every edit idempotent (if a name is already gone, or already present,
  leave it) and expect to rebase whichever lands second.

## Open Questions

- **Q1 — ANSWERED: the configured LoanRegistry `CDYKALTK…` is running pre-rework WASM.
  It was NOT upgraded in place. Step 0 is discharged; no backfill is needed.**

  Settled by querying the live contract rather than inferring it:

  ```
  stellar contract info interface --id CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH --network testnet
  ```

  The deployed interface exposes `fn set_default(env, loan_id: u32, ccr: u32)` — the `ccr`
  parameter exists **only** pre-rework; post-rework is `set_default(e, loan_id)`
  (`contracts/loan-registry/src/lib.rs:428`). It also lacks `loan_money`, `disburse` and
  `write_down`, all three of which post-rework declares. Combined with F4's address
  identity (the #26 deploy, a verified ancestor of the #32 rework), the generation is
  pinned from both directions.

  **Consequence:** the `LoanDrawn` / `LoanDefaulted` data loss this Issue describes is
  **latent, not active** — today's parsers match today's deployed contract. This Issue
  realigns the arm *ahead of* repointing `.env`, and nothing has been silently dropped on
  the configured deployment. The Issue body's framing of an in-flight outage is wrong, and
  `docs/exec-plans/known-bugs.md` needs no entry. It also sharpens Q2: once this lands, the
  arm decodes **only** the #36 contracts, so the `.env` repoint is what activates it.
- **Q2 — RESOLVED: out of scope. No config work in this Issue.**

  The premise was partly wrong: `.env` is gitignored (`.gitignore:27`) and never committed,
  so repointing it is an operational step, not a code change. User's call: this Issue does
  not touch the config topic at all — no `.env.example` edits, no separate issue.

  Recorded so it is not a surprise later, not as work: once this lands, the Stellar arm
  decodes **only** the #36 contracts, while the configured ids are the #26 generation (F4,
  Q1). The arm therefore indexes nothing until whoever runs the worker repoints their
  environment. Three consumers share that move — the indexer, the relayer
  (`RELAYER_STELLAR_LOAN_REGISTRY_ID`) and the frontend's `draw_loan` target
  (`VITE_STELLAR_LOAN_REGISTRY_ID`, which unlike the others does live in the tracked
  `.env.example:349`). Owned by whoever runs the deployment.

- **Q3 — RESOLVED: index all five and make the audit feed's amounts chain-aware.**

  Both halves approved. The five events (`Disbursed`, `Undisbursed`, `PaymentUnrecorded`,
  `LoanWrittenDown`, `InterestAdjusted`) land in the Trustee audit feed, **and** F12's
  scale defect is fixed in the same step rather than widened.

  So Step 12 additionally makes `param_amount` (`api/src/routes/audit_log.rs:207`)
  chain-aware: resolve `ChainKind` for the already-resolved `chain_id` (`:138`) and apply
  `shared::chains::normalize_usdc_amount` before `base6_to_decimal_string`. That also
  repairs the existing 10x overstatement on Stellar `PaymentRecorded` rows — live today,
  since `.env` runs `CHAINS="99000001"`.

  Test consequence: the audit-log tests need a Stellar-chain case asserting a 7-decimal
  raw amount renders at its true value, not 10x. Without that assertion the fix is
  unverified, and this is precisely the class of defect the #1432 rounds kept missing.

  `InterestSettled` stays deferred per D1 — it mutates no `LoanSnapshot` field.

## Implementation Steps

**Step 0 — settle Q1 before writing code.** Against Soroban testnet RPC, simulate
`mutable_loan_data(loan_id)` on `CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH`
for any existing loan id and inspect the returned map's keys. `ccr` /
`last_reported_ccr_timestamp` / `current_location` present ⇒ pre-rework, the defect is
latent. `current_rate` / `carved_out` / `interest_adjustment` present ⇒ upgraded in place,
the defect is active and `contract_logs` has a `LoanDrawn` gap. If RPC access is not
available, record that and hand Q1 back rather than assuming. Write the answer into this
plan's **Findings** section and, if active, log the indexing gap in
`docs/exec-plans/known-bugs.md` with the loan ids affected.

**Step 1 — `parse_loan_drawn`** (`stellar/loan_registry_parsers.rs:27`). Relax the guard
to `len() < 2`; delete the `extract_address_topic` call at `:36` and the `holder` param at
`:48`; update the doc comment to `topics: [loan_drawn, loan_id: u32]` and note per **D6**
that `holder` is gone from the contract. If `extract_address_topic` (`:452`) and
`extract_string` (`:330`) end up with no callers, delete them too — `extract_string`'s doc
comment references `LocationUpdated` specifically.

**Step 2 — `parse_loan_defaulted`** (`:155`). Replace the `ccr` read with
`extract_u128_from_map(&raw.value_base64, "outstanding")?` and `"moved"`; emit both as
decimal strings (`u128` → `.to_string()`, the file's convention for u128). Drop `ccr_bps`
and the whole `ONE`/bps paragraph from the doc comment.

**Step 3 — `parse_payment_recorded`** (`:217`). Add
`extract_u128_from_map(&raw.value_base64, "outstanding")?` and an `"outstanding"` param
alongside the seven flattened `RepaymentData` fields. Update the `value:` line of the doc
comment to `Map { repayment: RepaymentData, outstanding: u128 }`.

**Step 4 — delete the dead parsers.** Remove `parse_ccr_updated` (`:87`) and
`parse_location_updated` (`:119`) from `loan_registry_parsers.rs`. Remove
`parse_yield_minted` (`stellar/parsers.rs:231`).

**Step 5 — add the five new parsers** (**D1**, **D1a**) in `loan_registry_parsers.rs`,
each following the established shape (name guard → topic-length guard → topic decodes →
map decodes → `StellarLog` with `synthesise_log_index`), with a doc comment carrying the
verbatim `topics`/`data` lines from the contract:

| fn | guard | params (all u128/i128 as decimal strings) |
|---|---|---|
| `parse_disbursed` | `len() < 2` | `loan_id`, `amount`, `outstanding` |
| `parse_undisbursed` | `len() < 2` | `loan_id`, `amount`, `outstanding` |
| `parse_payment_unrecorded` | `len() < 3` | `loan_id`, `repayment_id`, the 7 flattened `RepaymentData` fields, `outstanding` |
| `parse_loan_written_down` | `len() < 2` | `loan_id`, `amount`, `outstanding`, `burned`, `unabsorbed` |
| `parse_interest_adjusted` | `len() < 2` | `loan_id`, `delta` (signed, decimal string), `reason_hash` (lowercase hex) |

`parse_payment_unrecorded` reuses `extract_repayment_data_from_map`. `parse_interest_adjusted`
imports `extract_i128_from_map` (`stellar/parsers.rs:440`) and `extract_bytes32_from_map`
(`:473`) — a plain `use` from the sibling module, exactly as `StellarLog` and
`synthesise_log_index` are already imported at `loan_registry_parsers.rs:18-19`. The
"circular dependency" note at `:450` is about an older arrangement; Rust permits mutual
intra-crate module imports, so do not re-duplicate the helpers.

**Step 6 — the dispatch ladder and imports** (`stellar/parsers.rs`). In the import block
at `:17-21`, drop `parse_ccr_updated` and `parse_location_updated`, add the five new ones.
In the `loan_registry_id` branch (`:576-585`) drop the two dead `.or_else` links, add the
five, and fix the "all 9 events" comment to the new count. In the `yield_minter_id` branch
(`:586-597`) drop `parse_yield_minted` from the chain and rewrite the comment per **F6**:
the Minter *is* deployed (`CAPL5WN3…` in the #36 deployment), `YieldMinted` is retired, and
the warn-on-`None` path now means only that a `wire_in` / `wire_in_assigned` encoding
differs from what the parsers expect.

**Step 7 — `is_loan_registry_event`** (`stellar/poller.rs:40`, **F2**). Remove
`"LoanCCRUpdated"` and `"LoanLocationUpdated"`; add the five **D1a** names. Update the doc
comment at `:35-39` — it says "all 9 events" and cites "the exec plan's event table";
point it at this plan.

**Step 8 — `decode_immutable_loan_data`** (`stellar/loan_registry_reader.rs:160`). Decode
`borrower_ref` via a new `map_bytes32` into `Some(FixedBytes::<32>::from(bytes))`; delete
the `// #1433:` marker and the `borrower_ref: None` placeholder. `None` must remain
reachable only as "not decoded" — a genuinely all-zero on-chain `BytesN<32>` decodes to
`Some(FixedBytes::ZERO)`, which is the distinction the field's doc comment promises.

**Step 9 — `decode_mutable_loan_data`** (`:213`). Replace all six `// #1433:` placeholders
with real decodes:

- `current_rate`: `map_u32(&map, "current_rate", "MutableLoanData")? / 100` — **D2**, with
  the scale comment naming `lib.rs:30`, `lib.rs:102`, `storage.rs:269` and `storage.rs:292`.
- `carved_out`: new `map_bool`.
- `disbursed` / `repaid` / `written_down`: `U256::from(map_u128(…)?)`.
- `interest_adjustment`: new `map_i128`, lifted with
  `alloy::primitives::I256::try_from(i128_value)`.

Leave the `status` and `closure_reason` symbol maps alone — already correct (#1432).

**Step 10 — new decoder primitives** (`stellar/loan_registry_reader.rs`, alongside
`map_u128` at `:313`):

- `map_bool` — `ScVal::Bool(v)`.
- `map_i128` — `ScVal::I128(parts)` reconstructed as `((parts.hi as i128) << 64) | (parts.lo as i128)`
  (`hi` is `i64`, so the cast sign-extends; `lo` is `u64` < 2^64 so the `or` is safe).
  Mirror `worker/src/stellar/scval.rs:21`.
- `map_bytes32` — `ScVal::Bytes(b)` with a `b.0.len() == 32` check, `bail!` otherwise.

**Step 11 — the five SQL allowlists** (`shared/contract_logs_repo.rs:273, 341, 423, 489, 983`,
**F3**). Add the five **D1a** names to each. **Keep every existing name** (**D3**). All
five lists must end up identical; a divergence between them is a bug.

**Step 12 — the API audit surface** (`api/src/routes/audit_log.rs`). Make the
`LoanDefaulted` projection at `:277` shape-tolerant per **D4**. Subject to **Q3**: add the
five names to `AUDIT_EVENT_NAMES` (`:48`) and a `format_action` arm each per **D5**.

**Step 13 — config doc comments.** `worker/src/indexer/config.rs:38-47` and
`.env.example:182-183`: drop the `YieldMinted` promise, keep the key itself, and state that
one id serves the Minter's `WireIn`/`WireInAssigned` for the relayer's wire-in matching
(#1416, #1417). Per **F5/Q2**, note that the Protocol Dashboard's cumulative-yield metrics
now read historical `YieldMinted` rows only.

**Step 14 — tests.** Per **Test Strategy**.

**Step 15 — lint and build.** `cargo clippy --all -- -D warnings` must pass (AGENTS.md).
Run `cargo test -p pipeline-worker` and `cargo build --workspace`. Expect dead-code
warnings in `shared/tests/loan_snapshot.rs` and the audit-log tests to need updating.

## Test Strategy

All tests are **pure unit tests in external files** under `packages/worker/tests/` — no
inline `#[cfg(test)] mod tests` in `src/`, and **no `DATABASE_URL`, `POSTGRES_URL` or any
env var reaching a Postgres** (repo rules, overriding defaults). Fixtures are built
locally with the `stellar-xdr` encode helpers the two test files already define.

### `packages/worker/tests/stellar_loan_parsers.rs`

Rewrite:

- `loan_drawn_decodes_fixture` — rebuild on a **two-topic** `RawEvent`; assert `loan_id`
  and `metadata_uri`, and assert `log.params.get("holder").is_none()`.
- `loan_drawn_rejects_short_topics` (`:257`) — currently asserts a two-topic event is
  rejected, i.e. it pins the bug. Invert it to the **regression test the Issue asks for**:
  a two-topic `loan_drawn` must now decode. Add a one-topic case for the remaining guard.
- `loan_defaulted_decodes_fixture` — data map `{ moved, outstanding }` (alphabetical, as
  `#[contractevent]` emits); assert both params as decimal strings and
  `params.get("ccr_bps").is_none()`.
- `payment_recorded_decodes_fixture` — add `outstanding` to the outer map; assert it
  alongside the seven `RepaymentData` fields.
- Delete `ccr_updated_decodes_fixture`, `ccr_updated_rejects_wrong_event_name`,
  `location_updated_decodes_fixture`, `location_updated_rejects_wrong_event_name`, the
  three `parse_yield_minted` tests (`:700`, `:727`, `:740`) and the
  `parse_yield_minted` import at `:17`. Repurpose `extract_u32_from_map_decodes_new_ccr`
  (`:628`) onto a surviving key.

Add, for each of the five new parsers: a happy-path decode and a wrong-event-name
rejection, plus specifically —

- `interest_adjusted_decodes_negative_delta` — a **negative** `delta` (e.g. `-250_000`),
  asserting the exact decimal string. Directly covers **R3**; a sign-extension bug here is
  otherwise silent.
- `interest_adjusted_decodes_u128_boundary` style coverage for
  `loan_written_down`'s four fields at `u128::MAX`, matching the existing
  `large u128` convention.
- `payment_unrecorded_decodes_fixture` — the nested `repayment` sub-map plus `outstanding`,
  asserting it does not collide with `parse_payment_recorded` (different `event_name` guard,
  same topic arity).
- An **ordering test** over the dispatch ladder: a `payment_unrecorded` `RawEvent` must not
  be claimed by `parse_payment_recorded`, and vice versa.

### `packages/worker/tests/stellar_loan_reader.rs`

The five `decode_mutable_loan_data_*` fixtures (`:127`, `:162`, `:183`, `:203`, `:223`)
currently carry **pre-rework keys** (`ccr`, `current_location`,
`last_reported_ccr_timestamp`) and pass only because the decoder ignores unknown keys and
placeholder-fills the new ones. Rebuild every one of them on the current
`MutableLoanData` key set and delete the `location_map` helper at `:117`.

- `decode_mutable_loan_data_happy_path` — assert `current_rate == 1_000` from a raw
  `100_000` (**D2**: 10% at `ONE` → 1,000 bps), `carved_out == true`, and the three money
  fields; replace the three `// #1433:` placeholder assertions at `:155-158`.
- `decode_mutable_loan_data_negative_interest_adjustment` — new; a negative `i128` waiver
  decoding to the matching `I256`. **R3** again, on the reader side.
- Keep `_closed_status`, `_approved_status`, `_cancelled_closure_reason` and
  `decode_then_name_performing_is_not_approved` as the ordinal pins they are — rebuild
  their fixtures only.
- Add a **missing-field** test per newly required key: a map lacking `current_rate` (or
  `carved_out`, or `interest_adjustment`) must `Err`, not default. This is the guard
  against TD-123 silently reappearing.
- `decode_immutable_loan_data_happy_path` — add `borrower_ref` to the fixture; assert
  `Some(expected)`. Add a case with an **all-zero** `borrower_ref` asserting
  `Some(FixedBytes::ZERO)`, not `None` (Step 8's distinction).
- `decode_immutable_loan_data_rejects_missing_borrower_ref` — absent key must `Err`.

### Allowlist coverage (R4)

The two silent-failure modes from **F2** and **F3** need tests, not review diligence:

- A test over `is_loan_registry_event` asserting it returns `true` for every stored name
  the parsers can produce. The cleanest form is a single list of the stored names declared
  in the test, checked against the function — so adding a parser without touching
  `poller.rs:40` fails. `is_loan_registry_event` is currently private; make it
  `pub(crate)` plus a `#[cfg(test)]`-free `pub` re-export, or assert via a small public
  helper. Prefer whichever keeps the function's visibility minimal.
- The five SQL lists in `shared/contract_logs_repo.rs` are inline string literals, so they
  cannot be unit-tested without a DB (which the repo rules forbid). Instead, extract the
  name list into a single `const LOAN_LIFECYCLE_EVENT_NAMES: &[&str]` in that module, build
  each query's `IN (…)` from it, and add a `packages/shared/tests/` test asserting the
  const's contents. This converts five hand-maintained copies into one, and is the only
  change in this plan to a shared file's structure rather than its contents — justified
  because F3 makes a divergence between those five lists a silent data defect.

### API tests

`packages/api/tests/audit_log.rs` — the `LoanDefaulted` case at `:148` asserts the
`ccr_bps` projection. Keep it (legacy rows, **D3/D4**) and add a case with
`{ outstanding, moved }` params asserting the new projection. The `LoanDrawn` case at
`:60` needs **no** change — verified: `format_action("LoanDrawn", …)` projects `json!({})`
(`audit_log.rs:221`) and never reads `holder`, so the fixture passing it is inert.
If **Q3** lands as yes, add a `format_action` case per new event.

### Verification

`cargo clippy --all -- -D warnings`; `cargo test -p pipeline-worker`;
`cargo test -p pipeline-shared`; `cargo test -p pipeline-api`; `cargo build --workspace`.
No frontend or Figma verification applies — the Issue is backend-only and the epic's
frontend consequence is tracked standalone as #1441.

## Docs to Update

- **`ARCHITECTURE.md:64`** — the worker's on-chain event listener line. Remove
  `CCRUpdated`, `LocationUpdated` and `YieldMinted`; add the five **D1a** names. Make the
  edit idempotent (**R6**): #1434 was given the same instruction, so if the three names are
  already gone, add only what is missing.
- **`docs/product-specs/audit-logging.md:66`** — subject to **Q3**: add the five new event
  names to the v1 event list. Keep `LoanCCRUpdated`, `LoanLocationUpdated` and
  `YieldMinted` listed (**D3**), with a parenthetical that no new rows are produced on the
  Stellar arm and that they remain for historical rows.
- **`.env.example:182-183`** and **`worker/src/indexer/config.rs:38-47`** — Step 13.
- **`docs/exec-plans/tech-debt-tracker.md`** —
  - **close TD-123** for the Stellar half: Step 9 replaces every `// #1433:` placeholder.
    Leave the EVM half open for #1434 and say so in the entry rather than deleting it.
  - **new entry** for **F8**: `LoanRolledOver` / `EconomicsAmended` store `new_rate` in the
    contract's `ONE = 1_000_000` scale with no conversion, and `audit_log.rs` renders it
    raw in the Trustee feed — a 10% rate shows as `100000`. Note that fixing it means
    deciding what to do with already-stored params.
  - **new entry** for **F9**: `docs/product-specs/loans-data.md:143-158` "Key events" is a
    v1 design-era list (`LoanMinted`, `LoanStatusChanged`, `MetadataUpdated`, flat 8-arg
    `PaymentRecorded`, deleted `LocationUpdated`) matching neither shipped contract repo.
  - **new entry** for `docs/references/smart-contracts.md`: the v2.3 reference still
    documents `updateCCR` / `updateLocation` / `ccrBps` / `location` as live LoanRegistry
    surface (`:1026`, `:1051-1052`, `:1069-1071`, `:1168`, `:1297`, `:1462`, `:1470`).
- **`docs/exec-plans/known-bugs.md`** — only if **Step 0** finds the configured contract
  was upgraded in place: log the active `LoanDrawn` / `LoanDefaulted` indexing gap with
  the affected loan ids and the ledger range.
- **This plan** — record Step 0's answer to **Q1** in the Findings section before
  implementation proceeds, and move the file to `docs/exec-plans/completed/` at the end.
