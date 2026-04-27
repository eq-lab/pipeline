# Loan Facilities — API, Data Model & Security

> API contract, data model, and security considerations for the loan facility system. See [loans.md](./loans.md) for the main spec (overview, behavior, lifecycle).

---

## API Contract

```solidity
interface ILoanRegistry {
    /// @notice Mints a new loan NFT. Emits LoanMinted.
    /// @dev Only callable by TRUSTEE (Trustee key). The resulting LoanMinted event
    ///      triggers Capital Wallet disbursement preparation in Relayer.
    function mintLoan(
        address originator,
        ImmutableLoanData calldata data
    ) external returns (uint256 tokenId);

    /// @notice Updates mutable lifecycle fields.
    /// @dev Reverts if newStatus == Default. Only callable by TRUSTEE.
    function updateMutable(
        uint256 tokenId,
        LoanStatus status,
        uint256 newMaturityDate,
        uint256 newCCR,
        LocationUpdate calldata newLocation
    ) external;

    /// @notice Records a repayment split across Senior tranche (principal + interest)
    ///         and Equity tranche. Pure accounting — no USDC or PLUSD movement.
    /// @dev Only callable by TRUSTEE. Reverts if
    ///      seniorPrincipal + seniorInterest + equityAmount > offtakerAmount.
    ///      Increments offtakerReceivedTotal, seniorPrincipalRepaid,
    ///      seniorInterestRepaid, equityDistributed. Emits RepaymentRecorded.
    function recordRepayment(
        uint256 tokenId,
        uint256 offtakerAmount,
        uint256 seniorPrincipal,
        uint256 seniorInterest,
        uint256 equityAmount
    ) external;

    /// @notice Transitions a loan to Default status.
    /// @dev Only callable by RISK_COUNCIL (3-of-5 multisig).
    function setDefault(uint256 tokenId) external;

    /// @notice Closes a loan with a stated reason.
    /// @dev TRUSTEE for {ScheduledMaturity, EarlyRepayment};
    ///      RISK_COUNCIL for {Default, OtherWriteDown}.
    function closeLoan(uint256 tokenId, ClosureReason reason) external;

    /// @notice Returns the immutable origination data for a loan.
    function getImmutable(uint256 tokenId)
        external view returns (ImmutableLoanData memory);

    /// @notice Returns the current mutable lifecycle data for a loan.
    function getMutable(uint256 tokenId)
        external view returns (MutableLoanData memory);
}
```

---

## Data Model

```solidity
struct ImmutableLoanData {
    address  originator;             // Originator's on-chain identifier
    bytes32  borrowerId;             // Hashed borrower identifier
    string   commodity;              // e.g. "Jet fuel JET A-1"
    string   corridor;               // e.g. "South Korea → Mongolia"
    uint256  originalFacilitySize;   // 6-decimal USDC units
    uint256  originalSeniorTranche;  // Senior portion at origination
    uint256  originalEquityTranche;  // Equity portion at origination
    uint256  originalOfftakerPrice;  // Total USDC the end buyer is contracted to pay
    uint256  seniorInterestRateBps;  // Annualised Senior coupon rate (bps)
    uint256  originationDate;        // Block timestamp at mint
    uint256  originalMaturityDate;   // Originally agreed maturity (Unix timestamp)
    string   governingLaw;           // e.g. "English law, LCIA London"
    string   metadataURI;            // Optional IPFS pointer to descriptive context
}

struct MutableLoanData {
    LoanStatus     status;
    uint256        currentMaturityDate;
    uint256        lastReportedCCR;           // Basis points (e.g. 14000 = 140%)
    uint256        lastReportedCCRTimestamp;
    LocationUpdate currentLocation;
    uint256        offtakerReceivedTotal;     // Cumulative USDC received from offtaker
    uint256        seniorPrincipalRepaid;     // Cumulative Senior principal repaid
    uint256        seniorInterestRepaid;      // Cumulative Senior coupon delivered
    uint256        equityDistributed;         // Cumulative Equity-tranche distributions
    ClosureReason  closureReason;             // Set only when status == Closed
}

struct LocationUpdate {
    LocationType locationType;
    string       locationIdentifier; // Vessel IMO, warehouse name, tank farm ID
    string       trackingURL;        // Optional external tracking link
    uint256      updatedAt;          // Timestamp of last location update
}

enum LoanStatus    { Performing, Watchlist, Default, Closed }
enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }
enum LocationType  { Vessel, Warehouse, TankFarm, Other }
```

**Key events**

```solidity
event LoanMinted(uint256 indexed tokenId, address indexed originator, ImmutableLoanData data);
event LoanStatusChanged(uint256 indexed tokenId, LoanStatus oldStatus, LoanStatus newStatus);
event LocationUpdated(uint256 indexed tokenId, LocationUpdate newLocation);
event MaturityExtended(uint256 indexed tokenId, uint256 newMaturityDate);
event RepaymentRecorded(
    uint256 indexed tokenId,
    uint256 offtakerAmount,
    uint256 seniorPrincipal,
    uint256 seniorInterest,
    uint256 equityAmount
);
event LoanClosed(uint256 indexed tokenId, ClosureReason reason);
```

---

## Security Considerations

- The `TRUSTEE` role on LoanRegistry is held by the Trustee key alone. Relayer has no role
  on LoanRegistry and cannot mint, update, close, or record repayment on a loan NFT. The
  Trustee broadcasts `mintLoan()` only after reviewing and approving the Originator's
  EIP-712 signed request; the mint is never automatic.
- The `RISK_COUNCIL` role is a 3-of-5 multisig. No single party can transition a loan to
  Default or force-close with a write-down reason.
- `updateMutable()` explicitly reverts on `newStatus == Default`, preventing accidental or
  malicious downgrades through the general lifecycle update path.
- Immutable data — including `originalOfftakerPrice` and `seniorInterestRateBps` — is
  stored on-chain and cannot be altered by any role post-mint, ensuring the disbursement
  basis, waterfall parameters, and recovery envelope are tamper-proof.
- `recordRepayment()` is pure accounting and cannot move USDC or mint PLUSD; it only
  updates the four repayment counters and emits an event. Actual yield PLUSD minting
  requires the two-party EIP-712 attestation on PLUSD (Relayer + custodian) independent of
  the LoanRegistry write, so a compromised Trustee key cannot fabricate yield.
- Repayment accounting splits Senior (principal + interest) and Equity flows explicitly on
  chain. Outstanding obligations are derivable from immutable minus mutable counters; a
  third party can audit cumulative offtaker receipts against `originalOfftakerPrice` at any
  time.
- The registry is informational. Because sPLUSD share price moves only on actual yield
  mints — not on `recordRepayment()` writes — a compromised or erroneous Trustee
  accounting entry cannot by itself inflate share price.
