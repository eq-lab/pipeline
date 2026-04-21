# Withdrawals — Product Spec

## Overview

LPs exit by redeeming sPLUSD for PLUSD, then queuing PLUSD for USDC payout via the
WithdrawalQueue contract. The queue is FIFO with partial fill support. The bridge service
auto-signs routine LP payouts; above-envelope payouts and Treasury redemptions require
human co-signature. PLUSD is held in escrow until USDC physically leaves the Capital
Wallet, keeping the PLUSD backing invariant valid throughout the lifecycle.

---

## Behavior

### Step 1 — sPLUSD to PLUSD

If the LP holds sPLUSD, they first call `sPLUSD.redeem(shares, receiver, owner)`. The vault
burns the sPLUSD shares and transfers the corresponding PLUSD (at the current exchange rate)
to the receiver. The receiver must be whitelisted on the WhitelistRegistry; if not, the
PLUSD transfer reverts at the PLUSD contract level.

### Step 2 — WithdrawalQueue.requestWithdrawal()

The LP calls `WithdrawalQueue.requestWithdrawal(amount)`. The contract performs two checks
before accepting the request:

- **Whitelist check**: `msg.sender` must be currently whitelisted on the WhitelistRegistry.
- **Chainalysis freshness check**: the `approvedAt` timestamp on the WhitelistRegistry must
  be within the active freshness window (default 90 days).

If either check fails, the call reverts. On success, the contract pulls `amount` PLUSD from
the caller into queue escrow, assigns a sequential `queue_id`, and emits
`WithdrawalRequested(lpAddress, amount, queue_id)`.

### FIFO queue with partial fills

The queue processes requests in strict FIFO order by `queue_id`. When USDC arrives in the
Capital Wallet from any source (deposit, loan repayment, USYC redemption), the bridge
service attempts to fill the first request in the queue:

- If available USDC covers the full first request, the bridge fills it completely and
  attempts the next queued request with any remaining USDC.
- If available USDC is less than the first request, the bridge issues a partial fill. The
  queue entry's `amount_remaining` is reduced and the entry stays at the head of the queue.
- `WithdrawalPartiallyFilled(queue_id, amount_filled, amount_remaining)` is emitted on each
  partial fill.
- `WithdrawalSettled(queue_id)` is emitted when `amount_remaining` reaches zero and the
  entry is removed from the queue.
- The LP dashboard displays progressive fill status for each active request.

USYC is not counted against USDC availability for queue fills. If USDC is insufficient, the
automated USDC/USYC rebalancing in the yield spec reduces the USYC position and restores
USDC, which then flows through to pending queue entries.

### LP cancelWithdrawal()

An LP may call `cancelWithdrawal(queue_id)` at any time before the request is fully
settled. The contract returns only the `amount_remaining` (escrowed but not yet filled).
Portions already paid out are final and cannot be reversed. A partially-filled request
returns only the unfilled remainder.

### Automated LP payout authorisation (bridge MPC policy)

The bridge service auto-signs Capital Wallet outflows for routine LP payouts. The MPC
policy engine enforces the following checks before any transaction is executed:

| Check | Rule |
|---|---|
| Destination address | Must equal the LP address that originally deposited the USDC corresponding to this PLUSD. Mapping stored in bridge persistent state and verified via policy webhook. |
| Whitelist status | Destination must be currently whitelisted with a fresh Chainalysis screen. |
| Amount | Must equal `amount_remaining` in the queue entry, or a valid partial fill up to current Capital Wallet USDC availability. |
| Per-transaction cap | $5M USDC maximum per single payout transaction. |
| Rolling 24h aggregate | $10M USDC maximum across all LP payouts in a rolling 24h window. |
| Out-of-envelope condition | Any request failing destination match, exceeding either cap, or involving a non-whitelisted address is rejected by the MPC engine and routed to the Trustee + team manual signing queue. |

LPs who wish to withdraw to a different address from their original deposit address must
complete a manual review process with the trustee. This flow is not supported through the
automated path.

### Above-envelope payouts

Payouts that fail the automated policy check — wrong destination, amount above $5M per-tx
or $10M rolling 24h, or non-whitelisted address — are surfaced in the trustee tooling's
signing queue. The trustee and Pipeline team review the request and co-sign via MPC before
the Capital Wallet transaction is submitted.

### Treasury Wallet redemption — Stage A (PLUSD to USDC)

The Treasury Wallet redeems accumulated PLUSD revenue via the same WithdrawalQueue
mechanics as a regular LP withdrawal, with a privileged fill path to avoid queue contention
with LP redemptions. Authorisation requires three parties:

1. **Team operator A** initiates the redemption request (specifies PLUSD amount).
2. **Team operator B** independently verifies the request and confirms. Operator B must be
   a different person from Operator A; the tooling enforces this by binding each step to a
   distinct authenticated session.
3. **Trustee** reviews the verified request and provides the final co-signature via MPC.

On all three signatures, the bridge executes the PLUSD escrow and the USDC payout from the
Capital Wallet to a protocol-controlled withdrawal endpoint inside the cash rail.

### Treasury Wallet redemption — Stage B (USDC to bank account)

Once USDC is at the withdrawal endpoint, the team initiates the off-ramp leg. The
destination bank account must be selected from the **pre-approved bank account list**
maintained by the foundation multisig. Free-text bank account entry is not permitted.
Adding or removing a destination requires a foundation multisig transaction.

Authorisation chain mirrors Stage A: team operator A initiates, team operator B verifies,
trustee co-signs via MPC. The bridge then submits the off-ramp instruction to the on/off-ramp
provider, converting USDC to USD and SWIFT-wiring to the selected Trust Company bank
account.

---

## API Contract

```solidity
interface IWithdrawalQueue {
    /// @notice Pulls PLUSD from caller into escrow and creates a queue entry.
    /// @dev Reverts if caller is not whitelisted with a fresh Chainalysis screen.
    /// @return queueId Sequential identifier for this request.
    function requestWithdrawal(uint256 amount) external returns (uint256 queueId);

    /// @notice Returns remaining escrowed PLUSD to the original requester.
    /// @dev Only callable by the original requester. Cannot reverse filled portions.
    function cancelWithdrawal(uint256 queueId) external;

    /// @notice Fills the specified queue entry fully or partially.
    /// @dev Only callable by FILLER role (bridge service). Burns filled PLUSD amount.
    ///      Emits WithdrawalPartiallyFilled or WithdrawalSettled.
    function fillRequest(uint256 queueId, uint256 amount) external;

    /// @notice Returns current queue state.
    /// @return totalEscrowed  Sum of all outstanding escrowed PLUSD.
    /// @return count          Number of pending requests.
    /// @return outstandingAtHead  amount_remaining for the first request in queue.
    function getQueueDepth()
        external view returns (
            uint256 totalEscrowed,
            uint256 count,
            uint256 outstandingAtHead
        );

    /// @notice Freezes all fills. 2-of-5 Risk Council via foundation multisig.
    function pause() external;

    /// @notice Resumes fills after a pause.
    function unpause() external;
}
```

**Key events**

```solidity
event WithdrawalRequested(address indexed lp, uint256 amount, uint256 indexed queueId);
event WithdrawalPartiallyFilled(uint256 indexed queueId, uint256 amountFilled, uint256 amountRemaining);
event WithdrawalSettled(uint256 indexed queueId);
event WithdrawalCancelled(uint256 indexed queueId, uint256 amountReturned);
```

---

## Data Model

```
WithdrawalEntry {
  queueId:         uint256   // Sequential, assigned at requestWithdrawal()
  lp:              address   // Original requester
  originalAmount:  uint256   // Amount at time of request
  amountFilled:    uint256   // Cumulative amount paid out so far
  amountRemaining: uint256   // Outstanding escrowed balance
  status:          enum { Pending, PartiallyFilled, Settled, Cancelled }
  createdAt:       uint256   // Block timestamp of requestWithdrawal()
}
```

PLUSD is held in queue escrow and is not burned until `fillRequest()` is called. This keeps
the PLUSD backing invariant intact: `totalSupply` does not decrease until USDC has
physically left the Capital Wallet.

---

## Security Considerations

- The destination-match check is the central security property of the automated payout
  path. Only the LP's original deposit address is a valid payout destination; the MPC
  policy engine enforces this independently of the bridge's software. A compromised bridge
  cannot redirect withdrawals to an attacker-controlled address.
- The $5M per-tx and $10M rolling 24h caps bound worst-case automated outflow to a
  recoverable fraction of the pilot pool within any single detection window.
- The whitelist and freshness check at `requestWithdrawal()` prevents PLUSD that has
  drifted to a non-whitelisted address (e.g., via a DeFi venue) from being used to drain
  protocol liquidity via the queue.
- PLUSD escrow preserves the backing invariant throughout the withdrawal lifecycle and enables cancellation without economic loss to the LP.
- The foundation multisig pause capability (2-of-5 Risk Council fast-pause) freezes all fills immediately on incident detection, independent of bridge state.
- The pre-approved bank account list for Stage B Treasury redemptions prevents operator accounts (including compromised ones) from redirecting protocol revenue to attacker-controlled bank accounts.
- Every automated payout above $1M triggers an alert to the 24/7 on-call channel.
