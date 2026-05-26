# Deposits and PLUSD Minting

## Overview

A lender deposits USDC by calling `DepositManager.deposit(amount)`. The contract pulls USDC into the **Intake Wallet**, an MPC custody address separate from the Capital Wallet, and writes a deposit ticket: `(lender, depositId) -> {amount, status: Pending}`. The Relayer runs compliance screening (KYT) on the lender address and the inbound transaction off-chain. On a clean result, the Relayer signs an EIP-712 `ClaimAttestation` and serves it to the lender via API. The lender calls `DepositManager.claim(depositId, attestation, signature)`. The contract verifies the signature against the configured `kytAttestor` address, writes the lender's whitelist entry, pulls USDC from the Intake Wallet to the Capital Wallet, and mints PLUSD 1:1 to the lender, all atomically.

The Relayer never writes to `DepositManager` on-chain in the normal path. Its role is an off-chain attestor: it signs claim attestations, which the lender submits at claim time. This mirrors the YieldMinter pattern (off-chain attestation verified on-chain at the moment of mint) and is symmetric with `WithdrawalQueue.claim`, which uses the same attestation shape.

`WhitelistRegistry` is retained, but its sole purpose is gating PLUSD transfers via `PLUSD._update`. It no longer gates deposits or withdrawals. Mint eligibility lives in the `DepositManager` ticket book combined with the claim attestation. Withdrawal eligibility is per-tx KYT inside `WithdrawalQueue`. See `lp-onboarding.md` for the three paths to whitelist enrolment.

---

## Behavior

### Deposit Initiation

To deposit, the lender:

1. Calls `USDC.approve(DepositManager, amount)`.
2. Calls `DepositManager.deposit(amount)`.

The deposit UI presents these as a single user action over two on-chain transactions.

### On-Chain Deposit (DepositManager.deposit)

`DepositManager.deposit(uint256 usdcAmount)` enforces these checks atomically:

1. **Minimum deposit.** `usdcAmount >= minimumDeposit` (default 1,000 USDC). Reverts with `BelowMinimum` otherwise.
2. **Per-lender 24h rolling deposit cap.** `lenderWindowDeposited[msg.sender] + usdcAmount <= maxPerLenderPerWindow`.
3. **Global 24h rolling deposit cap.** `windowDeposited + usdcAmount <= maxPerWindow`.
4. **Hard total supply ceiling reservation.** `PLUSD.totalSupply() + outstandingTickets + usdcAmount <= maxTotalSupply`. The `outstandingTickets` term reserves cap headroom for tickets already in `Pending` state, so a lender holding a `Pending` ticket cannot be blocked at claim time by other claimants exhausting the cap.
5. **USDC pull.** `USDC.transferFrom(msg.sender, intakeWallet, usdcAmount)`. Reverts if the lender has not approved DepositManager.
6. **Ticket creation.** `tickets[msg.sender][depositId] = {amount: usdcAmount, status: Pending, createdAt: block.timestamp}`. `depositId` is a sequential per-lender counter.

Emits `DepositRequested(lender, depositId, amount)`.

If any step reverts, the entire transaction rolls back and the lender's USDC remains in their wallet.

### KYT Screening (Off-Chain)

The Relayer detects `DepositRequested` and runs compliance screening through the KYT vendor:

- **Address screening.** Lender address against sanctions and risk lists.
- **Transaction screening.** Source-of-funds analysis on the inbound USDC transfer to the Intake Wallet.

Three result classes, each handled off-chain:

- **Clean.** Relayer signs an EIP-712 `ClaimAttestation` for the deposit and serves it via API (`GET /v1/deposits/{depositId}/attestation`). The Relayer makes no on-chain write.
- **Soft fail.** Indirect mixer exposure beyond a configured hop count, low-confidence flag, or any other non-binary result. Compliance officer reviews. Default outcome is auto-refund within 72h via Trustee + Team co-signed transfer from the Intake Wallet back to the lender's address. After settlement, Trustee calls `DepositManager.markRefunded(lender, depositId)` to flip the ticket on-chain. Compliance can override and approve, in which case the Relayer signs and serves a `ClaimAttestation` for the lender to submit.
- **Hard fail.** OFAC, sanctioned address, or confirmed criminal proceeds. Relayer signs nothing. Ticket stays `Pending` indefinitely. Trustee disposition is off-chain under legal direction. The ticket is not refundable through the standard path.

The framework citation that defines soft vs hard, and the permitted dispositions, is `[Framework: TBD]`.

KYT typically completes in seconds. Relayer SLA target is 60s P99 from `DepositRequested` to attestation availability for clean cases.

### Claim Attestation Format

```solidity
struct ClaimAttestation {
    bytes32 actionId;       // keccak256(abi.encode(chainId, contract, "deposit", depositId))
    address holder;         // expected msg.sender at claim time
    uint256 amount;         // ticket amount, must match
    uint64  approvedAt;     // KYT-pass timestamp, written to WhitelistRegistry
    uint64  deadline;       // claim must land before this
    bytes32 nonce;          // anti-replay, single-use
}
```

EIP-712 domain is the DepositManager contract's domain. Relayer signs with its `kytAttestor` ECDSA key. The signing key address is stored on DepositManager (and rotated under 48h ADMIN timelock via a parameter setter).

### On-Chain Claim (DepositManager.claim)

The lender calls `DepositManager.claim(uint256 depositId, ClaimAttestation att, bytes signature)`:

1. **Ticket status check.** `tickets[msg.sender][depositId].status == Pending`. Reverts otherwise.
2. **Ticket expiry check.** `block.timestamp - tickets[msg.sender][depositId].createdAt < claimWindow` (default 30 days). Reverts with `TicketExpired` after the window.
3. **Attestation field checks.**
   - `att.actionId == keccak256(...deposit, depositId)`.
   - `att.holder == msg.sender`.
   - `att.amount == tickets[msg.sender][depositId].amount`.
   - `block.timestamp <= att.deadline`.
   - `usedNonces[att.nonce] == false`.
4. **Signature verification.** `ECDSA.recover(hash(att), signature) == kytAttestor`.
5. **Nonce consumption.** `usedNonces[att.nonce] = true`.
6. **Whitelist write.** `WhitelistRegistry.setAccess(msg.sender, att.approvedAt)`. DepositManager holds `WHITELIST_ADMIN` on the registry. Auto-enrols the lender (or refreshes their entry).
7. **Hard supply ceiling re-check.** `PLUSD.totalSupply() + amount <= maxTotalSupply`.
8. **USDC pull from Intake Wallet to Capital Wallet.** `USDC.transferFrom(intakeWallet, capitalWallet, amount)` against the standing allowance the Intake Wallet has granted to DepositManager.
9. **PLUSD mint.** `PLUSD.mintForDeposit(msg.sender, amount)`. Increments `cumulativeLPDeposits` and runs the reserve invariant check. The PLUSD `_update` hook passes because step 6 just whitelisted the recipient.
10. **Ticket finalisation.** `tickets[msg.sender][depositId].status = Claimed`. Decrements `outstandingTickets`.

Emits `Deposited(lender, depositId, amount, att.nonce)`.

### Ticket Expiry and Abandoned Deposits

A `Pending` ticket that is not claimed within `claimWindow` (default 30 days from `deposit`) becomes refundable through the `refund` path. The lender calls `DepositManager.refund(depositId)`. The contract:

1. Checks `tickets[msg.sender][depositId].status == Pending`.
2. Checks `block.timestamp - createdAt >= claimWindow`.
3. Pulls USDC from the Intake Wallet via the same standing allowance and forwards to the lender.
4. Flips ticket to `Refunded`. Decrements `outstandingTickets`.

No attestation required for the abandonment refund. The 30-day timeout is the gate.

Trustee may also bulk-refund expired tickets quarterly to clean state and recover Intake Wallet operational headroom. Trustee calls `markRefunded` after the off-chain transfer settles.

### Refund Mechanics

| Path | Trigger | Mechanics |
|---|---|---|
| Lender abandonment | Ticket `Pending` past `claimWindow` (30d) | Lender calls `DepositManager.refund(depositId)`. Contract pulls USDC from Intake Wallet via standing allowance to lender. Ticket flips to `Refunded`. |
| KYT soft-fail refund | Compliance default outcome | Trustee + Team co-sign a USDC transfer from Intake Wallet to lender (off-chain). Trustee calls `DepositManager.markRefunded(lender, depositId)` to flip the ticket. The standing allowance is not used. |
| KYT hard-fail | Trustee disposition under legal direction | No standard refund. Ticket stays `Pending`. Trustee disposition handled off-chain. |

### Over-Rate-Limit Deposits

If `DepositManager.deposit` would breach the per-lender or global rolling window caps, the call reverts. There is no on-chain queue. The lender retries when window headroom reopens. The deposit UI reads `GET /v1/protocol/limits` to show live utilisation against both caps before the lender submits.

---

## UI: Network Fee Estimate

The `/deposit` page shows a "Network fee" row in the Details section of the deposit card. The fee is an ETH-denominated estimate, decoupled from the user's typed amount:

- **Fixed representative amount:** `max(1000 USDC, minDeposit)` is used for the gas simulation, not the user's input. This keeps the displayed fee stable while the user types.
- **Refresh cadence:** The estimate is refreshed once per minute (`refetchInterval: 60_000 ms`).
- **Format:** Fee is displayed as `~0.00053 ETH` (ETH only, no USD equivalent — no ETH/USD price source is wired up).
- **Loading / not configured:** When the contract address is the zero address, the wallet is disconnected, or the estimate has not yet resolved, the row shows `—`.
- **Fallback:** If the gas simulation reverts (e.g., the connected wallet lacks USDC allowance), a curated constant of ~250,000 gas is used, multiplied by live `gasPrice`.

---

## API Contract

The full `IDepositManager` interface, `Ticket` struct, `ClaimAttestation` struct, key events, and rate-limit parameter table are defined in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md). The PLUSD `mintForDeposit` function (called by DepositManager during `claim`) is documented there as well.

---

## Data Model

### Reserve Invariant Counters (on PLUSD contract)

| Field | Type | Description |
|---|---|---|
| `cumulativeLPDeposits` | `uint256` | Cumulative USDC moved from Intake Wallet to Capital Wallet via successful claims (6 decimals) |
| `cumulativeYieldMinted` | `uint256` | Cumulative PLUSD minted via `yieldMint` |
| `cumulativeLPBurns` | `uint256` | Cumulative PLUSD burned by `WithdrawalQueue` |

`cumulativeLPDeposits` increments at `claim`, not at `deposit`. USDC parked in the Intake Wallet is not yet backing PLUSD because no PLUSD has been minted against it.

### DepositManager State

```
mapping(address => uint256)                     latestDepositId;        // per-lender counter
mapping(address => mapping(uint256 => Ticket)) tickets;                  // ticket book
uint256                                         outstandingTickets;      // sum of Pending ticket amounts
uint256                                         windowDeposited;         // global rolling 24h
mapping(address => uint256)                     lenderWindowDeposited;   // per-lender rolling 24h
mapping(bytes32 => bool)                        usedNonces;              // attestation replay guard
address                                         kytAttestor;             // signer address for ClaimAttestation
```

`outstandingTickets` includes only `Pending` tickets. `Claimed` and `Refunded` are terminal states that decrement the counter.

---

## Security Considerations

- **Relayer compromise is bounded to KYT bypass, not unbacked minting.** A compromised `kytAttestor` key can sign valid `ClaimAttestation` for any depositId, holder, and amount. But `claim` requires a real `Pending` ticket, which requires the lender to have already deposited USDC into the Intake Wallet via `deposit`. PLUSD is only minted at `claim`, against USDC the lender themselves moved into the Intake Wallet. The risk is AML (a sanctioned or high-risk lender bypasses screening on a real deposit). PLUSD remains 1:1 backed in every state.

- **Relayer never writes to DepositManager on-chain.** No `markClaimable`, no role to grant. The signing key is a configuration parameter (`kytAttestor`), rotated under ADMIN timelock. Compromise response is signing-key rotation rather than role revocation.

- **Replay protection via nonces.** Each `ClaimAttestation` carries a 32-byte nonce, single-use. The `usedNonces` mapping prevents replay across deposits or after rotation.

- **Deadline enforcement.** Each attestation carries a `deadline`. Stale attestations cannot be submitted after the configured TTL (Relayer issues short-lived attestations, e.g. 1 hour, refreshed on demand).

- **Whitelist write is bound to claim.** `WhitelistRegistry.setAccess` is called by DepositManager during `claim`, after attestation verification. There is no separate Relayer-writes-whitelist path on the deposit flow. DepositManager holds `WHITELIST_ADMIN` for this purpose. Standalone enrolment uses a parallel attestation-verified path on `WhitelistRegistry.enrol` (see `lp-onboarding.md`).

- **Sanctions revocation remains a Relayer direct-call exception.** Passive re-screening that returns a sanctions hit calls `WhitelistRegistry.revokeAccess(addr)` directly. This is a defensive action that needs to land fast. Does not interact with DepositManager state. The narrow exception is documented.

- **Intake Wallet is a separate MPC custody.** Same substrate as Capital Wallet under independent cosigner policy (3-of-5 with Trustee + Team mandatory). A compromise of the Intake Wallet drains parked deposits but cannot drain Capital Wallet reserves.

- **Smart contracts hold no USDC.** Both Intake Wallet and Capital Wallet are MPC addresses. DepositManager only orchestrates `transferFrom` calls against standing allowances. A contract exploit cannot drain either wallet.

- **Reserve invariant unchanged.** PLUSD enforces `totalSupply <= cumulativeLPDeposits + cumulativeYieldMinted - cumulativeLPBurns` at every mint and burn.

- **Hard supply cap reserves against outstanding tickets.** `maxTotalSupply` bounds `totalSupply + outstandingTickets`. A lender holding a `Pending` ticket cannot be blocked at claim time by other claimants exhausting the cap.

- **DEPOSITOR role exclusive to DepositManager.** Only the DepositManager proxy holds DEPOSITOR on PLUSD. No other caller can mint via the deposit path.

- **Trustee can refund but not claim.** `markRefunded` flips a ticket to `Refunded` after an off-chain Trustee + Team co-signed USDC transfer. Trustee cannot mint PLUSD on the deposit path.

- **Intake Wallet allowances.** The Intake Wallet grants two standing USDC allowances to DepositManager: one for `claim` payouts to the Capital Wallet, one for `refund` payouts to the original lender. Both can be revoked by the custody-side hardware circuit breaker independently of any on-chain action.
