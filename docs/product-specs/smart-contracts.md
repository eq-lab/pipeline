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

#### Reserve invariant & mint caps

PLUSD maintains three cumulative counters, updated in the same transaction that moves value:

| Counter | Incremented in | Meaning |
|---|---|---|
| `cumulativeLPDeposits` | `mintForDeposit` | Total PLUSD ever minted on the deposit leg |
| `cumulativeYieldMinted` | `yieldMint` | Total PLUSD ever minted on the yield leg |
| `cumulativeLPBurns` | `burn` (via WQ), `redeemInShutdown` | Total PLUSD ever burned |

Every mint path asserts, before executing:

```
totalSupply() + amount ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns
totalSupply() + amount ≤ maxTotalSupply
```

This is internal-consistency only — it catches counter desync and prevents over-mint
against the contract's own ledger. It is **not** a Proof of Reserve: it does not verify
the custodian actually holds the USDC. Full on-chain PoR (Chainlink) is phase 2.

Four numeric caps gate mints, all managed by ADMIN through the 48h AccessManager delay:

| Cap | Enforced | Loosening |
|---|---|---|
| `maxPerWindow` | Aggregate PLUSD minted across all LPs per rolling 24h | ADMIN, 48h delay |
| `maxPerLPPerWindow` | Per-LP PLUSD minted per rolling 24h (LP path only; yield mints to system addresses exempt) | ADMIN, 48h delay |
| `maxTotalSupply` | Hard ceiling on `PLUSD.totalSupply()` | ADMIN, 48h delay; floor enforced |
| `freshnessWindow` | Chainalysis screening age on `isAllowedForMint` | ADMIN, bounded `[7d, 365d]` |

Tightening any cap is instant (ADMIN). Loosening is 48h-delayed and GUARDIAN-cancelable.
The per-tx cap (`maxPerTx`) was dropped in v2.3 — per-LP-per-window already bounds any
one actor, and per-tx caps create UX friction for legitimate large deposits without a
security benefit. The rolling window is a fixed-window algorithm, so worst case is
`2 × maxPerWindow` over a boundary; this is acceptable because `maxTotalSupply` and the
custodian MPC policy engine's independent cap on Bridge-originated USDC releases bound
the worst-case blast radius.

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
3. From that moment all mint paths revert (`mintForDeposit`, `yieldMint`, and therefore
   `DepositManager.deposit`); `redeemInShutdown` and `claimAtShutdown` become callable.

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
recoveryPool.balance() ≥ remainingUnredeemedSupply × newRateBps / 10_000
```

### LP exit paths

**PLUSD holders (direct):** `PLUSD.redeemInShutdown(plusdAmount)`. Requires `isActive`
and `isAllowed(msg.sender)`. Burns `plusdAmount` PLUSD (advancing `cumulativeLPBurns`),
releases `plusdAmount × recoveryRateBps / 10_000` USDC from RecoveryPool. Order of
redemption does not affect per-unit payout — no race-drain incentive.

**sPLUSD holders:** standard two-step exit; no dedicated shutdown conversion function.
`sPLUSD.redeem(shares)` first (vault stays unpaused post-shutdown specifically to keep
this open), then `PLUSD.redeemInShutdown`.

**LPs with a pre-shutdown `WithdrawalQueue` entry:** `WithdrawalQueue.claimAtShutdown(queueId)`,
callable only by the original requester while `isActive`. Applies the haircut
symmetrically to both `Pending` and `Funded` entries — both pay
`plusdAmount × recoveryRateBps / 10_000`. This closes the queue-jump exploit class
(otherwise Funded LPs would collect 1:1 while later LPs take the haircut). On the
Funded branch, WQ already holds USDC 1:1; the haircut difference returns to RecoveryPool.
On the Pending branch, payout is pulled from RecoveryPool. PLUSD escrowed in WQ is
burned in either case.

### Ongoing solvency

Monitoring invariant during shutdown:

```
recoveryRateBps × outstandingPlusd / 10_000 ≤ RecoveryPool.balance() + pendingTrusteeInflows
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

## Upgradeability

All eight protocol contracts use OpenZeppelin v5.x UUPS proxies. AccessManager itself is
deployed fresh from OZ and is not upgradeable (it has no custom code to evolve).

### Authorisation

- `upgradeTo(newImpl)` on every proxy is gated by the `UPGRADER` role on AccessManager.
- `UPGRADER` is held exclusively by the ADMIN 3/5 Safe.
- The call is scheduled through AccessManager with a 48h delay on the `upgradeTo`
  selector; GUARDIAN 2/5 may call `AccessManager.cancel(actionId)` at any point during
  the window to halt the upgrade.

### Meta-timelock on delay changes

`setTargetAdminDelay` — the function that sets the 48h delay itself — is gated by a
14-day meta-timelock. This defeats the sequence "ADMIN schedules delay-to-zero, waits
48h, delay is now zero, ADMIN immediately schedules a malicious upgrade with no wait."
A compromised ADMIN Safe still gives an attacker a minimum of 14 + 48h before any
upgrade lands — a window in which GUARDIAN can cancel, signers can rotate, or off-chain
governance can intervene.

### Implementation hygiene (required for every upgrade)

1. Constructor calls `_disableInitializers()`. Enforced as a pre-deployment audit item.
2. EIP-712 `name` and `version` are compile-time constants (e.g. `"Pipeline PLUSD"` / `"1"`).
3. `_authorizeUpgrade(address newImpl)` performs an on-chain check that the new
   implementation's `eip712Domain()` returns matching `name` and `version`. This defends
   against a silent domain-separator change that would orphan pre-signed yield
   attestations or ERC-20 permits.

### Storage discipline

Each contract uses ERC-7201 namespaced storage. Slots may only be appended; existing
slots may not be reordered, renamed, or resized. Enforced at the diff level for every
upgrade PR.

---

## Emergency Response

Emergency response is Ethena-style: GUARDIAN takes instant, granular defensive actions;
restoring service requires the 48h AccessManager timelock. No single-call "revoke
everything" switch exists — every action names what it is doing to what, leaving a
reviewable record and a bounded blast radius. Playbooks below; the full threat model
and defence-layer analysis lives in [security.md](./security.md).

### GUARDIAN's toolkit

| Action | Target | Timelock |
|---|---|---|
| `pause()` | Any pausable contract | Instant |
| `AccessManager.cancel(actionId)` | Any pending scheduled action (upgrade, role grant, parameter loosening, shutdown entry) | Instant |
| `AccessManager.revokeRole(role, account)` | Individual operational-role holders only — `YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE` | Instant |

GUARDIAN **cannot** grant roles, unpause any contract, upgrade, revoke governance roles
(`UPGRADER`, `DEFAULT_ADMIN`) or contract-held roles (`DEPOSITOR`, `BURNER`), or
initiate any risk-increasing action. Attempts revert.

### Restoration path

Every restoration runs through ADMIN with the 48h AccessManager delay and is itself
GUARDIAN-cancelable: `unpause()` on any contract; re-grant of any revoked operational
role; rotation of `bridgeYieldAttestor` / `custodianYieldAttestor` via
`PLUSD.proposeYieldAttestors`; rotation of `capitalWallet` on DepositManager; upgrade
of any implementation via the `UPGRADER` role.

### Playbook: Bridge operational-key compromise

1. **Detection.** Watchdog alerts on anomalous `WhitelistAccess` grants,
   `WithdrawalFunded` without matching Capital Wallet allowance movement, divergence
   between `DepositManager.Deposited` and `PLUSD.cumulativeLPDeposits`, or
   reserve-invariant headroom shrinking unexpectedly.
2. **Immediate (GUARDIAN, < 1 min).** Pause PLUSD, DepositManager, and WithdrawalQueue
   (defence in depth).
3. **Containment (GUARDIAN, < 10 min).** Submit separate `revokeRole` transactions for
   `YIELD_MINTER`, `FUNDER`, and `WHITELIST_ADMIN` on the compromised Bridge address.
   Even a fully compromised Bridge cannot mint yield afterwards (custodian EIP-1271
   still required), cannot fund withdrawals (`FUNDER` revoked), and cannot modify the
   whitelist.
4. **Investigation & recovery.** Audit event logs; if the yield-signing key is
   compromised, initiate `PLUSD.proposeYieldAttestors(newBridgeAttestor, sameCustodian)`
   under 48h timelock. Provision a new Bridge address; ADMIN proposes re-granting
   `YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN` under 48h timelock each. Unpause via
   ADMIN.

### Playbook: Trustee key compromise

1. **Immediate.** GUARDIAN revokes `TRUSTEE` from the Trustee key. Blocks `mintLoan`,
   `updateMutable`, `recordRepayment`, and Trustee-branch `closeLoan`. Capital flows
   are unaffected — LoanRegistry has no capital touchpoints.
2. **Containment.** Trustee can (out-of-band, via Capital Wallet MPC policy) revoke the
   Capital Wallet → WQ USDC allowance. Single-key Trustee compromise alone cannot move
   USDC (Bridge cosign required).
3. **Data-integrity review.** False LoanRegistry entries do not move funds or share
   price; reconcile against Capital Wallet inflows to identify them.
4. **Recovery.** Provision a new Trustee key; ADMIN re-grants `TRUSTEE` under 48h
   timelock.

### Playbook: Custodian yield-attestor compromise

1. **Immediate.** Custodian's own key-management revokes the compromised key; no
   on-chain action strictly required — the compromised key alone cannot mint (Bridge
   sig and `YIELD_MINTER` caller role still needed).
2. **Rotation.** ADMIN calls `PLUSD.proposeYieldAttestors(sameBridge, newCustodian)`
   under 48h timelock. Yield mints continue during the window (old attestor still
   valid — acceptable because it cannot mint alone).
3. **Defence in depth.** If coordinated compromise is suspected, GUARDIAN also pauses
   PLUSD and revokes `YIELD_MINTER` from Bridge.

---

## Deferred features

Acknowledged design targets not in MVP scope. Documented here so reviewers understand
the bounded nature of what is shipping.

### Loss waterfall

On a loan loss event, the intended seniority is:

1. Originator equity tranche (absorbed by the originator off-chain).
2. sPLUSD writedown (share-price reduction).
3. IOU token issued to PLUSD holders for the residual.

An insurance-tranche unwind is planned as a Gradual Dutch Auction (GDA) on the residual
equity. **None of this is implemented in MVP.** The MVP's only response to loss is
shutdown (fixed recovery rate on PLUSD), which is a blunt instrument. Per-loan loss
handling without protocol-wide shutdown is post-MVP.

### Chainlink Proof of Reserve

The MVP's reserve invariant verifies internal-consistency only. Chainlink PoR, which
would verify on-chain that `PLUSD.totalSupply()` is backed by actual USD-equivalent
custody balances, is phase 2.

### Partial loan repayments

Trade-finance loans in MVP are effectively single-shot: principal + interest paid at
maturity or early in one transfer. `recordRepayment` supports a single tranche-split
entry per call, which the Trustee may call multiple times if operational reality is
multi-tranche, but there is no on-chain primitive for "expected schedule of partial
repayments." If multi-tranche repayment becomes operationally needed, the extension
will be additive (a `LoanPartialRepaid` event and additional mutable fields).

### sPLUSD transferability beyond the PLUSD redeem whitelist

sPLUSD shares are freely transferable ERC-20. The PLUSD redeem-whitelist gate on the
underlying asset neutralises secondary-market value for non-KYC buyers (they can hold
sPLUSD but cannot redeem for USDC). A future version could add sPLUSD-level transfer
restrictions.

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

For the full threat model (single-role and joint-compromise analysis, peer-protocol
comparison, layered defence stack, timelock action table, pause cascade, cross-rail
sequence integrity, known properties, and accepted trust assumptions), see
[security.md](./security.md).

---

## Appendix A — Actor glossary

| Actor | Type | On-chain roles | Notes |
|---|---|---|---|
| ADMIN Safe | 3/5 Gnosis Safe | `DEFAULT_ADMIN` on AccessManager, `UPGRADER` on every proxy | All actions 48h-timelocked. Grants and re-grants operational roles (re-grant under 48h after a GUARDIAN revocation). |
| RISK_COUNCIL Safe | 3/5 Gnosis Safe | Caller of `setDefault` on LoanRegistry, `proposeShutdown` and `adjustRecoveryRateUp` on ShutdownController | 24h AccessManager delay on these selectors. Distinct signer set from ADMIN. |
| GUARDIAN Safe | 2/5 Gnosis Safe | `PAUSER` on every pausable contract; `GUARDIAN_ROLE` on AccessManager | Instant pause, cancellation, and operational-role revocation. No ability to grant, unpause, upgrade, or initiate risk-increasing actions. |
| Bridge | Protocol backend | `YIELD_MINTER` (PLUSD), `FUNDER` (WithdrawalQueue), `WHITELIST_ADMIN` (WhitelistRegistry) | On-chain EOA or contract wallet. Never custodies USDC. Co-signs yield-mint attestations alongside custodian. Not in the critical path for deposits (those are atomic LP-driven via DepositManager). Has no role on LoanRegistry. |
| Trustee | Pipeline Trust Company key | `TRUSTEE` on LoanRegistry | All LoanRegistry writes: `mintLoan`, `updateMutable`, `recordRepayment`, Trustee-branch `closeLoan`. Also one cosigner on the Capital Wallet MPC. Distinct key set from Bridge and Team. |
| Pipeline Team | Team key | — (none on-chain) | One cosigner on Capital Wallet and Treasury Wallet MPC. Co-signs loan disbursement and treasury operations per custodian policy. |
| Capital Wallet | MPC-controlled on-chain address | — | Holds USDC reserves. Cosigners: Trustee + Team + Bridge. All Capital Wallet transfers are on-chain ERC-20, never off-chain wires. |
| Treasury Wallet | MPC-controlled on-chain address | — | Protocol fees and yield share. |
| Custodian yield-attestor | EIP-1271 contract | — (smart-contract signer) | Independent second signer on every yield mint. Compromising Bridge alone mints zero; compromising the custodian alone mints zero. |
| Bridge yield-attestor | EOA | — (ECDSA signer) | First signer on every yield mint. Rotatable via `proposeYieldAttestors` under 48h ADMIN timelock. |
| DepositManager | Contract | Holds `DEPOSITOR` on PLUSD | Only account authorised to call `PLUSD.mintForDeposit`. |
| WithdrawalQueue | Contract | Holds `BURNER` on PLUSD | Only account authorised to call `PLUSD.burn` on the claim path. |
