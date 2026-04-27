# Withdrawals — Product Spec

## Overview

LPs exit by redeeming sPLUSD for PLUSD, then queuing PLUSD via the WithdrawalQueue contract
for USDC payout. The queue is strict FIFO. Relayer funds the queue head in full via
`fundRequest`; the LP then calls `claim` to atomically burn PLUSD and receive USDC. PLUSD is
held in escrow until `claim`, preserving the backing invariant throughout the lifecycle.

---

## Behavior

### Step 1 — sPLUSD to PLUSD

If the LP holds sPLUSD, they call `sPLUSD.redeem(shares, receiver, owner)`. The vault burns
the sPLUSD shares and transfers PLUSD at the current share price to the receiver. The receiver
must satisfy `WhitelistRegistry.isAllowed(receiver)` — if not, the PLUSD transfer reverts at
the PLUSD contract level.

Before processing the redemption, Relayer checks whether a lazy USYC yield mint is due (NAV
delta > 0) and executes it, keeping the share price current.

### Step 2 — WithdrawalQueue.requestWithdrawal()

The LP calls `WithdrawalQueue.requestWithdrawal(amount)`. The contract checks:

- **Whitelist check:** `msg.sender` must be currently whitelisted (`isAllowed`).
- **Freshness check:** `approvedAt` must be within the freshness window (default 90 days).

On success, the contract pulls `amount` PLUSD from the caller into escrow, assigns a
sequential `queue_id`, and emits `WithdrawalRequested(lpAddress, amount, queueId)`. Entry
status is `Pending`.

### Queue Funding — Relayer calls fundRequest

Relayer processes the queue head in strict FIFO order:

1. **Whitelist check.** If `isAllowed(requester)` is false, calls `WQ.skipSanctionedHead()`.
   The entry moves to `AdminReleased` and the next entry becomes the head.
2. **Freshness check (Relayer-side).** If stale: re-screens via Chainalysis. On clean result,
   calls `WhitelistRegistry.refreshScreening(lp, newTs)`, then proceeds. On flag, calls
   `revokeAccess` then `skipSanctionedHead`. If Chainalysis is unreachable, Relayer halts and
   alerts ops — head is stuck until manual `adminRelease`.
3. **Balance check.** If Capital Wallet USDC is insufficient, Relayer requests a USYC → USDC
   redemption via the custodian MPC API and retries after settlement.
4. **Fund.** Calls `WQ.fundRequest(queueId)`. WQ pulls the full `amount` in USDC from the
   Capital Wallet via pre-approved allowance. Entry moves to `Funded`. Emits
   `WithdrawalFunded(queueId)`.

Funding is always full-amount. There are no partial fills.

### Step 3 — LP calls claim()

After their entry is `Funded`, the LP calls `WQ.claim(queueId)`. The contract atomically:

1. Burns the escrowed PLUSD (`amount`) — increments `cumulativeLPBurns` on PLUSD.
2. Transfers the corresponding USDC from WQ to the LP's address.
3. Moves entry to `Claimed`. Emits `WithdrawalClaimed(queueId)`.

Only the original requester may call `claim`. PLUSD is not burned until `claim`, preserving
the backing invariant throughout the funding-to-claim window.

### Sanctioned Head Handling

If `isAllowed(requester)` is false at funding time, Relayer calls `skipSanctionedHead()`. The
WQ contract moves the entry to `AdminReleased`, unblocking the queue. Escrowed PLUSD in the
skipped entry is held in the contract; ADMIN determines disposition separately.

### Admin Release

ADMIN (3/5 Safe) may call `adminRelease(queueId)` to manually move a stuck `Pending` entry
to `AdminReleased` when automated processing is blocked (e.g., Chainalysis unavailable for an
extended period).

### Above-Envelope Payouts

Relayer's custodian MPC payout policy bounds automated Capital Wallet USDC outflows (per-tx
cap and rolling 24h aggregate). Payouts exceeding these bounds surface in the Trustee tooling
signing queue; Trustee and Pipeline team co-sign via MPC.

### Treasury Wallet Redemption — Stage A (PLUSD to USDC)

The Treasury Wallet redeems PLUSD revenue via the same WithdrawalQueue mechanics, with
three-party authorisation:

1. **Team operator A** initiates the redemption (specifies PLUSD amount).
2. **Team operator B** (distinct authenticated session) verifies and confirms.
3. **Trustee** provides the final co-signature via MPC.

On all three signatures, Relayer escrows PLUSD and executes the USDC payout from the Capital
Wallet to a protocol-controlled withdrawal endpoint.

### Treasury Wallet Redemption — Stage B (USDC to bank account)

Once USDC is at the withdrawal endpoint, Team operator A initiates off-ramp. The destination
bank account must be from the **pre-approved bank account list** maintained by ADMIN Safe.
Free-text entry is not permitted. Authorisation mirrors Stage A (two operators + Trustee).

---

## API Contract

```solidity
interface IWithdrawalQueue {
    /// @notice Pulls PLUSD from caller into escrow; creates a Pending entry.
    /// @dev Reverts if caller is not whitelisted with a fresh screen.
    function requestWithdrawal(uint256 amount) external returns (uint256 queueId);

    /// @notice Funds the queue head in full by pulling USDC from Capital Wallet.
    /// @dev Only callable by FUNDER (Relayer). Moves entry to Funded.
    function fundRequest(uint256 queueId) external;

    /// @notice Skips a sanctioned queue head; moves it to AdminReleased.
    /// @dev Only callable by FUNDER (Relayer). Requires !isAllowed(head requester).
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
  queueId:    uint256   // Sequential, assigned at requestWithdrawal()
  lp:         address   // Original requester
  amount:     uint256   // Full escrowed PLUSD amount
  status:     enum { Pending, Funded, Claimed, AdminReleased }
  createdAt:  uint256   // Block timestamp of requestWithdrawal()
  fundedAt:   uint256   // Block timestamp of fundRequest() — zero until funded
  claimedAt:  uint256   // Block timestamp of claim() — zero until claimed
}
```

PLUSD is burned only at `claim`, when USDC simultaneously leaves the contract. This preserves
the PLUSD backing invariant throughout the full withdrawal lifecycle.

---

## Security Considerations

- **Two-step settlement.** Funding (USDC to WQ) and claiming (PLUSD burn + USDC to LP) are
  separate transactions. `totalSupply` does not decrease until USDC has left the Capital
  Wallet and `claim` burns the PLUSD atomically.
- **No partial fills.** Funding is all-or-nothing, ensuring no state where PLUSD is partially
  burned against partial USDC.
- **Sanctioned head skip.** `skipSanctionedHead` prevents a sanctioned LP from permanently
  blocking queue progress.
- **Queue is one-way.** `cancelWithdrawal` is not in MVP. Once PLUSD enters escrow it remains
  until `claim` or `adminRelease`.
- **Destination is the original requester.** `claim` always pays to the `lp` address on the
  queue entry — there is no redirect parameter.
- **MPC policy caps.** The custodian's policy engine bounds automated Capital Wallet USDC
  outflows by per-tx and rolling aggregate caps, independent of Relayer software.
- **GUARDIAN pause.** GUARDIAN 2/5 can freeze all `fundRequest` and `claim` operations
  immediately on incident detection.
