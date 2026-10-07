# Issue #1432: Indexer: realign the shared loan-data model to the reworked contracts

Source: https://github.com/eq-lab/pipeline/issues/1432

Parent epic: #1431. Blocks #1433 (Stellar arm) and #1434 (EVM arm) — the types defined
here are the contract both arms decode into, so this lands first and alone.

No Figma reference is attached to this Issue or to #1431; the one frontend edit is a
text-content removal on an existing row, so there is nothing to verify visually.

## Scope

### In scope

1. **`packages/worker/src/indexer/loan_mapper.rs`** — extend `loan_status_name` and
   `closure_reason_name` to the current variant sets.
2. **`packages/worker/src/indexer/loan_metadata.rs`** — reshape
   `MutableLoanDataView`, add `borrower_ref` to `ImmutableLoanDataView`, delete
   `LocationType` and `LocationUpdateView`.
3. **`packages/shared/src/loan_snapshot.rs`** — mirror the swap on `LoanSnapshot`,
   delete `LocationUpdateSnapshot`, extend `normalize_usdc_for_display`, and apply the
   chosen legacy-row compatibility strategy.
4. **`packages/shared/src/json_numeric.rs`** — add `i256_to_bigdecimal` for the new
   signed `interest_adjustment`.
5. **`packages/api/src/routes/loan_book.rs`** — remove `reported_ccr_bps` and
   `ccr_reported_at` from `LoanBookEntry` (decision **D1**).
6. **`packages/api/src/routes/loan_financials.rs`** — remove `location` and the
   `LocationView` DTO (decision **D1b** — the Issue body attributes `location` to
   `loan_book.rs`; it is actually on the financials response, see Finding F1).
7. **`packages/trustee/src/api/useLoanFinancials.ts`** and
   **`packages/trustee/src/routes/-useLoanDetail.ts:503-509`** — drop the mirrored
   `LocationView` type and degrade the "Status / location" row to "Status".
8. **`packages/trustee/src/api/useLoanBook.ts`** and
   **`packages/trustee/src/routes/-useLoansTable.ts`** — drop `ccr_reported_at` and the
   CCR-age chip it backs.
9. All `LoanSnapshot` / view-struct construction sites in tests (enumerated in Test
   Strategy) plus the docs listed in Docs to Update.

### Out of scope

- Any parser or reader change on either arm — `parsers.rs`, `evm_parsers.rs`,
  `loan_registry_reader.rs`, `stellar/loan_registry_parsers.rs`,
  `stellar/loan_registry_reader.rs`. Those files **will not compile** after this change;
  see decision **D4** for how that is handled.
- Indexing the new LoanRegistry events (`Disbursed`, `LoanWrittenDown`,
  `InterestSettled`, …) — per-arm sub-issues.
- Renaming `senior_interest_rate_bps` anywhere. Settled in the Issue body and its
  comment: the contract-level rename is not an instruction for this Issue. The field
  is a key on persisted `contract_logs.params.snapshot` JSONB and does hold basis
  points after each arm normalizes.
- `LocationInput` / `initial_location` on the draw-loan request body
  (`loan_book.rs:325-332`, validated at `:1015`) and the origination-review Location
  row. See Finding F2 — these are off-chain **submission intent** stored in
  `submitted_loans`, not a contract read, and they survive the contract change intact.
- `shared::collateral_valuation::ccr_bps`, `packages/api/src/routes/ccr_history.rs`,
  and `collateral_valuation.rs` — the product's actual CCR is computed off-chain from
  `collateral_valuations` and is untouched.

## Ground truth (verified against the contract repos, not the Issue body)

Read directly from the sibling checkouts on 2026-10-07.

`../pipeline-contracts/src/interfaces/ILoanRegistry.sol`:

```solidity
enum LoanStatus { Approved, Performing, WatchList, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Cancelled, Default, OtherWriteDown }

struct ImmutableLoanData {
    bytes32 borrowerRef;            // new, first field
    uint256 originalFacilitySize; uint256 originalSeniorTranche;
    uint256 originalEquityTranche; uint256 originalOfftakerPrice;
    uint32  seniorInterestRate;     // renamed from seniorInterestRateBps
    uint64  originationDate; uint64 originalMaturityDate;
}

struct MutableLoanData {
    uint256 nextEconomicsEpochsId; uint256 nextRepaymentId;
    LoanStatus status; uint64 currentMaturityTimestamp; uint32 currentRate;
    ClosureReason closureReason; bool carvedOut;
    uint256 disbursed; uint256 repaid; uint256 writtenDown;
    int256 interestAdjustment; string metadataURI;
}
```

`../pipeline-stellar-contracts/contracts/loan-registry/src/types.rs` carries the same
enum variant order and the same mutable field **set**, but in a **different order**
(`metadata_uri` sits before `disbursed`, and `carved_out` after `written_down`).
`interest_adjustment` is `i128`; the money fields are `u128`; `borrower_ref` is
`BytesN<32>`.

Consequence for the arms (recorded here so #1434 does not have to rediscover it): the
`sol!` block field order is load-bearing for ABI decoding on EVM, and the Stellar
reader is key-addressed so order is irrelevant there. The **shared view struct** is
order-free; both arms map into it by name.

## Findings that correct or extend the Issue body

- **F1 — `location` is not on `loan_book.rs`.** The Issue body says the `location`
  response field lives in `loan_book.rs`. It does not: `grep` finds no `location`
  response field there. It is `LoanFinancialsResponse.location: Option<LocationView>`
  at `packages/api/src/routes/loan_financials.rs:57`, projected by `location_view()` at
  `:338-351`, served by `GET /v1/loan-book/{loan_id}/financials`, with `LocationView`
  declared at `:111-123`. The frontend mirror is
  `packages/trustee/src/api/useLoanFinancials.ts:15-25`, consumed at
  `packages/trustee/src/routes/-useLoanDetail.ts:503-509`. The plan targets the real
  location.
- **F2 — the origination-side location survives.** `LocationInput` /
  `initial_location` on the draw-loan request body is persisted as part of the
  off-chain submission record and rendered by the origination-review UI
  (`docs/frontend/trustee-flows.md:1016` → `loan_data.initial_location`). It is not
  sourced from a contract read, so the contract's deletion of `LocationUpdate` does not
  invalidate it. Only the **current on-chain** location dies. This also means the
  `docs/exec-plans/active/issue-1014-protection-location-rows.md` work splits: its
  origination Location row is unaffected; its loan-detail "Status / location" row is
  the one this Issue degrades (risk R4).
- **F3 — `reported_ccr_bps` has zero consumers.** `grep -rn reported_ccr_bps
  packages/trustee/src` returns nothing; the only references outside `loan_book.rs` are
  in `packages/api/tests/loan_book.rs`. `docs/exec-plans/tech-debt-tracker.md:603`
  already records it as "served by the backend but still missing" from the frontend
  mirror. Dropping it has no blast radius beyond its own tests.
- **F4 — `ccr_reported_at` *does* have a consumer.** It backs the CCR staleness chip:
  `packages/trustee/src/routes/-useLoansTable.ts:250` (`age:
  formatCcrAge(entry.ccr_reported_at, nowMs)`), specified at
  `docs/frontend/trustee-flows.md:243`. This is the one user-visible loss in the
  change, and it is why D1 carries an Open Question.
- **F5 — the audit-log projection for `LoanDefaulted` goes stale.**
  `packages/api/src/routes/audit_log.rs:277` emits `json!({ "ccr_bps":
  params.get("ccr_bps") })`. The reworked `LoanDefaulted` carries `outstanding` and
  `moved`, no `ccr`, so this silently renders `null` once the arms land. It reads
  **event params**, not the snapshot, so the replacement param names are decided in
  #1433/#1434, not here. Left out of scope deliberately and routed to those issues (see
  Step 10).
- **F6 — the new money fields are USDC-denominated.**
  `disbursed`, `repaid`, `written_down` and `interest_adjustment` are amounts in the
  chain's native USDC scale, so they must be added to
  `LoanSnapshot::normalize_usdc_for_display` (#901) exactly like the
  `original_*` / `repayment.*` fields. Omitting this would make Stellar amounts read 10x
  high wherever they are eventually displayed. `current_rate` must **not** be
  normalized (it is a rate, like `senior_interest_rate_bps`).

## Decisions

### D1 — `LoanBookEntry`: drop `reported_ccr_bps` and `ccr_reported_at`, add nothing

Both fields lose their source and neither is replaced.

- `reported_ccr_bps` → **dropped outright.** No consumer exists (F3), and the field's
  whole purpose was "what the contract last reported", which the contract no longer
  reports.
- `ccr_reported_at` → **dropped**, and the CCR-age chip in the loans table goes with it.
  Blast radius: the `age` sub-field of `CcrCell` in
  `packages/trustee/src/routes/-useLoansTable.ts`, and the `formatCcrAge` helper there.
  The chip's `percent` and `band` are driven by the off-chain computed `ccr_bps` and are
  unaffected.

**No new money fields are added to `LoanBookEntry`.** Rejected the alternative of
exposing `disbursed` / `repaid` / `written_down` / `carved_out` in their place because:

- no consumer asks for them today — #1433/#1434 index the events that will drive any
  such view, and the fields are available on `LoanSnapshot` for whichever issue needs
  them;
- `senior_outstanding` on the entry is already `original_senior_tranche −
  repayment.senior_principal_repaid`, so `repaid` would ship a second, differently
  derived outstanding figure on the same object — an invitation to divergence;
- adding unconsumed fields is the pattern that produced `reported_ccr_bps` and its
  tech-debt entry in the first place;
- **`LoanBookEntry` already has a `disbursed` field, and it is a `bool`**
  (`loan_book.rs:271`, the off-ramp-complete flag, specified at
  `docs/product-specs/trustee-dashboard.md:172`). Adding the contract's `disbursed`
  money amount to the same struct would require either renaming an existing public
  field or inventing a second spelling for the same word on one object. Decisive on its
  own.

The change is therefore **purely subtractive** on the public response: two fields
removed from the loan-book list entry, one from the financials response (D1b). No
field is renamed or has its meaning altered, so any consumer not reading those three
keys is unaffected.

### D1b — `LoanFinancialsResponse`: drop `location` and `LocationView`

`location_view()` has no source once `current_location` leaves `LoanSnapshot`. Delete
the field, the `LocationView` struct, its `components(schemas(...))` registration in
the route's `#[openapi]` block, and the `location_view` helper. Frontend: delete the
mirrored `LocationView` interface and the `location` key from
`LoanFinancialsResponse` in `useLoanFinancials.ts`, and simplify `buildFinancials` so
the first row is `{ label: "Status", value: data.status, tag: "chain" }`.

Rejected repointing the row at the submission's `initial_location` (F2): it would make
a loan-detail row cross endpoints to read origination intent and present stale
submission data as current on-chain state — the opposite of what the row's `tag:
"chain"` promises.

### D2 — Legacy-row compatibility: remove `deny_unknown_fields` from `LoanSnapshot`

Of the three candidates in the Issue body, take **relaxing the unknown-field guard**,
applied as narrowly as possible: delete `#[serde(deny_unknown_fields)]` from
`LoanSnapshot` only. `RepaymentSnapshot` keeps its guard; `LoanDocument` already has
none by design.

Historical `contract_logs.params.snapshot` rows carrying `ccr_bps`,
`last_reported_ccr_timestamp` and `current_location` then deserialize with those three
keys ignored, and newly written rows simply do not carry them.

**Why not deserialize-only tombstones** (`#[serde(default, skip_serializing)]` on the
three fields): it does not achieve the Issue's own requirement to delete
`LocationUpdateSnapshot` — a tombstoned `current_location: LocationUpdateSnapshot`
keeps the type alive, and every one of the ~10 construction sites in Test Strategy must
keep naming all three dead fields indefinitely. It trades a one-line attribute for
permanent struct and fixture bloat.

**Why not a JSONB backfill**: `contract_logs` is the append-only record of what was
read on-chain at each event's block. Rewriting it to delete the CCR the contract
genuinely did report at the time destroys history to serve a deserialization
convenience. It also has to complete before any new API instance serves traffic, so it
turns a code-only change into a deploy-ordering hazard, against the epic's "no
migration required" framing.

**Cost, and why it is small.** The guard's practical value is catching a field rename
that leaves old JSON unreadable. Removing it only weakens that for fields that *also*
carry `#[serde(default)]`; every field without `default` still fails loudly with
`missing field` on a rename. So the loss is confined to `protection`, `documents` and
the six new fields. Mitigated by the explicit round-trip test in Test Strategy, which
asserts each field survives serialize → deserialize with its value.

### D3 — New field shapes, and the unit contract for the arms

This Issue defines the contract #1433 and #1434 decode into, so each unit is pinned in
a doc comment. The #1434 lesson (a rename erasing a unit) applies in reverse: write the
unit down where it cannot be renamed away.

On `MutableLoanDataView` (`loan_metadata.rs`) — remove `ccr_bps`,
`last_reported_ccr_timestamp`, `current_location`; add:

| field | type | note |
|---|---|---|
| `current_rate` | `u32` | **basis points**, normalized by each arm |
| `carved_out` | `bool` | |
| `disbursed` | `alloy::primitives::U256` | raw native USDC scale |
| `repaid` | `alloy::primitives::U256` | raw native USDC scale |
| `written_down` | `alloy::primitives::U256` | raw native USDC scale |
| `interest_adjustment` | `alloy::primitives::I256` | **signed**; raw native USDC scale |

`U256`/`I256` are used because the view already speaks alloy types (`next_repayment_id`,
the `original_*` fields) and `U256` is the only one of the two chains' widths that
holds the other — Stellar's `u128` widens losslessly, EVM's `uint256` does not narrow.
`I256` is required for `interest_adjustment`: waivers are negative, and `U256` would
wrap them into astronomically large positives silently.

On `ImmutableLoanDataView`: add `borrower_ref: alloy::primitives::FixedBytes<32>`
(`bytes32` / `BytesN<32>`). Keep `senior_interest_rate_bps` as the field name per the
scope guard. `borrower_ref` is deliberately **not** added to `LoanSnapshot` — it has no
consumer, and every key added to the persisted JSONB is a key that must be defaulted
forever. The arms populate the view field; a later issue can promote it if a product
surface needs it.

On `LoanSnapshot` (`shared/src/loan_snapshot.rs`) — remove `ccr_bps`,
`last_reported_ccr_timestamp`, `current_location`; delete `LocationUpdateSnapshot`;
add, each with `#[serde(default)]` for the reason already documented on `protection`
and `documents`:

```rust
#[serde(default)] pub current_rate: u32,            // basis points
#[serde(default)] pub carved_out: bool,
#[serde(default)] pub disbursed: BigDecimal,
#[serde(default)] pub repaid: BigDecimal,
#[serde(default)] pub written_down: BigDecimal,
#[serde(default)] pub interest_adjustment: BigDecimal,  // signed
```

`BigDecimal::default()` is zero, which is the correct value for a pre-rework row that
had no such concept.

Place them in the `mutableLoanData (block-pinned)` section, keeping `current_rate`
adjacent to `status` and the money fields grouped together, so the struct reads in the
same order as the contract.

### D4 — This Issue intentionally lands a non-compiling worker tree

Removing `MutableLoanDataView.ccr_bps` and `LocationUpdateView` breaks
`packages/worker/src/indexer/loan_registry_reader.rs:178-185` and
`packages/worker/src/indexer/stellar/loan_registry_reader.rs:237-267,368-390`, which
are #1434's and #1433's files respectively. There is no way to change a shared struct
and leave both consumers untouched.

**Resolution:** the coder makes the *minimal mechanical* edit to both readers needed to
compile — map the new fields from the data each reader already has where that is
trivial, and otherwise construct the new fields from the existing raw read, leaving the
actual ABI/XDR realignment (which keys to read, which events to parse) entirely to
#1433/#1434. Concretely:

- EVM `loan_registry_reader.rs`: the `sol!` block still declares the pre-rework
  `MutableLoanData`, so `d.ccrBps` etc. exist. Drop the three removed assignments and
  fill the six new view fields with `Default::default()` / `U256::ZERO` /
  `I256::ZERO`, each carrying a one-line `// #1434: realign the sol! block` marker
  comment. Delete the `LocationType` / `LocationUpdate` declarations from the `sol!`
  block and the `map_location_update` equivalent.
- Stellar `loan_registry_reader.rs`: same shape — delete the `ccr`,
  `last_reported_ccr_timestamp` and `current_location` reads and
  `map_location_update()`, fill the six new fields with zero/false and a `// #1433:`
  marker.

This is a deliberate, bounded placeholder: no behavior regresses (both readers are
already broken against current contracts per #1431 and #1433), and the markers are the
hand-off. Log it in `docs/exec-plans/tech-debt-tracker.md` (Step 9) so it cannot be
forgotten if #1433/#1434 stall.

Rejected the alternative of doing the full reader realignment here: it is exactly the
work #1433 and #1434 exist to do, needs the per-arm XDR/ABI fixtures, and would make
this Issue's diff unreviewable.

## Assumptions and Risks

- **A1.** The sibling checkouts `../pipeline-contracts` and
  `../pipeline-stellar-contracts` are at the revisions the epic names. The structs and
  enums quoted in Ground truth were read from them directly; if either has moved since,
  re-verify before implementing.
- **A2.** `senior_interest_rate_bps` on `LoanSnapshot` holds basis points. Asserted by
  the Issue comment and by `stellar/loan_registry_reader.rs:193` (`raw / 100`). The
  EVM-side scale question is #1434's and does not block this Issue.
- **R1 — the arm issues may need to reopen these files.** #1434 reports that
  `cumulativeRepaymentData()` no longer exists on EVM, with no drop-in replacement
  (`loanMoney()` covers the money fields but not the seven-way `RepaymentData` split).
  If #1434 concludes the remaining components must be accumulated from `PaymentRecorded`
  events, the shared `MutableDataResolver::cumulative_repayment_data` trait method in
  `loan_metadata.rs:170-186` has to change — and Stellar still has that getter
  (`contracts/loan-registry/src/lib.rs:714`), so the two arms would diverge on a shared
  trait. **This Issue deliberately leaves the trait untouched** (it is still correct for
  Stellar and the question is unsettled for EVM), but the file will likely be revisited.
  Flagged as Open Question Q3.
- **R2 — a rolling deploy mixes old and new writers.** During deploy, an old worker may
  still write snapshots containing the three removed keys while a new API reads them.
  D2 handles exactly this direction. The reverse (a new worker writing without the keys,
  an old API reading) would fail on `missing field ccr_bps` — so **the API must not be
  rolled back past this change once a new worker has written a snapshot.** Note it in
  the tech-debt/deploy log.
- **R3 — `docs/exec-plans/active/issue-1014-protection-location-rows.md` overlaps.**
  That plan is active and reads `current_location` via
  `useLoanFinancials.ts:28`. Per F2 its origination row survives; its loan-detail
  location row is removed by D1b. Whoever executes whichever lands second must
  reconcile; if #1014 is already merged, Step 7 is the reconciliation.
- **R4 — the CCR-age chip is a visible UI loss.** Covered by Open Question Q1.
- **R5 — breadth of fixture churn.** ~10 test files construct `LoanSnapshot` or the
  view structs. The edits are mechanical but numerous; a missed one is a compile error,
  not a silent bug, so the risk is schedule rather than correctness.

## Open Questions

1. **Is dropping the CCR staleness chip acceptable, or should `ccr_reported_at` be
   repointed at the computed valuation's as-of timestamp?** (F4) Repointing is arguably
   *more* correct — the chip sits beside the off-chain computed `ccr_bps`, not the
   reported one — but `compute_loan_book` has no per-loan valuation timestamp today
   (`collateral_by_loan` is a bare `BigDecimal` map), so it needs a repo/query change
   that is its own issue. **Recommended default if no answer: drop the chip**, and file
   a follow-up issue for a `collateral_as_of` field. Proceeding either way is safe; this
   only decides whether the follow-up is filed now or the chip is restored later.

   **Finding added after the plan was written (verified in both contract repos): CCR
   did not disappear, it moved to `CollateralRegistry` — but not as a usable event.**

   - `MarginCall(loanId, coverageBps, floorBps)` is emitted **only when coverage is
     below the loan's floor** (EVM `CollateralRegistryUpgradeable.sol:548`; Stellar
     `collateral-registry/src/lib.rs:636`). A healthy loan never emits it, so it cannot
     feed a per-loan CCR value or a staleness chip. There is no general
     "coverage updated" event on either chain.
   - On-chain CCR **is** still readable, as a view: `coverage(loanId) -> u32` bps
     (EVM `:502`, Stellar `:560`), defined as
     `collateralValue / (outstanding + accruedInterest)`. Note this is **not** the same
     number as the old `ccrBps` nor as the off-chain `shared::collateral_valuation::ccr_bps`,
     which divides by outstanding senior *principal* — the new view includes accrued
     interest in the denominator.
   - The staleness signal the chip actually wants also exists as a view:
     `markAge(loanId) -> u64` (EVM `:511`; Stellar `mark_age`, `:579`) — seconds since
     the oldest mark among the lots that count toward coverage, `u64::MAX` when one has
     no mark. This is arguably a better source than the old
     `last_reported_ccr_timestamp`, because it measures the age of the valuation inputs
     rather than of a reported number.

   Consequence for this question: the follow-up issue is **not** about adding a
   `collateral_as_of` field to the off-chain computation. It is about **indexing the
   `CollateralRegistry` contract** (`coverage` + `markAge` views, plus the `MarginCall`
   event for margin-call visibility), which epic #1431 currently lists as out of scope.
   That is a larger follow-up than this plan assumed, and it is the only route to a
   genuine on-chain reported CCR.
2. **Should `written_down` and `carved_out` be exposed on `LoanBookEntry` now?** (D1)
   They are the two new fields with an obvious Trustee risk-view use. **Recommended
   default: no** — defer to whichever issue builds the surface that reads them.
3. **Does #1434's `cumulativeRepaymentData` resolution require changing the shared
   `MutableDataResolver` trait, and if so should that change land here instead?** (R1)
   **Recommended default: leave the trait alone here**; the question belongs to #1434
   and the trait is still correct for Stellar.

Questions 1 and 2 are public-response-shape decisions a human may want to weigh in on.
Question 3 is a sequencing question for the epic.

## Implementation Steps

1. **`packages/worker/src/indexer/loan_mapper.rs:31-50`** — extend both ordinal maps,
   keeping the `_ => "Unknown"` fallback:

   ```rust
   pub fn loan_status_name(ordinal: u8) -> &'static str {
       match ordinal {
           0 => "Approved", 1 => "Performing", 2 => "WatchList",
           3 => "Default", 4 => "Closed", _ => "Unknown",
       }
   }
   pub fn closure_reason_name(ordinal: u8) -> &'static str {
       match ordinal {
           0 => "None", 1 => "ScheduledMaturity", 2 => "EarlyRepayment",
           3 => "Cancelled", 4 => "Default", 5 => "OtherWriteDown", _ => "Unknown",
       }
   }
   ```

2. **`packages/shared/src/json_numeric.rs`** — add `i256_to_bigdecimal(v: I256) ->
   BigDecimal` alongside `u256_to_bigdecimal`, same `from_str` + `expect` shape
   (`I256::to_string()` yields a signed decimal literal, which `BigDecimal::from_str`
   accepts). Import `alloy_primitives::I256`.

3. **`packages/shared/src/loan_snapshot.rs`** — apply D2 and D3:
   - delete `#[serde(deny_unknown_fields)]` from `LoanSnapshot` (keep it on
     `RepaymentSnapshot`);
   - delete the `ccr_bps`, `last_reported_ccr_timestamp` and `current_location` fields
     and their doc comments, and the whole `LocationUpdateSnapshot` struct;
   - add the six fields from D3 with `#[serde(default)]` and unit-pinning doc comments;
   - extend `LoanSnapshot::normalize_usdc_for_display` with `disbursed`, `repaid`,
     `written_down` and `interest_adjustment` (F6). Do **not** add `current_rate`.
     `normalize_usdc_amount` takes `&BigDecimal` and is sign-agnostic, so
     `interest_adjustment` needs no special handling.

4. **`packages/worker/src/indexer/loan_metadata.rs`** — apply D3:
   - delete `LocationType` (`:82-112`) and `LocationUpdateView` (`:114-121`);
   - on `MutableLoanDataView` (`:136-153`) remove `ccr_bps`,
     `last_reported_ccr_timestamp`, `current_location`; add the six new fields; update
     the stale ordinal lists in the `status` and `closure_reason` doc comments to the
     new variant sets;
   - on `ImmutableLoanDataView` (`:71-79`) add `borrower_ref:
     alloy::primitives::FixedBytes<32>` as the first field, matching the contract.

5. **`packages/worker/src/indexer/loan_mapper.rs`** — update both snapshot builders,
   `compose_initial_snapshot` (`:102-145`, the `mutableLoanData` block at `:124-133`)
   and `compose_lifecycle_snapshot` (`:218-227`): drop the three removed assignments
   and the `LocationUpdateSnapshot` literal, and add the six new ones
   (`current_rate: mutable.current_rate`, `carved_out: mutable.carved_out`,
   `disbursed: u256_to_bigdecimal(mutable.disbursed)`, likewise `repaid` and
   `written_down`, and `interest_adjustment:
   i256_to_bigdecimal(mutable.interest_adjustment)`). Drop `LocationUpdateSnapshot`
   from the `shared::` import block at `:16`.

6. **Readers — minimal compile fix only, per D4.**
   - `packages/worker/src/indexer/loan_registry_reader.rs`: `:11` import, the
     `LocationType` / `LocationUpdate` declarations in the `sol!` block (`:32-41`), and
     the view construction at `:178-185`.
   - `packages/worker/src/indexer/stellar/loan_registry_reader.rs`: `:23-24` imports,
     the reads at `:237-267`, and `map_location_update` (`:368-390`).
   Each new field gets a zero/`false`/`Default::default()` value and a one-line
   `// #1433:` or `// #1434:` marker. Nothing else in these files changes.

7. **`packages/api/src/routes/loan_book.rs`** — apply D1: delete the `ccr_reported_at`
   (`:211-214`) and `reported_ccr_bps` (`:215-221`) fields from `LoanBookEntry` and the
   two assignments at `:1451-1452`. Edit the doc comment on the surviving `ccr_bps`
   (`:240-244`) to drop the now-dangling `see reported_ccr_bps` cross-reference and the
   `LoanCCRUpdated` mention.

8. **`packages/api/src/routes/loan_financials.rs`** — apply D1b: delete `LocationView`
   (`:111-123`), the `location` field (`:56-57`), the `location_view` helper
   (`:338-351`) and its call site, and the `LocationView` entry in
   `components(schemas(...))` (`:128`).

9. **Frontend** — four files, all type-mirror and text edits:
   - `packages/trustee/src/api/useLoanFinancials.ts`: delete the `LocationView`
     interface (`:15-25`) and the `location` key on `LoanFinancialsResponse`; drop the
     `LocationView` re-export if any consumer imports it.
   - `packages/trustee/src/routes/-useLoanDetail.ts:500-510`: remove the `loc` /
     `statusLocation` computation and emit `{ label: "Status", value: data.status, tag:
     "chain" }`.
   - `packages/trustee/src/api/useLoanBook.ts`: delete the `ccr_reported_at` field
     (`:128-132`).
   - `packages/trustee/src/routes/-useLoansTable.ts`: delete the `age` field from
     `CcrCell` (`:73`), its assignment (`:250`), and the now-unused `formatCcrAge`
     helper (`:170`) and its doc comment at `:91`.

10. **Lint and hand-off.**
    - `cargo clippy --all -- -D warnings`
    - `npx tsc --noEmit` in `packages/trustee` (or the package's configured typecheck)
    - `npx tsx scripts/lint-docs.ts`
    - Append a tech-debt entry for D4's placeholder reader values and for R2's
      no-rollback constraint to `docs/exec-plans/tech-debt-tracker.md`.
    - Post a comment on #1433 and #1434 recording: the shared field names and units
      from D3, the `// #1433:` / `// #1434:` markers left in their readers, the
      contract field-order difference from Ground truth, and Finding F5 (the stale
      `LoanDefaulted` audit-log projection at `audit_log.rs:277`) so whichever arm
      settles the new event params fixes it. **Comment only — do not edit labels.**

## Test Strategy

All Rust tests are **external files** under `packages/<pkg>/tests/<topic>.rs` — never
inline `#[cfg(test)] mod tests` in `src/`. No test reads `DATABASE_URL`,
`POSTGRES_URL`, or any env var; these are pure unit tests over structs and serde.

### New assertions

**`packages/worker/tests/loan_mapper.rs`** — ordinal maps across the full current range,
written so the pre-fix code fails:

- `loan_status_name`: `0 => "Approved"`, `1 => "Performing"`, `2 => "WatchList"`,
  `3 => "Default"`, `4 => "Closed"`, `5 => "Unknown"`, `255 => "Unknown"`. Ordinals
  1–3 are the ones that regress today (they currently return the variant one position
  early), so assert them explicitly rather than only the new `0` and `4`.
- `closure_reason_name`: `0..=5` → `None`, `ScheduledMaturity`, `EarlyRepayment`,
  `Cancelled`, `Default`, `OtherWriteDown`; `6` and `255` → `Unknown`. Ordinals 3–4
  are the regressing pair.
- Replace the `LocationType::from_ordinal` test (`:888-903`) — delete it with the type.

**`packages/shared/tests/loan_snapshot.rs`**:

- **Round-trip for the new shape** — `serde_json::to_value` → `from_value`, asserting
  equality, plus an explicit per-field assertion over the six new fields including a
  **negative** `interest_adjustment`. This is the test that replaces what
  `deny_unknown_fields` bought (D2).
- **Legacy-row deserialization** — a hand-written JSON fixture in the shape of a real
  pre-rework `contract_logs.params.snapshot`: every surviving key plus `ccr_bps`,
  `last_reported_ccr_timestamp` and a nested `current_location` object. Assert it
  deserializes, that the six new fields come back at their defaults (`0` / `false` /
  `BigDecimal::zero()`), and that a surviving field (`senior_interest_rate_bps`,
  `status`) carries its fixture value. This is the direct test of D2 and the single
  most important test in the change.
- **Pre-`protection`/`documents` legacy row** — keep whatever coverage exists for the
  older default-ed fields; confirm the new fixture does not accidentally replace it.
- **Normalization (F6)** — extend
  `stellar_normalization_divides_every_monetary_field_by_ten` to assert `disbursed`,
  `repaid`, `written_down` and `interest_adjustment` all scale, and extend
  `stellar_normalization_does_not_touch_non_monetary_fields` to assert `current_rate`
  and `carved_out` do not. Include a negative `interest_adjustment` so the sign
  survives normalization.

**`packages/api/tests/loan_book.rs`** — delete the three now-meaningless tests:
`entry_exposes_reported_ccr_bps_from_snapshot` (`:433-438`), the `reported_ccr_bps`
assertions inside `ccr_bps_is_collateral_over_outstanding_senior` (`:422-429`, keeping
the computed-`ccr_bps` assertions), and the `ccr_reported_at` assertion at `:628-631`.
Keep and re-verify the surviving computed-CCR coverage — the point is that off-chain
CCR is untouched by this change.

### Fixture updates (compile-driven, mechanical)

Every `LoanSnapshot` / view-struct literal below drops three fields and gains six.
`cargo build --tests` enumerates them; the known set is:

- `packages/shared/tests/loan_snapshot.rs`
- `packages/worker/tests/loan_mapper.rs` (`mock_location`, and the literals at
  `:91-95`, `:212-216`, `:354-358`, `:531-536`, `:648-652`, `:715-720`, `:811-815`,
  `:860-864`, `:934-938`, plus the `snap.*` assertions at `:611-616`, `:684-690`,
  `:773-774`)
- `packages/worker/tests/stellar_loan_reader.rs` (`:127-169`) — the `location_map`
  helper and the `ccr` / `last_reported_ccr_timestamp` / `current_location` map entries
  and `view.*` assertions. **Scope note:** this file is #1433's; here it changes only
  as much as D4's placeholder requires.
- `packages/api/tests/` — `portfolio_compute.rs`, `capital_allocation.rs`,
  `financial_position.rs`, `loan_financials.rs`, `dashboard.rs`, `waterfall.rs`,
  `loan_book.rs`. Each has a `zero_location()` / `empty_location()` helper to delete.
  `loan_financials.rs` additionally has a `location` parameter threaded through its
  snapshot builder (`:34`, `:59`, `:65-66`, `:170`) and location-assertion tests that
  go with D1b.

### Frontend tests

`vitest` in `packages/trustee`. The fixture objects at the sites found by `grep -rn
"ccr_reported_at" packages/trustee/src` lose that key:
`-useNeedsAttention.test.ts:198`, `-record-repayment-page.test.tsx:135`,
`-useLoanDetail.test.ts:56`, `-record-coupon-page.test.tsx:125`,
`-loans.index.test.tsx:63,91`, `-risk-council-reterm-page.test.tsx:86`,
`-risk-council-escalate-page.test.tsx:100`, `-risk-council-writedown-page.test.tsx:82`,
`-useLoansTable.test.ts:46,232`. Additionally:

- `-useLoansTable.test.ts` — drop the `age` expectations from the CCR-cell assertions
  (`:217` and neighbours); keep the `percent` / `band` expectations, which are driven
  by the computed `ccr_bps` and must not change.
- `-useLoanDetail.test.ts` — update the `buildFinancials` expectation for the first row
  from `"Status / location"` to `"Status"`; drop the `location` key from the
  `LoanFinancialsResponse` fixture.

### Edge cases to cover explicitly

- Legacy snapshot JSON where `current_location` is present but `location_type` is the
  empty string (the "never reported" case `location_view` handled) — must still
  deserialize, not just the populated form.
- Negative `interest_adjustment` through both serde round-trip and
  `normalize_usdc_for_display`.
- `closure_reason_name(5)` → `"OtherWriteDown"`, the variant that moved furthest; and
  `loan_status_name(4)` → `"Closed"`, which returns `"Unknown"` today.
- A legacy row containing an unknown key that is *not* one of the three removed ones
  (e.g. a hypothetical future `foo`) — confirms D2's relaxation is what makes the
  fixture pass, and documents the cost being accepted.

## Docs to Update

- **`docs/frontend/trustee-flows.md:243`** — the CCR-staleness bullet ("the age derived
  from `ccr_reported_at` only (`1h` / `26h`)") is the spec for the chip D1 removes.
  Rewrite to state that the CCR cell carries percent and band only, with the reason
  (the contract no longer reports a CCR or its timestamp; the displayed CCR is computed
  off-chain). Leave `:1016` (origination `loan_data.initial_location`) alone per F2.
- **`docs/frontend/trustee-flows.md#registry-state--derived-852`** — the "Status /
  location" row in the Registry state & derived section becomes "Status". This section
  is referenced by spec-pointer headers in `-useLoanDetail.ts` and
  `useLoanFinancials.ts`, so both pointers stay valid once the section is edited.
- **`docs/exec-plans/tech-debt-tracker.md`** — three entries:
  (a) D4's placeholder zero-values in both loan-registry readers, owned by #1433/#1434;
  (b) R2's API no-rollback constraint once a new worker has written a snapshot;
  (c) retire or annotate the existing `reported_ccr_bps` "served but not mirrored"
  entry at `:598-603`, which this change resolves by deletion rather than by mirroring.
  Also check `:564` and `:589`, which name `ccr_reported_at` and
  `LoanFinancialsResponse`/`LocationView` in the epic-#775 hand-mirroring entries.
- **`docs/exec-plans/active/issue-1014-protection-location-rows.md`** — add a note
  recording the F2 split (origination row survives, loan-detail location row removed by
  this Issue) so that plan is not executed against a removed field.
- **`docs/product-specs/trustee-dashboard.md:172`** — **required.** The Loans-page row
  of the surface table names the fields D1 removes verbatim: `**CCR** (`ccr_bps`,
  off-chain computed) + on-chain **reported CCR** (`reported_ccr_bps`) + **report
  time** (`ccr_reported_at`)`. Edit that clause down to `**CCR** (`ccr_bps`, off-chain
  computed)`. This is the user-facing spec change the behavior change requires; the
  rest of the long row is untouched.
- **`ARCHITECTURE.md:64`** — the on-chain event listener line still lists `CCRUpdated`,
  `LocationUpdated` and `YieldMinted`, all deleted from both contract repos. Those
  three parsers are removed by #1433/#1434, not here, so **leave this line to the arm
  issues** and include it in the Step 10 hand-off comment rather than editing it in this
  Issue's diff. Noted so it is not mistaken for an omission.
- Generated reference material: `docs/generated/` holds only
  `stellar-protocol-contracts.md` — there is no checked-in OpenAPI dump, so no codegen
  needs regenerating for the two response-shape changes.
