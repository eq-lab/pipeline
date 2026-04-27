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
request is POSTed to the bridge service, which validates the signature and records the
request with status `SubmittedAwaitingTrustee`.

The Originator cannot call `LoanRegistry.mintLoan()` directly. All on-chain mints are
executed by the Trustee key (the sole holder of the `TRUSTEE` role on LoanRegistry),
exclusively after trustee approval. Bridge has no role on LoanRegistry and does not relay
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
bridge service listens for this event and immediately prepares the Capital Wallet outflow
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
  threshold crossings from the price feed system; Bridge observes and alerts but does not
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
Bridge via the two-party `yieldMint` path on PLUSD, triggered by the same Trustee
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

For the API contract, data model, events, and security considerations, see
[loans-data.md](./loans-data.md).
