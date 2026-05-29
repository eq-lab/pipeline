# Smart Contracts — LoanRegistry, ShutdownController & Shutdown Mode

> See [smart-contracts.md](./smart-contracts.md) for the main spec and [smart-contracts-interfaces.md](./smart-contracts-interfaces.md) for core contract interfaces.

---

## LoanRegistry

| Function | Access | Timelock | Description |
|---|---|---|---|
| `mintLoan(address originator, ImmutableLoanData economics, string metadataURI, string initialLocation)` | TRUSTEE | none | Mints a new loan NFT and writes genesis economics on-chain plus `epochs[0]`. `metadataURI` points to an IPFS JSON document with descriptive material only. Emits `LoanMinted`. |
| `updateMutable(uint256 loanId, LoanStatus status, uint256 newCCR, LocationUpdate newLocation, string metadataURI)` | TRUSTEE | none | Updates non-economic mutable fields. `status` may be one of {Performing, Watchlist, Matured}. Reverts on Default and Closed. Does not touch rate or maturity. |
| `recordPayment(uint256 loanId, uint256 offtakerAmount, uint256 seniorPrincipal, uint256 seniorInterest, uint256 mgmtFee, uint256 perfFee, uint256 oetAlloc, uint256 equityAmount)` | TRUSTEE | none | Records a repayment split. Pure accounting, moves no USDC, mints no PLUSD. Reverts unless the loan is in {Performing, Watchlist} and the six components sum to `<= offtakerAmount`. Increments the seven per-loan counters. Emits `PaymentRecorded`. |
| `rollover(uint256 loanId, uint32 newRateBps, uint64 newMaturityDate)` | TRUSTEE | none | Rolls a loan into a new term after maturity. Reverts unless `now >= currentMaturityDate` and status is not Default or Closed. Appends an `EconomicsEpoch`, sets `currentMaturityDate`, returns status to Performing. Emits `LoanRolledOver`. |
| `amendEconomics(uint256 loanId, uint32 newRateBps, uint64 newMaturityDate)` | RISK_COUNCIL | 24h | Re-terms a loan outside the rollover fast-path (default penalty rate, off-cycle maturity change). Appends an `EconomicsEpoch` from the call time. Emits `EconomicsAmended`. |
| `setDefault(uint256 loanId)` | RISK_COUNCIL | 24h | Transitions loan to Default. May fire before or after maturity. Blocks loan-tied mints. |
| `closeLoan(uint256 loanId, ClosureReason reason)` | TRUSTEE or RISK_COUNCIL | TRUSTEE none / RISK_COUNCIL 24h | TRUSTEE for {ScheduledMaturity, EarlyRepayment}; RISK_COUNCIL for {Default, OtherWriteDown}. |
| `getImmutable(uint256 loanId)` | public view | none | Returns genesis economics. |
| `getMutable(uint256 loanId)` | public view | none | Returns current mutable lifecycle and repayment data. |
| `getEpochs(uint256 loanId)` | public view | none | Returns the append-only economics epoch schedule. |
| `tokenURI(uint256 loanId)` | public view (ERC-721) | none | Returns the IPFS URI of the descriptive document (the mutable `metadataURI`). |

Relayer has **no role on LoanRegistry**. All loan NFT writes, including `recordPayment`,
`rollover`, and `setDefault`, are executed by the Trustee key or the RISK_COUNCIL multisig
directly per the table above.

Genesis economics are stored on-chain in `ImmutableLoanData` and mirrored into `epochs[0]`.
YieldMinter reads them on every loan-tied mint to enforce the maturity-capped interest
ceiling, so they must be on-chain rather than on IPFS. The IPFS document referenced by
`metadataURI` carries descriptive material only (borrower hash, commodity, corridor,
governing law, additional legal documents) and is appendable over the loan's life.

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
   `DepositManager.deposit` and `YieldMinter.mintLoanYield` / `mintTbillYield`); `redeemInShutdown` and
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

Field-level detail is authoritative in [loans-data.md](./loans-data.md). Summary of the
three on-chain loan structs:

- **`ImmutableLoanData`** — seven numeric genesis fields written once in `mintLoan` and
  never rewritten: `originalFacilitySize`, `originalSeniorTranche` (the accrual base),
  `originalEquityTranche`, `originalOfftakerPrice`, `seniorInterestRateBps`,
  `originationDate`, `originalMaturityDate`. Mirrored into `epochs[0]`. YieldMinter reads
  these on every loan-tied mint. Descriptive material (borrower hash, commodity, corridor,
  governing law, additional documents) lives in the IPFS `metadataURI`.
- **`EconomicsEpoch`** — append-only `{ effectiveFrom, maturityDate, seniorInterestRateBps }`.
  `epochs[0]` mirrors the genesis term; `rollover` (TRUSTEE) and `amendEconomics`
  (RISK_COUNCIL) append a row. No row is ever rewritten or removed. The YieldMinter ceiling
  is the maturity-capped piecewise sum over epochs, accrual base `originalSeniorTranche`.
- **`MutableLoanData`** — lifecycle plus seven repayment counters: `status`, `ccrBps`,
  `lastReportedCCRTimestamp`, `currentMaturityDate`, `closureReason`, `currentLocation`,
  `metadataURI`, `offtakerReceivedTotal`, `seniorPrincipalRepaid`, `seniorInterestRecorded`,
  `mgmtFeeRecorded`, `perfFeeRecorded`, `oetAllocRecorded`, `equityDistributed`.

Enums: `LoanStatus { Performing, Watchlist, Matured, Default, Closed }` ·
`ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }` ·
`LocationType { Vessel, Warehouse, TankFarm, Other }`. `LocationUpdate` embeds
`locationType`, `locationIdentifier`, `trackingURL`, `updatedAt`.
