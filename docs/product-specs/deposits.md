# Deposits and PLUSD Minting

## Overview

An LP deposits USDC directly to the Pipeline Capital Wallet from their whitelisted wallet address. The bridge service detects the on-chain USDC Transfer event, runs four eligibility checks, and mints PLUSD 1:1 to the depositor. Deposits that exceed the rolling rate limit are queued and processed as capacity opens. There is no smart contract deposit function: the LP makes a standard ERC-20 USDC transfer; the mint is a bridge-side response.

---

## Behavior

### Deposit Initiation

The LP initiates a deposit through the Pipeline app. Before presenting the deposit UI, the app reads the LP's on-chain WhitelistRegistry entry:

- If the LP is not whitelisted, the deposit UI is disabled and the LP is directed to complete onboarding.
- If the LP is whitelisted but the Chainalysis freshness window has expired (i.e., `block.timestamp - approvedAt >= freshnessWindow`), the deposit UI is blocked and the LP is prompted to re-verify. Re-verification triggers a fresh Chainalysis screen via the bridge service; on a clean result, `approvedAt` is refreshed and the deposit UI is unblocked.

The LP enters a deposit amount and signs a standard USDC `transfer` transaction from their connected wallet to the Capital Wallet address.

### Minimum Deposit and Below-Minimum Accumulation

The minimum deposit amount is **1,000 USDC**, configurable by the foundation multisig.

Deposits below 1,000 USDC are not rejected. The bridge service accumulates the unminted balance per LP address in a **pending top-up counter**. When subsequent deposits from the same address bring the cumulative pending amount to or above 1,000 USDC, the bridge mints PLUSD for the combined total in a single transaction and resets the counter to zero.

The LP dashboard displays the LP's pending top-up balance as "pending deposits — not yet earning yield", showing how much sits below the threshold and how much additional deposit would unlock the mint.

### Four Eligibility Checks

When the bridge service observes a USDC Transfer event into the Capital Wallet, it runs four checks in order:

1. **Whitelist check.** The sending address must be present in the WhitelistRegistry.
2. **Freshness check.** The sending address must have a Chainalysis screen within the freshness window (`approvedAt` is current).
3. **Minimum check.** The deposit amount, combined with any pending top-up balance for this address, must reach or exceed 1,000 USDC to trigger a mint.
4. **Rate limit check.** The mint must not breach the rolling 24h aggregate cap ($10M) or the per-transaction cap ($5M).

If checks 1 or 2 fail, the deposit is quarantined and routed to the compliance review queue for manual resolution by a compliance officer. The LP is not immediately notified of a quarantine; the compliance officer determines the outcome.

If check 3 is not yet met, the amount is added to the LP's pending top-up counter and no mint occurs until the threshold is crossed.

If check 4 fails (rate limit or per-transaction cap would be breached), the deposit enters the mint queue (see Deposit Mint Queue below).

If all four checks pass, the bridge service calls `PLUSD.mint(lpAddress, amount)` immediately.

### Rolling Rate Limit

On-chain rate limits apply to all PLUSD mints (both deposit mints and yield mints):

- **Rolling 24-hour aggregate cap: $10M.** The contract reverts any mint that would cause total minted PLUSD in the preceding 24 hours to exceed this amount.
- **Per-transaction cap: $5M.** The contract reverts any single mint above this amount.

Both caps are configurable by the foundation multisig. Mints that breach either cap revert at the contract level.

### Deposit Mint Queue

When a deposit would breach the rolling 24h cap or the per-transaction cap, the bridge service does not reject it. The USDC has already arrived in the Capital Wallet and the LP is entitled to PLUSD. Instead:

1. The bridge service records the pending mint as a queue entry: `(lpAddress, amount, deposit_tx_hash, queued_at)`.
2. As the rolling 24h window advances and headroom becomes available, the bridge processes queued entries in **FIFO order**, calling `PLUSD.mint()` for each as capacity permits.
3. A single deposit exceeding the $5M per-transaction cap is automatically split by the bridge into multiple mint transactions, each at or below $5M, processed over successive rolling windows. The LP receives incremental PLUSD as each window opens.
4. The LP dashboard shows queued deposits with status "PLUSD mint pending — rate limit" and the expected processing window.

The queue is a bridge-side backend construct with no on-chain state. If the bridge service restarts, it rebuilds the queue by computing the delta between the USDC Transfer log and the PLUSD mint log for the Capital Wallet address.

### PLUSD Mint

`PLUSD.mint()` is called by the bridge service (the sole holder of the MINTER role). The function enforces on-chain:

- The per-transaction cap ($5M).
- The rolling 24h aggregate cap ($10M).
- That the recipient address is present on the WhitelistRegistry (the `_update` hook reverts if `!WhitelistRegistry.isAllowed(to)`).

PLUSD is minted 1:1 to USDC received. No fee is deducted at mint time.

The bridge service distinguishes two mint categories in its audit log and alerting, both using the same on-chain function:
- **Deposit mints**: triggered by USDC Transfer events from whitelisted LP addresses.
- **Yield mints**: triggered by trustee-signed RepaymentSettled and TreasuryYieldDistributed events.

---

## API Contract

### PLUSD.mint

```solidity
function mint(address to, uint256 amount) external;
// Access: MINTER role (bridge service only)
// Enforces:
//   - per-tx cap: amount <= perTxCap (default $5M, 6-decimal USDC units)
//   - rolling 24h cap: rollingMinted + amount <= rollingCap (default $10M)
//   - recipient whitelist: WhitelistRegistry.isAllowed(to) == true
// Reverts if any condition is unmet.
// Emits: Transfer(address(0), to, amount)
```

### WhitelistRegistry.isAllowed (called at mint time)

```solidity
function isAllowed(address lp) external view returns (bool);
// Returns true if lp is whitelisted AND (block.timestamp - approvedAt) < freshnessWindow
```

### On-chain rate limit parameters (configurable by foundation multisig)

| Parameter | Default | Description |
|---|---|---|
| `perTxCap` | $5,000,000 USDC | Maximum PLUSD minted in a single transaction |
| `rollingCap` | $10,000,000 USDC | Maximum PLUSD minted across all mint types in any rolling 24-hour window |
| `minimumDeposit` | $1,000 USDC | Minimum deposit amount to trigger a mint (per-address cumulative threshold) |

---

## Data Model

### Deposit Mint Queue Entry (bridge-side, no on-chain state)

| Field | Type | Description |
|---|---|---|
| `lpAddress` | `address` | The depositing LP's wallet address |
| `amount` | `uint256` | USDC amount to mint (6 decimals) |
| `deposit_tx_hash` | `bytes32` | Transaction hash of the originating USDC Transfer |
| `queued_at` | `uint256` | Unix timestamp when the entry was added to the queue |

Queue is rebuilt on bridge restart from the delta between the Capital Wallet's USDC Transfer event log and the PLUSD contract's mint event log.

### Pending Top-Up Counter (bridge-side)

| Field | Type | Description |
|---|---|---|
| `lpAddress` | `address` | LP wallet address |
| `pendingAmount` | `uint256` | Cumulative below-minimum USDC received, not yet minted (6 decimals) |

Counter resets to zero when cumulative amount reaches 1,000 USDC and a mint is executed for the total.

---

## Security Considerations

- Smart contracts hold no USDC. The Capital Wallet is an MPC wallet; the bridge's auto-signing scope does not include arbitrary USDC outflows. A contract exploit cannot drain deposited USDC.
- The MINTER role is held exclusively by the bridge service. On-chain rate limits cap the blast radius of a compromised MINTER to $10M in any 24-hour rolling window, enforceable at the contract level independently of the bridge.
- The `_update` hook on PLUSD ensures minted tokens can only land at whitelisted addresses, preventing accidental or malicious minting to unapproved destinations.
- Quarantined deposits (whitelist or freshness failure) are not automatically returned. Human compliance review is required, providing a gate against address spoofing or post-approval sanctions events.
- The foundation multisig can adjust rate limits and the minimum deposit threshold via governance without a contract upgrade.
