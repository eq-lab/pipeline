# Issue #1434: EVM indexer — realign parsers and reader to post-rework pipeline-contracts, add the Minter group

Source: https://github.com/eq-lab/pipeline/issues/1434

Parent epic: #1431. Siblings: #1432 (shared model, landed `9133dc73`, plan archived at
`docs/exec-plans/completed/issue-1432-shared-loan-data-model.md`) and #1433 (Stellar arm,
landed `dc099757`, plan archived at
`docs/exec-plans/completed/issue-1433-stellar-loan-parsers-realignment.md`). The #1433
plan is this one's template; decisions are kept in parity wherever the two contracts
agree, and every divergence is named explicitly below.

No Figma reference is attached to this Issue or to #1431 — backend-only, so no
Figma-driven verification step applies.

## Ground truth

Verified 2026-10-08 against `/Users/aabliazimov/Documents/work/pipeline-contracts` at
`4cc467856eccf50fac797c77a3c8b3d7ec5a5c0c` ("Contracts sizes trim (#49)", 2026-10-02),
branch `main`, clean and in sync with `origin/main`. Read from the **implementation**
(`src/loanRegistry/LoanRegistryUpgradeable.sol`, `src/minter/MinterUpgradeable.sol`), not
only the interface — `ILoanRegistry.sol` declares **zero events** and does not declare
`immutableLoanData` / `mutableLoanData` at all.

### Enums — `src/interfaces/ILoanRegistry.sol:5-20`

```solidity
enum LoanStatus { Approved, Performing, WatchList, Default, Closed }                        // 0..4
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Cancelled, Default, OtherWriteDown } // 0..5
```

Identical to the canonical tables already in `loan_mapper.rs` (#1432) and identical to the
Stellar arm. **No ordinal translation is needed after this lands.**

### Structs — `src/interfaces/ILoanRegistry.sol`

```solidity
:22  struct ImmutableLoanData {
       bytes32 borrowerRef; uint256 originalFacilitySize; uint256 originalSeniorTranche;
       uint256 originalEquityTranche; uint256 originalOfftakerPrice; uint32 seniorInterestRate;
       uint64 originationDate; uint64 originalMaturityDate; }

:40  struct MutableLoanData {
       uint256 nextEconomicsEpochsId; uint256 nextRepaymentId; LoanStatus status;
       uint64 currentMaturityTimestamp; uint32 currentRate; ClosureReason closureReason;
       bool carvedOut; uint256 disbursed; uint256 repaid; uint256 writtenDown;
       int256 interestAdjustment; string metadataURI; }

:55  struct RepaymentData {
       uint256 offtakerReceived; uint256 seniorPrincipalRepaid; uint256 seniorInterest;
       uint256 equityDistributed; uint256 mgmtFee; uint256 perfFee; uint256 oetAlloc; }

:65  struct LoanMoney {
       uint256 disbursed; uint256 repaid; uint256 writtenDown; uint256 outstanding;
       uint256 accruedInterest; bool carvedOut; }

:33  struct EconomicsEpoch {
       uint256 accruedInterest; uint64 effectiveFrom; uint64 maturityDate; uint32 seniorInterestRate; }
```

EVM ABI decode is **order-dependent** — unlike the key-addressed Stellar decoder, a field
in the wrong slot silently yields a plausible wrong number. The orders above are the
contract of this Issue.

`interestAdjustment` is `int256` (not `int128`) → maps straight onto
`MutableLoanDataView.interest_adjustment: I256` with no lift.

### Events — `src/loanRegistry/LoanRegistryUpgradeable.sol:34-53`

```solidity
34 event LoanDrawn(uint256 indexed loanId, string metadataURI);
35 event StatusUpdated(uint256 indexed loanId, LoanStatus indexed newStatus);
36 event Disbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding);
37 event Undisbursed(uint256 indexed loanId, uint256 amount, uint256 outstanding);
38 event PaymentRecorded(uint256 indexed loanId, uint256 indexed repaymentId, RepaymentData repayment, uint256 outstanding);
41 event PaymentUnrecorded(uint256 indexed loanId, uint256 indexed repaymentId, uint256 outstanding);
42 event LoanDefaulted(uint256 indexed loanId, uint256 outstanding, uint256 moved);
43 event LoanWrittenDown(uint256 indexed loanId, uint256 amount, uint256 outstanding, uint256 burned, uint256 unabsorbed);
46 event InterestAdjusted(uint256 indexed loanId, int256 delta, bytes32 reasonHash);
47 event InterestSettled(uint256 indexed loanId, uint256 accrued, uint256 paid, uint256 waived);
48 event LoanClosed(uint256 indexed loanId, ClosureReason indexed reason);
49 event LoanRolledOver(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
50 event EconomicsAmended(uint256 indexed loanId, uint32 newRate, uint64 newMaturityTimestamp);
51 event CapitalWalletSet(address capitalWallet);
52 event MaxFeeBpsSet(uint32 maxFeeBps);
53 event MaxResidualSet(uint256 maxResidual);
```

No `CCRUpdated`. No `LocationUpdated`. The three config events carry no `loanId` and are
excluded outright (`loan_mapper::extract_loan_id` would error on each), exactly as #1433
excluded Stellar's four admin events.

### Minter — `src/minter/MinterUpgradeable.sol`

```solidity
88 event WireInRecorded(uint256 indexed id, address indexed receiver, uint256 amount, uint64 valueDate, bytes32 refHash);
91 event WireInAssigned(uint256 indexed id, address indexed receiver);
```

`contract PipelineMinter is UUPSUpgradeable, MinterUpgradeable` (`src/PipelineMinter.sol:9`).
**`PipelineYieldMinter` does not exist in `src/`** — the name survives only as a JSON key
in `deployments/*.json`. **`YieldMinted` does not exist anywhere in the repo** (zero hits
across `src/`, `script/`, `test/`).

### Rate scale — `src/loanRegistry/LoanRegistryUpgradeable.sol`

```solidity
17  uint256 private constant ONE = 1_000_000;
18  uint256 private constant YEAR = 31557600;
19  uint256 private constant BPS_ONE = 10_000;
...
652 function _epochInterest(EconomicsEpoch storage epoch, uint256 principal) private view returns (uint256) {
653     return (block.timestamp - epoch.effectiveFrom) * epoch.seniorInterestRate * principal / (YEAR * ONE);
654 }
```

`currentRate` is assigned from the same ppm value: `:235 loan.currentRate = economics.seniorInterestRate;`
(draw) and `:610 loan.currentRate = newRate;` (`_setTerms`, shared by `rollover` and
`amendEconomics`). `BPS_ONE` is used only for `maxFeeBps` — two scales in one contract.

## Findings that correct or extend the Issue body

**F1 — `seniorInterestRate` is ppm (`ONE = 1_000_000`), confirmed from the implementation.
The Issue's required check is discharged: the EVM reader is missing a `/100`.**
Verified independently of the #1434 comment thread, at `LoanRegistryUpgradeable.sol:17`
and `:653` above. The rework did **not** change the scale — the pre-rework field name
`seniorInterestRateBps` was simply wrong, and the rename removed an inaccurate name rather
than changing a unit. `loan_registry_reader.rs:196` assigns `d.seniorInterestRateBps`
straight into `ImmutableLoanDataView.senior_interest_rate_bps` with no conversion, so
**every EVM-indexed loan's `LoanSnapshot.senior_interest_rate_bps` is 100x too high**, and
`compute_series` / `loan_book.rs:691` divide by `BPS_DENOM = 10_000` regardless. This is a
pre-existing defect that predates the rework. `currentRate` carries the identical scale and
needs the identical `/100` — matching the doc comment #1432 left on
`MutableLoanDataView.current_rate` (`loan_metadata.rs:108-113`).

**F2 — this Issue fixes the rate half of #765 in code but must not close it.** See **D7**.

**F3 — `cumulativeRepaymentData()` is gone and `RepaymentTotals` has no getter, is not
emitted, and is lossy. The seven-way split is unrecoverable from EVM contract state.**
This is the Issue's "one piece without a drop-in replacement" and it is worse than the
body suggests. `RepaymentTotals` (`LoanRegistryUpgradeable.sol:28-32`) is three fields —
`offtakerReceived`, `seniorInterest`, `interestFees` — living in a **private** storage
mapping (`:96`), read only internally by `_accruedInterest` (`:645`) and `_close` (`:524`).
`mgmtFee` and `perfFee` are **merged** into `interestFees` at `:331`
(`uint256 interestFees = repayment.mgmtFee + repayment.perfFee;`), and
`equityDistributed` / `oetAlloc` are **not accumulated at all**. The per-repayment record
`$.repayments[loanId][repaymentId]` (`RecordedRepayment`, `:21-26`) is likewise four fields
and likewise ungettable.

The complete external view surface is: `tokenURI`, `nextLoanId`, `immutableLoanData`,
`mutableLoanData`, `economicsEpoch`, `status`, `outstanding`, `loanMoney`,
`outstandingTotal`, `unabsorbedTotal`, `capitalWallet`, `stakedPlUsd`, `pocket`,
`maxFeeBps`, `maxResidual`. Nothing returns cumulative repayment data.

**The only complete source is the `PaymentRecorded` event itself**, which carries the full
7-field `RepaymentData` tuple in its data section. Drives **D3**.

**F4 — `loanMoney()` is not needed and must not be called.** The Issue body suggests it as
the replacement read. Of its six fields, four (`disbursed`, `repaid`, `writtenDown`,
`carvedOut`) are already on `MutableLoanData` and read for free in the existing
`mutableLoanData` call; the other two (`outstanding`, `accruedInterest`) are not
`LoanSnapshot` fields and have no consumer. Calling it would add one `eth_call` per
lifecycle event for nothing. Skip it. (`_outstanding` is `disbursed − repaid − writtenDown`
at `:657`, whereas the API computes outstanding senior as
`original_senior_tranche − senior_principal_repaid` — a definitional divergence that is a
separate API question, logged as tech debt, not touched here.)

**F5 — `PaymentUnrecorded` on EVM carries no amounts, unlike Stellar.** Stellar's is
`{repayment: RepaymentData, outstanding}` (#1433); EVM's is
`(loanId, repaymentId, outstanding)` only (`:41`). The reversed amounts must be recovered by
joining back to the original `PaymentRecorded` row by `(loan_id, repayment_id)`. Two
consequences: it shapes **D3**, and it means `audit_log.rs`'s `PaymentUnrecorded` arm
(`:360-366`, which reads `senior_principal_repaid` / `senior_interest`) renders two nulls on
every EVM row. See **D6**.

**F6 — `LoanDrawn`'s `metadataURI` is no longer `indexed`.** The Issue body says "URI is no
longer indexed" and that is load-bearing in a way the body does not spell out: the URI is
now readable from the event data rather than being a dead keccak topic. Emit it as a
`metadata_uri` param, matching what the Stellar `parse_loan_drawn` already does. Note the
existing test `parsers.rs:281-284` asserts `metadata_uri` is **absent** — it must be
inverted, not merely rebuilt. The snapshot still sources its URI from
`mutable.metadata_uri` (`loan_mapper.rs:355`), so this is informational parity only.

**F7 — `StatusUpdated` / `LoanClosed` keep topic0 but change meaning, exactly as the body
warns.** Solidity ABI-encodes an indexed enum as `uint8`, so `StatusUpdated(uint256,uint8)`
and `LoanClosed(uint256,uint8)` still match. What changes is that the enums gained
`Approved` at 0 and `Cancelled` at 3, which is precisely what
`translate_pre_rework_status` / `translate_pre_rework_closure_reason` exist to paper over.
Both parsers must drop the translation call, not be left alone.

**F8 — the `// #1434:` markers are the deletion checklist and there are 13 of them**, in two
files: `packages/worker/src/indexer/parsers.rs:28` and
`packages/worker/src/indexer/loan_registry_reader.rs:17, 25, 88, 99, 126, 129, 131, 133,
135, 137, 191`. Every one must be gone when this lands, together with
`translate_pre_rework_status` (`loan_registry_reader.rs:89`) and
`translate_pre_rework_closure_reason` (`:100`). `grep -rn '// #1434' packages/` must return
nothing.

**F9 — DEPLOYMENT REALITY: the EVM indexer arm runs in no environment, deployed or local,
and no post-rework EVM deployment exists anywhere.** Established, not assumed:

| Source | State |
|---|---|
| `pipeline-contracts` HEAD | `4cc4678`, 2026-10-02 — post-rework (#45–#49 all merged) |
| `pipeline-contracts/deployments/` | 5 files: `anvil-test`, `hoodi-v1..v4`. Last commit touching the directory: **`dbee513`, 2026-06-02, "Deploy contracts v4 (#35)" — four months before HEAD** |
| Minter key in every deployment JSON | `PipelineYieldMinterV1` (v1–v3, anvil) / `PipelineYieldMinter` (v4). **None names `PipelineMinter`**, which every current deploy script writes (`script/deployers/DeployMinter.sol:15`) |
| New rework contracts in any deployment JSON | none — no `Pocket`, `CollateralRegistry`, `DealTokenFactory` |
| `pipeline-contracts` CI | `.github/workflows/test.yml` only: `forge fmt --check`, `forge build --sizes`, `forge test`. **No deploy job, no environments, no network secrets** — deployment is manual |
| Staging config (`../argocd/pipeline/test.yaml:86,174`) | `CHAINS: "99000001"` — Stellar testnet only. **Zero `CHAIN_*_ETH_RPC_URL` / `*_LOAN_REGISTRY_CONTRACTS` / `*_YIELD_MINTER_CONTRACTS` keys in the file** |
| Production config (`../argocd/pipeline/prod.yaml:166,245`) | `CHAINS: "99000002"` — Stellar mainnet only. Same: zero EVM chain keys |
| Local `.env:145,163` | `CHAINS="99000001"` |

So: the Issue body's "Known consequence" (this breaks `hoodi-v4` indexing) is correct but
understates the safety margin — hoodi is configured in no environment at all, not merely
absent from the local `.env`. **Nothing breaks when this lands, anywhere.** What breaks is
hypothetical and future: if someone points an EVM chain at a pre-rework deployment after
this lands, `LoanDrawn` (topic0 changed: `LoanDrawn(uint256,string)` vs
`LoanDrawn(uint256,address,string)`), `LoanDefaulted` (topic0 changed), `PaymentRecorded`
(topic0 changed), `CCRUpdated` / `LocationUpdated` (parsers deleted) and `YieldMinted`
(parser deleted) all stop decoding, and `mutableLoanData` / `immutableLoanData` eth_calls
fail to ABI-decode outright, which errors the whole snapshot path rather than degrading it.

**The equivalent of the Stellar statement cannot be made for EVM, and that is a finding,
not a gap in this research.** For Stellar one can say "staging and prod run contracts at
`pipeline-stellar-contracts` HEAD-or-near" because `test.yaml:181-182` names the #36
deployment ids. For EVM there is nothing to say: `pipeline-contracts` has no deploy
automation, no environment mapping (`script/base/Deployments.sol:13-15` picks the file from
an operator-supplied `deploymentTag` at runtime), no `docs/`, a stock Foundry `README.md`,
and the only configured chain is Hoodi (`script/base/ChainValues.sol:7,18`). Record it;
do not invent one.

**F10 — `CHAIN_<id>_YIELD_MINTER_CONTRACTS` is `env_csv_require`** (`config.rs:327`), i.e.
**required** for any EVM chain. Keeping the key (rather than renaming it to `MINTER`)
mirrors #1433's Stellar decision to keep `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` and avoids
making this Issue a config-breaking change for #1436. Doc comments change; the key does not.

**F11 — `ref_hash` must be lowercase hex with NO `0x` prefix.** `lp_bank_deposit_repo.rs:114,
135, 151` match with `decode(l.params->>'ref_hash', 'hex')`, and the Stellar parser writes
`hex::encode(bytes)` (`stellar/parsers.rs:444`). An EVM parser using
`FixedBytes::<32>::to_string()` would write `0x…` and the join would silently match
**nothing** — the exact class of invisible defect this epic exists to remove. Same for
`InterestAdjusted.reasonHash`.

**F12 — the EVM wire-in matcher does not exist yet, and `receiver` casing is a trap for
whoever writes it.** `relayer/stellar/wire_in_match.rs` is the only implementation;
`WireInMatcher` is implemented once, for `LpBankDepositRepo`, and `mark_minted_direct`
compares `l.params->>'receiver' <> $2` against the minter id. On EVM the parser writes
`to_checksum(None)` while `CHAIN_<id>_YIELD_MINTER_CONTRACTS` is typically lowercase in
env, so that predicate would be true for every row. Not fixed here (no EVM matcher to fix)
— recorded so the follow-up does not inherit a silent bug.

**F13 — indexing `PaymentUnrecorded` on EVM opens the same exposure #1447 describes for
Stellar.** `YieldMintOutboxRepo::discover_pending` (`shared/src/yield_mint_outbox_repo.rs:97`)
is the EVM path and matches `cl.event_name = 'PaymentRecorded'` (`:114`) with no
`PaymentUnrecorded` consideration anywhere in the file. #1447 already says "check the EVM
side for the same shape", so this Issue widens the exposure without owning the fix. Noted in
risks, not in scope.

**F14 — the EVM relayer's yield-mint phase targets a contract that no longer exists.**
`relayer/config.rs:27-29` documents `yield_minter_address` as "PipelineYieldMinter contract
address", and `relayer/yield_mint/mod.rs` submits against it. `PipelineYieldMinter` is gone
from `pipeline-contracts/src/`. Relayer is out of epic scope (#1431 decision 4); logged as
tech debt.

**F15 — three pieces of #1433's work already cover this arm; verify, do not duplicate.**
`shared/src/contract_logs_repo.rs:15-30` `LOAN_LIFECYCLE_EVENT_NAMES` already contains
`Disbursed`, `Undisbursed`, `PaymentUnrecorded`, `LoanWrittenDown`, `InterestAdjusted`.
`audit_log.rs:48-66` `AUDIT_EVENT_NAMES` already contains the same five, and `format_action`
already has an arm for each (`:338-379`), plus a chain-aware `param_amount` (`:233`) and the
shape-tolerant `LoanDefaulted` projection (`:300-314`). `ARCHITECTURE.md:63` has already
dropped `CCRUpdated` / `LocationUpdated` / `YieldMinted` and gained the five. The EVM arm
inherits all of it by writing the same `event_name` and param-key set — which is the whole
reason **D2** keys off #1433's names verbatim.

**F17 — four of the indexed events fire in the same transaction as a `StatusUpdated`, so
`disburse`, `setDefault` and `closeLoan` each write two snapshot rows at one block.** The
emission order is fixed and verified: `_disburse` emits `Disbursed` (`:287`) then
`StatusUpdated` (`:288`, only on the first disbursement); `_setDefault` emits
`StatusUpdated` (`:415`) then `LoanDefaulted` (`:416`); `_close` emits `StatusUpdated`
(`:530`) → `InterestSettled` (`:531`) → `LoanClosed` (`:532`); `_drawLoan` emits `LoanDrawn`
(`:244`) then `StatusUpdated(Approved)` (`:245`). Both rows carry the same on-chain state
(the eth_calls are block-pinned, not log-pinned), and every "latest snapshot" query orders
`block_number DESC, log_index DESC`, so the later row wins deterministically. This is
pre-existing behaviour on both arms, not something this Issue introduces — recorded because
it is the obvious thing to mistake for a bug when the five new events start doubling row
counts, and because it is a second reason **D1** defers `InterestSettled` (it would make the
close path write three rows instead of two, all identical).

**F16 — `LoanRolledOver.newRate` / `EconomicsAmended.newRate` are ppm and stored raw on EVM
too**, identical to Stellar's F8. `parsers.rs:317` and `:336` write `decoded.newRate` into
params with no conversion, and `audit_log.rs:321-335` projects it verbatim — a 10% rate
renders as `100000` in the Trustee feed. Out of scope for the same reason it was on #1433
(a `params` value, not a snapshot field, with its own back-compat question for stored rows);
the existing tech-debt entry already covers both arms once its wording is widened.

## Scope

### In scope

`packages/worker/src/indexer/parsers.rs`

1. Rewrite the `loan_registry` `sol!` block (`:25-48`) to the post-rework ABI; delete the
   `yield_minter` module (`:50-55`) and add a `minter` module.
2. `parse_loan_drawn` — two-topic form, no `holder`, `metadata_uri` from data (**F6**).
3. `parse_loan_defaulted` — `outstanding` / `moved`, no `ccr_bps`.
4. `parse_payment_recorded` — `loanId` (not `tokenId`), plus `outstanding`.
5. `parse_loan_status_updated` / `parse_loan_closed` — drop the translation calls (**F7**).
6. Delete `parse_loan_ccr_updated` (`:267`), `parse_loan_location_updated` (`:285`),
   `parse_yield_minted` (`:342`).
7. Add `parse_disbursed`, `parse_undisbursed`, `parse_payment_unrecorded`,
   `parse_loan_written_down`, `parse_interest_adjusted` (**D1**, **D2**).
8. Add `parse_wire_in` (`WireInRecorded` → `event_name` `"WireIn"`) and
   `parse_wire_in_assigned` (**D5**).

`packages/worker/src/indexer/evm_parsers.rs`

9. Import list (`:11-17`), the `loan_registry_contracts` chain (`:94-123`), and the
   `yield_minter_contracts` handler (`:124-132`) → the Minter group.

`packages/worker/src/indexer/loan_registry_reader.rs`

10. Replace the whole `sol!` interface (`:15-84`) with the post-rework one; delete
    `translate_pre_rework_status` (`:89`) and `translate_pre_rework_closure_reason` (`:100`)
    and every `// #1434:` marker (**F8**).
11. `immutable_loan_data` — decode `borrowerRef`; `seniorInterestRate / 100` (**D4**).
12. `decode_mutable_loan_data` — real decodes for all six placeholder fields;
    `currentRate / 100` (**D4**).
13. `cumulative_repayment_data` → `Ok(None)` (**D3**).

`packages/worker/src/indexer/loan_metadata.rs`

14. `MutableDataResolver::cumulative_repayment_data` returns
    `anyhow::Result<Option<RepaymentDataView>>` (**D3**).

`packages/worker/src/indexer/stellar/loan_registry_reader.rs`

15. Wrap the existing return in `Some(...)` — the only Stellar-arm change (**D3**).

`packages/worker/src/indexer/loan_mapper.rs`

16. Off-chain cumulative reconstruction when the resolver returns `None`, as a pure
    function plus two repo reads (**D3**).

`packages/shared/src/contract_logs_repo.rs`

17. Two new queries backing step 16 (**D3**). No change to `LOAN_LIFECYCLE_EVENT_NAMES`
    (**F15**) — assert it, do not edit it.

`packages/api/src/routes/audit_log.rs`

18. Shape-tolerant `PaymentUnrecorded` projection (**D6**).

`.env.example`, `packages/worker/src/indexer/config.rs`, `ARCHITECTURE.md`,
`docs/product-specs/audit-logging.md`, `docs/exec-plans/tech-debt-tracker.md` — see
**Docs to Update**.

Tests: `packages/worker/tests/parsers.rs`, `packages/worker/tests/loan_registry_reader.rs`,
`packages/worker/tests/loan_mapper.rs`, `packages/api/tests/audit_log.rs` — see
**Test Strategy**.

### Out of scope

- **Any Stellar parser or Stellar-specific reader logic.** The single Stellar edit is step
  15, forced by the trait signature.
- `loanMoney()` (**F4**), `economicsEpoch()`, `outstanding()`, `status()` — no consumer.
- `InterestSettled` and the three config events (**D1**).
- `Pocket`, `CollateralRegistry`, `DealTokenFactory` — per the Issue's own out-of-scope note.
- The relayer, including the EVM yield-mint phase (**F14**) and the `PaymentUnrecorded`
  outbox gap (**F13**, owned by #1447).
- `newRate` unit normalization (**F16**).
- Adding or changing any EVM chain's `.env` values — #1436 owns Ethereum mainnet config.
  Only `.env.example` **comments** change here.
- `docs/references/smart-contracts.md`, which documents the v2.3 *designed* contract
  (`updateCCR`, `updateLocation`, `ccrBps`, `location`) rather than either shipped repo —
  already tech-debt-logged by #1433.
- `LoanSnapshot` JSONB back-compat — settled in #1432 (TD-124: roll the API before the
  worker).

## Decisions

**D1 — index five of the six new events; defer `InterestSettled`. Full parity with #1433.**

Index: `Disbursed`, `Undisbursed`, `PaymentUnrecorded`, `LoanWrittenDown`,
`InterestAdjusted`. Defer: `InterestSettled`.

The same test applies — *does the event mutate a field #1432 added to `LoanSnapshot`?* —
and the EVM contract answers it identically, verified at the emission sites:

- `Disbursed` (`:287`) / `Undisbursed` (`:307`) → `loan.disbursed` (`:283`, `:304`).
- `PaymentUnrecorded` (`:375`) → `loan.repaid` (`:367`) and `$.repaymentTotals` (`:370-373`).
- `LoanWrittenDown` (`:438`) → `loan.writtenDown` (`:431`).
- `InterestAdjusted` (`:448`) → `loan.interestAdjustment` (`:446`), a signed accumulator.
- `InterestSettled` (`:531`) → **nothing.** It is emitted inside private `_close`, between
  `StatusUpdated(Closed)` at `:530` and `LoanClosed` at `:532`, and its three values are
  `paid = $.repaymentTotals[loanId].seniorInterest` (`:524`), `waived` (the residual
  accrued interest passed in from `_closeLoan:475` / `_closeDefaulted:492`) and
  `accrued = paid + waived`. Indexing it would write a second snapshot row at the same
  block carrying state identical to the `LoanClosed` row already written.

On EVM `PaymentUnrecorded` carries extra weight: per **D3** it is the subtraction trigger
for the reconstructed cumulative. Not indexing it would leave reversed payments counted
forever.

The three config events (`CapitalWalletSet`, `MaxFeeBpsSet`, `MaxResidualSet`) carry no
`loanId` — excluded outright, as #1433 excluded Stellar's four admin events.

**D2 — stored `event_name` and param keys mirror #1433 verbatim.** This is what buys
**F15**: the shared read side already works.

| EVM event | stored `event_name` | params |
|---|---|---|
| `LoanDrawn` | `LoanDrawn` | `loan_id`, `metadata_uri` |
| `StatusUpdated` | `LoanStatusUpdated` | `loan_id`, `status` |
| `LoanClosed` | `LoanClosed` | `loan_id`, `closure_reason` |
| `LoanDefaulted` | `LoanDefaulted` | `loan_id`, `outstanding`, `moved` |
| `PaymentRecorded` | `PaymentRecorded` | `loan_id`, `repayment_id`, the 7 flattened `RepaymentData` fields, `outstanding` |
| `PaymentUnrecorded` | `PaymentUnrecorded` | `loan_id`, `repayment_id`, `outstanding` (**F5** — no amounts) |
| `Disbursed` | `Disbursed` | `loan_id`, `amount`, `outstanding` |
| `Undisbursed` | `Undisbursed` | `loan_id`, `amount`, `outstanding` |
| `LoanWrittenDown` | `LoanWrittenDown` | `loan_id`, `amount`, `outstanding`, `burned`, `unabsorbed` |
| `InterestAdjusted` | `InterestAdjusted` | `loan_id`, `delta` (signed), `reason_hash` (lowercase hex, no `0x`) |
| `LoanRolledOver` | `LoanRolledOver` | unchanged |
| `EconomicsAmended` | `EconomicsAmended` | unchanged |
| `WireInRecorded` | **`WireIn`** | `id`, `receiver`, `amount`, `value_date`, `ref_hash` |
| `WireInAssigned` | `WireInAssigned` | `id`, `receiver` |

All `uint256`/`int256` values are decimal strings (`.to_string()`), matching both the
existing EVM parsers and the Stellar arm. `value_date` is a decimal string, matching
Stellar's `value_date.to_string()`. `receiver` is `to_checksum(None)`. `ref_hash` and
`reason_hash` are `hex::encode(...)` — lowercase, no `0x` (**F11**).

**D3 — `MutableDataResolver::cumulative_repayment_data` returns `Option`; EVM returns
`None` and the mapper reconstructs cumulative totals from indexed `PaymentRecorded` /
`PaymentUnrecorded` rows, with `senior_principal_repaid` overridden from
`MutableLoanData.repaid`.**

This is the #1432 Q3 deferral, now settled. Per **F3** no EVM contract call can serve this,
and per **F4** `loanMoney()` does not help. The alternatives and why they lose:

- *Zero-fill the six non-principal fields.* This is TD-123 again, and worse: `senior_interest`
  feeds `financial_position.rs:219`, `dashboard.rs:390`, `loan_financials.rs:244` and
  `waterfall.rs:483`; `mgmt_fee`/`perf_fee` feed `loan_financials.rs:245` and
  `waterfall.rs:479-481`; `offtaker_received` feeds `loan_book.rs:1459` ("Repaid to date"),
  `loan_financials.rs:253` and `waterfall.rs:403`; `oet_alloc` feeds `waterfall.rs:485`.
  Zeros there are plausible-looking and wrong.
- *Drop the trait method and accumulate on both arms.* Stellar's on-chain
  `cumulative_repayment_data` (`contracts/loan-registry/src/lib.rs:714`) is authoritative
  and self-healing; replacing it with an off-chain running total is a regression on an arm
  that is the only one actually running.
- *Running delta on `prior.repayment`.* Cheaper, but any missed, duplicated or out-of-order
  event corrupts the total permanently with no path back, and **F5** means
  `PaymentUnrecorded` needs the DB lookup anyway. The reconstruction below is idempotent at
  no extra query cost.

The shape:

- Trait (`loan_metadata.rs:163`) → `Result<Option<RepaymentDataView>>`. Doc comment states
  the contract: `Some` = this chain exposes an authoritative on-chain cumulative getter;
  `None` = it does not, and the caller must reconstruct from indexed rows.
- Stellar impl wraps its existing decode in `Some(...)` — one line, nothing else changes.
- EVM impl returns `Ok(None)` with a comment naming `LoanRegistryUpgradeable.sol:28-32,96`
  (private mapping, no getter) and `:331` (fees merged), so the next reader does not go
  looking for a getter that was never there.
- `loan_mapper.rs` gains `reconstruct_cumulative(conn, loan_id, mutable, in_flight)`:
  1. `contract_logs_repo.list_recorded_payments(conn, chain_id, contract_address, loan_id, max_block)`
     → `Vec<(repayment_id: String, RepaymentDataView)>`, read from
     `params->'event'` of `event_name = 'PaymentRecorded'` rows with
     `(params->>'loan_id')::numeric = $loan_id` and `block_number <= $max_block`.
  2. `contract_logs_repo.list_unrecorded_repayment_ids(conn, chain_id, contract_address, loan_id, max_block)`
     → `HashSet<String>` from `params->'event'->>'repayment_id'` of
     `event_name = 'PaymentUnrecorded'` rows, same filters.
  3. Pure `accumulate_repayments(recorded, reversed, in_flight) -> RepaymentDataView` —
     fold into a `BTreeMap<repayment_id, RepaymentDataView>` (so a duplicate row cannot
     double-count), apply the in-flight event, drop reversed ids, sum the rest.
  4. Override `senior_principal_repaid = mutable.repaid`, exactly as the Stellar contract
     assembles its own `cumulative_repayment_data` (`lib.rs:716-718`). Verified correct:
     `loan.repaid += repayment.seniorPrincipalRepaid` at `:324` and `-= principal` at `:367`
     are its only mutations, so it *is* Σ recorded − Σ reversed, read block-pinned.
- `in_flight` exists because `do_insert` composes the snapshot **before** writing the
  current event's own row: `InFlight::Recorded(repayment_id, data)` when
  `event_name == "PaymentRecorded"` (parsed from `self.event.params`), `InFlight::Unrecorded(repayment_id)`
  when `"PaymentUnrecorded"`, `None` otherwise.
- `max_block` is `self.event.block_number`, matching the `BlockHint` already used for the
  `eth_call`s, so the reconstruction and the on-chain read see the same point in time.
- `snapshot_for_drawn` must take `&mut PgConnection` (it does not today,
  `loan_mapper.rs:323`); at `LoanDrawn` the reconstruction returns zeros, which is correct
  and also correct on a resync that replays `LoanDrawn` after payments exist.

Cost: two indexed queries per EVM loan lifecycle event, each bounded by that loan's payment
count. Nothing on the Stellar arm.

**D4 — both rates are divided by 100 to reach basis points, with the scale pinned in a
comment.** Per **F1**: `ImmutableLoanData.seniorInterestRate / 100` →
`senior_interest_rate_bps`, and `MutableLoanData.currentRate / 100` → `current_rate`. The
comment names `LoanRegistryUpgradeable.sol:17` (`ONE = 1_000_000`), `:653` (the accrual
denominator `YEAR * ONE`) and `:235`/`:610` (where `currentRate` is assigned from the same
ppm value), so the next rename cannot erase the unit again. `LoanSnapshot.senior_interest_rate_bps`
keeps its name — it is a JSONB key on persisted rows and does hold basis points after
normalization.

**D5 — the Minter group reuses `CHAIN_<id>_YIELD_MINTER_CONTRACTS` and persists
`WireInRecorded` as `"WireIn"`.** Per the Issue body and in parity with the Stellar arm,
where one `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` serves both event families. The key is
`env_csv_require` (**F10**) so renaming it would break any future EVM chain config for
nothing; the doc comments change instead. The `"WireIn"` name (not `"WireInRecorded"`) is
what `lp_bank_deposit_repo.rs:111, 131, 151` matches on.

**D6 — the `PaymentUnrecorded` audit projection becomes shape-tolerant.** Same treatment
`LoanDefaulted` got in #1433 D4, for the same reason: the two arms emit different params
(**F5**). Project `senior_principal_repaid` / `senior_interest` when present (Stellar rows)
and `outstanding` when present (both arms), emitting only the keys the row actually has
rather than a fixed shape full of nulls.

**D7 — this Issue does NOT close #765. It fixes the rate defect in code and makes #765
decidable.** Three reasons, stated so the manager does not auto-close:

1. **The fix is real.** #765's investigation predicted exactly **F1**: "if it's
   ~`100_000`–`1_000_000` (fraction-of-1e6) rather than ~`1_000` (true bps), the EVM read
   path is missing the same ÷100 the Stellar reader has." Confirmed against the
   implementation. **D4** adds it.
2. **It cannot be verified.** #765 was observed on Hoodi (`chain_id` 560048). Per **F9**,
   Hoodi is in no `CHAINS` anywhere, its deployment is pre-rework, and there is no
   post-rework EVM deployment to re-observe on. Closing a bug whose symptom cannot be
   re-checked, on an arm that runs nowhere, is a guess.
3. **Only half of it is in scope.** #765 has a second half — the ~194,411% LTV — which is
   monetary decimal scale, not rate scale. `shared::chains::normalize_usdc_amount` (#901)
   addressed that for Stellar at read time; whether it closes the EVM half is a separate
   question this Issue does not touch.

Action: comment on #765 linking this plan and **D4**, state that the rate half is fixed in
code and awaits an EVM deployment to confirm, and leave it open. See **Q2** for the
ingest-time guard #765 also asks for.

## Assumptions and Risks

- **A1.** #1432 (`9133dc73`) and #1433 (`dc099757`) are both on `main`. `loan_mapper.rs`
  carries the canonical post-rework name tables, `MutableLoanDataView`/`LoanSnapshot` carry
  the post-rework shape, `ImmutableLoanDataView.borrower_ref` is
  `Option<FixedBytes<32>>`, and `LOAN_LIFECYCLE_EVENT_NAMES` / `AUDIT_EVENT_NAMES` /
  `format_action` already cover the five new names (**F15**). Verified by reading each file.
- **A2 — EVM ABI decode is positional.** Unlike Stellar's key-addressed map decode, a field
  transposed inside `ImmutableLoanData` or `MutableLoanData` produces a wrong number
  silently, not an error. The field orders quoted in **Ground truth** are load-bearing and
  must be re-checked against the sibling checkout before coding, since they were read on
  2026-10-08.
- **R1 — the reconstruction (D3) has no self-heal for six of seven fields.** A
  `PaymentRecorded` row that is never indexed (RPC gap, a `start_block` set past existing
  payments, a parser regression) leaves `offtaker_received`, `senior_interest`,
  `equity_distributed`, `mgmt_fee`, `perf_fee` and `oet_alloc` permanently understated, with
  no on-chain read to correct them. `senior_principal_repaid` **does** self-heal, because
  **D3** sources it from `mutable.repaid` — and it is the most-consumed of the seven
  (`collateral_valuation.rs:381`, `ccr_history.rs:238`, `loan_book.rs:1374,1616`,
  `waterfall.rs:444`). Mitigation is a reconciliation job, not part of this Issue; log as
  tech debt with the detection signal (`loanMoney().accruedInterest` drifting from
  `gross − (senior_interest + mgmt_fee + perf_fee) + interest_adjustment`).
- **R2 — the trait signature change touches the Stellar arm.** Step 15 is one line, but it
  is on the only arm that runs. A `Some(...)` omitted there is a compile error, not a silent
  defect, so the risk is low — but `cargo test -p pipeline-worker` must stay green on the
  Stellar reader tests, and `tests/loan_mapper.rs:114,219` (two mock resolvers) need the
  same signature update.
- **R3 — this is the first signed value on the EVM reader path.** `int256 interestAdjustment`
  and `int256 delta` decode to `I256`; a sign-handling slip renders a waiver as a huge
  positive. Covered by dedicated negative-value tests on both the parser and the reader.
- **R4 — `translate_pre_rework_*` deletion removes the only thing keeping the current EVM
  parsers honest against `hoodi-v4`.** Accepted deliberately per epic decision 2, and
  harmless per **F9**. But it means the existing `tests/loan_registry_reader.rs` is not
  "updated" — all four of its tests pin the pre-rework payload and must be **replaced**, not
  edited.
- **R5 — topic0 changes make old and new rows coexist without colliding.** `LoanDrawn`,
  `LoanDefaulted` and `PaymentRecorded` all get new signature hashes, so historical
  `contract_logs` rows written by the pre-rework parsers keep their `event_name` and keep
  rendering; nothing is rewritten. This is why **D2**/#1433 D3 keep every legacy name on the
  read side.
- **R6 — `hex` must already be a `pipeline-worker` dependency.** It is: `stellar/parsers.rs:444`
  uses `hex::encode`. Same crate, no `Cargo.toml` change.
- **R7 — conflict window with #1435/#1436.** Both touch `indexer/config.rs` and
  `.env.example`. Make every edit here comment-only and idempotent; expect to rebase
  whichever lands second.
- **R8 — widening #1447's exposure.** Indexing `PaymentUnrecorded` on EVM gives the EVM
  `discover_pending` path the same uncancelled-outbox-row gap (**F13**). Not reachable today
  (no EVM chain runs), but #1447's fix must cover both queries.

## Open Questions — all resolved

- **Q1 — D3's approach is APPROVED.** `MutableDataResolver::cumulative_repayment_data`
  becomes `Result<Option<RepaymentDataView>>`: the EVM arm returns `None`, the Stellar arm
  wraps its still-live on-chain getter in `Some(...)`, and the mapper reconstructs the EVM
  figures from indexed `PaymentRecorded` / `PaymentUnrecorded` rows, block-pinned and keyed
  by `repayment_id` so a re-process cannot double-count. The cheaper running-delta on
  `prior.repayment` was rejected for the reason the plan gives: it is not idempotent and
  needs the same DB read anyway.

- **Q2 — NO ingest-time rate guard.** Fixing the scale removes the cause; a guard is extra
  code guarding against a defect that no longer exists. Do not add the `warn!`.

- **Q3 — the relayer stays out of scope, and the dead EVM yield-minter target stays a
  tracker entry** rather than becoming its own Issue now. The EVM relayer runs in no
  environment either (see the deployment finding: `CHAINS` is Stellar-only in both argocd
  files), so a dead target there is latent, not live. #1447 owns the outbox half.

- **#765 is NOT closed by this Issue — comment only.** The rate half of its cause is fixed
  here, but: the symptom was observed on Hoodi, which runs nowhere and has no post-rework
  deployment to re-observe on, so closing it would assert a verification that cannot be
  performed; and its second half, the ~194,411% LTV, is monetary decimal scale rather than
  rate scale and is untouched. Post a comment on #765 explaining what was fixed and what
  remains, and leave it open.

## Implementation Steps

**Step 1 — re-verify the ABI.** Before writing code, re-read
`/Users/aabliazimov/Documents/work/pipeline-contracts/src/interfaces/ILoanRegistry.sol`,
`src/loanRegistry/LoanRegistryUpgradeable.sol:17-53` and `src/minter/MinterUpgradeable.sol:88-91`
against the **Ground truth** section. If HEAD has moved past `4cc4678`, diff the structs and
events and correct this plan before proceeding (**A2**).

**Step 2 — `parsers.rs` `sol!` blocks.** Replace the `loan_registry` module (`:25-48`) with
the post-rework events and `RepaymentData` from **Ground truth**, keeping the struct field
order exactly. Declare the enums as `uint8` in the event signatures (as today) — topic0 is
unchanged by the enum's Solidity type. Delete the `yield_minter` module (`:50-55`) and add a
`minter` module holding `WireInRecorded` and `WireInAssigned`. Delete the `// #1434:` comment
at `:28` and the `translate_pre_rework_*` import at `:7-9`.

**Step 3 — rewrite the five changed parsers.**
- `parse_loan_drawn` (`:167`) — drop `holder`; add `"metadata_uri": decoded.metadataURI`
  (**F6**); replace the dead-hash comment with one naming the new signature.
- `parse_loan_defaulted` (`:187`) — `"outstanding"` / `"moved"` as decimal strings; drop
  `ccr_bps`.
- `parse_payment_recorded` (`:223`) — `decoded.loanId` (field renamed from `tokenId`),
  `decoded.repayment` (renamed from `repaymentData`), plus `"outstanding"`.
- `parse_loan_status_updated` (`:249`) — `loan_status_name(decoded.newStatus)`, no
  translation.
- `parse_loan_closed` (`:205`) — `closure_reason_name(decoded.reason)`, no translation.

**Step 4 — delete the dead parsers.** `parse_loan_ccr_updated` (`:267`),
`parse_loan_location_updated` (`:285`), `parse_yield_minted` (`:342`).

**Step 5 — add the five new loan parsers** (**D1**, **D2**), each following the file's
established shape (decode → `extract_log_meta` → `ContractLog`):

| fn | params |
|---|---|
| `parse_disbursed` | `loan_id`, `amount`, `outstanding` |
| `parse_undisbursed` | `loan_id`, `amount`, `outstanding` |
| `parse_payment_unrecorded` | `loan_id`, `repayment_id`, `outstanding` |
| `parse_loan_written_down` | `loan_id`, `amount`, `outstanding`, `burned`, `unabsorbed` |
| `parse_interest_adjusted` | `loan_id`, `delta` (`I256::to_string()`), `reason_hash` (`hex::encode`) |

**Step 6 — add the two Minter parsers** (**D5**). `parse_wire_in` decodes `WireInRecorded`
and emits `event_name: "WireIn"` with `id`, `receiver` (`to_checksum(None)`), `amount`,
`value_date`, `ref_hash` (`hex::encode(decoded.refHash.as_slice())` — lowercase, **no `0x`**,
**F11**). `parse_wire_in_assigned` emits `id`, `receiver`. Doc comments carry the verbatim
Solidity signature and name `lp_bank_deposit_repo.rs` as the consumer.

**Step 7 — `evm_parsers.rs`.** Update the import list (`:11-17`); in the
`loan_registry_contracts` chain (`:95-103`) drop `parse_loan_ccr_updated` /
`parse_loan_location_updated` and add the five new ones; replace the
`yield_minter_contracts` handler (`:124-132`) with
`parse_wire_in(log).or_else(|| parse_wire_in_assigned(log))`, keeping `ContractLogMapper`
(these are not loan events). Rename the local `yield_minter_repo` binding (`:60`) to
`minter_repo` and update the handler's doc comment.

**Step 8 — `loan_registry_reader.rs` `sol!` block.** Replace `:15-84` wholesale: the two
enums with their full post-rework variant sets, `ImmutableLoanData` (8 fields),
`MutableLoanData` (12 fields), `RepaymentData` (7 fields, retained — the mapper's view type
still uses it), and the two surviving functions `immutableLoanData` / `mutableLoanData`.
Delete `LocationType`, `LocationUpdate`, the `cumulativeRepaymentData` declaration, and both
`translate_pre_rework_*` functions (`:88-109`).

**Step 9 — `immutable_loan_data`** (`:168`). Decode `borrowerRef` into
`Some(FixedBytes::<32>::from(d.borrowerRef))`, deleting the `// #1434:` marker at `:191`.
`None` must remain reachable only as "not decoded"; an all-zero on-chain `bytes32` decodes
to `Some(FixedBytes::ZERO)`. Set `senior_interest_rate_bps: d.seniorInterestRate / 100`
with the **D4** scale comment.

**Step 10 — `decode_mutable_loan_data`** (`:117`). Replace all six placeholders:
`current_rate: d.currentRate / 100` (**D4**), `carved_out: d.carvedOut`,
`disbursed`/`repaid`/`written_down` straight through (already `U256`),
`interest_adjustment: d.interestAdjustment` (already `I256`). `status` and `closure_reason`
become `d.status as u8` / `d.closureReason as u8` with no translation. Rewrite the function
doc comment — it currently describes decoding-and-discarding hoodi-v4's CCR fields.

**Step 11 — the trait** (`loan_metadata.rs:152-168`). Change
`cumulative_repayment_data` to `-> anyhow::Result<Option<RepaymentDataView>>` and rewrite
its doc comment per **D3**. Add `impl Default for RepaymentDataView` (all `U256::ZERO`) if
one does not exist.

**Step 12 — the two resolver impls.** EVM (`loan_registry_reader.rs:232`) → delete the
`eth_call` body and return `Ok(None)` with the **F3** citation. Stellar
(`stellar/loan_registry_reader.rs:144`) → wrap the existing
`decode_cumulative_repayment_data(&scval)` result in `Some(...)`.

**Step 13 — the two repo queries** (`shared/src/contract_logs_repo.rs`). Add
`list_recorded_payments` and `list_unrecorded_repayment_ids` per **D3**. Both filter on
`chain_id`, `contract_address`, `(params->>'loan_id')::numeric` and `block_number <= $4`,
and read `params->'event'` (the `LoanEventMapper` nesting — the same shape
`yield_mint_outbox_repo` reads as `params->'event'->>'repayment_id'`). Follow the file's
existing `sqlx::query` + `try_get` style; `contract_logs` has no `loan_id` column, so the
JSONB expression is required (see `:282`, `:342`, `:477`, `:509` for the idiom).

**Step 14 — the mapper** (`loan_mapper.rs`). Add the pure
`accumulate_repayments(recorded, reversed, in_flight) -> RepaymentDataView` and the
`InFlight` enum next to the other pure composers (`:90-240`), so they are unit-testable with
no DB. Add `reconstruct_cumulative(...)` on `LoanEventMapper`. In `snapshot_for_drawn`
(`:323`, which must now take `&mut PgConnection`) and `snapshot_for_lifecycle` (`:383`),
replace the direct `cumulative_repayment_data` call with the `match … { Some(c) => c, None =>
self.reconstruct_cumulative(…).await? }` form, then apply the
`senior_principal_repaid = mutable.repaid` override. Update the `do_insert` call site
(`:455`) to pass `conn`.

**Step 15 — `audit_log.rs`** (**D6**). Make the `PaymentUnrecorded` arm (`:356-366`)
shape-tolerant: build `details` incrementally from whichever of `senior_principal_repaid`,
`senior_interest`, `outstanding` `param_amount` actually resolves, following the
`LoanDefaulted` arm (`:300-314`) as the pattern. No change to `AUDIT_EVENT_NAMES` or any
other arm (**F15**) — verify each of the five new names already has an arm rather than
adding one.

**Step 16 — config doc comments.** `indexer/config.rs` (the EVM `IndexerJobSettings` block
around `:299-317` — add a doc comment to `yield_minter_contracts` mirroring the Stellar
`yield_minter_id` one at `:38-47`) and `.env.example:156` — the key stays
`CHAIN_<id>_YIELD_MINTER_CONTRACTS` (**F10**), the comment stops saying
"PipelineYieldMinter" and says: the Minter contract (`PipelineMinter` in
`pipeline-contracts`), whose `WireInRecorded`/`WireInAssigned` are indexed as
`WireIn`/`WireInAssigned` for the relayer's wire-in matching (#1416, #1417). Leave
`.env.example:159` (`RELAYER_YIELD_MINTER_ADDRESS`) alone — relayer, out of scope (**F14**),
tech-debt-logged instead.

**Step 17 — tests.** Per **Test Strategy**.

**Step 18 — verification sweep.** `grep -rn '// #1434' packages/` must return nothing
(**F8**). `grep -rn 'translate_pre_rework' packages/` must return nothing. Then
`cargo fmt`, `cargo clippy --all --all-targets -- -D warnings`,
`cargo test -p pipeline-worker`, `cargo test -p pipeline-shared`,
`cargo test -p pipeline-api`, `cargo build --workspace`.

## Test Strategy

All tests are **pure unit tests in external files** under `packages/<pkg>/tests/` — no
inline `#[cfg(test)] mod tests` in `src/`, and **no `DATABASE_URL`, `POSTGRES_URL` or any
env var reaching a Postgres** (repo rules, overriding defaults). EVM fixtures are built with
the `alloy::sol!` + `LogData::new` + `SIGNATURE_HASH` idiom the file already uses
(`tests/parsers.rs:16-46`), which means the test file's re-declared `sol!` block must be
rewritten in lockstep with the source one — and that is deliberate: a transposed field in
either shows up as a failing decode.

### `packages/worker/tests/parsers.rs`

Rewrite the re-declared `sol!` block (`:16-46`) to the post-rework signatures, add the
`minter` events, and drop `CCRUpdated` / `LocationUpdated` / `YieldMinted`.

Rewrite:
- `loan_drawn_decodes` (`:250`) — two-topic log, URI in the data section. Assert `loan_id`,
  assert `params["metadata_uri"]` equals the URI (**inverting** the current `is_none()`
  assertion at `:281-284`), and assert `params.get("holder").is_none()`.
- `loan_defaulted_decodes` (`:477`) — `outstanding` / `moved` as decimal strings;
  `params.get("ccr_bps").is_none()`.
- `payment_recorded_decodes` (`:381`) — `loanId`/`repayment` field renames; `outstanding`
  appended to the data section after the 7×32-byte tuple. Keep the explicit byte-offset
  construction — it is what pins field order.
- `loan_status_updated_decodes` (`:535`) and `loan_closed_*` (`:290`, `:321`, `:351`) —
  rebuild on the post-rework ordinals: `0 → "Approved"`, `1 → "Performing"`,
  `3 → "Cancelled"` for `ClosureReason`.
- `loan_status_updated_translates_every_pre_rework_ordinal` (`:549`) — **invert** into
  `loan_status_updated_uses_canonical_ordinals`: all five `LoanStatus` ordinals and all six
  `ClosureReason` ordinals map to their canonical names with no translation. This is the
  test that fails loudly if someone reintroduces a shift.

Delete: `loan_ccr_updated_decodes` (`:570`), `loan_location_updated_decodes` (`:600`),
`yield_minted_decodes` (`:448`), and their imports.

Add, per new parser: a happy-path decode and a wrong-topic0 rejection, plus specifically —
- `interest_adjusted_decodes_negative_delta` — a negative `int256` (e.g. `-250_000`)
  asserting the exact decimal string (**R3**).
- `interest_adjusted_reason_hash_is_lowercase_hex_without_0x` — asserts
  `!params["reason_hash"].as_str().unwrap().starts_with("0x")` and that it is 64 chars.
  This is **F11**'s guard and its absence is a silent production defect, not a cosmetic one.
- `wire_in_decodes` — asserts `event_name == "WireIn"` (**not** `"WireInRecorded"`), the
  checksummed `receiver`, `amount`/`value_date` as decimal strings, and the same
  lowercase-no-`0x` assertion on `ref_hash`.
- `wire_in_assigned_decodes` — `event_name == "WireInAssigned"`, `id` and `receiver`,
  no-data log.
- `loan_written_down_decodes` with all four amounts at `U256::MAX`, matching the file's
  large-value convention.
- A **dispatch-ordering** test: a `PaymentUnrecorded` log must not be claimed by
  `parse_payment_recorded`, and vice versa (different topic0, same topic arity).

### `packages/worker/tests/loan_registry_reader.rs`

All four existing tests pin the **pre-rework** payload (**R4**) and must be replaced, along
with the `pre_rework_payload` helper (`:15`) and the file's header doc comment.

- `decode_mutable_loan_data_happy_path` — a full post-rework `MutableLoanData` fixture;
  assert `current_rate == 1_000` from a raw `100_000` (**D4**: 10% at ppm → 1,000 bps),
  `carved_out == true`, and the three money fields.
- `decode_mutable_loan_data_negative_interest_adjustment` — a negative `int256` decoding to
  the matching `I256` (**R3**).
- `decode_mutable_loan_data_every_status_ordinal` / `_every_closure_reason_ordinal` — all
  five and all six, asserting the canonical names with no translation. Keep the spirit of
  `decode_then_name_performing_is_not_approved` (`:64`) as an explicit
  `ordinal 0 → "Approved"` / `ordinal 1 → "Performing"` pair.
- `decode_mutable_loan_data_rejects_pre_rework_payload` — ABI-encode the **old** struct
  shape and assert the decode errors. This pins **R5**: a pre-rework deployment fails loudly
  rather than decoding into transposed fields.
- `decode_immutable_loan_data_*` — this file has no immutable-side tests today. Add them by
  extracting the decode out of the `async fn` into a pure
  `decode_immutable_loan_data(result: &[u8]) -> Result<ImmutableLoanDataView>`, mirroring how
  `decode_mutable_loan_data` is already split (`loan_registry_reader.rs:117`). Then assert:
  `borrower_ref == Some(expected)`; an **all-zero** `borrowerRef` decodes to
  `Some(FixedBytes::ZERO)` and **not** `None` (Step 9's distinction);
  `senior_interest_rate_bps == 1_000` from a raw `100_000` — the **F1 / #765** regression
  test, and the single most important assertion in this Issue.

### `packages/worker/tests/loan_mapper.rs`

- Update the two mock `MutableDataResolver` impls (`:114`, `:219`) to the `Option` signature
  (**R2**); one returns `Some(...)` (Stellar-like) and one `None` (EVM-like).
- New tests for the pure `accumulate_repayments` (**D3**), no DB:
  - three recorded payments, none reversed → field-wise sum;
  - one of three reversed → that one excluded;
  - the in-flight `Recorded` event is included even though it is absent from the "DB" slice;
  - the in-flight `Unrecorded` event excludes a payment that *is* in the slice;
  - a duplicated `repayment_id` in the slice is counted **once** (the idempotence property
    that justifies D3 over the running-delta alternative);
  - an empty slice yields all zeros (the `LoanDrawn` case).
- A composer test asserting `senior_principal_repaid` comes from `mutable.repaid` and
  **not** from the accumulated sum, by feeding the two deliberately different values.

### `packages/api/tests/audit_log.rs`

- Add an EVM-shaped `PaymentUnrecorded` case (`{loan_id, repayment_id, outstanding}`)
  asserting `details` carries `outstanding` and does **not** carry null-valued
  `senior_interest` / `senior_principal_repaid` keys (**D6**).
- Keep the existing Stellar-shaped `PaymentUnrecorded` case asserting both amount keys still
  render.
- No new `format_action` arms are expected — if one is missing, **F15** is wrong and the plan
  needs revisiting rather than a quiet addition.

### Verification

`cargo clippy --all --all-targets -- -D warnings`; `cargo test -p pipeline-worker`;
`cargo test -p pipeline-shared`; `cargo test -p pipeline-api`; `cargo build --workspace`;
plus the two greps in Step 18. No frontend or Figma verification applies — the Issue is
backend-only and the epic's frontend consequence is tracked standalone as #1441.

## Docs to Update

- **`ARCHITECTURE.md:63`** — **verify only.** #1433 already removed `CCRUpdated`,
  `LocationUpdated` and `YieldMinted` and added the five new names. If the line reads as it
  does today, change nothing (the edit was specified as idempotent on both Issues).
- **`docs/product-specs/audit-logging.md:66`** — the parenthetical currently says the three
  retired names are "read-path-only on the Stellar arm post-#1433". Widen it: post-#1434 they
  are read-path-only on **both** arms, with historical rows still rendering (#1433 D3).
- **`.env.example:156`** and **`packages/worker/src/indexer/config.rs`** — Step 16.
- **`docs/exec-plans/tech-debt-tracker.md`** —
  - **close TD-123 outright.** #1433 closed the Stellar half; Steps 9–10 close the EVM half.
    Mark the entry resolved rather than deleting it.
  - **widen the `new_rate` entry** added by #1433 (**F16**) to say both arms store the ppm
    value raw and `audit_log.rs` renders it raw in the Trustee feed.
  - **new entry — EVM cumulative repayment totals are reconstructed off-chain and six of the
    seven fields have no self-heal** (**R1**). Record the cause
    (`LoanRegistryUpgradeable.sol:28-32,96` — private `RepaymentTotals`, no getter; `:331`
    merges `mgmtFee`+`perfFee` into `interestFees`; `equityDistributed`/`oetAlloc` not
    accumulated at all), the exception (`senior_principal_repaid` from `mutable.repaid`),
    and the detection signal.
  - **new entry — the EVM relayer's yield-mint phase targets a deleted contract**
    (**F14**): `relayer/config.rs:27-29` and `relayer/yield_mint/mod.rs` submit against
    `PipelineYieldMinter`, which no longer exists in `pipeline-contracts/src/`.
  - **new entry — no EVM deployment exists for the current contracts, and no environment
    mapping exists to produce one** (**F9**): `pipeline-contracts/deployments/` is four
    months stale and pre-rework, the repo has no deploy CI and no `docs/`, and neither
    `argocd/pipeline/test.yaml` nor `prod.yaml` configures any EVM chain. This blocks #1436
    in substance, not just in config.
  - **new entry — `outstanding` is defined two ways** (**F4**): the contract's
    `disbursed − repaid − writtenDown` (`LoanRegistryUpgradeable.sol:657`) versus the API's
    `original_senior_tranche − senior_principal_repaid` (`loan_book.rs:1374`).
  - **new entry — the EVM wire-in `receiver` casing trap** (**F12**), for whoever writes the
    EVM `WireInMatcher`.
- **`docs/exec-plans/known-bugs.md`** — no entry. Per **F9** nothing is actively broken; the
  one live defect found (**F1**, the missing `/100`) already has an open Issue in #765 and is
  fixed by this one.
- **#765** — post a comment per **D7**: the rate half is confirmed and fixed, cite
  `LoanRegistryUpgradeable.sol:17,653`, state that it cannot be verified until an EVM chain
  runs post-rework contracts, and that the LTV half is untouched. **Do not close.**
- **This plan** — move to `docs/exec-plans/completed/` at the end.

## Progress

- [ ] 1. Re-verify the ABI against the sibling checkout
- [ ] 2. `parsers.rs` `sol!` blocks — loan registry rewritten, minter added, yield-minter deleted
- [ ] 3. Five changed parsers (`LoanDrawn`, `LoanDefaulted`, `PaymentRecorded`, `StatusUpdated`, `LoanClosed`)
- [ ] 4. Deleted `parse_loan_ccr_updated`, `parse_loan_location_updated`, `parse_yield_minted`
- [ ] 5. Five new loan parsers
- [ ] 6. Two Minter parsers (`WireIn`, `WireInAssigned`)
- [ ] 7. `evm_parsers.rs` handler chains and imports
- [ ] 8. `loan_registry_reader.rs` `sol!` block + both `translate_pre_rework_*` deleted
- [ ] 9. `immutable_loan_data` — `borrower_ref` decoded, rate ÷ 100
- [ ] 10. `decode_mutable_loan_data` — six placeholders replaced, `current_rate` ÷ 100
- [ ] 11. `MutableDataResolver::cumulative_repayment_data` → `Option`
- [ ] 12. Both resolver impls updated (EVM `None`, Stellar `Some`)
- [ ] 13. Two new `ContractLogsRepo` queries
- [ ] 14. Mapper reconstruction + `accumulate_repayments`
- [ ] 15. `audit_log.rs` shape-tolerant `PaymentUnrecorded`
- [ ] 16. Config doc comments (`config.rs`, `.env.example`)
- [ ] 17. Tests — see Test Strategy
- [ ] 18. Verification sweep (two greps, fmt, clippy, tests, build)
