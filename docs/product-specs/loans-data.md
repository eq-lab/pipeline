# Loan Facilities — API, Data Model & Security

> API contract, data model, and security considerations for the loan facility system. See [loans.md](./loans.md) for the main spec (overview, behavior, lifecycle).

---

## API Contract

```solidity
interface ILoanRegistry {
    // TRUSTEE, no timelock. Writes genesis economics and seeds epochs[0]. Reverts unless
    // seniorTranche + equityTranche == facilitySize, maturityDate > originationDate,
    // offtakerPrice >= facilitySize. LoanMinted triggers Relayer disbursement prep.
    function mintLoan(
        address originator,
        ImmutableLoanData calldata economics,
        string calldata metadataURI,
        string calldata initialLocation
    ) external returns (uint256 loanId);

    // TRUSTEE, no timelock. Non-economic fields only. status in {Performing, Watchlist,
    // Matured}; reverts on Default (use setDefault) and Closed (use closeLoan).
    function updateMutable(
        uint256 loanId,
        LoanStatus status,
        uint256 newCCR,
        LocationUpdate calldata newLocation,
        string calldata metadataURI
    ) external;

    // TRUSTEE, no timelock. Pure accounting, no USDC or PLUSD movement. Reverts unless the
    // loan is in {Performing, Watchlist} and the six components sum <= offtakerAmount.
    // seniorInterest is the net senior coupon; mgmtFee/perfFee/oetAlloc are the fee
    // carve-outs from gross interest; all may be zero when interest defers to a later
    // payment. Increments the seven per-loan counters. Emits PaymentRecorded.
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

    // TRUSTEE, no timelock. Reverts unless now >= currentMaturityDate and status not in
    // {Default, Closed}. Appends an epoch from the prior maturity (continuous accrual),
    // sets currentMaturityDate, returns status to Performing. Emits LoanRolledOver.
    function rollover(uint256 loanId, uint32 newRateBps, uint64 newMaturityDate) external;

    // RISK_COUNCIL, 24h timelock. Re-terms outside the rollover fast-path (default penalty
    // rate, off-cycle maturity). Appends an epoch from now. Emits EconomicsAmended.
    function amendEconomics(uint256 loanId, uint32 newRateBps, uint64 newMaturityDate) external;

    // RISK_COUNCIL, 24h timelock. May fire before or after maturity. Blocks loan-tied mints.
    function setDefault(uint256 loanId) external;

    // TRUSTEE (no timelock) for {ScheduledMaturity, EarlyRepayment};
    // RISK_COUNCIL (24h) for {Default, OtherWriteDown}.
    function closeLoan(uint256 loanId, ClosureReason reason) external;

    function getImmutable(uint256 loanId) external view returns (ImmutableLoanData memory);
    function getMutable(uint256 loanId)   external view returns (MutableLoanData memory);
    function getEpochs(uint256 loanId)    external view returns (EconomicsEpoch[] memory);
}
```

---

## Data Model

```solidity
// Genesis economics, written once in mintLoan, never altered. Mirrors epochs[0].
struct ImmutableLoanData {
    uint256 originalFacilitySize;     // 6-decimal USDC units
    uint256 originalSeniorTranche;    // Senior portion at origination (the accrual base)
    uint256 originalEquityTranche;    // Equity portion at origination
    uint256 originalOfftakerPrice;    // Total USDC the end buyer is contracted to pay
    uint32  seniorInterestRateBps;    // Genesis annualised Senior coupon rate (bps)
    uint64  originationDate;          // Block timestamp at mint
    uint64  originalMaturityDate;     // Originally agreed maturity
}

// Append-only rate and maturity schedule. epochs[0] is the genesis term.
// Rollover (TRUSTEE) and amendEconomics (RISK_COUNCIL) append a row. No row is ever
// rewritten or removed. The accrual base is always originalSeniorTranche.
struct EconomicsEpoch {
    uint64 effectiveFrom;             // Accrual start for this epoch
    uint64 maturityDate;             // Accrual stops here for this epoch
    uint32 seniorInterestRateBps;     // Annualised Senior coupon rate for this epoch
}

struct MutableLoanData {
    LoanStatus     status;
    uint32         ccrBps;                    // Last reported CCR (e.g. 14000 = 140%)
    uint64         lastReportedCCRTimestamp;
    uint64         currentMaturityDate;       // Operative maturity (latest epoch)
    ClosureReason  closureReason;             // Set only when status == Closed
    LocationUpdate currentLocation;
    string         metadataURI;               // IPFS pointer, appendable over the loan's life
    uint256        offtakerReceivedTotal;     // Cumulative USDC received from offtaker
    uint256        seniorPrincipalRepaid;     // Cumulative Senior principal repaid
    uint256        seniorInterestRecorded;    // Cumulative net Senior coupon recorded
    uint256        mgmtFeeRecorded;           // Cumulative management fee recorded
    uint256        perfFeeRecorded;           // Cumulative performance fee recorded
    uint256        oetAllocRecorded;          // Cumulative OET allocation recorded
    uint256        equityDistributed;         // Cumulative Equity-tranche distributions
}

struct LocationUpdate {
    LocationType locationType;
    string       locationIdentifier; // Vessel IMO, warehouse name, tank farm ID
    string       trackingURL;        // Optional external tracking link
    uint64       updatedAt;          // Timestamp of last location update
}

enum LoanStatus    { Performing, Watchlist, Matured, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }
enum LocationType  { Vessel, Warehouse, TankFarm, Other }
```

Descriptive material (originator label, hashed borrower identifier, commodity, corridor,
governing law, additional legal documents) lives in the IPFS document referenced by
`metadataURI`. Nothing that drives the waterfall, an aggregate, or a mint cap is read from
IPFS. The `originator` address is passed to `mintLoan` and stored alongside the NFT owner.

### Maturity-capped accrual ceiling

The immutable interest ceiling consumed by YieldMinter is computed piecewise across the
epoch schedule, with each epoch's accrual stopping at its own maturity:

```
ceiling(loanId) = Σ over epochs e of
    originalSeniorTranche * e.seniorInterestRateBps
      * ( min(block.timestamp, e.maturityDate) - e.effectiveFrom ) / (365 days * 10_000)
```

A loan past maturity without a rollover cannot accrue beyond its contracted term. A
rollover appends an epoch that re-opens accrual under the new rate from the prior maturity.

**Key events**

```solidity
event LoanMinted(uint256 indexed loanId, address indexed originator, ImmutableLoanData economics, string metadataURI);
event LoanStatusChanged(uint256 indexed loanId, LoanStatus oldStatus, LoanStatus newStatus);
event LocationUpdated(uint256 indexed loanId, LocationUpdate newLocation);
event MetadataUpdated(uint256 indexed loanId, string metadataURI);
event LoanRolledOver(uint256 indexed loanId, EconomicsEpoch epoch);
event EconomicsAmended(uint256 indexed loanId, EconomicsEpoch epoch, address indexed caller);
event PaymentRecorded(
    uint256 indexed loanId,
    uint256 offtakerAmount,
    uint256 seniorPrincipal,
    uint256 seniorInterest,
    uint256 mgmtFee,
    uint256 perfFee,
    uint256 oetAlloc,
    uint256 equityAmount
);
event LoanClosed(uint256 indexed loanId, ClosureReason reason);
```

### Upgrade migration

The UUPS reinitializer that introduces the epoch schedule seeds `epochs[0]` for every
existing loan from its genesis economics (`originationDate`, `originalMaturityDate`,
`seniorInterestRateBps`) and backfills the per-loan repayment counters from historical
`RepaymentRecorded` events. ERC-7201 storage is append-only, so the epoch array and the
new fee counters occupy fresh slots and no existing slot is reordered, renamed, or
resized. See [smart-contracts-operations.md](./smart-contracts-operations.md).

---

## Security Considerations

- The `TRUSTEE` role on LoanRegistry is held by the Trustee key alone. Relayer has no role
  on LoanRegistry and cannot mint, update, roll over, close, or record payment on a loan
  NFT. The Trustee broadcasts `mintLoan()` only after reviewing and approving the
  Originator's EIP-712 signed request. The mint is never automatic.
- The `RISK_COUNCIL` role is a 3-of-5 multisig under a 24h AccessManager timelock. No
  single party can transition a loan to Default, amend economics outside the rollover
  fast-path, or force-close with a write-down reason.
- Genesis economics in `ImmutableLoanData` are written once and never rewritten. Re-terms
  append an `EconomicsEpoch`, preserving the original terms on-chain for audit. The full
  rate and maturity history is reconstructable from `getEpochs` and the
  `LoanRolledOver` / `EconomicsAmended` event stream.
- The rollover fast-path (TRUSTEE, no timelock) can only raise the accrual ceiling, never
  mint. Actual minting still requires `recordPayment` plus Relayer ECDSA plus custodian
  EIP-1271. A lone compromised Trustee key gains nothing from appending an epoch.
- `recordPayment()` is pure accounting and cannot move USDC or mint PLUSD. It updates the
  per-loan counters and emits an event. Actual yield PLUSD minting requires the two-party
  attestation on the YieldMinter path independent of the LoanRegistry write, so a
  compromised Trustee key cannot fabricate yield.
- Repayment accounting splits Senior principal, net Senior coupon, the three fee
  carve-outs, and Equity flows explicitly on chain. Outstanding obligations are derivable
  from genesis economics minus the mutable counters, auditable by any third party.
- The registry is informational. sPLUSD share price moves only on actual yield mints and
  not on `recordPayment()` writes, so an erroneous Trustee entry cannot inflate share price.
