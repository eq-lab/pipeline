# Loan Facilities — Product Spec

## Overview

The LoanRegistry is an ERC-721 contract that records every loan facility originated through
the Pipeline protocol. Each NFT carries a set of immutable origination parameters fixed at
mint time and a mutable lifecycle bucket that the trustee and Risk Council update throughout
the loan's life. The registry is the authoritative on-chain ledger of origination data,
lifecycle state, and repayment accounting. It is informational: sPLUSD share price moves
only on actual repayment events landing through the yield-mint path, not on any field
written into the registry.

---

## Behavior

### Origination request submission (off-chain)

The Loan Originator submits a new origination request through the Originator UI. The UI
builds a canonical EIP-712 payload covering all immutable loan parameters and signs it
using the Originator's authenticated session (2FA-confirmed, no wallet popup). The signed
request is POSTed to the relayer service, which validates the signature and records the
request with status `SubmittedAwaitingTrustee`.

The Originator cannot call `LoanRegistry.mintLoan()` directly. All on-chain mints are
executed by the Trustee key (the sole holder of the `TRUSTEE` role on LoanRegistry),
exclusively after trustee approval. Relayer has no role on LoanRegistry and does not relay
these writes.

### Trustee review queue

The trustee sees every pending origination request in the trustee tooling. For each request
the trustee can:

- **Approve** — the trustee broadcasts `LoanRegistry.mintLoan()` directly from the Trustee
  key with the verified immutable parameters.
- **Request changes** — the request is returned to the Originator with a comment; the
  Originator may resubmit a revised request as a new submission.
- **Reject** — the request is closed; the Originator sees the trustee's rejection comment
  and cannot take further action on that submission.

### Mint and disbursement trigger

On `mintLoan()` succeeding, the contract emits `LoanMinted(tokenId, originator, data)`. The
relayer service listens for this event and immediately prepares the Capital Wallet outflow
transaction (USDC → on-ramp provider → borrower). The trustee and Pipeline team then
co-sign the prepared transaction via MPC on the Capital Wallet. The Originator is not part
of the disbursement signing chain. The LoanRegistry mint and the Capital Wallet
disbursement are independent actions: the mint is a Trustee-key transaction on LoanRegistry;
the disbursement is an MPC co-signature on the Capital Wallet.

### Immutable data

The following fields are set at mint and cannot be changed by any role:

- `originator`, `borrowerId`, `commodity`, `corridor`
- `originalFacilitySize`, `originalSeniorTranche`, `originalEquityTranche`
- `originalOfftakerPrice` — total USDC the end buyer is contracted to pay for the cargo.
  This is the gross cash inflow the loan expects to see over its life; outstanding offtaker
  balance is derived as `originalOfftakerPrice − offtakerReceivedTotal`.
- `seniorInterestRateBps` — annualised coupon rate for the Senior tranche, in basis points
  (e.g. 1200 = 12%). The Equity tranche has no fixed rate; it receives the residual.
- `originationDate`, `originalMaturityDate`, `governingLaw`, `metadataURI`

### Mutable lifecycle data

The following fields are updated during the loan's life by the `TRUSTEE` (Trustee key) or
`RISK_COUNCIL` role:

- `status` — `Performing | Watchlist | Default | Closed`
- `currentMaturityDate` — may be extended from `originalMaturityDate`
- `lastReportedCCR` and `lastReportedCCRTimestamp` — written by the Trustee on CCR
  threshold crossings from the price feed system; Relayer observes and alerts but does not
  write to the registry
- `currentLocation` — updated as cargo moves through the trade corridor
- `offtakerReceivedTotal` — cumulative USDC received from the offtaker against
  `originalOfftakerPrice`; incremented on each `recordRepayment` call
- `seniorPrincipalRepaid` — cumulative Senior-tranche principal repaid; outstanding Senior
  principal is `originalSeniorTranche − seniorPrincipalRepaid`
- `seniorInterestRepaid` — cumulative Senior-tranche interest (net coupon) actually
  delivered to the vault
- `equityDistributed` — cumulative Equity-tranche distributions (residual after the Senior
  tranche is serviced and fees are paid)
- `closureReason` — set only when `status = Closed`

### Loan status transitions

| Transition | Permitted caller | Notes |
|---|---|---|
| `Performing → Watchlist` | `TRUSTEE` | Trustee-key transaction |
| `Watchlist → Performing` | `TRUSTEE` | Trustee-key transaction |
| `Any → Default` | `RISK_COUNCIL` | 3-of-5 Risk Council multisig only |
| `Any → Closed` (scheduled / early repayment) | `TRUSTEE` | Trustee-key transaction at maturity or on early repayment |
| `Any → Closed` (default / write-down) | `RISK_COUNCIL` | 3-of-5 Risk Council multisig only |

`updateMutable()` reverts if `newStatus == Default`; callers must use `setDefault()`
instead.

### Repayment accounting

When an offtaker wire lands in the Capital Wallet and the trustee has completed the
client-side waterfall in the Operations Console, the trustee calls `recordRepayment()` on
LoanRegistry with the four split components:

- `offtakerAmount` — gross USDC received from the offtaker for this repayment event
- `seniorPrincipal` — portion allocated to Senior principal amortisation
- `seniorInterest` — portion allocated to Senior coupon (net of fees)
- `equityAmount` — portion distributed to the Equity tranche

The contract asserts `seniorPrincipal + seniorInterest + equityAmount <= offtakerAmount`
(the residual covers protocol fees routed to Treasury off-registry), increments the four
mutable repayment counters, and emits `RepaymentRecorded`. The call is a pure accounting
record: it does not move USDC or mint PLUSD. Actual yield PLUSD minting is performed by
Relayer via the two-party `yieldMint` path on PLUSD, triggered by the same Trustee
attestation; the registry write and the yield mint are independent transactions.

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
