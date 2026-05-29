# Trustee Console & LoanRegistry-Backed Minting — Product Spec

## Overview

LoanRegistry holds per-loan origination economics, an append-only rate and maturity
schedule, lifecycle state, and full repayment accounting on-chain. YieldMinter consults
LoanRegistry on every loan-tied PLUSD mint and rejects amounts that exceed either the
operational gate (recorded but not yet minted) or the maturity-capped ceiling summed across
the loan's economics epochs. The Trustee Console is the single
web surface where the Trustee runs origination approval, repayment intake, yield minting,
T-Bill allocation, and lifecycle updates. Authentication and Console-shared mechanics are
in [operations-console.md](./operations-console.md).

---

## Behavior

### Loan economics on-chain

`mintLoan` writes genesis origination economics into LoanRegistry storage alongside the
IPFS `metadataURI` and the initial location, and seeds `epochs[0]` from those economics.
The IPFS document carries only descriptive material (borrower hash, commodity, corridor,
governing law, additional documents) and is appendable through the loan's life. Anything
that drives the waterfall, an aggregate, or a mint cap reads from chain.

Rate and maturity are not frozen for the loan's whole life. They live in an append-only
`EconomicsEpoch[]`. A post-maturity `rollover` (Trustee, no timelock) or a RISK_COUNCIL
`amendEconomics` (24h timelock, used for default re-terms) appends an epoch. Genesis
economics are never rewritten, so the original terms and every re-term stay on-chain.

### Per-loan repayment ledger

Each LoanRegistry token tracks its own repayment counters: `offtakerReceivedTotal`,
`seniorPrincipalRepaid`, `seniorInterestRecorded`, `mgmtFeeRecorded`, `perfFeeRecorded`,
`oetAllocRecorded`, `equityDistributed`. `recordPayment` increments these per loan.
Protocol-wide rollups stay on the registry as derived sums for cheap reads and
PLUSD-invariant checks.

### Per-loan mint cap

YieldMinter exposes two distinct paths and tracks per-loan mints in its own storage.

`mintLoanYield` requires `att.loanId` to point to a loan in `Performing` or `Watchlist`.
`Matured`, `Default`, and `Closed` refuse mints. For `leg = Vault`:
```
vaultMintedByLoan[loanId] + att.amount <= min(
  seniorInterestRecorded[loanId],
  ceiling(loanId)
)

ceiling(loanId) = Σ over epochs e of
  originalSeniorTranche * e.seniorInterestRateBps
    * ( min(block.timestamp, e.maturityDate) - e.effectiveFrom ) / (365 days * 10_000)
```
The ceiling is the maturity-capped piecewise sum across the epoch schedule. Each epoch's
accrual stops at its own maturity, so a loan past maturity without a rollover cannot accrue
beyond its contracted term, and a rollover re-opens accrual under the new rate. For
`leg = Treasury`:
```
treasuryMintedByLoan[loanId] + att.amount
  <= mgmtFeeRecorded[loanId] + perfFeeRecorded[loanId] + oetAllocRecorded[loanId]
```
`destination` is bound by leg: `Vault` must equal the sPLUSD vault, `Treasury` must equal
the Treasury Wallet. Replay is gated by `usedLoanRefs[att.repaymentRef]`.

`mintTbillYield` carries no `loanId`. Cap is governed by Capital Wallet USYC NAV delta
from the Relayer's `last_minted_NAV` baseline (see [yield.md](./yield.md)). Replay is
gated by `usedTbillRefs[att.navRef]`.

Both paths require Relayer ECDSA + custodian EIP-1271 + the YieldMinter proxy holding
`YIELD_MINTER` on PLUSD.

### Repayment to mint flow

Relayer surfaces an unmatched Capital Wallet USDC inflow in the Console. Trustee picks
the loan, Console computes the waterfall against on-chain economics + protocol fee
schedule + actual tenor, Trustee accepts or adjusts components, then broadcasts
`recordPayment(loanId, ...full split...)` from the Trustee key. Relayer reads the new
counters, constructs one `LoanYieldAttestation` per leg (both bound to `loanId`),
requests custodian co-signature, and submits `mintLoanYield` twice. Console shows the
ticket move Recorded → Vault Minted → Treasury Minted.

### Trustee Console panels

| Panel | Scope | Primary actions |
|---|---|---|
| Loans Board | Every loan with row-level state. Columns include outstanding senior, accrued interest, recorded interest, unminted delta per leg, status, CCR (with age), current maturity, epoch count, location. Filterable by status, watchlist, originator, corridor. | View detail, Record payment, Update status, Update CCR, Update location, Roll over (post-maturity), Close, Escalate to Default. |
| Repayment Intake | Unmatched Capital Wallet inflows and open intake tickets awaiting mint. | Match to loan, compute waterfall, adjust, broadcast `recordPayment`. |
| Mint Queue | Loans with non-zero unminted Vault or Treasury delta, with aging clock. | Retrigger Relayer, inspect custodian co-sig, view PLUSD invariant. |
| T-Bill Allocation | Capital Wallet USDC/USYC, ratio vs target band, forward strip (queued withdrawals + approved-not-disbursed loans + expected repayments in window), recent swaps. | Initiate Capital Wallet swap (Trustee cosig on custodian MPC policy). |
| Origination Queue | Pending Originator EIP-712 requests. | Approve (broadcasts `mintLoan`), Request changes, Reject. |
| Audit Log | Append-only stream of Trustee actions. | Read-only. |

`Default` transitions, `amendEconomics` re-terms, and write-down `closeLoan` reasons
compose proposals into the RISK_COUNCIL Safe rather than executing from the Console.
`rollover` executes directly from the Trustee key once the loan is past maturity.

### Trustee aggregates

| Scope | Aggregate | Source |
|---|---|---|
| Loan | outstanding senior principal | `originalSeniorTranche − seniorPrincipalRepaid` |
| Loan | outstanding offtaker | `originalOfftakerPrice − offtakerReceivedTotal` |
| Loan | accrued interest | maturity-capped piecewise sum over epochs (the `ceiling(loanId)` formula) |
| Loan | unminted vault / treasury | `recorded − mintedByLoan` per leg |
| Loan | days to maturity | `currentMaturityDate − now` |
| Portfolio | deployed, at-risk, weighted tenor/rate, concentration | sums and weighted aggregates over active and `{Watchlist, Default}` loans |
| Portfolio | cumulative minted | `Σ vaultMintedByLoan`, `Σ treasuryMintedByLoan` |
| Reserves | backing invariant, ledger invariant, USYC NAV vs band | Relayer-published, `PLUSD.assertLedgerInvariant()`, Hashnote |

---

## API Contract

The full `ILoanRegistry` surface (`mintLoan`, `recordPayment`, `rollover`,
`amendEconomics`, `setDefault`, `closeLoan`, `updateMutable`, and the `getImmutable` /
`getMutable` / `getEpochs` views) with access controls and timelocks is in
[loans-data.md](./loans-data.md). The YieldMinter surface:

```solidity
interface IYieldMinter {
    function mintLoanYield(LoanYieldAttestation att, bytes relayerSig, bytes custodianSig) external;
    function mintTbillYield(TbillYieldAttestation att, bytes relayerSig, bytes custodianSig) external;
    function vaultMintedByLoan(uint256 loanId)    external view returns (uint256);
    function treasuryMintedByLoan(uint256 loanId) external view returns (uint256);
}
```

`updateMutable` carries no economic arguments. Rate and maturity move only through
`rollover` (TRUSTEE, post-maturity, no timelock) or `amendEconomics` (RISK_COUNCIL, 24h).

---

## Data Model

```solidity
struct ImmutableLoanData {            // genesis economics, written once, mirrored into epochs[0]
    uint256 originalFacilitySize;     // 6-decimal USDC
    uint256 originalSeniorTranche;    // accrual base for every epoch
    uint256 originalEquityTranche;
    uint256 originalOfftakerPrice;
    uint32  seniorInterestRateBps;    // genesis rate
    uint64  originationDate;
    uint64  originalMaturityDate;
}
struct EconomicsEpoch {               // append-only; rollover and amendEconomics push a row
    uint64 effectiveFrom; uint64 maturityDate; uint32 seniorInterestRateBps;
}
struct MutableLoanData {
    LoanStatus status; uint32 ccrBps; uint64 lastReportedCCRTimestamp;
    uint64 currentMaturityDate; ClosureReason closureReason;
    string location; string metadataURI;
    uint256 offtakerReceivedTotal; uint256 seniorPrincipalRepaid;
    uint256 seniorInterestRecorded; uint256 mgmtFeeRecorded;
    uint256 perfFeeRecorded; uint256 oetAllocRecorded; uint256 equityDistributed;
}
struct LoanYieldAttestation {
    bytes32 repaymentRef;   // keccak256(chainId, repaymentTxHash, loanId, leg)
    uint256 loanId; YieldLeg leg; address destination;
    uint256 amount; uint64 deadline; uint256 salt;
}
struct TbillYieldAttestation {
    bytes32 navRef;         // keccak256(chainId, navTimestamp, leg)
    YieldLeg leg; address destination;
    uint256 amount; uint64 deadline; uint256 salt;
}
enum YieldLeg      { Vault, Treasury }
enum LoanStatus    { Performing, Watchlist, Matured, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }
```

`mintLoan` and `recordPayment` revert conditions are in [loans-data.md](./loans-data.md):
the tranche-sum and date invariants at mint, and the split-sum and status checks on record.

---

## Security Considerations

- **Three independent layers gate any loan-tied PLUSD mint.** Operational gate:
  Trustee-signed `recordPayment` credits net senior coupon and fee amounts to the loan
  before any mint. Maturity-capped ceiling on Vault leg: cumulative vault mints per loan
  cannot exceed the piecewise `ceiling(loanId)` summed across the epoch schedule, with each
  epoch's accrual stopping at its own maturity. PLUSD ledger invariant
  `cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns == totalSupply`
  asserted on every mint path. Two-party attestation (Relayer ECDSA + custodian EIP-1271)
  remains required.
- **Re-terms cannot mint.** `rollover` and `amendEconomics` only append an epoch, so they
  can only raise the ceiling. A lone compromised Trustee key that rolls a loan still needs
  `recordPayment` plus the two-party attestation to mint, so the fast-path rollover carries
  no extra mint risk. Genesis economics are never rewritten.
- **Matured, Default, and Closed loans refuse mints.** `mintLoanYield` reverts on any
  `loanId` whose status is not `Performing` or `Watchlist`. Destination is bound by leg.
- **Console signing surfaces.** Origination approvals, lifecycle updates, and
  `recordPayment` are Trustee-key transactions broadcast directly. Disbursements, T-Bill
  swaps, and Treasury redemption stages remain MPC-cosigned with Team and custodian. No
  Console action moves USDC from the Capital Wallet alone.
- **Audit log.** Every Console action is appended to the log defined in
  [audit-logging.md](./audit-logging.md).
