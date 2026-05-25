# Trustee Console & LoanRegistry-Backed Minting — Product Spec

## Overview

LoanRegistry holds per-loan origination economics, lifecycle state, and full repayment
accounting on-chain. YieldMinter consults LoanRegistry on every loan-tied PLUSD mint and
rejects amounts that exceed either the operational gate (recorded but not yet minted) or
the immutable ceiling (`principal × rate × elapsed`). The Trustee Console is the single
web surface where the Trustee runs origination approval, repayment intake, yield minting,
T-Bill allocation, and lifecycle updates. Authentication and Console-shared mechanics are
in [operations-console.md](./operations-console.md).

---

## Behavior

### Loan economics on-chain

`mintLoan` writes immutable origination economics into LoanRegistry storage alongside the
IPFS `metadataURI` and the initial location. The IPFS document carries only descriptive
material (borrower hash, commodity, corridor, governing law, additional documents).
Anything that drives the waterfall, an aggregate, or a mint cap reads from chain.

### Per-loan repayment ledger

Each LoanRegistry token tracks its own repayment counters: `offtakerReceivedTotal`,
`seniorPrincipalRepaid`, `seniorInterestRecorded`, `mgmtFeeRecorded`, `perfFeeRecorded`,
`oetAllocRecorded`, `equityDistributed`. `recordPayment` increments these per loan.
Protocol-wide rollups stay on the registry as derived sums for cheap reads and
PLUSD-invariant checks.

### Per-loan mint cap

YieldMinter exposes two distinct paths and tracks per-loan mints in its own storage.

`mintLoanYield` requires `att.loanId` to point to a loan in `Performing` or `Watchlist`.
For `leg = Vault`:
```
vaultMintedByLoan[loanId] + att.amount <= min(
  seniorInterestRecorded[loanId],
  originalSeniorTranche * seniorInterestRateBps
    * (block.timestamp - originationDate) / (365 days * 10_000)
)
```
For `leg = Treasury`:
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
| Loans Board | Every loan with row-level state. Columns include outstanding senior, accrued interest, recorded interest, unminted delta per leg, status, CCR (with age), maturity, location. Filterable by status, watchlist, originator, corridor. | View detail, Record payment, Update status, Update CCR, Update location, Extend maturity, Close, Escalate to Default. |
| Repayment Intake | Unmatched Capital Wallet inflows and open intake tickets awaiting mint. | Match to loan, compute waterfall, adjust, broadcast `recordPayment`. |
| Mint Queue | Loans with non-zero unminted Vault or Treasury delta, with aging clock. | Retrigger Relayer, inspect custodian co-sig, view PLUSD invariant. |
| T-Bill Allocation | Capital Wallet USDC/USYC, ratio vs target band, forward strip (queued withdrawals + approved-not-disbursed loans + expected repayments in window), recent swaps. | Initiate Capital Wallet swap (Trustee cosig on custodian MPC policy). |
| Origination Queue | Pending Originator EIP-712 requests. | Approve (broadcasts `mintLoan`), Request changes, Reject. |
| Audit Log | Append-only stream of Trustee actions. | Read-only. |

`Default` transitions and write-down `closeLoan` reasons compose proposals into the
RISK_COUNCIL Safe rather than executing from the Console.

### Trustee aggregates

| Scope | Aggregate | Source |
|---|---|---|
| Loan | outstanding senior principal | `originalSeniorTranche − seniorPrincipalRepaid` |
| Loan | outstanding offtaker | `originalOfftakerPrice − offtakerReceivedTotal` |
| Loan | accrued interest | `originalSeniorTranche × rate × elapsed / (365 × 10_000)` |
| Loan | unminted vault / treasury | `recorded − mintedByLoan` per leg |
| Loan | days to maturity | `currentMaturityDate − now` |
| Portfolio | deployed, at-risk, weighted tenor/rate, concentration | sums and weighted aggregates over active and `{Watchlist, Default}` loans |
| Portfolio | cumulative minted | `Σ vaultMintedByLoan`, `Σ treasuryMintedByLoan` |
| Reserves | backing invariant, ledger invariant, USYC NAV vs band | Relayer-published, `PLUSD.assertLedgerInvariant()`, Hashnote |

---

## API Contract

```solidity
interface ILoanRegistry {
    function mintLoan(
        address originator,
        ImmutableLoanData calldata economics,
        string calldata metadataURI,
        string calldata initialLocation
    ) external returns (uint256 loanId);

    function recordPayment(
        uint256 loanId,
        uint256 offtakerAmount,
        uint256 seniorPrincipal,
        uint256 seniorInterest,
        uint256 mgmtFee,
        uint256 perfFee,
        uint256 oetAlloc,
        uint256 equityAmount
    ) external;

    function getImmutable(uint256 loanId) external view returns (ImmutableLoanData memory);
    function getMutable(uint256 loanId)   external view returns (MutableLoanData memory);
}

interface IYieldMinter {
    function mintLoanYield(LoanYieldAttestation att, bytes relayerSig, bytes custodianSig) external;
    function mintTbillYield(TbillYieldAttestation att, bytes relayerSig, bytes custodianSig) external;
    function vaultMintedByLoan(uint256 loanId)    external view returns (uint256);
    function treasuryMintedByLoan(uint256 loanId) external view returns (uint256);
}
```

`updateMutable`, `setDefault`, and `closeLoan` retain access controls and semantics from
[smart-contracts-registry.md](./smart-contracts-registry.md), with
`MutableLoanData.maturity` renamed `currentMaturityDate`.

---

## Data Model

```solidity
struct ImmutableLoanData {
    uint256 originalFacilitySize;     // 6-decimal USDC
    uint256 originalSeniorTranche;
    uint256 originalEquityTranche;
    uint256 originalOfftakerPrice;
    uint32  seniorInterestRateBps;
    uint64  originationDate;
    uint64  originalMaturityDate;
}
struct MutableLoanData {
    LoanStatus status; uint32 ccrBps; uint64 lastReportedCCRTimestamp;
    uint64 currentMaturityDate; ClosureReason closureReason; string location;
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
enum LoanStatus    { Performing, Watchlist, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }
```

`mintLoan` reverts unless `originalSeniorTranche + originalEquityTranche ==
originalFacilitySize`, `originalMaturityDate > originationDate`, and
`originalOfftakerPrice >= originalFacilitySize`. `recordPayment` reverts unless the sum
of the seven split components is `<= offtakerAmount` and the loan is in `Performing` or
`Watchlist`.

---

## Security Considerations

- **Three independent layers gate any loan-tied PLUSD mint.** Operational gate:
  Trustee-signed `recordPayment` credits senior interest and fee amounts to the loan
  before any mint. Immutable ceiling on Vault leg: cumulative vault mints per loan cannot
  exceed `principal × rate × elapsed`. PLUSD ledger invariant `cumulativeLPDeposits +
  cumulativeYieldMinted − cumulativeLPBurns == totalSupply` asserted on every mint path.
  Two-party attestation (Relayer ECDSA + custodian EIP-1271) remains required.
- **Default and Closed loans refuse mints.** `mintLoanYield` reverts on any `loanId`
  whose status is `Default` or `Closed`. Destination is bound by leg.
- **Console signing surfaces.** Origination approvals, lifecycle updates, and
  `recordPayment` are Trustee-key transactions broadcast directly. Disbursements, T-Bill
  swaps, and Treasury redemption stages remain MPC-cosigned with Team and custodian. No
  Console action moves USDC from the Capital Wallet alone.
- **Audit log.** Every Console action is appended to the log defined in
  [audit-logging.md](./audit-logging.md).
