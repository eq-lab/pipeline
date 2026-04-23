---
title: Emergency response
order: 16
section: Security & Transparency
---

# Emergency response

Pipeline follows an Ethena-style emergency model. GUARDIAN (2/5 Safe) takes instant, granular defensive actions; restoring service requires the 48h ADMIN timelock.

<div class="callout safety">
No single-call "revoke everything" switch exists. Every action names what it is doing to what — a reviewable record with a bounded blast radius.
</div>

{% include diagram.html src="d9-incident-response.svg" caption="Incident response — GUARDIAN contains instantly by pausing contracts and revoking named operational-role holders one at a time; ADMIN restores under the 48-hour timelock." %}

## Walkthrough

<ol class="steps">
  <li>Watchdog detects an anomaly — unexpected whitelist grants, cumulative-counter drift, or a rate-limit breach.</li>
  <li>GUARDIAN instantly pauses PLUSD, DepositManager, and WithdrawalQueue as defence in depth.</li>
  <li>GUARDIAN calls <code>AccessManager.cancel(actionId)</code> on any pending ADMIN scheduled actions.</li>
  <li>GUARDIAN submits <code>revokeRole(YIELD_MINTER, bridgeAddr)</code> — Bridge can no longer mint yield even with both signatures.</li>
  <li>GUARDIAN submits <code>revokeRole(FUNDER, bridgeAddr)</code> — Bridge can no longer fund withdrawal-queue entries.</li>
  <li>GUARDIAN submits <code>revokeRole(WHITELIST_ADMIN, bridgeAddr)</code> — Bridge can no longer modify the whitelist.</li>
  <li>ADMIN investigates and, if needed, rotates the yield-attestor key via <code>proposeYieldAttestors</code> (48h delay, GUARDIAN can cancel).</li>
  <li>ADMIN re-grants operational roles one by one — each under the 48h timelock, GUARDIAN-cancelable.</li>
  <li>ADMIN calls <code>unpause()</code> on each paused contract (48h delay each).</li>
</ol>

## GUARDIAN's toolkit

| Action | Target | Timelock |
|---|---|---|
| `pause()` | Any pausable contract | Instant |
| `AccessManager.cancel(actionId)` | Pending scheduled actions | Instant |
| `AccessManager.revokeRole(role, holder)` | YIELD_MINTER, FUNDER, WHITELIST_ADMIN, TRUSTEE | Instant |

## What GUARDIAN cannot do

- Grant any role.
- Unpause any contract.
- Upgrade any contract.
- Revoke `UPGRADER`, `DEFAULT_ADMIN`, `DEPOSITOR`, `BURNER`, or any governance role.
- Move funds.

A compromised GUARDIAN can grief (pause, cancel, revoke operational-role holders) but cannot escalate, unpause, or move funds. Restoration of service is strictly ADMIN's job, gated by the 48h timelock and itself GUARDIAN-cancelable.

## Playbooks

### Bridge operational-key compromise

Watchdog flags anomalous `setAccess` calls or drift in the cumulative mint counters. GUARDIAN pauses PLUSD, DepositManager, and WithdrawalQueue, then submits three separate `revokeRole` transactions — `YIELD_MINTER`, `FUNDER`, and `WHITELIST_ADMIN` — within minutes. Even a fully compromised Bridge mints zero yield afterwards, funds no withdrawals, and cannot touch the whitelist. Deposits remain atomic and unaffected by Bridge compromise because DepositManager has no Bridge dependency. ADMIN then rotates keys under the 48h timelock.

### Trustee key compromise

GUARDIAN revokes `TRUSTEE` on LoanRegistry instantly. The compromised key can no longer write to LoanRegistry. Capital flows are unaffected because LoanRegistry has no capital touchpoints and is not a NAV source. The Trustee is also a Capital Wallet cosigner, but a single-key Trustee compromise cannot move USDC alone — Bridge cosign is required. Trustee rotation follows the standard 48h ADMIN path.

### Custodian yield-attestor compromise

The custodian revokes its own key internally. The compromised key alone cannot mint — Bridge signature and `YIELD_MINTER` caller role are independent requirements. ADMIN calls `proposeYieldAttestors(sameBridge, newCustodian)` under the 48h timelock. During the window, yield mints can continue safely: the old attestor alone cannot mint, and the compromise is bounded by the Bridge signature and caller-role requirements that still apply.

## Related

- [Custody model](/pipeline/security/custody/)
- [Supply safeguards](/pipeline/security/supply-safeguards/)
- [Defaults and losses](/pipeline/defaults-and-losses/)
