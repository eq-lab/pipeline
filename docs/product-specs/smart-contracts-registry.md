# Smart Contracts — LoanRegistry, ShutdownController & Shutdown Mode

> See [smart-contracts.md](./smart-contracts.md) for the main spec and [smart-contracts-interfaces.md](./smart-contracts-interfaces.md) for core contract interfaces.

---

## LoanRegistry

| Function | Access | Description |
|---|---|---|
| `mintLoan(address originator, string tokenURI)` | TRUSTEE | Mints a new loan NFT. `tokenURI` points to an IPFS JSON document containing the immutable origination fields (see Data Models). Emits `LoanMinted(tokenId, originator, tokenURI)`. |
| `updateMutable(uint256 tokenId, LoanStatus status, uint256 newMaturityDate, uint256 newCCR, LocationUpdate newLocation)` | TRUSTEE | Updates mutable lifecycle fields. Reverts if newStatus == Default. |
| `recordRepayment(uint256 tokenId, uint256 offtakerAmount, uint256 seniorPrincipal, uint256 seniorInterest, uint256 equityAmount)` | TRUSTEE | Records a repayment split across Senior (principal + interest) and Equity tranches. Pure accounting — moves no USDC, mints no PLUSD. Reverts if `seniorPrincipal + seniorInterest + equityAmount > offtakerAmount`. Increments `offtakerReceivedTotal`, `seniorPrincipalRepaid`, `seniorInterestRepaid`, `equityDistributed`. Emits `RepaymentRecorded`. |
| `setDefault(uint256 tokenId)` | RISK_COUNCIL | Transitions loan to Default (24h timelock). |
| `closeLoan(uint256 tokenId, ClosureReason reason)` | TRUSTEE or RISK_COUNCIL | TRUSTEE for {ScheduledMaturity, EarlyRepayment}; RISK_COUNCIL for {Default, OtherWriteDown}. |
| `tokenURI(uint256 tokenId)` | public view (ERC-721) | Returns the IPFS URI of the immutable origination JSON. |
| `getMutable(uint256 tokenId)` | public view | Returns current mutable lifecycle data. |

Bridge has **no role on LoanRegistry**. All loan NFT writes — including `recordRepayment` —
are done by the Trustee key directly.

Immutable origination data is stored off-chain as an IPFS JSON document referenced by
`tokenURI`. No on-chain protocol logic reads these fields (repayment accounting is
driven by counters, not parameters), so keeping them on-chain would only inflate gas
without adding trust — the Trustee is the authoritative source at origination
regardless. The IPFS approach also keeps the registry ERC-721-idiomatic: standard NFT
explorers, marketplaces, and indexers consume `tokenURI` natively.

---

## ShutdownController

| Function | Access | Description |
|---|---|---|
| `proposeShutdown(uint256 recoveryRateBps)` | RISK_COUNCIL | Proposes shutdown. 24h timelock before ADMIN can execute. |
| `executeShutdown()` | ADMIN via AccessManager | Freezes normal flow across all contracts; enables `redeemInShutdown` / `claimAtShutdown`. |
| `adjustRecoveryRateUp(uint256 newRateBps)` | RISK_COUNCIL | Ratchets recovery rate upward only (24h timelock). Rate never decreases after shutdown entry. |

sPLUSD holders exit post-shutdown via normal `sPLUSD.redeem()` (returns PLUSD) then
`PLUSD.redeemInShutdown` for USDC at the frozen recovery rate.

---

## Shutdown Mode

Shutdown is a one-way terminal declaration by RISK_COUNCIL that normal protocol
operation has ended and LPs should be unwound at a fixed recovery rate. It is orthogonal
to pause: pause is a reversible defensive brake; shutdown is a programmatic wind-down.
Only RISK_COUNCIL can enter shutdown; only ADMIN can execute after the 24h timelock;
GUARDIAN can cancel during the window.

### Controller state

ShutdownController is a standalone contract; the flag and rate live there, not inside
PLUSD. Every other contract reads `shutdownController.isActive()` and
`shutdownController.recoveryRateBps()`, giving the protocol a single source of truth.

| Field | Meaning |
|---|---|
| `isActive` | Set true on `executeShutdown`. One-way; never reset. |
| `recoveryRateBps` | USDC-per-PLUSD payout rate (basis points, 1..10_000). Ratchets up only. |
| `reasonHash` | 32-byte reference to the off-chain incident report. |
| `activatedAt` | Block timestamp of `executeShutdown`. |
| `totalSupplyAtEntry` | `PLUSD.totalSupply()` snapshotted at entry; used by monitoring, not by payout math. |

### Entry path

1. RISK_COUNCIL schedules `proposeShutdown(recoveryRateBps, reasonHash)` through
   AccessManager with a 24h delay; GUARDIAN may cancel during this window.
2. After 24h, ADMIN calls `executeShutdown()`. `isActive` flips to true,
   `recoveryRateBps` is fixed, `totalSupplyAtEntry` is snapshotted.
3. From that moment all mint paths revert (`mintForDeposit`, `mintForYield`, and therefore
   `DepositManager.deposit` and `YieldMinter.yieldMint`); `redeemInShutdown` and
   `claimAtShutdown` become callable.

There is no pool pre-fund requirement at entry. A real solvency crisis implies there is
no USDC to pre-fund with; RISK_COUNCIL chooses `recoveryRateBps` consistent with the
RecoveryPool balance available at execution. Trustee tops up the pool over subsequent
weeks or months as capital is repatriated; `adjustRecoveryRateUp` widens the rate as
solvency improves.

### Rate adjustment — up only

Only `adjustRecoveryRateUp(newRateBps)` exists (RISK_COUNCIL, 24h delay,
GUARDIAN-cancelable). There is no downward adjustment selector. Lowering the rate after
entry would transfer value from patient LPs (who have not yet redeemed) to early
exiters — strictly anti-LP. Monitoring invariant at adjustment scheduling:

```
recoveryPool.balance() >= remainingUnredeemedSupply * newRateBps / 10_000
```

### LP exit paths

**PLUSD holders (direct):** `PLUSD.redeemInShutdown(plusdAmount)`. Requires `isActive`
and `isAllowed(msg.sender)`. Burns `plusdAmount` PLUSD (advancing `cumulativeLPBurns`),
releases `plusdAmount * recoveryRateBps / 10_000` USDC from RecoveryPool. Order of
redemption does not affect per-unit payout — no race-drain incentive.

**sPLUSD holders:** standard two-step exit; no dedicated shutdown conversion function.
`sPLUSD.redeem(shares)` first (vault stays unpaused post-shutdown specifically to keep
this open), then `PLUSD.redeemInShutdown`.

**LPs with a pre-shutdown `WithdrawalQueue` entry:** `WithdrawalQueue.claimAtShutdown(queueId)`,
callable only by the original requester while `isActive`. Applies the haircut
symmetrically to both `Pending` and `Funded` entries — both pay
`plusdAmount * recoveryRateBps / 10_000`. This closes the queue-jump exploit class
(otherwise Funded LPs would collect 1:1 while later LPs take the haircut). On the
Funded branch, WQ already holds USDC 1:1; the haircut difference returns to RecoveryPool.
On the Pending branch, payout is pulled from RecoveryPool. PLUSD escrowed in WQ is
burned in either case.

### Ongoing solvency

Monitoring invariant during shutdown:

```
recoveryRateBps * outstandingPlusd / 10_000 <= RecoveryPool.balance() + pendingTrusteeInflows
```

This is a monitoring check, not an on-chain gate. If the left side exceeds the right,
redemptions queue until Trustee inflows catch up. Rate only ratchets up, so the gap
never widens through a rate change.

### Post-shutdown capital flow

All mint paths are blocked while `isActive == true`. Late recoveries enter via ADMIN
calling `RecoveryPool.deposit(amount)`, after which RISK_COUNCIL can
`adjustRecoveryRateUp`. There is no path for PLUSD or sPLUSD share price to move
post-shutdown; the rate is the only lever.

### Separation from pause

| Mechanism | Trigger | Reversible | Blocks mints | Blocks transfers | Blocks redemptions |
|---|---|---|---|---|---|
| `pause()` | GUARDIAN, instant | Yes (ADMIN unpause, 48h) | Yes | Yes | Yes |
| Shutdown | RISK_COUNCIL 24h + ADMIN execute | No | Yes | Yes (except `redeemInShutdown`) | Opens `redeemInShutdown` / `claimAtShutdown` |

Pause and shutdown can overlap: a paused PLUSD can still have shutdown triggered. The
shutdown-redeem path is carved out of the transfer-block using a transient flag in
`PLUSD._update`, so `redeemInShutdown` works even if PLUSD has been paused separately.

### Pause cascade

The MVP deliberately keeps pause per-contract rather than consolidating into a single
global switch. GUARDIAN's runbook for a full-protocol pause is a Safe multi-call to
`pause()` on PLUSD, DepositManager, YieldMinter, WithdrawalQueue, sPLUSD, and
LoanRegistry. A global `Pausable` aggregator was considered and rejected for MVP: it
would couple every mutating path to a cross-contract read, raising the blast-radius
footprint of any bug in the aggregator itself, for a convenience win that multi-call
from the GUARDIAN Safe already delivers. Consolidation is a post-MVP refactor candidate.

---

## Data Models

### Loan origination JSON (IPFS, referenced by ERC-721 `tokenURI`)

Immutable at mint; stored off-chain as a JSON document pinned to IPFS. No on-chain
protocol logic reads these fields, so they live outside contract storage. The Trustee
pins the JSON at mint time and passes the resulting `ipfs://...` URI to
`mintLoan(originator, tokenURI)`.

| Field | Type | Notes |
|---|---|---|
| originator | address | Originator's on-chain identifier |
| borrowerId | string (hex) | Hashed borrower identifier (bytes32 hex) |
| commodity | string | e.g. Jet fuel JET A-1 |
| corridor | string | e.g. South Korea → Mongolia |
| originalFacilitySize | string (uint256) | 6-decimal USDC units (stringified for JSON) |
| originalSeniorTranche | string (uint256) | Senior portion at origination |
| originalEquityTranche | string (uint256) | Equity portion at origination |
| originalOfftakerPrice | string (uint256) | Total USDC the end buyer is contracted to pay |
| seniorInterestRateBps | number | Annualised Senior coupon rate (bps); Equity is residual |
| originationDate | number | Unix seconds at mint |
| originalMaturityDate | number | Originally agreed maturity |
| governingLaw | string | e.g. English law, LCIA London |
| additionalDocuments | array | Optional pointers to legal docs, also IPFS |

### MutableLoanData (on-chain, updated by TRUSTEE / RISK_COUNCIL)

| Field | Type | Notes |
|---|---|---|
| status | LoanStatus | Performing \| Watchlist \| Default \| Closed |
| currentMaturityDate | uint256 | May be extended from original |
| lastReportedCCR | uint256 | Basis points (e.g. 14000 = 140%) |
| lastReportedCCRTimestamp | uint256 | When CCR was last updated |
| currentLocation | LocationUpdate | Embedded struct |
| offtakerReceivedTotal | uint256 | Cumulative USDC received from offtaker (≤ originalOfftakerPrice from IPFS) |
| seniorPrincipalRepaid | uint256 | Cumulative Senior principal repaid |
| seniorInterestRepaid | uint256 | Cumulative Senior coupon (net) delivered |
| equityDistributed | uint256 | Cumulative Equity-tranche distributions (residual) |
| closureReason | ClosureReason | Set when status = Closed |

Enums: `LoanStatus { Performing, Watchlist, Default, Closed }` ·
`ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }` ·
`LocationType { Vessel, Warehouse, TankFarm, Other }`

`LocationUpdate` (embedded in MutableLoanData): `locationType`, `locationIdentifier` (vessel IMO / warehouse name), `trackingURL` (optional MarineTraffic etc.), `updatedAt`.
