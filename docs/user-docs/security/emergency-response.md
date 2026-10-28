---
title: Emergency response
order: 32
section: Security & Transparency
---

# Emergency response

The Pauser stops a contract at once. The Guardian cancels scheduled calls. The Admin revokes roles and restarts contracts. Each action names its target and is recorded on-chain.

<div class="callout safety">
No single call stops the whole protocol. The Pauser pauses each contract separately.
</div>

{% include diagram.html src="d9-incident-response.png" caption="Incident response." %}

## Walkthrough

<ol class="steps">
  <li>Monitoring detects an anomaly: unexpected address approvals, mints near the limits, or a queue or cash-book mismatch.</li>
  <li>The Pauser pauses the affected contracts: deposit manager, withdrawal queue, minter, vault, loan registry, default pocket or security registry.</li>
  <li>The Guardian or the Admin cancels any pending scheduled call that looks wrong.</li>
  <li>The Admin revokes the role of the suspected holder.</li>
  <li>If withdrawals are the suspected vector, the withdrawal custody account withdraws its allowance to the queue. This needs no on-chain governance action.</li>
  <li>The Admin replaces a compromised voucher signer key.</li>
  <li>The Admin grants the role to a new holder.</li>
  <li>The Admin unpauses each contract.</li>
</ol>

## Toolkit

| Action | Who | Target | Delay |
|---|---|---|---|
| Pause | Pauser | Deposit manager, withdrawal queue, minter, vault, loan registry, default pocket, security registry | Instant |
| Cancel a scheduled call | Guardian, Admin, or the scheduler | Pending scheduled calls | Instant |
| Revoke a role | Admin | Any role holder | Instant |
| Remove an address from the approved holder list | Whitelist admin | One PLUSD holder | Instant |
| Unpause | Admin | Any paused contract | Instant |
| Upgrade | Upgrader | Protocol contracts except the access manager | Instant |

While the vault is paused, default handling still runs: the carve-out to a default pocket, loss absorption and fee reversal.

## Limits — what the Guardian cannot do

- Grant or revoke any role. Admin only.
- Pause or unpause any contract.
- Upgrade any contract.
- Move funds.

A compromised Guardian can cancel scheduled calls. It cannot do anything else.

## Playbooks

### Backend compromise

The platform backend screens addresses, approves PLUSD holders and signs deposit and withdrawal vouchers. The Pauser pauses the deposit manager and the withdrawal queue. The Admin revokes the backend's approval role and replaces the voucher signer key on both contracts. The backend cannot mint PLUSD on its own: a deposit mint needs a request backed by USDC already in custody, and minter mints need the Cash reporter role.

### Trustee key compromise

The Admin revokes the Trustee role. The compromised key can no longer open loans, record disbursements or book cash movements. The Trustee cannot mint PLUSD. The Risk Council reverses any wrong disbursement after its 24-hour delay. The Admin grants the Trustee role to a new signer set.

### Cash reporter compromise

A compromised Cash reporter could book a false wire or repayment and mint PLUSD against it. Each mint is limited to 1,000,000 PLUSD and 10,000,000 PLUSD per 24 hours, and each bank reference is used once. The Pauser pauses the minter. The Admin revokes the role. The Risk Council reverses wrong repayments and corrects the vault.

### Queue contract exploit

The Pauser pauses the withdrawal queue. The withdrawal custody account can also withdraw its allowance. Losses are limited to the USDC in the withdrawal custody account within the allowance. The deposit custody account is out of the queue's reach.

## Related

- [Custody](/security/custody/)
- [Capital safeguards](/security/capital-safeguards/)
- [Default management](/risks/default-management/)
