# Loan Facilities — Product Spec

## Overview

The LoanRegistry is an ERC-721 contract that records every loan facility originated through
the Pipeline protocol. Each NFT carries a set of immutable origination parameters fixed at
mint time and a mutable lifecycle bucket that the trustee and Risk Council update throughout
the loan's life. The registry is the authoritative on-chain source of truth for the
deployment monitor, the price feed system, and the yield waterfall.

---

## Behavior

### Origination request submission (off-chain)

The Loan Originator submits a new origination request through the Originator UI. The UI
builds a canonical EIP-712 payload covering all immutable loan parameters and signs it
using the Originator's authenticated session (2FA-confirmed, no wallet popup). The signed
request is POSTed to the bridge service, which validates the signature and records the
request with status `SubmittedAwaitingTrustee`.

The Originator cannot call `LoanRegistry.mintLoan()` directly. All on-chain mints are
executed by the bridge service acting in the `loan_manager` role, exclusively after trustee
approval.

### Trustee review queue

The trustee sees every pending origination request in the trustee tooling. For each request
the trustee can:

- **Approve** — the trustee tooling instructs the bridge service to broadcast
  `LoanRegistry.mintLoan()` with the verified immutable parameters.
- **Request changes** — the request is returned to the Originator with a comment; the
  Originator may resubmit a revised request as a new submission.
- **Reject** — the request is closed; the Originator sees the trustee's rejection comment
  and cannot take further action on that submission.

### Mint and disbursement trigger

On `mintLoan()` succeeding, the contract emits `LoanMinted(tokenId, originator, data)`. The
bridge service listens for this event and immediately prepares the Capital Wallet outflow
transaction (USDC → on-ramp provider → borrower). The trustee and Pipeline team then
co-sign the prepared transaction via MPC. The Originator is not part of the disbursement
signing chain.

### Immutable data

The following fields are set at mint and cannot be changed by any role:

- `originator`, `borrowerId`, `commodity`, `corridor`
- `originalFacilitySize`, `originalSeniorTranche`, `originalEquityTranche`
- `originationDate`, `originalMaturityDate`, `governingLaw`, `metadataURI`

### Mutable lifecycle data

The following fields are updated during the loan's life by the `loan_manager` or
`risk_council` role:

- `status` — `Performing | Watchlist | Default | Closed`
- `currentMaturityDate` — may be extended from `originalMaturityDate`
- `lastReportedCCR` and `lastReportedCCRTimestamp` — updated by the bridge on CCR threshold
  crossings from the price feed system
- `currentLocation` — updated as cargo moves through the trade corridor
- `closureReason` — set only when `status = Closed`

### Loan status transitions

| Transition | Permitted caller | Notes |
|---|---|---|
| `Performing → Watchlist` | `loan_manager` | Trustee action via tooling |
| `Watchlist → Performing` | `loan_manager` | Trustee action via tooling |
| `Any → Default` | `risk_council` | 3-of-5 Risk Council multisig only |
| `Any → Closed` (scheduled / early repayment) | `loan_manager` | Trustee action at maturity or on early repayment |
| `Any → Closed` (default / write-down) | `risk_council` | 3-of-5 Risk Council multisig only |

`updateMutable()` reverts if `newStatus == Default`; callers must use `setDefault()`
instead.

### Maturity date extensions

The trustee may call `updateMutable()` with a `newMaturityDate` greater than
`originalMaturityDate`. The original maturity date is preserved in the immutable struct;
`currentMaturityDate` in the mutable struct reflects the operative date.

### Goods location tracking

`currentLocation` is a `LocationUpdate` struct embedded in the mutable data. It is updated
each time cargo moves (vessel departure/arrival, warehouse transfer, tank farm change). The
`trackingURL` field may point to an external maritime tracking platform (e.g.,
MarineTraffic) for real-time AIS position.

---

## API Contract

```solidity
interface ILoanRegistry {
    /// @notice Mints a new loan NFT. Emits LoanMinted.
    /// @dev Only callable by loan_manager. Triggers disbursement preparation in bridge.
    function mintLoan(
        address originator,
        ImmutableLoanData calldata data
    ) external returns (uint256 tokenId);

    /// @notice Updates mutable lifecycle fields.
    /// @dev Reverts if newStatus == Default. Only callable by loan_manager.
    function updateMutable(
        uint256 tokenId,
        LoanStatus status,
        uint256 newMaturityDate,
        uint256 newCCR,
        LocationUpdate calldata newLocation
    ) external;

    /// @notice Transitions a loan to Default status.
    /// @dev Only callable by risk_council (3-of-5 multisig).
    function setDefault(uint256 tokenId) external;

    /// @notice Closes a loan with a stated reason.
    /// @dev loan_manager for {ScheduledMaturity, EarlyRepayment};
    ///      risk_council for {Default, OtherWriteDown}.
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
    address  originator;            // Originator's on-chain identifier
    bytes32  borrowerId;            // Hashed borrower identifier
    string   commodity;             // e.g. "Jet fuel JET A-1"
    string   corridor;              // e.g. "South Korea → Mongolia"
    uint256  originalFacilitySize;  // 6-decimal USDC units
    uint256  originalSeniorTranche; // Senior portion at origination
    uint256  originalEquityTranche; // Equity portion at origination
    uint256  originationDate;       // Block timestamp at mint
    uint256  originalMaturityDate;  // Originally agreed maturity (Unix timestamp)
    string   governingLaw;          // e.g. "English law, LCIA London"
    string   metadataURI;           // Optional IPFS pointer to descriptive context
}

struct MutableLoanData {
    LoanStatus     status;
    uint256        currentMaturityDate;
    uint256        lastReportedCCR;           // Basis points (e.g. 14000 = 140%)
    uint256        lastReportedCCRTimestamp;
    LocationUpdate currentLocation;
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
event LoanClosed(uint256 indexed tokenId, ClosureReason reason);
```

---

## Security Considerations

- The `loan_manager` role is held by the bridge service; the bridge only calls `mintLoan()`
  after the trustee has approved the Originator's EIP-712 signed request. The mint is never
  automatic.
- The `risk_council` role is a 3-of-5 multisig. No single party can transition a loan to
  Default or force-close with a write-down reason.
- `updateMutable()` explicitly reverts on `newStatus == Default`, preventing accidental or
  malicious downgrades through the general lifecycle update path.
- Immutable data is stored on-chain and cannot be altered by any role post-mint, ensuring
  the disbursement basis and waterfall parameters are tamper-proof.
- The equity tranche never enters the cash rail; it is tracked as a trustee-attested
  off-chain figure and does not affect on-chain invariants.
