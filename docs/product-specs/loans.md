# Loan Facilities — Product Spec

> The per-loan repayment ledger fields are in [loans-data.md](./loans-data.md). The YieldMinter per-loan mint cap rule that consumes them is in [yield.md](./yield.md).

## Overview

The LoanRegistry is an ERC-721 contract that records every loan facility originated through
the Pipeline protocol. Each NFT carries genesis origination economics written once at mint
time, an append-only schedule of rate and maturity epochs that captures rollovers and
default re-terms, and a mutable lifecycle bucket that the Trustee and Risk Council update
throughout the loan's life. The registry is the authoritative on-chain ledger of
origination data, lifecycle state, and repayment accounting. It is informational: sPLUSD
share price moves only on actual repayment events landing through the yield-mint path, not
on any field written into the registry.

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

On `mintLoan()` succeeding, the contract emits `LoanMinted(loanId, originator, economics, metadataURI)`. The
relayer service listens for this event and immediately prepares the Capital Wallet outflow
transaction (USDC → on-ramp provider → borrower). The trustee and Pipeline team then
co-sign the prepared transaction via MPC on the Capital Wallet. The Originator is not part
of the disbursement signing chain. The LoanRegistry mint and the Capital Wallet
disbursement are independent actions: the mint is a Trustee-key transaction on LoanRegistry;
the disbursement is an MPC co-signature on the Capital Wallet.

### Genesis economics

The `ImmutableLoanData` struct is written once at mint and is never rewritten by any role.
It holds seven numeric fields:

- `originalFacilitySize`, `originalSeniorTranche`, `originalEquityTranche`
- `originalOfftakerPrice`, the total USDC the end buyer is contracted to pay for the cargo.
  This is the gross cash inflow the loan expects to see over its life. Outstanding offtaker
  balance is derived as `originalOfftakerPrice − offtakerReceivedTotal`.
- `seniorInterestRateBps`, the genesis annualised coupon rate for the Senior tranche in
  basis points (e.g. 1200 = 12%). The Equity tranche has no fixed rate and receives the
  residual.
- `originationDate`, `originalMaturityDate`

Descriptive material (originator label, hashed borrower identifier, commodity, corridor,
governing law, additional legal documents) is carried in the IPFS document referenced by
`metadataURI`. The `originator` address is passed to `mintLoan` and stored alongside the
NFT owner.

### Economics epochs (rate and maturity over the loan's life)

Rate and maturity are not frozen for the loan's whole life. They live in an append-only
`EconomicsEpoch[]`, where `epochs[0]` mirrors the genesis term. A rollover or a default
re-term appends a new epoch. No epoch is ever rewritten or removed, so the original terms
and every later re-term stay on-chain for audit.

Each epoch carries `effectiveFrom`, `maturityDate`, and `seniorInterestRateBps`. The
accrual base is always `originalSeniorTranche`. The interest ceiling that YieldMinter
enforces is computed piecewise across epochs, with accrual stopping at each epoch's own
maturity. A loan past maturity without a rollover cannot accrue beyond its contracted term.
See [loans-data.md](./loans-data.md) for the ceiling formula.

### Mutable lifecycle data

The following fields are updated during the loan's life by the `TRUSTEE` (Trustee key) or
`RISK_COUNCIL` role:

- `status`, one of `Performing | Watchlist | Matured | Default | Closed`
- `currentMaturityDate`, the operative maturity, set from the latest epoch on rollover or
  amend
- `ccrBps` and `lastReportedCCRTimestamp`, written by the Trustee on CCR threshold
  crossings from the price feed system. Relayer observes and alerts but does not write to
  the registry
- `currentLocation`, updated as cargo moves through the trade corridor
- `metadataURI`, the IPFS pointer, appendable by the Trustee so additional documents and
  links can be attached over the loan's life
- `offtakerReceivedTotal`, cumulative USDC received from the offtaker against
  `originalOfftakerPrice`, incremented on each `recordPayment` call
- `seniorPrincipalRepaid`, cumulative Senior-tranche principal repaid. Outstanding Senior
  principal is `originalSeniorTranche − seniorPrincipalRepaid`
- `seniorInterestRecorded`, cumulative net Senior coupon recorded for delivery to the vault
- `mgmtFeeRecorded`, `perfFeeRecorded`, `oetAllocRecorded`, the cumulative fee carve-outs
  recorded for delivery to the Treasury Wallet
- `equityDistributed`, cumulative Equity-tranche distributions (residual after the Senior
  tranche is serviced and fees are paid)
- `closureReason`, set only when `status = Closed`

### Loan status transitions

| Transition | Permitted caller | Notes |
|---|---|---|
| `Performing ↔ Watchlist` | `TRUSTEE` | Trustee-key transaction, no timelock |
| `Performing/Watchlist → Matured` | `TRUSTEE` | Past `currentMaturityDate`, payment not yet settled, awaiting rollover or close |
| `Matured → Performing` | `TRUSTEE` | Via `rollover()` after maturity |
| `Any non-terminal → Default` | `RISK_COUNCIL` | 3-of-5 multisig, 24h timelock, may fire before maturity |
| `Any → Closed` (scheduled / early repayment) | `TRUSTEE` | Trustee-key transaction, no timelock |
| `Any → Closed` (default / write-down) | `RISK_COUNCIL` | 3-of-5 multisig, 24h timelock |

`updateMutable()` accepts only `{Performing, Watchlist, Matured}` for `status`. It reverts
on `Default` (callers must use `setDefault()`) and on `Closed` (callers must use
`closeLoan()`).

Loan-tied PLUSD minting is permitted only while the loan is `Performing` or `Watchlist`.
`Matured`, `Default`, and `Closed` refuse mints. The normal final-coupon mint happens while
the loan is still `Performing`, before it is closed. `Matured` is the overdue-and-unpaid
limbo where there is nothing to mint.

### Rollover

A rollover rolls a loan into a new term under new interest and a new maturity. It is a
Trustee-key transaction with no timelock, and it reverts unless `block.timestamp >=
currentMaturityDate`. Deal parameters change only after maturity. The call appends an
`EconomicsEpoch` that starts at the prior term's maturity (so accrual is continuous),
carries the new rate, sets `currentMaturityDate` to the new maturity, and returns the loan
to `Performing`. The same `loanId`, all repayment counters, and all per-loan minted totals
carry over. The genesis economics are untouched.

The rollover fast-path is safe despite having no timelock: appending an epoch can only
raise the accrual ceiling, never mint. Actual minting still requires `recordPayment` plus
the two-party Relayer and custodian attestation on the YieldMinter path.

### Default and economics amendment

`setDefault()` is a RISK_COUNCIL transaction under a 24h timelock and may fire before or
after maturity. A defaulted loan refuses all loan-tied mints. The Risk Council may re-term
a loan (penalty rate, revised maturity) outside the rollover fast-path through
`amendEconomics()`, also RISK_COUNCIL under the 24h timelock, which appends an
`EconomicsEpoch` from the call time. This is the only path that rewrites economics without
going through a post-maturity rollover.

### Repayment accounting

When an offtaker wire lands in the Capital Wallet and the trustee has completed the
client-side waterfall in the Operations Console, the trustee calls `recordPayment()` on
LoanRegistry with the eight components. The offtaker pays principal plus gross interest, and
the fees are carried inside that interest. The split decomposes the gross inflow:

- `offtakerAmount`, gross USDC received from the offtaker for this repayment event
- `seniorPrincipal`, portion allocated to Senior principal amortisation
- `seniorInterest`, the net Senior coupon (gross interest minus the fee carve-outs), the
  amount destined for the vault
- `mgmtFee`, `perfFee`, `oetAlloc`, the fee carve-outs taken from gross interest, destined
  for the Treasury Wallet
- `equityAmount`, portion distributed to the Equity tranche

The contract asserts `seniorPrincipal + seniorInterest + mgmtFee + perfFee + oetAlloc +
equityAmount <= offtakerAmount`, increments the seven per-loan counters, and emits
`PaymentRecorded`. Early repayments may carry `seniorInterest = 0` and zero fees when the
schedule defers all interest to the final payment. The call is a pure accounting record. It
does not move USDC or mint PLUSD. Actual yield PLUSD minting is performed on the YieldMinter
path via the two-party Relayer and custodian attestation, triggered by the same Trustee
record. The registry write and the yield mint are independent transactions.

### Goods location tracking

`currentLocation` is a `LocationUpdate` struct embedded in the mutable data. It is updated
each time cargo moves (vessel departure/arrival, warehouse transfer, tank farm change). The
`trackingURL` field may point to an external maritime tracking platform (e.g.,
MarineTraffic) for real-time AIS position.

For the API contract, data model, events, and security considerations, see
[loans-data.md](./loans-data.md).
