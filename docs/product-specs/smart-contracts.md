# Smart Contracts

## Overview

The Pipeline protocol deploys eight functional on-chain contracts on Ethereum mainnet, plus a
shared AccessManager hub that provides role gating and timelocked scheduling for privileged
actions. All functional contracts use OpenZeppelin v5.x audited library code as their base
with custom logic confined to small, clearly-scoped extensions. All protocol contracts use
UUPS proxies; upgrades are gated by the UPGRADER role (ADMIN 3/5 Safe) with a 48h
AccessManager delay, which GUARDIAN 2/5 Safe may cancel.

Emergency response follows an Ethena-style split: GUARDIAN takes **instant, granular**
defensive actions — pause and targeted revocation of individual operational-role holders —
while re-enabling paused contracts and re-granting revoked roles requires the timelocked
ADMIN path. There is no scorched-earth `revokeAll`; every revocation is a named-role,
named-holder action that can be reviewed and cancelled on a per-call basis.

---

## Governance

Three Gnosis Safes hold all privileged roles across the protocol, with distinct signer sets:

| Safe | Threshold | Role | Timelock |
|---|---|---|---|
| ADMIN | 3/5 | Role grants, unpause, upgrades, parameter changes | 48h (14d on delay changes) |
| RISK_COUNCIL | 3/5 | Proposes `setDefault` and `enterShutdown` | 24h |
| GUARDIAN | 2/5 | Instant pause; cancel pending ADMIN actions; revoke individual operational-role holders | None |

GUARDIAN is defensive-only — it cannot grant any role, unpause a contract, upgrade, or
initiate any risk-increasing action. It can only halt in-flight operations (pause) or
strip named operational-role holders (`revokeRole(role, account)` on AccessManager) on a
one-role-at-a-time basis. Restoring service — re-enabling a paused contract or re-granting
a revoked role — is an ADMIN action subject to the 48h AccessManager delay.

---

## Contracts

| Contract | Base standard | Purpose | Custom LOC |
|---|---|---|---|
| AccessManager (OZ) | — | Single role-management hub; timelocked scheduled actions | 0 |
| PLUSD | OZ ERC20Pausable + ERC20Permit + AccessManaged + UUPS | Receipt token; minted via DepositManager (1:1 USDC) or `yieldMint` (two-party attested). Non-transferable except between system addresses and whitelisted LPs. | ~110 |
| DepositManager | AccessManaged + Pausable + ReentrancyGuard + UUPS | Atomic 1:1 USDC→PLUSD deposit. LP calls `deposit(amount)`; contract pulls USDC to Capital Wallet and calls `mintForDeposit`. | ~60 |
| sPLUSD | OZ ERC-4626 + ERC20Pausable + AccessManaged + UUPS | Yield-bearing vault on PLUSD; open to any PLUSD holder. | ~35 |
| WhitelistRegistry | AccessManaged + TimelockPending + UUPS | On-chain allowlist: KYCed LP wallets and approved DeFi venues. Tracks Chainalysis `approvedAt` timestamp. | ~95 |
| WithdrawalQueue | AccessManaged + Pausable + ReentrancyGuard + UUPS | FIFO withdrawal queue; Pending→Funded→Claimed/AdminReleased lifecycle. Full-amount funding only. | ~140 |
| LoanRegistry | OZ ERC-721 (soulbound) + AccessManaged + Pausable + UUPS | On-chain registry of loan facilities; immutable origination data + mutable lifecycle state. | ~190 |
| ShutdownController | AccessManaged + UUPS | Freezes normal flow on distress; fixes `recoveryRateBps`; opens `redeemInShutdown` / `claimAtShutdown` paths. | ~75 |
| RecoveryPool | AccessManaged + Pausable + ReentrancyGuard + UUPS | Holds USDC for LP recovery payments on shutdown. | ~70 |

---

## Contract Interfaces

### PLUSD

| Function | Access | Description |
|---|---|---|
| `mintForDeposit(address lp, uint256 amount)` | DEPOSITOR (DepositManager) | Mints PLUSD 1:1 to a USDC deposit. Increments `cumulativeLPDeposits`. Checks reserve invariant and whitelist. |
| `yieldMint(YieldAttestation att, bytes bridgeSig, bytes custodianSig)` | YIELD_MINTER (Bridge) | Mints yield PLUSD. Verifies two EIP-712 signatures on-chain: Bridge ECDSA (ecrecover on `bridgeYieldAttestor`) and custodian EIP-1271 (on `custodianYieldAttestor`). Destination constrained to sPLUSD vault or Treasury. Checks reserve invariant. |
| `burn(address from, uint256 amount)` | BURNER (WithdrawalQueue) | Burns escrowed PLUSD when LP calls `claim`. Increments `cumulativeLPBurns`. |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` hook enforces: exactly one of (from, to) must be a system address or a whitelisted LP. LP↔LP and system↔system both revert. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all mint, burn, and transfer operations. |
| `unpause()` | ADMIN | Restores operations; subject to 48h AccessManager delay, cancellable by GUARDIAN. |
| `reserveHealth()` | public view | Returns `cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns - totalSupply`. Non-negative = internally consistent. |

Direct `mint(address, uint256)` is removed. Fresh PLUSD enters supply only through
`mintForDeposit` (deposit leg) or `yieldMint` (yield leg).

### DepositManager

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 usdcAmount)` | public | Atomic deposit: checks `isAllowedForMint`, per-LP cap, rolling cap, supply cap; pulls USDC from LP to Capital Wallet; calls `PLUSD.mintForDeposit`. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of all deposits (`pauseMint` equivalent). |
| `unpause()` | ADMIN | Restores deposits; subject to 48h AccessManager delay, cancellable by GUARDIAN. |

### sPLUSD (ERC-4626)

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 assets, address receiver)` | public | Standard ERC-4626 deposit. Open to any PLUSD holder. |
| `redeem(uint256 shares, address receiver, address owner)` | public | Standard ERC-4626 redeem. Triggers lazy USYC yield mint if NAV delta > 0. |
| `totalAssets()` | public view | Returns `PLUSD.balanceOf(address(this))`. Increases when yield mints land in the vault. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of deposits and redemptions. |
| `unpause()` | ADMIN | Restores operations; subject to 48h AccessManager delay, cancellable by GUARDIAN. |

### WhitelistRegistry

| Function | Access | Description |
|---|---|---|
| `setAccess(address lp, uint256 approvedAt)` | WHITELIST_ADMIN (Bridge) | Adds or updates a whitelisted LP with the Chainalysis screening timestamp. |
| `refreshScreening(address lp, uint256 newApprovedAt)` | WHITELIST_ADMIN (Bridge) | Updates `approvedAt` for an existing whitelisted LP after re-screening. |
| `revokeAccess(address lp)` | WHITELIST_ADMIN (Bridge) or ADMIN | Removes LP from the whitelist immediately. |
| `isAllowed(address lp)` | public view | Returns true if LP is whitelisted. Does not check freshness. Used by WithdrawalQueue and PLUSD `_update`. |
| `isAllowedForMint(address lp)` | public view | Returns true if LP is whitelisted AND `(block.timestamp - approvedAt) < freshnessWindow`. Used by DepositManager. |
| `addDeFiVenue(address venue)` | ADMIN | Adds an approved DeFi pool/vault to the system-address allowlist. |

### WithdrawalQueue

Lifecycle: `Pending → Funded → Claimed | AdminReleased`

| Function | Access | Description |
|---|---|---|
| `requestWithdrawal(uint256 amount)` | public | Pulls PLUSD from caller into escrow; assigns `queue_id`; emits `WithdrawalRequested`. Reverts if caller not whitelisted with a fresh screen. |
| `fundRequest(uint256 queueId)` | FUNDER (Bridge) | Funds the queue head in full: pulls USDC from Capital Wallet to WQ via pre-approved allowance. Moves entry to `Funded`. Emits `WithdrawalFunded`. |
| `skipSanctionedHead()` | FUNDER (Bridge) | Moves a non-`isAllowed` queue head to `AdminReleased`, unblocking the queue. |
| `claim(uint256 queueId)` | public (original requester only) | Atomically burns escrowed PLUSD and pays out USDC to LP. Only callable after `Funded`. Emits `WithdrawalClaimed`. |
| `adminRelease(uint256 queueId)` | ADMIN | Manual release of a stuck entry to `AdminReleased`. |
| `getQueueDepth()` | public view | Returns `(totalEscrowed, pendingCount, fundedCount)`. |
| `pause()` | PAUSER (GUARDIAN) | Instant freeze of `fundRequest` and `claim`. |
| `unpause()` | ADMIN | Restores funding and claiming; subject to 48h AccessManager delay, cancellable by GUARDIAN. |

Partial fills, `cancelWithdrawal`, and LP-initiated cancellation are not in the MVP.

### LoanRegistry

| Function | Access | Description |
|---|---|---|
| `mintLoan(address originator, ImmutableLoanData data)` | TRUSTEE | Mints a new loan NFT. Emits `LoanMinted`. |
| `updateMutable(uint256 tokenId, LoanStatus status, uint256 newMaturityDate, uint256 newCCR, LocationUpdate newLocation)` | TRUSTEE | Updates mutable lifecycle fields. Reverts if newStatus == Default. |
| `recordRepayment(uint256 tokenId, uint256 offtakerAmount, uint256 seniorPrincipal, uint256 seniorInterest, uint256 equityAmount)` | TRUSTEE | Records a repayment split across Senior (principal + interest) and Equity tranches. Pure accounting — moves no USDC, mints no PLUSD. Reverts if `seniorPrincipal + seniorInterest + equityAmount > offtakerAmount`. Increments `offtakerReceivedTotal`, `seniorPrincipalRepaid`, `seniorInterestRepaid`, `equityDistributed`. Emits `RepaymentRecorded`. |
| `setDefault(uint256 tokenId)` | RISK_COUNCIL | Transitions loan to Default (24h timelock). |
| `closeLoan(uint256 tokenId, ClosureReason reason)` | TRUSTEE or RISK_COUNCIL | TRUSTEE for {ScheduledMaturity, EarlyRepayment}; RISK_COUNCIL for {Default, OtherWriteDown}. |
| `getImmutable(uint256 tokenId)` | public view | Returns immutable origination data. |
| `getMutable(uint256 tokenId)` | public view | Returns current mutable lifecycle data. |

Bridge has **no role on LoanRegistry**. All loan NFT writes — including `recordRepayment` —
are done by the Trustee key directly.

### ShutdownController

| Function | Access | Description |
|---|---|---|
| `proposeShutdown(uint256 recoveryRateBps)` | RISK_COUNCIL | Proposes shutdown. 24h timelock before ADMIN can execute. |
| `executeShutdown()` | ADMIN via AccessManager | Freezes normal flow across all contracts; enables `redeemInShutdown` / `claimAtShutdown`. |
| `adjustRecoveryRateUp(uint256 newRateBps)` | RISK_COUNCIL | Ratchets recovery rate upward only (24h timelock). Rate never decreases after shutdown entry. |

sPLUSD holders exit post-shutdown via normal `sPLUSD.redeem()` (returns PLUSD) then
`PLUSD.redeemInShutdown` for USDC at the frozen recovery rate.

---

## Role Assignments

**Operational roles** (GUARDIAN can revoke a named holder directly; ADMIN grants and re-grants under 48h timelock):

- Bridge holds: `YIELD_MINTER` (PLUSD), `FUNDER` (WithdrawalQueue), `WHITELIST_ADMIN` (WhitelistRegistry).
- Trustee key holds: `TRUSTEE` on LoanRegistry (all loan NFT writes — Bridge has no LoanRegistry role).

**Contract-held roles** (bound to a proxy address, not an EOA; not subject to GUARDIAN revocation in the ordinary flow):

- DepositManager proxy holds: `DEPOSITOR` on PLUSD.
- WithdrawalQueue proxy holds: `BURNER` on PLUSD.

**Governance roles** (held by Safes; not revocable by GUARDIAN):

- GUARDIAN Safe holds: `PAUSER` on every pausable contract; `GUARDIAN_ROLE` on AccessManager (cancel pending actions, revoke operational-role holders).
- ADMIN Safe holds: `UPGRADER` on every upgradeable contract, `DEFAULT_ADMIN` on AccessManager (role grants, unpause, parameter changes — all 48h-timelocked).
- RISK_COUNCIL Safe holds: `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController.

### GUARDIAN revocation scope

GUARDIAN's `revokeRole(role, account)` on AccessManager is restricted to operational roles:
`YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`. Revocation is instant and requires
no timelock. Re-granting a revoked role requires an ADMIN proposal with the 48h
AccessManager delay (which GUARDIAN may cancel). GUARDIAN cannot revoke `UPGRADER`,
`DEFAULT_ADMIN`, `DEPOSITOR`, `BURNER`, or any governance role — attempts revert.

---

## Data Models

### ImmutableLoanData (set at mint, never changes)

| Field | Type | Notes |
|---|---|---|
| originator | address | Originator's on-chain identifier |
| borrowerId | bytes32 | Hashed borrower identifier |
| commodity | string | e.g. Jet fuel JET A-1 |
| corridor | string | e.g. South Korea → Mongolia |
| originalFacilitySize | uint256 | 6-decimal USDC units |
| originalSeniorTranche | uint256 | Senior portion at origination |
| originalEquityTranche | uint256 | Equity portion at origination |
| originalOfftakerPrice | uint256 | Total USDC the end buyer is contracted to pay for the cargo |
| seniorInterestRateBps | uint256 | Annualised Senior coupon rate (bps); Equity is residual |
| originationDate | uint256 | Block timestamp at mint |
| originalMaturityDate | uint256 | Originally agreed maturity |
| governingLaw | string | e.g. English law, LCIA London |
| metadataURI | string | Optional IPFS pointer |

### MutableLoanData (updated by TRUSTEE / RISK_COUNCIL)

| Field | Type | Notes |
|---|---|---|
| status | LoanStatus | Performing \| Watchlist \| Default \| Closed |
| currentMaturityDate | uint256 | May be extended from original |
| lastReportedCCR | uint256 | Basis points (e.g. 14000 = 140%) |
| lastReportedCCRTimestamp | uint256 | When CCR was last updated |
| currentLocation | LocationUpdate | Embedded struct |
| offtakerReceivedTotal | uint256 | Cumulative USDC received from offtaker (≤ originalOfftakerPrice) |
| seniorPrincipalRepaid | uint256 | Cumulative Senior principal repaid |
| seniorInterestRepaid | uint256 | Cumulative Senior coupon (net) delivered |
| equityDistributed | uint256 | Cumulative Equity-tranche distributions (residual) |
| closureReason | ClosureReason | Set when status = Closed |

Enums: `LoanStatus { Performing, Watchlist, Default, Closed }` ·
`ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }` ·
`LocationType { Vessel, Warehouse, TankFarm, Other }`

`LocationUpdate` (embedded in MutableLoanData): `locationType`, `locationIdentifier` (vessel IMO
/ warehouse name), `trackingURL` (optional MarineTraffic etc.), `updatedAt`.

---

## Security Considerations

- **No single point of mint compromise.** Deposit-leg mints require an atomic contract call
  through DepositManager (no off-chain signer). Yield-leg mints require Bridge ECDSA signature
  + custodian EIP-1271 signature + YIELD_MINTER caller role — three independent controls.
  Compromising any one party alone mints zero PLUSD.
- **Reserve invariant on every mint path.** On-chain cumulative counters prevent over-minting
  against the contract's own ledger. Full Proof of Reserve (Chainlink PoR) is deferred to
  phase 2.
- **Bounded upgradeability.** 48h ADMIN delay on upgrades with GUARDIAN veto. A 14-day
  meta-timelock on delay changes closes the "collapse-delay-then-exploit" second-order attack.
- **Three-Safe governance separation.** ADMIN cannot enter shutdown or declare default;
  RISK_COUNCIL cannot perform upgrades or manage roles; GUARDIAN cannot grant roles,
  unpause, upgrade, or initiate any risk-increasing action.
- **Granular defensive response.** GUARDIAN's emergency toolkit is instant but narrow:
  pause a named pausable contract, cancel a pending ADMIN action, or revoke a named holder
  of a named operational role (`YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`).
  There is no `revokeAll` switch that strips everything at once — every action names what
  it is doing to what, leaving a reviewable record and bounded blast radius. Re-enabling a
  paused contract or re-granting a revoked role is an ADMIN action with the 48h
  AccessManager delay, which GUARDIAN may cancel if the restoration is premature.
- **Smart contracts hold no USDC.** Capital Wallet and Treasury Wallet are MPC-controlled.
  A contract exploit cannot drain investor capital unilaterally.
- **Non-transferable PLUSD.** The `_update` hook requires exactly one of (from, to) to be a
  system address or whitelisted LP, closing LP↔LP and system↔system laundering attack classes.
- **On-chain repayment accounting is informational.** `LoanRegistry.recordRepayment`
  increments counters and emits an event but moves no USDC and mints no PLUSD. sPLUSD share
  price moves only on actual yield mints via the two-party `yieldMint` path. A compromised
  Trustee key cannot inflate share price by writing false repayment entries.
