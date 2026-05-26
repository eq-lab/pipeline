# Withdrawals

## Overview

Lenders exit by redeeming sPLUSD for PLUSD if needed, then queuing PLUSD via the `WithdrawalQueue` contract, then pulling USDC themselves with `claim`. The queue tracks three aggregates (`totalRequested`, `totalClaimed`, `totalClaimable`) and pulls USDC from the **Withdrawal Queue Wallet** via a standing allowance the Wallet has granted to the contract.

Compliance screening is enforced at two points. The PLUSD transfer into queue escrow runs through `PLUSD._update`, which checks `WhitelistRegistry.isAllowed` (whitelist + 90-day freshness). The `claim` call requires a fresh KYT attestation signed by the Relayer off-chain, plus an `isAllowed` re-check at claim time as a backstop.

The Relayer never writes to `WithdrawalQueue` on-chain. Its role is an off-chain attestor: it signs `ClaimAttestation` payloads after running KYT, and the lender submits the attestation at claim time. This mirrors the deposit flow on `DepositManager` and the yield flow on `YieldMinter`.

PLUSD held in queue escrow is burned only at `claim`, atomically with USDC payout. The reserve invariant `totalSupply <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns` is preserved through the request-to-claim window.

---

## Behavior

### Step 1: sPLUSD to PLUSD

If the lender holds sPLUSD, they call `sPLUSD.redeem(shares, receiver, owner)`. The vault burns the sPLUSD shares and transfers PLUSD at the current share price to `receiver`. The receiver must satisfy `WhitelistRegistry.isAllowed(receiver)` or the PLUSD transfer reverts at `PLUSD._update`.

Before processing the redemption, the Relayer checks whether a lazy USYC yield mint is due (NAV delta > 0) and executes it, keeping the share price current.

Skip this step if the lender already holds PLUSD.

### Step 2: requestWithdrawal

The lender calls `WithdrawalQueue.requestWithdrawal(amount)`. The contract:

1. Pulls `amount` PLUSD from the lender into queue escrow via `PLUSD.transferFrom`. The transfer triggers `PLUSD._update`, which enforces `isAllowed(msg.sender)` and the freshness window. A stale or revoked entry reverts here.
2. Assigns a sequential `queueId`.
3. Increments `totalRequested` by `amount`.
4. Stores the entry: `{queueId, lp: msg.sender, amount, status: Pending, createdAt: block.timestamp}`.
5. Emits `WithdrawalRequested(lp, amount, queueId)`.

### Off-Chain KYT and Attestation

The Relayer detects `WithdrawalRequested` and runs KYT screening on the holder address against sanctions and risk lists. On a clean result, the Relayer signs an EIP-712 `ClaimAttestation` and serves it via API (`GET /v1/withdrawals/{queueId}/attestation`).

Three result classes:

- **Clean.** Attestation signed and served. No on-chain Relayer action.
- **Soft fail.** Compliance officer reviews. Default outcome is approve-and-sign or reject-and-no-sign per the `[Framework: TBD]` rules.
- **Hard fail.** Relayer signs nothing. ADMIN takes disposition via `adminRelease(queueId)`.

The attestation typically lands within seconds of `WithdrawalRequested`. The lender's frontend polls the API and constructs the `claim` transaction once the attestation is available.

### Claim Attestation Format

```solidity
struct ClaimAttestation {
    bytes32 actionId;       // keccak256(abi.encode(chainId, contract, "withdrawal", queueId))
    address holder;         // expected msg.sender at claim time
    uint256 amount;         // queue entry amount, must match
    uint64  approvedAt;     // KYT-pass timestamp
    uint64  deadline;       // claim must land before this
    bytes32 nonce;          // anti-replay, single-use
}
```

EIP-712 domain is the WithdrawalQueue contract's domain. Same shape as the deposit attestation, distinct domain.

### Step 3: claim

The lender calls `WithdrawalQueue.claim(uint256 queueId, ClaimAttestation att, bytes signature)`. The contract:

1. **Ownership check.** `entries[queueId].lp == msg.sender`. Only the original requester can claim.
2. **Status check.** `entries[queueId].status == Pending`.
3. **Whitelist re-check.** `WhitelistRegistry.isAllowed(msg.sender)` as a backstop. Catches sanctions revocations between attestation issuance and claim landing.
4. **Attestation field checks.**
   - `att.actionId == keccak256(...withdrawal, queueId)`.
   - `att.holder == msg.sender`.
   - `att.amount == entries[queueId].amount`.
   - `block.timestamp <= att.deadline`.
   - `usedNonces[att.nonce] == false`.
5. **Signature verification.** `ECDSA.recover(hash(att), signature) == kytAttestor`.
6. **Nonce consumption.** `usedNonces[att.nonce] = true`.
7. **Self-limit invariant.** `claimAmount <= totalClaimable`, where `totalClaimable = totalRequested - totalClaimed`.
8. **USDC pull.** `USDC.transferFrom(withdrawalQueueWallet, msg.sender, amount)` against the standing allowance.
9. **PLUSD burn.** `PLUSD.burn(amount)`. Increments `cumulativeLPBurns` on the PLUSD contract.
10. **Aggregate update.** Increments `totalClaimed` by `amount`.
11. **Status finalisation.** `entries[queueId].status = Claimed`.

Emits `WithdrawalClaimed(queueId, amount, att.nonce)`. All steps in a single transaction.

The PLUSD burn happens after the USDC has left the Withdrawal Queue Wallet, so `totalSupply` does not decrease until USDC has visibly moved.

### Withdrawal Queue Wallet Top-ups

The Withdrawal Queue Wallet is a separate MPC custody address. It holds USDC earmarked for queue settlement, sized to cover near-term `totalClaimable` plus operational headroom. Top-ups are executed by the Trustee and Team under the standard 3-of-5 cosigner quorum on the Capital Wallet, with USDC transferred from the Capital Wallet to the Withdrawal Queue Wallet.

The Trustee monitors the Wallet's USDC balance against the contract's `totalClaimable`. When the buffer thins, the Trustee initiates a top-up. If the Capital Wallet itself is short on USDC (15% buffer depleted), the Trustee instructs a USYC redemption against the Hashnote rail before topping up.

If the Withdrawal Queue Wallet's USDC balance falls below the queue's outstanding obligations, `claim` reverts on the `transferFrom` until the next top-up. The contract's accounting is unaffected. Lenders see a delay, not a loss.

### Sanctions Handling Between Request and Claim

If the Relayer's passive re-screening returns a sanctions hit on a lender with one or more `Pending` queue entries, the Relayer calls `WhitelistRegistry.revokeAccess(lender)` directly. Subsequent claim attempts fail at the `isAllowed` re-check (step 3 of claim), and the Relayer also stops issuing claim attestations for that holder.

The escrowed PLUSD remains in the queue contract until ADMIN takes a disposition action via `adminRelease(queueId)`. Disposition is a manual decision: refund the PLUSD to a permitted address, burn it under legal direction, or hold pending instruction.

### Admin Release

ADMIN (3/5 Safe) may call `adminRelease(queueId)` to flip a `Pending` entry to `AdminReleased` when the lender cannot or should not claim. The escrowed PLUSD does not move on this call. ADMIN provides separate disposition instructions to the Trustee for the actual transfer.

### Above-Envelope Payouts

Withdrawal Queue Wallet top-ups exceeding the cosigner policy's per-transfer cap surface in the Trustee tooling signing queue. Trustee, two Team operators, and one external Counterparty co-sign via MPC under the 3-of-5 + Team + Trustee quorum.

### Treasury Wallet Redemption (PLUSD to USDC)

The Treasury Wallet redeems accumulated protocol fees through the same `requestWithdrawal` and `claim` mechanics. Authorisation requires three-party approval inside the Operations Console:

1. **Team operator A** initiates the redemption (specifies PLUSD amount).
2. **Team operator B** (distinct authenticated session) verifies and confirms.
3. **Trustee** provides the final co-signature via MPC.

On all three signatures, the Treasury Wallet calls `requestWithdrawal` from its own address (a whitelisted system address) and `claim` after the standard timing, including the attestation flow.

### Treasury Wallet Off-Ramp (USDC to bank account)

Once USDC is at the Treasury Wallet, Team operator A initiates an off-ramp transfer. The destination bank account must be from the **pre-approved bank account list** maintained by the foundation multisig. Free-text destination entry is not permitted. Authorisation mirrors the redemption path (two operators plus Trustee).

---

## UI: Network Fee Estimate

The `/deposit` page (withdraw direction) shows a "Network fee" row in the Details section of the conversion card. The fee is an ETH-denominated estimate, decoupled from the user's typed amount:

- **Fixed representative amount:** 1000 PLUSD is used for the gas simulation, not the user's input. This keeps the displayed fee stable while the user types.
- **Refresh cadence:** The estimate is refreshed once per minute (`refetchInterval: 60_000 ms`).
- **Format:** Fee is displayed as `~0.00042 ETH` (ETH only, no USD equivalent — no ETH/USD price source is wired up).
- **Loading / not configured:** When the contract address is the zero address, the wallet is disconnected, or the estimate has not yet resolved, the row shows `—`.
- **Fallback:** If the gas simulation reverts (e.g., the connected wallet lacks PLUSD balance), a curated constant of ~180,000 gas is used, multiplied by live `gasPrice`.

---

## API Contract

The full `IWithdrawalQueue` interface, `Entry` struct, `ClaimAttestation` struct, and key events are defined in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## Data Model

### Queue Aggregates (on WithdrawalQueue contract)

| Aggregate | Description |
|---|---|
| `totalRequested` | Cumulative PLUSD escrowed across all withdrawal requests ever submitted |
| `totalClaimed` | Cumulative USDC paid out (equals cumulative PLUSD burned via claim) |
| `totalClaimable` | Currently outstanding obligations: `totalRequested - totalClaimed` |

The self-limit invariant `claimAmount <= totalClaimable` is checked on every `claim`. Independent of allowance from the Withdrawal Queue Wallet. Allowance is the permission ceiling. The aggregate ledger is the spending discipline.

### Entry State

```
Entry {
  queueId:    uint256   // Sequential, assigned at requestWithdrawal()
  lp:         address   // Original requester
  amount:     uint256   // Full escrowed PLUSD amount
  status:     enum { Pending, Claimed, AdminReleased }
  createdAt:  uint256   // Block timestamp of requestWithdrawal()
  claimedAt:  uint256   // Block timestamp of claim(), zero until claimed
}
```

PLUSD is burned only at `claim`, when USDC simultaneously leaves the Withdrawal Queue Wallet. This preserves the PLUSD backing invariant throughout the full withdrawal lifecycle.

---

## Security Considerations

- **User-pulled claim, no off-chain signer in critical path for execution.** The lender pulls USDC themselves. The Relayer signs the attestation off-chain but does not write to WithdrawalQueue. As long as the Withdrawal Queue Wallet has USDC, the queue contract has allowance against it, and the lender holds a valid attestation, `claim` settles in a single transaction.

- **Relayer compromise is bounded to KYT bypass on real escrowed positions.** A compromised `kytAttestor` key can sign valid attestations for any queueId, but only against existing escrowed entries. The lender must have already escrowed PLUSD via `requestWithdrawal` (which itself required the lender to be whitelisted). PLUSD already burned cannot be re-burned. The risk is AML (a sanctioned holder bypasses screening), not unbacked release of USDC.

- **Withdrawal Queue Wallet isolates settlement funds.** A `WithdrawalQueue` contract bug or exploit can drain only the topped-up USDC in the Withdrawal Queue Wallet, not the full Capital Wallet.

- **Self-limit invariant prevents over-pull.** Even if the Withdrawal Queue Wallet's allowance is `MAX_UINT`, the contract physically refuses to pull more USDC than the queue's outstanding obligations.

- **PLUSD burn after USDC out.** The burn happens after the USDC has visibly left the Withdrawal Queue Wallet, so `totalSupply` cannot drop ahead of the USDC payout.

- **Sanctions caught at request, claim attestation, and claim re-check.** Three layers: PLUSD `_update` at request, attestation issuance at claim time, and `isAllowed` re-check inside claim.

- **Replay protection via nonces.** Each `ClaimAttestation` carries a 32-byte single-use nonce.

- **Deadline enforcement.** Stale attestations cannot be submitted after the configured TTL.

- **One-way queue.** No `cancelWithdrawal` in MVP. Once PLUSD enters escrow it remains until `claim` or `adminRelease`.

- **Destination is the original requester.** `claim` always pays to the `lp` address recorded on the entry. There is no redirect parameter.

- **Custody-side circuit breaker.** The hardware breaker on the Withdrawal Queue Wallet revokes the queue contract's allowance instantly, independent of any on-chain action.

- **GUARDIAN pause.** GUARDIAN can freeze `requestWithdrawal` and `claim` immediately on incident detection.
