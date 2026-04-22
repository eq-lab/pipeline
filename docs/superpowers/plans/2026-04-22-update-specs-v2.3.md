# Update Product Specs to v2.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all affected product specs in `docs/product-specs/` to reflect the v2.3 smart-contract and backend design, replacing the v0.3.8-era descriptions with the confirmed v2.3 architecture.

**Architecture:** v2.3 replaces the Bridge-mediated deposit attestation flow with an atomic on-chain DepositManager; retires MINT_ATTESTOR; adds two-party yield attestation; restructures the WithdrawalQueue lifecycle; and removes Bridge from the loan disbursement and USDC↔USYC rebalancing paths.

**Tech Stack:** Markdown docs, TypeScript lint script (`npx tsx scripts/lint-docs.ts`)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `docs/references/index.md` | Modify | Register three new reference docs |
| `docs/product-specs/deposits.md` | Rewrite | DepositManager atomic flow replaces bridge-mediated mint; remove per-tx cap and mint queue |
| `docs/product-specs/smart-contracts.md` | Rewrite | 8 contracts + AccessManager + EmergencyRevoker; role renames; new PLUSD mint architecture |
| `docs/product-specs/bridge-service.md` | Rewrite | Remove deposit flow, loan disbursement, rebalancing; two-party yield attestation; lazy USYC yield |
| `docs/product-specs/withdrawals.md` | Rewrite | New Pending→Funded→Claimed/AdminReleased lifecycle; remove partial fills and cancelWithdrawal |
| `docs/product-specs/yield.md` | Modify | Lazy USYC yield on stake/unstake; two-party attestation; remove bridge rebalancing |
| `docs/product-specs/lp-onboarding.md` | Modify | Fix freshness-gate attribution (now DepositManager, not Bridge) |

---

### Task 1: Register reference documents in `docs/references/index.md`

**Files:**
- Modify: `docs/references/index.md`

- [ ] **Step 1: Update the index**

Replace the `## Source Documents` section and add entries for all three new reference docs:

```markdown
## Source Documents

- [Initial Technical Spec (PRD)](../initial_spec.md) — Pipeline MVP Technical Specification v0.3.8 (original source of truth)
- [Smart Contract Design Spec v2.3](./smart-contracts.md) — Canonical smart contract specification; supersedes v0.3.8 contract descriptions
- [Bridge Backend Spec](./backend.md) — Bridge service scope, flows, data model, and API surface (v2.3)
- [Mint Trust Model](./security.md) — Threat analysis, peer-protocol survey, and layered defence rationale for the PLUSD mint path (v2.3)
```

- [ ] **Step 2: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/references/index.md
git commit -m "docs: register v2.3 reference documents in references index"
```

---

### Task 2: Rewrite `docs/product-specs/deposits.md`

**Files:**
- Modify: `docs/product-specs/deposits.md`

**Summary of changes:**
- Replace the bridge-mediated EIP-712 attestation deposit flow with the DepositManager atomic flow.
- LP calls `DepositManager.deposit(amount)` directly; the contract atomically: checks `isAllowedForMint`, checks `maxPerWindow` / `maxPerLPPerWindow` rolling caps, checks `maxTotalSupply` hard ceiling, enforces reserve invariant, does `USDC.transferFrom(lp, capitalWallet, amount)`, calls `PLUSD.mintForDeposit(lp, amount)`.
- Remove the per-tx cap ($5M) — dropped in v2.3. The `maxPerLPPerWindow` cap bounds single-actor exposure.
- Remove the deposit mint queue — over-cap deposits revert at contract; LP retries when headroom opens.
- Remove the below-minimum accumulation counter — not present in v2.3 flow.
- Update rate-limit parameters table: `maxPerWindow`, `maxPerLPPerWindow`, `maxTotalSupply`.
- Update API contract section: `DepositManager.deposit`, `PLUSD.mintForDeposit`, `PLUSD.isAllowedForMint`.
- Update security section to reflect: no off-chain signer to forge; reserve invariant enforced on-chain; hard supply cap.

- [ ] **Step 1: Rewrite the file**

Write the following content to `docs/product-specs/deposits.md`:

```markdown
# Deposits and PLUSD Minting

## Overview

An LP deposits USDC by calling `DepositManager.deposit(amount)` directly. The contract
atomically pulls USDC from the LP's wallet to the Capital Wallet and mints PLUSD 1:1 to the
depositor in a single transaction. Bridge is not involved in the deposit flow — the on-chain
USDC transfer IS the attestation. Deposits that exceed on-chain rate limits revert; the LP
retries when window headroom opens.

---

## Behavior

### Deposit Initiation

The LP must first whitelist-approve their wallet via KYC/KYB onboarding (see lp-onboarding
spec). Before presenting the deposit UI, the app reads the LP's on-chain WhitelistRegistry
entry via `isAllowedForMint(lp)`:

- If not whitelisted, the deposit UI is disabled and the LP is directed to complete onboarding.
- If whitelisted but the Chainalysis freshness window has expired, the deposit UI is blocked
  and the LP is prompted to re-verify. Bridge calls `WhitelistRegistry.refreshScreening` on a
  clean Chainalysis result to update `approvedAt`.

To deposit, the LP first calls `USDC.approve(depositManager, amount)` from their wallet, then
calls `DepositManager.deposit(amount)`.

### On-Chain Deposit Contract (DepositManager)

`DepositManager.deposit(uint256 usdcAmount)` enforces all checks in a single atomic
transaction, in this order:

1. **Whitelist + freshness check.** `PLUSD.isAllowedForMint(msg.sender)` must return true.
   Reverts with `NotAllowedForMint` if the LP is not whitelisted or the Chainalysis screen is
   stale (> 90-day freshness window).
2. **Per-LP rolling window cap.** `lpWindowMinted[msg.sender] + amount <= maxPerLPPerWindow`.
   Reverts if a single LP would exceed their window allocation.
3. **Global rolling window cap.** `windowMinted + amount <= maxPerWindow`. Reverts if total
   minted in the current rolling window would exceed the protocol-wide cap.
4. **Hard total supply cap.** `PLUSD.totalSupply() + amount <= maxTotalSupply`. Reverts if
   the protocol hard ceiling would be breached.
5. **Reserve invariant check.** `totalSupply + amount <= cumulativeLPDeposits + amount +
   cumulativeYieldMinted - cumulativeLPBurns`. Enforced inside `mintForDeposit` atomically.
6. **USDC pull.** `USDC.transferFrom(msg.sender, capitalWallet, usdcAmount)`. Fails if LP has
   not approved.
7. **PLUSD mint.** `PLUSD.mintForDeposit(msg.sender, usdcAmount)`. Increments
   `cumulativeLPDeposits` in the same transaction. Emits `Deposited(lp, amount)`.

If any step reverts, the entire transaction rolls back atomically. The LP's USDC is never
moved without the corresponding PLUSD mint succeeding in the same transaction.

### Over-Rate-Limit Deposits

If a deposit would breach `maxPerWindow` or `maxPerLPPerWindow`, the contract reverts. There
is no queue: the LP must retry when window headroom has reopened. The Bridge API endpoint
`GET /v1/protocol/limits` exposes current window utilisation and per-LP utilisation so the
deposit UI can show live cap status before the LP submits.

### PLUSD Mint

`PLUSD.mintForDeposit(address lp, uint256 amount)` is callable only by the DepositManager
(DEPOSITOR role). The function:

- Increments `cumulativeLPDeposits` by `amount`.
- Checks the reserve invariant: `totalSupply + amount <= cumulativeLPDeposits +
  cumulativeYieldMinted - cumulativeLPBurns`. Reverts on invariant failure.
- Mints PLUSD 1:1 to `lp`.
- Enforces the `_update` hook: recipient must satisfy `WhitelistRegistry.isAllowed(lp)`.

PLUSD is minted 1:1 to USDC received. No fee is deducted at mint time.

---

## API Contract

### DepositManager.deposit

```solidity
function deposit(uint256 usdcAmount) external;
// Access: public (whitelisted LPs only — enforced via isAllowedForMint)
// Checks (in order):
//   1. isAllowedForMint(msg.sender) == true
//   2. lpWindowMinted[msg.sender] + usdcAmount <= maxPerLPPerWindow
//   3. windowMinted + usdcAmount <= maxPerWindow
//   4. PLUSD.totalSupply() + usdcAmount <= maxTotalSupply
//   5. USDC.transferFrom(msg.sender, capitalWallet, usdcAmount)
//   6. PLUSD.mintForDeposit(msg.sender, usdcAmount)
// Emits: Deposited(address indexed lp, uint256 amount)
```

### PLUSD.mintForDeposit

```solidity
function mintForDeposit(address lp, uint256 amount) external;
// Access: DEPOSITOR role (DepositManager proxy only)
// Enforces:
//   - Reserve invariant: totalSupply + amount <= cumulativeLPDeposits + amount +
//     cumulativeYieldMinted - cumulativeLPBurns
//   - WhitelistRegistry.isAllowed(lp) == true (via _update hook)
// Increments cumulativeLPDeposits by amount.
// Emits: Transfer(address(0), lp, amount)
```

### WhitelistRegistry.isAllowedForMint

```solidity
function isAllowedForMint(address lp) external view returns (bool);
// Returns true if lp is whitelisted AND (block.timestamp - approvedAt) < freshnessWindow
// Used by DepositManager at deposit time.
```

### On-chain rate-limit parameters (configurable by ADMIN 3/5 Safe, tightening instant / loosening 48h)

| Parameter | Description |
|---|---|
| `maxPerWindow` | Maximum total PLUSD minted across all deposits in the rolling window |
| `maxPerLPPerWindow` | Maximum PLUSD minted by a single LP in the rolling window |
| `maxTotalSupply` | Hard ceiling on `PLUSD.totalSupply()` — MakerDAO PSM debt-ceiling analog |

Launch values are a product/risk decision (open item — see references/backend.md decision #13).

---

## Data Model

### Reserve Invariant Counters (on PLUSD contract)

| Field | Type | Description |
|---|---|---|
| `cumulativeLPDeposits` | `uint256` | Cumulative USDC deposits minted via DepositManager (6 decimals) |
| `cumulativeYieldMinted` | `uint256` | Cumulative PLUSD minted via yieldMint |
| `cumulativeLPBurns` | `uint256` | Cumulative PLUSD burned by WithdrawalQueue |

These counters are updated atomically in the same transaction that moves value. The invariant
`totalSupply <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns` is checked
on every mint and burn.

---

## Security Considerations

- **No off-chain signer to forge.** The on-chain USDC transfer IS the deposit evidence. There
  is no EIP-712 attestation or Bridge key that could be forged to mint unbacked PLUSD on the
  deposit leg.
- **Reserve invariant enforced on-chain.** Three cumulative counters updated in the same
  transaction prevent the Resolv-class over-minting attack (minting more than deposits justify)
  at the contract level, independently of any off-chain service.
- **Hard supply cap.** `maxTotalSupply` provides a circuit-breaker bounding total PLUSD
  supply regardless of deposit volume. Tightening is instant (ADMIN); loosening requires 48h
  AccessManager delay.
- **Per-LP window cap.** `maxPerLPPerWindow` bounds single-actor minting within any rolling
  window, replacing the dropped per-transaction cap.
- **Smart contracts hold no USDC.** The Capital Wallet is an MPC wallet. A contract exploit
  cannot drain deposited USDC; the DepositManager only calls `transferFrom` to move USDC
  from the LP's wallet to the Capital Wallet.
- **Whitelist enforced at contract, not bridge.** The DEPOSITOR role on PLUSD is held by the
  DepositManager proxy address. No other caller can invoke `mintForDeposit`. The `_update`
  hook additionally ensures PLUSD cannot land at a non-whitelisted address.
```

- [ ] **Step 2: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/product-specs/deposits.md
git commit -m "docs(specs): rewrite deposits spec for v2.3 DepositManager atomic flow"
```

---

### Task 3: Rewrite `docs/product-specs/smart-contracts.md`

**Files:**
- Modify: `docs/product-specs/smart-contracts.md`

**Summary of changes:**
- Contract count: 8 functional contracts + AccessManager (OZ) + EmergencyRevoker (was 6 contracts).
- Add: DepositManager (new in v2.3), ShutdownController (new in v2.2), RecoveryPool (new in v2.2).
- Replace FoundationMultisig entry with three-Safe governance (ADMIN 3/5, RISK_COUNCIL 3/5, GUARDIAN 2/5).
- PLUSD role changes: remove MINTER, add DEPOSITOR (DepositManager), rename to YIELD_MINTER (Bridge), keep BURNER (WQ), PAUSER (GUARDIAN).
- WithdrawalQueue: rename FILLER→FUNDER; new Pending→Funded→Claimed/AdminReleased lifecycle; add `fundRequest`, `claim`, `skipSanctionedHead`, `adminRelease`; remove `fillRequest`.
- LoanRegistry: rename `loan_manager`→TRUSTEE (held by Trustee key, not Bridge); rename `risk_council` role holder to RISK_COUNCIL Safe.
- PLUSD: `mint(address,uint256)` removed; new `mintForDeposit` and `yieldMint(att,bridgeSig,custodianSig)`.
- Non-transferable PLUSD: `_update` requires exactly one of (from, to) to be a system address.
- AccessManager (OZ): single hub for all role management, timelocked.
- EmergencyRevoker: revokes FUNDER, WHITELIST_ADMIN, YIELD_MINTER from Bridge and TRUSTEE from Trustee.
- Update security section (three-safe governance, bounded upgradeability).

- [ ] **Step 1: Rewrite the file**

Write the following content to `docs/product-specs/smart-contracts.md`:

```markdown
# Smart Contracts

## Overview

The Pipeline protocol deploys eight functional on-chain contracts on Ethereum mainnet, plus a
shared AccessManager hub and a non-upgradeable EmergencyRevoker. All functional contracts use
OpenZeppelin v5.x audited library code as their base with custom logic confined to small,
clearly-scoped extensions. All protocol contracts (except EmergencyRevoker) use UUPS proxies;
upgrades are gated by the UPGRADER role (ADMIN 3/5) with a 48h AccessManager delay, which
GUARDIAN 2/5 may cancel.

---

## Governance

Three Gnosis Safes hold all privileged roles across the protocol, with distinct signer sets:

| Safe | Threshold | Role | Timelock |
|---|---|---|---|
| ADMIN | 3/5 | Role management, upgrades, parameter changes | 48h (14d on delay changes) |
| RISK_COUNCIL | 3/5 | Proposes `setDefault` and `enterShutdown` | 24h |
| GUARDIAN | 2/5 | Instant pause; cancel pending actions; `revokeAll` on EmergencyRevoker | None |

GUARDIAN is defensive-only — it cannot initiate risk-increasing actions, only halt or cancel
in-flight ones.

---

## Contracts

| Contract | Base standard | Purpose | Custom LOC |
|---|---|---|---|
| AccessManager (OZ) | — | Single role-management hub; timelocked actions | 0 |
| PLUSD | OZ ERC20Pausable + ERC20Permit + AccessManaged + UUPS | Receipt token; minted via DepositManager (1:1 USDC) or `yieldMint` (two-party attested). Non-transferable except between system addresses and whitelisted LPs. | ~110 |
| DepositManager | AccessManaged + Pausable + ReentrancyGuard + UUPS | Atomic 1:1 USDC→PLUSD deposit. LP calls `deposit(amount)`; contract pulls USDC to Capital Wallet and calls `mintForDeposit`. | ~60 |
| sPLUSD | OZ ERC-4626 + ERC20Pausable + AccessManaged + UUPS | Yield-bearing vault on PLUSD; open to any PLUSD holder. | ~35 |
| WhitelistRegistry | AccessManaged + TimelockPending + UUPS | On-chain allowlist: KYCed LP wallets and approved DeFi venues. Tracks Chainalysis `approvedAt` timestamp. | ~95 |
| WithdrawalQueue | AccessManaged + Pausable + ReentrancyGuard + UUPS | FIFO withdrawal queue; Pending→Funded→Claimed/AdminReleased lifecycle. Full-amount funding only. | ~140 |
| LoanRegistry | OZ ERC-721 (soulbound) + AccessManaged + Pausable + UUPS | On-chain registry of loan facilities; immutable origination data + mutable lifecycle state. | ~190 |
| ShutdownController | AccessManaged + UUPS | Freezes normal flow on distress; fixes a `recoveryRateBps`; opens `redeemInShutdown` / `claimAtShutdown` paths. | ~75 |
| RecoveryPool | AccessManaged + Pausable + ReentrancyGuard + UUPS | Holds USDC for LP recovery payments on shutdown. | ~70 |
| EmergencyRevoker | standalone, **non-upgradeable** | Single `revokeAll()` call by GUARDIAN atomically strips FUNDER, WHITELIST_ADMIN, YIELD_MINTER from Bridge and TRUSTEE from Trustee. | ~50 |

---

## Contract Interfaces

### PLUSD

| Function | Access | Description |
|---|---|---|
| `mintForDeposit(address lp, uint256 amount)` | DEPOSITOR (DepositManager) | Mints PLUSD 1:1 to a USDC deposit. Increments `cumulativeLPDeposits`. Checks reserve invariant and whitelist. |
| `yieldMint(YieldAttestation att, bytes bridgeSig, bytes custodianSig)` | YIELD_MINTER (Bridge) | Mints yield PLUSD. Verifies two EIP-712 signatures on-chain: Bridge ECDSA (ecrecover on `bridgeYieldAttestor`) and custodian EIP-1271 (on `custodianYieldAttestor`). Destination constrained to sPLUSD vault or Treasury. Checks reserve invariant. |
| `burn(address from, uint256 amount)` | BURNER (WithdrawalQueue) | Burns PLUSD from escrow when the WQ `claim` step finalises. |
| `transfer / transferFrom` | public | Standard ERC-20. `_update` hook enforces: exactly one of (from, to) must be a system address (Capital Wallet, Treasury, DepositManager, WQ, sPLUSD vault) or a whitelisted LP. LP↔LP and system↔system both revert. |
| `pause() / unpause()` | PAUSER (GUARDIAN) | Freezes all mint, burn, and transfer operations. |
| `reserveHealth()` | public view | Returns `(cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns - totalSupply)`. Non-negative = internally consistent. |

Direct `mint(address, uint256)` is removed. Fresh PLUSD enters supply only through
`mintForDeposit` (deposit leg) or `yieldMint` (yield leg).

### DepositManager

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 usdcAmount)` | public | Atomic deposit: checks `isAllowedForMint`, rolling caps, supply cap; pulls USDC from LP to Capital Wallet; calls `PLUSD.mintForDeposit`. |
| `pause() / unpause()` | PAUSER (GUARDIAN) | Freezes all deposits. |

### sPLUSD (ERC-4626)

| Function | Access | Description |
|---|---|---|
| `deposit(uint256 assets, address receiver)` | public | Standard ERC-4626 deposit. Open to any PLUSD holder. |
| `redeem(uint256 shares, address receiver, address owner)` | public | Standard ERC-4626 redeem. Triggers lazy USYC yield mint if NAV delta > 0. |
| `totalAssets()` | public view | Returns `PLUSD.balanceOf(address(this))`. Increases when yield mints land in the vault. |
| `pause() / unpause()` | PAUSER (GUARDIAN) | Freezes deposits and redemptions. |

### WhitelistRegistry

| Function | Access | Description |
|---|---|---|
| `setAccess(address lp, uint256 approvedAt)` | WHITELIST_ADMIN (Bridge) | Adds or updates a whitelisted LP with the Chainalysis screening timestamp. |
| `refreshScreening(address lp, uint256 newApprovedAt)` | WHITELIST_ADMIN (Bridge) | Updates `approvedAt` for an existing whitelisted LP after re-screening. |
| `revokeAccess(address lp)` | WHITELIST_ADMIN (Bridge) or ADMIN | Removes LP from the whitelist immediately. |
| `isAllowed(address lp)` | public view | Returns true if LP is whitelisted. Used by WithdrawalQueue and PLUSD `_update`. Does not check freshness. |
| `isAllowedForMint(address lp)` | public view | Returns true if LP is whitelisted AND `(block.timestamp - approvedAt) < freshnessWindow`. Used by DepositManager. |
| `addDeFiVenue(address venue)` | ADMIN | Adds an approved DeFi pool/vault to the allowlist (held by PLUSD `_update`). |

### WithdrawalQueue

Lifecycle: `Pending → Funded → Claimed | AdminReleased`

| Function | Access | Description |
|---|---|---|
| `requestWithdrawal(uint256 amount)` | public | Pulls PLUSD from caller into escrow; assigns `queue_id`; emits `WithdrawalRequested`. Reverts if caller not whitelisted with fresh screen. |
| `fundRequest(uint256 queueId)` | FUNDER (Bridge) | Funds the queue head in full: pulls USDC from Capital Wallet to WQ via pre-approved allowance. Moves entry to `Funded`. Emits `WithdrawalFunded`. |
| `skipSanctionedHead()` | FUNDER (Bridge) | Moves a sanctioned (non-`isAllowed`) queue head to `AdminReleased`, unblocking the queue. |
| `claim(uint256 queueId)` | public (original requester only) | Atomically burns escrowed PLUSD and pays out USDC to LP. Only callable after `Funded`. Emits `WithdrawalClaimed`. |
| `adminRelease(uint256 queueId)` | ADMIN | Manual release of a stuck entry to `AdminReleased`. |
| `getQueueDepth()` | public view | Returns `(totalEscrowed, pendingCount, fundedCount)`. |
| `pause() / unpause()` | PAUSER (GUARDIAN) | Freezes `fundRequest` and `claim`. |

Note: partial fills, `cancelWithdrawal`, and LP-initiated cancellation are not in the MVP.
The queue is one-way once submitted.

### LoanRegistry

| Function | Access | Description |
|---|---|---|
| `mintLoan(address originator, ImmutableLoanData data)` | TRUSTEE | Mints a new loan NFT. Emits `LoanMinted`. |
| `updateMutable(uint256 tokenId, LoanStatus status, uint256 newMaturityDate, uint256 newCCR, LocationUpdate newLocation)` | TRUSTEE | Updates mutable lifecycle fields. Reverts if newStatus == Default. |
| `setDefault(uint256 tokenId)` | RISK_COUNCIL | Transitions loan to Default (24h timelock). |
| `closeLoan(uint256 tokenId, ClosureReason reason)` | TRUSTEE or RISK_COUNCIL | TRUSTEE for {ScheduledMaturity, EarlyRepayment}; RISK_COUNCIL for {Default, OtherWriteDown}. |
| `getImmutable(uint256 tokenId)` | public view | Returns immutable origination data. |
| `getMutable(uint256 tokenId)` | public view | Returns current mutable lifecycle data. |

Bridge has **no role on LoanRegistry**. All loan NFT writes are done by the Trustee key directly.

### ShutdownController

| Function | Access | Description |
|---|---|---|
| `proposeShutdown(uint256 recoveryRateBps)` | RISK_COUNCIL | Proposes shutdown with a proposed recovery rate. 24h timelock before execution. |
| `executeShutdown()` | ADMIN via AccessManager | Executes after timelock; freezes normal flow across all contracts; enables `redeemInShutdown` / `claimAtShutdown`. |
| `adjustRecoveryRateUp(uint256 newRateBps)` | RISK_COUNCIL | Ratchets recovery rate upward (only) as Trustee repatriates capital. 24h timelock. |

Recovery rate ratchets up only; lowering is structurally prevented. sPLUSD holders exit post-shutdown via normal `sPLUSD.redeem()` (returns PLUSD) then `PLUSD.redeemInShutdown` for USDC at the frozen recovery rate.

---

## Role Assignments

| Contract | Role | Held by |
|---|---|---|
| PLUSD | DEPOSITOR | DepositManager (proxy address) |
| PLUSD | YIELD_MINTER | Bridge service |
| PLUSD | BURNER | WithdrawalQueue |
| PLUSD | PAUSER | GUARDIAN 2/5 Safe |
| PLUSD | UPGRADER | ADMIN 3/5 Safe |
| DepositManager | PAUSER | GUARDIAN 2/5 Safe |
| DepositManager | UPGRADER | ADMIN 3/5 Safe |
| sPLUSD | PAUSER | GUARDIAN 2/5 Safe |
| sPLUSD | UPGRADER | ADMIN 3/5 Safe |
| WhitelistRegistry | WHITELIST_ADMIN | Bridge service |
| WhitelistRegistry | ADMIN | ADMIN 3/5 Safe |
| WhitelistRegistry | PAUSER | GUARDIAN 2/5 Safe |
| WhitelistRegistry | UPGRADER | ADMIN 3/5 Safe |
| WithdrawalQueue | FUNDER | Bridge service |
| WithdrawalQueue | PAUSER | GUARDIAN 2/5 Safe |
| WithdrawalQueue | ADMIN ops | ADMIN 3/5 Safe |
| WithdrawalQueue | UPGRADER | ADMIN 3/5 Safe |
| LoanRegistry | TRUSTEE | Trustee key (Pipeline Trust Company) |
| LoanRegistry | RISK_COUNCIL | RISK_COUNCIL 3/5 Safe |
| LoanRegistry | PAUSER | GUARDIAN 2/5 Safe |
| LoanRegistry | UPGRADER | ADMIN 3/5 Safe |
| ShutdownController | RISK_COUNCIL | RISK_COUNCIL 3/5 Safe |
| ShutdownController | ADMIN (execute) | ADMIN 3/5 Safe via AccessManager |
| EmergencyRevoker | GUARDIAN | GUARDIAN 2/5 Safe |

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
| closureReason | ClosureReason | Set when status = Closed |

Enums: `LoanStatus { Performing, Watchlist, Default, Closed }` ·
`ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }` ·
`LocationType { Vessel, Warehouse, TankFarm, Other }`

---

## Security Considerations

- **No single point of mint compromise.** Deposit-leg mints require a contract-to-contract
  call through DepositManager (no off-chain signer). Yield-leg mints require Bridge ECDSA
  signature + custodian EIP-1271 signature + YIELD_MINTER caller role — three independent
  controls. Compromising any one party mints zero PLUSD.
- **Reserve invariant on every mint path.** On-chain cumulative counters prevent over-minting
  against the contract's own ledger. Full Proof of Reserve (Chainlink PoR) is deferred to
  phase 2.
- **Bounded upgradeability.** 48h ADMIN delay on upgrades with GUARDIAN veto prevents a
  "collapse-delay-then-exploit" sequence. A 14-day meta-timelock on delay changes closes the
  second-order attack.
- **Three-Safe governance separation.** ADMIN cannot enter shutdown or declare default;
  RISK_COUNCIL cannot perform upgrades or manage roles; GUARDIAN cannot initiate
  risk-increasing actions.
- **Smart contracts hold no USDC.** Capital Wallet and Treasury Wallet are MPC-controlled
  addresses. A contract exploit cannot drain investor capital unilaterally.
- **Non-transferable PLUSD.** The `_update` hook requires exactly one of (from, to) to be a
  system address or whitelisted LP, closing the LP↔LP laundering and system↔system
  laundering attack classes.
```

- [ ] **Step 2: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/product-specs/smart-contracts.md
git commit -m "docs(specs): rewrite smart-contracts spec for v2.3 architecture"
```

---

### Task 4: Rewrite `docs/product-specs/bridge-service.md`

**Files:**
- Modify: `docs/product-specs/bridge-service.md`

**Summary of changes:**
- Bridge is no longer the deposit mint gate — remove sections 3 (PLUSD Minting Authority), 4 (Deposit Mint Queue), and the deposit-related USDC Transfer event.
- Remove loan disbursement preparation from bridge scope — Trustee + Team cosign directly on Capital Wallet.
- Remove USDC↔USYC rebalancing from bridge scope — managed by custodian MPC policy engine; Bridge only requests liquidity when needed.
- Replace MINTER role with FUNDER (WQ), WHITELIST_ADMIN (WhitelistRegistry), YIELD_MINTER (PLUSD).
- Bridge has no role on LoanRegistry — Trustee key holds TRUSTEE role directly.
- Replace simple `PLUSD.mint()` with two-party `yieldMint(att, bridgeSig, custodianSig)`.
- Replace weekly USYC yield cron with lazy mint triggered on sPLUSD stake/unstake.
- Update event monitoring list: add DepositManager.Deposited; update WQ events to new lifecycle.
- Update role assignments table.
- Update security section.

- [ ] **Step 1: Rewrite the file**

Write the following content to `docs/product-specs/bridge-service.md`:

```markdown
# Bridge Service

## Overview

The Pipeline Bridge Service is a backend service operated by the Pipeline team. It watches
on-chain events, reconciles protocol state, co-signs yield attestations, and submits
operational transactions. **Bridge is not in the critical path for deposits** — deposits are
atomic user-driven calls to DepositManager. Bridge also has no role in loan disbursements or
USDC↔USYC rebalancing; those operations are managed by the Trustee and custodian.

The bridge is designed so that its compromise does not enable unbacked PLUSD minting. Yield
minting requires a second independent signature from the custodian's EIP-1271 contract;
compromising Bridge alone produces zero yield PLUSD.

---

## Behavior

### 1. Deposit Observation (Bridge not in critical path)

Deposits are fully atomic and user-driven. The LP calls `DepositManager.deposit(amount)`;
the contract handles all checks and the USDC → PLUSD exchange. Bridge observes
`DepositManager.Deposited` events for reconciliation and exposes deposit history via the LP
API. Bridge is not a signer or a gate on the deposit flow.

Bridge also exposes live rate-limit state (`maxPerWindow`, `maxPerLPPerWindow`, current
window utilisation, per-LP utilisation) via `GET /v1/protocol/limits` so the deposit UI can
show cap status before the LP submits.

### 2. Withdrawal Queue Funding

When a `WithdrawalRequested` event is observed, Bridge processes the queue head:

1. **Whitelist check.** Calls `WhitelistRegistry.isAllowed(requester)`. If not allowed, calls
   `WQ.skipSanctionedHead()` to unblock the queue.
2. **Freshness check.** Bridge checks Chainalysis freshness (bridge-side). If stale but not
   revoked: calls `WhitelistRegistry.refreshScreening(lp, newApprovedAt)` after a clean
   Chainalysis re-screen, then proceeds. If re-screen returns a flag, calls `revokeAccess`
   first, then `skipSanctionedHead`. If Chainalysis is unreachable, Bridge halts and alerts
   ops — the queue head is stuck pending manual `adminRelease`.
3. **Balance check.** Reads Capital Wallet USDC balance. If insufficient, requests a USYC →
   USDC redemption via the custodian MPC API and retries after settlement.
4. **Fund.** Calls `WQ.fundRequest(queueId)`. The WQ contract pulls USDC from Capital Wallet
   via a pre-approved allowance. The LP's entry moves to `Funded`; the LP then calls
   `WQ.claim()` to atomically burn PLUSD and receive USDC.

### 3. Yield Minting — Repayment

When a loan repayment USDC inflow arrives at the Capital Wallet (classified from the indexed
USDC Transfer log), Bridge initiates the two-party yield mint flow:

1. **Detect and classify.** Bridge indexes USDC inflows to Capital Wallet. The inflow
   classifier matches each transfer to a category: deposit settlement, repayment, rebalance,
   or unknown quarantine.
2. **Trustee approval.** Bridge presents the detected repayment to the Trustee via
   `GET /v1/trustee/repayments/pending`. The Trustee submits final split amounts (vault share
   / treasury share) via `POST /v1/trustee/repayments/{id}/approve`.
3. **Bridge signs.** Signer service constructs two `YieldAttestation` structs (one per
   destination: vault and treasury) and signs each with the `bridgeYieldAttestor` key:
   ```
   YieldAttestation {
     bytes32 repaymentRef;  // keccak256(chainId, repaymentTxHash, destinationTag)
     address destination;   // sPLUSD vault OR Treasury
     uint256 amount;
     uint64  deadline;
     uint256 salt;
   }
   ```
   Vault and treasury legs use distinct `repaymentRef` values (`"vault"` / `"treasury"` tag).
4. **Custodian co-signs.** Bridge posts the structs + Bridge sigs to the custodian's API
   (Fireblocks Co-Signer / BitGo webhook). The custodian independently verifies the USDC
   inflow and co-signs via EIP-1271.
5. **Submit.** Bridge calls `PLUSD.yieldMint(att, bridgeSig, custodianSig)` for each leg via
   the transaction outbox. PLUSD verifies both signatures on-chain, checks the reserve
   invariant, and mints to the destination.

Neither Bridge alone nor the custodian alone can mint yield PLUSD — both signatures plus the
YIELD_MINTER caller role are required.

### 4. Yield Minting — USYC (Lazy, Stake/Unstake-Triggered)

USYC NAV grows continuously. sPLUSD share price advances only when `yieldMint` runs. To keep
the share price current without a time-based cron, yield is minted **lazily** on every sPLUSD
`Deposit` or `Withdraw` event:

1. Bridge reads current USYC NAV from the Hashnote API.
2. Computes `yield_delta = current_NAV - last_minted_NAV` (applied to Capital Wallet USYC
   holdings). If `delta <= 0`, skip.
3. If `delta > 0`: builds two `YieldAttestation` structs (vault + treasury) with refs scoped
   to the NAV timestamp. Gets Bridge sig + custodian co-sig (same flow as repayment yield).
4. Submits both `yieldMint` calls via outbox.
5. Advances `last_minted_NAV` baseline only after both legs confirm on-chain.

Between mints, Bridge polls USYC NAV (e.g., every minute) and exposes accrued-but-undistributed
yield via `GET /v1/vault/stats` for dashboard display.

### 5. WhitelistRegistry Maintenance

- **On Sumsub APPROVED + Chainalysis clean result:** calls
  `WhitelistRegistry.setAccess(lpAddress, currentBlockTimestamp)` immediately.
- **On failed passive re-screen:** calls `revokeAccess(lpAddress)` and routes to compliance
  review queue.
- **On manual compliance approval:** calls `setAccess(lpAddress, approvedAt)`.
- **Periodic batch re-screen:** Bridge calls `refreshScreening(lp, newTs)` for each LP on a
  configurable cadence to maintain freshness.

### 6. Price Feed and CCR Monitoring

Bridge monitors every active loan in the LoanRegistry:

- Polls Platts/Argus commodity prices on a configurable cadence (working assumption: every 15
  minutes during market hours).
- Computes CCR = collateral_value / outstanding_senior_principal in basis points.
- On threshold crossings, notifies configured recipients and submits a TRUSTEE-gated
  `LoanRegistry.updateMutable` call to update `lastReportedCCR`.

| Event | Trigger | Recipients |
|---|---|---|
| Watchlist | CCR falls below 130% | Team, Originator, Trustee |
| Maintenance margin call | CCR falls below 120% | Team, Originator, Borrower, Trustee |
| Margin call | CCR falls below 110% | Team, Originator, Borrower, Trustee |
| Payment delay (amber) | Scheduled repayment > 7 days late | Team, Originator, Trustee |
| Payment delay (red) | Scheduled repayment > 21 days late | Team, Originator, Trustee |
| AIS blackout | Vessel tracking loss > 12 hours | Team, Originator, Trustee |
| CMA discrepancy | Reported collateral > 3% from CMA | Team, Originator, Trustee |
| Status transition | Any LoanRegistry mutable status change | Team, Originator, Trustee |

### 7. Reserve Reconciliation

After every state-changing event, Bridge evaluates and publishes the full backing invariant:

```
PLUSD totalSupply  ==  USDC in Capital Wallet
                     +  USYC NAV in Capital Wallet
                     +  USDC out on active loans
                     +  USDC in transit
```

| Drift | Status | Action |
|---|---|---|
| < 0.01% | Green | Normal |
| 0.01%–1% | Amber | Alert on-call + Trustee |
| > 1% | Red | Page on-call + Trustee; consider pausing DepositManager |

Bridge also cross-checks: `sum(DepositManager.Deposited.amount) == PLUSD.cumulativeLPDeposits()`.
Any drift is a bug or indexer lag — alert ops immediately.

---

## On-Chain Events Monitored

| Contract | Event | Purpose |
|---|---|---|
| DepositManager | `Deposited(lp, amount)` | Reconciliation; deposit history for LP API |
| USDC | `Transfer(*, capitalWallet, amount)` | Repayment inflow classification |
| PLUSD | `Transfer(0x0, lp, amount)` | Mint cross-check vs DepositManager.Deposited |
| WithdrawalQueue | `WithdrawalRequested` | Flow 2 trigger |
| WithdrawalQueue | `WithdrawalFunded / WithdrawalClaimed / WithdrawalSanctionedSkip / WithdrawalAdminReleased` | Status tracking |
| sPLUSD | `Deposit / Withdraw` | Trigger lazy USYC yield (Flow 4) |
| LoanRegistry | `LoanMinted / LoanUpdated / LoanClosed` | Loan book mirror |
| PLUSD | `RateLimitsChanged / MaxTotalSupplyChanged` | Update local cache |
| WhitelistRegistry | `LPApproved / ScreeningRefreshed / LPRevoked` | Whitelist sync |
| ShutdownController | `ShutdownEntered` | Halt all normal flows |
| All pausable | `Paused() / Unpaused()` | Halt/resume flows |

---

## Role Assignments on Contracts

| Contract | Role | Held by |
|---|---|---|
| PLUSD | YIELD_MINTER | Bridge service |
| PLUSD | PAUSER | GUARDIAN 2/5 Safe |
| sPLUSD | PAUSER | GUARDIAN 2/5 Safe |
| WhitelistRegistry | WHITELIST_ADMIN | Bridge service |
| WhitelistRegistry | ADMIN | ADMIN 3/5 Safe |
| WithdrawalQueue | FUNDER | Bridge service |
| WithdrawalQueue | PAUSER | GUARDIAN 2/5 Safe |

Bridge has **no role on LoanRegistry**. Loan NFT writes are done by the Trustee key directly.
Bridge is **not a signer for loan disbursements** — those require Trustee + Team co-signature
on the Capital Wallet directly.
Bridge **does not manage the USDC↔USYC ratio** — the custodian's MPC policy engine and
Trustee manage the band; Bridge only requests a USYC redemption at withdrawal funding time
when Capital Wallet USDC is insufficient.

---

## Security Considerations

**Two-party yield attestation.** Yield minting requires Bridge ECDSA signature + custodian
EIP-1271 signature + YIELD_MINTER caller role — three independent controls. Bridge alone
cannot mint yield PLUSD.

**Narrow on-chain roles.** Bridge holds only FUNDER (WQ), WHITELIST_ADMIN (WhitelistRegistry),
and YIELD_MINTER (PLUSD). These are bounded roles: FUNDER can only trigger WQ pulls for
existing queue entries; WHITELIST_ADMIN cannot mint; YIELD_MINTER still requires custodian
co-sig. Bridge has zero roles on LoanRegistry, DepositManager, or governance Safes.

**Deposit path is Bridge-free.** The deposit flow has no Bridge keys on the critical path.
A complete Bridge compromise does not stop deposits or allow unbacked deposit mints.

**Key storage.** Bridge hot keys (FUNDER, WHITELIST_ADMIN, YIELD_MINTER submitter) are stored
in HSM-backed KMS. The `bridgeYieldAttestor` key used for yield EIP-712 signing is stored
separately in an HSM with no internet egress. MPC key shares are managed through the custodian
vendor's key ceremony.

**Audit log.** Every bridge action is recorded in an append-only audit log mirrored in
near-real-time to an independent third-party log sink.
```

- [ ] **Step 2: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/product-specs/bridge-service.md
git commit -m "docs(specs): rewrite bridge-service spec for v2.3 roles and scope"
```

---

### Task 5: Rewrite `docs/product-specs/withdrawals.md`

**Files:**
- Modify: `docs/product-specs/withdrawals.md`

**Summary of changes:**
- New lifecycle: `Pending → Funded → Claimed | AdminReleased` (was `Pending | PartiallyFilled | Settled | Cancelled`).
- Funding is full-amount only — Bridge calls `fundRequest(queueId)`; no partial fills in funding.
- Claim is a separate LP-initiated step — LP calls `claim(queueId)` which atomically burns PLUSD and receives USDC.
- No `cancelWithdrawal` in MVP — queue is one-way once submitted.
- Sanctioned head: Bridge calls `skipSanctionedHead()`, moving entry to `AdminReleased` and unblocking queue.
- Admin intervention: `adminRelease(queueId)` available for stuck entries.
- No above-envelope partial fills — if Capital Wallet USDC is insufficient, Bridge requests USYC redemption and retries.
- Treasury redemption three-party flow is unchanged.
- Update API interface, events, and data model.

- [ ] **Step 1: Rewrite the file**

Write the following content to `docs/product-specs/withdrawals.md`:

```markdown
# Withdrawals — Product Spec

## Overview

LPs exit by redeeming sPLUSD for PLUSD, then queuing PLUSD via the WithdrawalQueue contract
for USDC payout. The queue is strict FIFO. Bridge funds the queue head in full via
`fundRequest`; the LP then calls `claim` to atomically burn PLUSD and receive USDC. PLUSD
is held in escrow until the LP's `claim` call, keeping the PLUSD backing invariant valid
throughout the lifecycle.

---

## Behavior

### Step 1 — sPLUSD to PLUSD

If the LP holds sPLUSD, they first call `sPLUSD.redeem(shares, receiver, owner)`. The vault
burns the sPLUSD shares and transfers PLUSD at the current share price to the receiver. The
receiver must satisfy `WhitelistRegistry.isAllowed(receiver)` — if not, the PLUSD transfer
reverts at the PLUSD contract level.

Before processing the redemption downstream, Bridge checks whether a lazy USYC yield mint is
due (NAV delta since last mint > 0) and executes it, keeping the share price current.

### Step 2 — WithdrawalQueue.requestWithdrawal()

The LP calls `WithdrawalQueue.requestWithdrawal(amount)`. The contract checks:

- **Whitelist check:** `msg.sender` must be currently whitelisted (`isAllowed`).
- **Freshness check:** the `approvedAt` timestamp must be within the freshness window
  (default 90 days).

On success, the contract pulls `amount` PLUSD from the caller into escrow, assigns a
sequential `queue_id`, and emits `WithdrawalRequested(lpAddress, amount, queueId)`.
The entry status is `Pending`.

### Queue Funding — Bridge calls fundRequest

Bridge processes the queue head in strict FIFO order:

1. Checks `isAllowed(requester)`. If not allowed (sanctioned or revoked), calls
   `WQ.skipSanctionedHead()` — the entry moves to `AdminReleased` and the next entry
   becomes the head.
2. Checks Chainalysis freshness (Bridge-side). If stale, re-screens via Chainalysis API. On
   clean result, calls `WhitelistRegistry.refreshScreening(lp, newTs)`, then proceeds. On
   flagged result, calls `revokeAccess`, then `skipSanctionedHead`.
3. Reads Capital Wallet USDC balance. If insufficient, requests a USYC → USDC redemption
   via the custodian MPC API and waits for settlement before retrying `fundRequest`.
4. Calls `WQ.fundRequest(queueId)`. The WQ contract pulls the full `amount` in USDC from
   the Capital Wallet via a pre-approved allowance. The entry status moves to `Funded`.
   Emits `WithdrawalFunded(queueId)`.

Funding is always full-amount. There are no partial fills. If Capital Wallet USDC is
insufficient for the full amount, Bridge requests a USYC redemption rather than partially
filling.

### Step 3 — LP calls claim()

After their entry is `Funded`, the LP calls `WQ.claim(queueId)`. The contract atomically:

1. Burns the escrowed PLUSD (`amount`) — increments `cumulativeLPBurns` on PLUSD.
2. Transfers the corresponding USDC from WQ to the LP's address.
3. Moves entry to `Claimed`. Emits `WithdrawalClaimed(queueId)`.

Only the original requester may call `claim`. PLUSD is not burned until `claim` executes,
preserving the backing invariant throughout the funding-to-claim window.

### Sanctioned Head Handling

If `isAllowed(requester)` returns false at funding time, Bridge calls `skipSanctionedHead()`.
The WQ contract moves the entry to `AdminReleased` status, unlocking the queue. Escrowed
PLUSD in the skipped entry is held in the contract; ADMIN must decide disposition separately
via a governance action.

### Admin Release

ADMIN (3/5 Safe) may call `adminRelease(queueId)` to manually move a stuck `Pending` entry
to `AdminReleased` when automated processing is blocked and manual intervention is needed
(e.g., Chainalysis API unavailable for extended period).

### Above-Envelope Payouts

Bridge's custodian MPC payout policy applies auto-signing bounds (per-tx cap and rolling 24h
aggregate) on the Capital Wallet USDC outflows. Payouts exceeding these bounds surface in the
Trustee tooling signing queue; the Trustee and Pipeline team co-sign via MPC.

### Treasury Wallet Redemption — Stage A (PLUSD to USDC)

The Treasury Wallet redeems accumulated PLUSD revenue via the same WithdrawalQueue mechanics,
with three-party authorisation:

1. **Team operator A** initiates the redemption (specifies PLUSD amount).
2. **Team operator B** (distinct authenticated session) verifies and confirms.
3. **Trustee** provides the final co-signature via MPC.

On all three signatures, Bridge escrows PLUSD and executes the USDC payout from the Capital
Wallet to a protocol-controlled withdrawal endpoint.

### Treasury Wallet Redemption — Stage B (USDC to bank account)

Once USDC is at the withdrawal endpoint, Team operator A initiates off-ramp. The destination
bank account must be from the **pre-approved bank account list** maintained by the ADMIN Safe.
Free-text entry is not permitted. Authorisation mirrors Stage A (two team operators + Trustee).

---

## API Contract

```solidity
interface IWithdrawalQueue {
    /// @notice Pulls PLUSD from caller into escrow; creates a Pending queue entry.
    /// @dev Reverts if caller is not whitelisted with a fresh screen.
    function requestWithdrawal(uint256 amount) external returns (uint256 queueId);

    /// @notice Funds the queue head in full by pulling USDC from Capital Wallet.
    /// @dev Only callable by FUNDER (Bridge). Moves entry to Funded.
    function fundRequest(uint256 queueId) external;

    /// @notice Skips a sanctioned queue head; moves it to AdminReleased.
    /// @dev Only callable by FUNDER (Bridge). Requires !isAllowed(head requester).
    function skipSanctionedHead() external;

    /// @notice Atomically burns escrowed PLUSD and pays USDC to original requester.
    /// @dev Only callable by the original requester. Entry must be Funded.
    function claim(uint256 queueId) external;

    /// @notice Manually releases a stuck Pending entry to AdminReleased.
    /// @dev Only callable by ADMIN (3/5 Safe).
    function adminRelease(uint256 queueId) external;

    /// @notice Returns current queue state.
    function getQueueDepth()
        external view returns (
            uint256 totalEscrowed,
            uint256 pendingCount,
            uint256 fundedCount
        );

    function pause() external;
    function unpause() external;
}
```

**Key events**

```solidity
event WithdrawalRequested(address indexed lp, uint256 amount, uint256 indexed queueId);
event WithdrawalFunded(uint256 indexed queueId);
event WithdrawalClaimed(uint256 indexed queueId, uint256 amountPaid);
event WithdrawalSanctionedSkip(uint256 indexed queueId);
event WithdrawalAdminReleased(uint256 indexed queueId);
```

---

## Data Model

```
WithdrawalEntry {
  queueId:         uint256   // Sequential, assigned at requestWithdrawal()
  lp:              address   // Original requester
  amount:          uint256   // Full escrowed PLUSD amount
  status:          enum { Pending, Funded, Claimed, AdminReleased }
  createdAt:       uint256   // Block timestamp of requestWithdrawal()
  fundedAt:        uint256   // Block timestamp of fundRequest() — zero if not yet funded
  claimedAt:       uint256   // Block timestamp of claim() — zero if not yet claimed
}
```

PLUSD is held in escrow from `requestWithdrawal` through `claim`. It is burned only at
`claim`, when USDC simultaneously leaves the contract. This preserves the PLUSD backing
invariant throughout the full withdrawal lifecycle.

---

## Security Considerations

- **Two-step settlement.** Funding (USDC to WQ) and claiming (PLUSD burn + USDC to LP) are
  separate transactions. PLUSD backing invariant holds because `totalSupply` does not decrease
  until USDC has physically left the Capital Wallet and `claim` burns the PLUSD.
- **No partial fills.** Funding is all-or-nothing. Atomicity of the USDC transfer + PLUSD burn
  is guaranteed by the `claim` step; there is no state where PLUSD is partially burned against
  partial USDC.
- **Sanctioned head skip.** `skipSanctionedHead` prevents a sanctioned LP from permanently
  blocking queue progress for all other LPs behind them.
- **Queue is one-way.** `cancelWithdrawal` is not available in MVP. Once PLUSD enters escrow
  it remains there until `claim` or `adminRelease`.
- **Destination is implicitly the original requester.** `claim` pays to the original `lp`
  address on the queue entry — there is no payment-to parameter the requester can redirect.
- **MPC policy cap on Capital Wallet outflows.** The custodian's policy engine bounds
  automated Bridge-initiated USDC outflows by per-tx and rolling aggregate caps, independent
  of Bridge software.
- **GUARDIAN pause.** GUARDIAN 2/5 can freeze all `fundRequest` and `claim` operations
  immediately on incident detection.
```

- [ ] **Step 2: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add docs/product-specs/withdrawals.md
git commit -m "docs(specs): rewrite withdrawals spec for v2.3 Pending/Funded/Claimed lifecycle"
```

---

### Task 6: Update `docs/product-specs/yield.md`

**Files:**
- Modify: `docs/product-specs/yield.md`

**Summary of changes:**
- Step 3 of repayment delivery: replace `PLUSD.mint(sPLUSDvault, ...)` / `PLUSD.mint(TreasuryWallet, ...)` with `yieldMint(att, bridgeSig, custodianSig)` two-party attestation flow. Add note that Trustee provides final split amounts (waterfall is not computed on-chain in MVP).
- Step 4 of repayment delivery: remove "bridge automatically converts senior_principal_returned USDC into USYC" — USDC/USYC rebalancing is now managed by custodian MPC policy engine, not Bridge.
- Weekly USYC NAV yield distribution section: replace with lazy mint on sPLUSD stake/unstake. Update the subsection to reflect: no weekly cron; yield is minted when NAV delta > 0 on each stake/unstake event using the same two-party attestation as repayment yield.
- Remove the "Automated USDC/USYC rebalancing" subsection — this is now managed by the custodian and is out of Bridge scope.
- Update "RepaymentSettled event" language — it is no longer an EIP-712 off-chain attestation signed by the Trustee; instead, the Trustee approves the split amounts via the Bridge API, and Bridge constructs the `YieldAttestation` structs.

- [ ] **Step 1: Read the full current yield.md**

Read `docs/product-specs/yield.md` in full before editing to confirm line numbers for each section to replace.

```bash
cat -n docs/product-specs/yield.md
```

- [ ] **Step 2: Replace repayment on-chain delivery section**

Find the block that describes `PLUSD.mint(sPLUSDvault, ...)` and replace with the two-party
attestation mechanism. The replacement for steps 2–4 under "RepaymentSettled event and
on-chain delivery":

```markdown
Once the trustee confirms the waterfall breakdown via
`POST /v1/trustee/repayments/{id}/approve`, the Bridge executes on-chain yield delivery:

1. The trustee instructs the on-ramp provider to convert the senior portion
   (`senior_principal_returned + senior_coupon_net + protocol fees`) from USD to USDC,
   settling into the Capital Wallet.
2. The bridge verifies that the USDC inflow matches the Trustee-approved amounts.
3. The bridge constructs two `YieldAttestation` structs (one for the sPLUSD vault, one for
   the Treasury Wallet), signs each with the `bridgeYieldAttestor` key, and requests
   custodian co-signatures via the custodian's EIP-1271 API:
   - Vault leg: `yieldMint(att_vault, bridgeSig, custodianSig)` mints `senior_coupon_net`
     PLUSD to the sPLUSD vault, increasing `totalAssets` and accreting NAV for all stakers.
   - Treasury leg: `yieldMint(att_treasury, bridgeSig, custodianSig)` mints
     `management_fee + performance_fee + oet_allocation` PLUSD to the Treasury Wallet.
   Both legs are submitted and confirmed independently. Neither Bridge alone nor the custodian
   alone can mint — both EIP-712 signatures are verified on-chain.
```

- [ ] **Step 3: Replace weekly USYC distribution section**

Replace the "Weekly USYC NAV yield distribution" subsection with:

```markdown
### USYC NAV yield distribution (lazy, stake/unstake-triggered)

USYC in the Capital Wallet accrues NAV continuously. To keep sPLUSD share price current
without a time-based cron, yield is minted **lazily** on each sPLUSD `Deposit` or `Withdraw`
event:

1. Bridge reads the current USYC NAV from the Hashnote API.
2. Computes `yield_delta = current_NAV - last_minted_NAV` (applied to Capital Wallet USYC
   holdings). If `delta <= 0`, no yield mint occurs.
3. If `delta > 0`: Bridge constructs two `YieldAttestation` structs (vault 70%, treasury 30%
   of `yield_delta`), gets Bridge sig + custodian co-sig, and submits two `yieldMint` calls
   via the transaction outbox.
4. After both `yieldMint` transactions confirm on-chain, Bridge advances the `last_minted_NAV`
   baseline. Until both confirm, the baseline is unchanged — idempotent retry is safe.

Between mints, Bridge polls USYC NAV (e.g., every minute) and exposes accrued-but-undistributed
yield via `GET /v1/vault/stats` for dashboard display. USYC is not redeemed during yield
distribution; it remains in the Capital Wallet.
```

- [ ] **Step 4: Remove the automated USDC/USYC rebalancing subsection**

Delete the "Automated USDC/USYC rebalancing" subsection entirely. USDC↔USYC ratio management
is now the custodian MPC policy engine's responsibility, not Bridge's. Only a reference
sentence remains appropriate in the relevant context (e.g., Bridge requests USYC redemption
at withdrawal funding time if USDC is insufficient — covered in the withdrawals spec).

- [ ] **Step 5: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add docs/product-specs/yield.md
git commit -m "docs(specs): update yield spec for v2.3 two-party attestation and lazy USYC distribution"
```

---

### Task 7: Update `docs/product-specs/lp-onboarding.md`

**Files:**
- Modify: `docs/product-specs/lp-onboarding.md`

**Summary of changes:**
- One targeted fix: the "Chainalysis Re-Screening Freshness Window" section currently says "the authoritative check is performed by the bridge service before any PLUSD mint is executed." In v2.3, the authoritative check is performed by the DepositManager contract (`isAllowedForMint`), not by Bridge. Bridge no longer gates deposits.
- No other substantive changes — the onboarding flow (Sumsub, Chainalysis, whitelist write) is unchanged.

- [ ] **Step 1: Read the current file**

Read `docs/product-specs/lp-onboarding.md` to locate the exact sentence to fix.

```bash
cat -n docs/product-specs/lp-onboarding.md
```

- [ ] **Step 2: Fix the freshness gate attribution**

Find the sentence in the "Chainalysis Re-Screening Freshness Window" section:

> The frontend freshness gate is a UX convenience; the authoritative check is performed by
> the bridge service before any PLUSD mint is executed (see deposits spec).

Replace with:

> The frontend freshness gate is a UX convenience; the authoritative check is enforced
> on-chain by the DepositManager contract (`isAllowedForMint`) at deposit time (see deposits
> spec).

- [ ] **Step 3: Lint**

```bash
npx tsx scripts/lint-docs.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/product-specs/lp-onboarding.md
git commit -m "docs(specs): fix deposit freshness-gate attribution (DepositManager, not Bridge)"
```

---

## Self-Review

### Spec coverage check

| v2.3 change | Covered by task |
|---|---|
| M1 — DepositManager atomic 1:1 deposit | Task 2 (deposits), Task 3 (smart-contracts) |
| M2 — MINT_ATTESTOR retired | Task 3 (smart-contracts), Task 4 (bridge-service) |
| M3 — DEPOSITOR role on PLUSD | Task 3 (smart-contracts), Task 2 (deposits) |
| M4 — Reserve invariant (3 cumulative counters) | Task 2 (deposits), Task 3 (smart-contracts) |
| M5 — Two-party yield attestation | Task 3 (smart-contracts), Task 4 (bridge-service), Task 6 (yield) |
| M6 — Economic caps (maxPerLPPerWindow, maxTotalSupply; drop per-tx cap) | Task 2 (deposits), Task 3 (smart-contracts) |
| M7 — EmergencyRevoker simplified | Task 3 (smart-contracts) |
| U3 — WithdrawalQueue Pending/Funded/Claimed/AdminReleased | Task 5 (withdrawals), Task 3 (smart-contracts) |
| FILLER→FUNDER rename | Task 3 (smart-contracts), Task 5 (withdrawals), Task 4 (bridge-service) |
| LOAN_MANAGER→TRUSTEE rename | Task 3 (smart-contracts), Task 4 (bridge-service) |
| Bridge no role on LoanRegistry | Task 4 (bridge-service), Task 3 (smart-contracts) |
| Bridge no role in deposit flow | Task 4 (bridge-service), Task 2 (deposits) |
| Bridge no role in loan disbursement | Task 4 (bridge-service) |
| USDC↔USYC rebalancing out of Bridge scope | Task 4 (bridge-service), Task 6 (yield) |
| Weekly USYC cron → lazy mint on stake/unstake | Task 4 (bridge-service), Task 6 (yield) |
| Partial fills dropped from WQ funding | Task 5 (withdrawals), Task 3 (smart-contracts) |
| cancelWithdrawal not in MVP | Task 5 (withdrawals) |
| Three-Safe governance (ADMIN, RISK_COUNCIL, GUARDIAN) | Task 3 (smart-contracts) |
| ShutdownController + RecoveryPool new contracts | Task 3 (smart-contracts) |
| Register reference docs | Task 1 |
| lp-onboarding freshness gate attribution | Task 7 |
