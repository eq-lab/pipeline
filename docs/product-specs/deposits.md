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

The LP must first whitelist their wallet via KYC/KYB onboarding (see lp-onboarding spec).
Before presenting the deposit UI, the app reads the LP's on-chain WhitelistRegistry entry via
`isAllowedForMint(lp)`:

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
   Reverts if the LP is not whitelisted or the Chainalysis screen is stale (> 90-day freshness
   window).
2. **Per-LP rolling window cap.** `lpWindowMinted[msg.sender] + amount <= maxPerLPPerWindow`.
   Reverts if a single LP would exceed their window allocation.
3. **Global rolling window cap.** `windowMinted + amount <= maxPerWindow`. Reverts if total
   minted in the current rolling window would exceed the protocol-wide cap.
4. **Hard total supply cap.** `PLUSD.totalSupply() + amount <= maxTotalSupply`. Reverts if
   the protocol hard ceiling would be breached.
5. **USDC pull.** `USDC.transferFrom(msg.sender, capitalWallet, usdcAmount)`. Fails if LP has
   not approved DepositManager on USDC.
6. **PLUSD mint.** `PLUSD.mintForDeposit(msg.sender, usdcAmount)`. Checks reserve invariant
   and increments `cumulativeLPDeposits` in the same transaction. Emits `Deposited(lp, amount)`.

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

- Checks the reserve invariant: `totalSupply + amount <= cumulativeLPDeposits + amount +
  cumulativeYieldMinted - cumulativeLPBurns`. Reverts on invariant failure.
- Increments `cumulativeLPDeposits` by `amount`.
- Mints PLUSD 1:1 to `lp`.
- The `_update` hook enforces: recipient must be a whitelisted address or a system address.

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
//   - Reserve invariant: totalSupply + amount <=
//     cumulativeLPDeposits + amount + cumulativeYieldMinted - cumulativeLPBurns
//   - _update hook: recipient must be whitelisted or a system address
// Increments cumulativeLPDeposits by amount.
// Emits: Transfer(address(0), lp, amount)
```

### WhitelistRegistry.isAllowedForMint

```solidity
function isAllowedForMint(address lp) external view returns (bool);
// Returns true if lp is whitelisted AND (block.timestamp - approvedAt) < freshnessWindow
// Used by DepositManager at deposit time.
```

### On-chain rate-limit parameters (configurable by ADMIN 3/5 Safe; tightening instant, loosening 48h)

| Parameter | Description |
|---|---|
| `maxPerWindow` | Maximum total PLUSD minted across all deposits in the rolling window |
| `maxPerLPPerWindow` | Maximum PLUSD minted by a single LP in the rolling window |
| `maxTotalSupply` | Hard ceiling on `PLUSD.totalSupply()` — MakerDAO PSM debt-ceiling analog |

Launch values are a product/risk decision (see references/backend.md decision #13).

---

## Data Model

### Reserve Invariant Counters (on PLUSD contract)

| Field | Type | Description |
|---|---|---|
| `cumulativeLPDeposits` | `uint256` | Cumulative USDC deposited via DepositManager (6 decimals) |
| `cumulativeYieldMinted` | `uint256` | Cumulative PLUSD minted via yieldMint |
| `cumulativeLPBurns` | `uint256` | Cumulative PLUSD burned by WithdrawalQueue |

These counters are updated atomically in the same transaction that moves value. The invariant
`totalSupply <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns` is checked
on every mint and burn.

---

## Security Considerations

- **No off-chain signer to forge.** The on-chain USDC transfer IS the deposit evidence.
  There is no EIP-712 attestation or Bridge key that could be forged to mint unbacked PLUSD
  on the deposit leg.
- **Reserve invariant enforced on-chain.** Three cumulative counters updated in the same
  transaction prevent the Resolv-class over-minting attack at the contract level, independently
  of any off-chain service.
- **Hard supply cap.** `maxTotalSupply` provides a circuit-breaker bounding total PLUSD
  supply regardless of deposit volume. Tightening is instant (ADMIN); loosening requires a
  48h AccessManager delay.
- **Per-LP window cap.** `maxPerLPPerWindow` bounds single-actor minting within any rolling
  window, replacing the dropped per-transaction cap.
- **Smart contracts hold no USDC.** The Capital Wallet is an MPC wallet. A contract exploit
  cannot drain deposited USDC; DepositManager only calls `transferFrom` to move USDC from
  the LP's wallet directly to the Capital Wallet.
- **DEPOSITOR role is exclusive.** Only the DepositManager proxy address holds DEPOSITOR on
  PLUSD. No other caller can invoke `mintForDeposit`.
