---
title: Emergency response
order: 16
section: Security & Transparency
---

# Emergency response

Pipeline follows an Ethena-style emergency model. GUARDIAN (2/5 MPC) takes instant, granular defensive actions. Restoring service requires the standard 3-day ADMIN timelock (7 days for upgrades).

<div class="callout safety">
No single-call "revoke everything" switch exists. Every action names what it is doing to what. A reviewable record with a bounded blast radius.
</div>

{% include diagram.html src="d9-incident-response.svg" caption="Incident response. GUARDIAN contains instantly by pausing contracts and revoking named operational-role holders one at a time. ADMIN restores under the 3-day timelock." %}

## Walkthrough

<ol class="steps">
  <li>Watchdog detects an anomaly: unexpected whitelist grants, cumulative-counter drift, or queue-aggregate mismatch.</li>
  <li>GUARDIAN instantly pauses PLUSD, DepositManager, YieldMinter, and WithdrawalQueue as defence in depth.</li>
  <li>GUARDIAN calls <code>AccessManager.cancel(actionId)</code> on any pending ADMIN scheduled actions.</li>
  <li>GUARDIAN submits <code>revokeRole(WHITELIST_MANAGER_ROLE, relayerAddr)</code>. Relayer can no longer modify the whitelist.</li>
  <li>If yield mints are the suspected vector, the YieldMinter pause above already halts them regardless of attestor key state. Attestor rotation follows under ADMIN.</li>
  <li>If withdrawal-queue settlement is the suspected vector, the custody-side circuit breaker can additionally revoke the Withdrawal Queue Wallet's standing allowance to the queue contract, independent of any on-chain action.</li>
  <li>ADMIN rotates the yield-attestor keys via <code>YieldMinter.proposeYieldAttestors</code> (7-day delay, GUARDIAN can cancel).</li>
  <li>ADMIN re-grants operational roles one by one, each under the 3-day timelock, GUARDIAN-cancelable.</li>
  <li>ADMIN calls <code>unpause()</code> on each paused contract (3-day delay each).</li>
</ol>

## GUARDIAN's toolkit

| Action | Target | Timelock |
|---|---|---|
| `pause()` | Any pausable contract | Instant |
| `AccessManager.cancel(actionId)` | Pending scheduled actions | Instant |
| `AccessManager.revokeRole(role, holder)` | WHITELIST_MANAGER_ROLE, TRUSTEE | Instant |

## What GUARDIAN cannot do

- Grant any role.
- Unpause any contract.
- Upgrade any contract.
- Revoke `UPGRADER`, `DEFAULT_ADMIN`, `MINTER_ROLE`, `BURNER_ROLE`, or any governance role. (`MINTER_ROLE` is held by the YieldMinter and DepositManager contracts. If a problem with one is suspected, the response is to pause that contract instantly, not revoke the role.)
- Move funds.

A compromised GUARDIAN can grief (pause, cancel, revoke operational-role holders) but cannot escalate, unpause, or move funds. Restoration of service is strictly ADMIN's job, gated by the 3-day timelock and itself GUARDIAN-cancelable.

## Playbooks

### Relayer operational-key compromise

Watchdog flags anomalous whitelist writes or yield-attestation patterns. GUARDIAN pauses PLUSD, DepositManager, YieldMinter, and WithdrawalQueue, then submits `revokeRole(WHITELIST_MANAGER_ROLE, relayerAddr)`. With YieldMinter paused, the compromised `relayerYieldAttestor` key cannot be used to mint yield PLUSD. With WHITELIST_MANAGER_ROLE revoked, the Relayer EOA cannot touch the whitelist. **Withdrawals are unaffected by Relayer compromise** because the WithdrawalQueue is user-pulled. The Relayer is not in the claim critical path. **Deposits remain atomic and unaffected** because DepositManager has no Relayer dependency. ADMIN then rotates the attestor key via `YieldMinter.proposeYieldAttestors` and re-grants the Relayer's operational role under the 3-day timelock.

### Trustee key compromise

GUARDIAN revokes `TRUSTEE` (the LoanRegistry write role) instantly. The compromised key can no longer write to LoanRegistry. **Capital flows are unaffected** because LoanRegistry has no capital touchpoints and is not a NAV source. The Trustee is also one of five Capital Wallet cosigners. A single-key Trustee compromise cannot move USDC alone, since the cosigner policy requires Team + Trustee + one more on every transfer (3-of-5 with mandatory Team and Trustee). At the custody layer, the Trustee's compromised cosigner share is rotated under the standard MPC-rotation procedure. On-chain, Trustee role rotation follows the standard 3-day ADMIN path.

### Trustee yield-attestor compromise

The Trustee revokes the compromised yield-attestor signing material from its own infrastructure. The compromised key alone cannot mint. The Relayer signature and the YieldMinter contract's role on PLUSD are independent requirements. ADMIN calls `YieldMinter.proposeYieldAttestors(sameRelayer, newTrustee)` under the 7-day delay to rotate the on-chain attestor address. During the window, yield mints continue safely. The old attestor alone cannot mint, and the compromise is bounded by the Relayer signature and the caller-role requirement that still apply.

### Withdrawal-queue contract suspected exploit

GUARDIAN pauses WithdrawalQueue. If the exploit is in the claim path, the Withdrawal Queue Wallet's standing allowance to the queue contract can additionally be revoked at the custody layer. A Trustee + Team operation that is independent of on-chain governance. The blast radius is bounded by whatever USDC was in the Withdrawal Queue Wallet at the moment of compromise. The Capital Wallet itself is unreachable from the queue contract.

## Related

- [Custody model](/security/custody/)
- [Supply safeguards](/security/supply-safeguards/)
- [Default management](/defaults-and-losses/)
