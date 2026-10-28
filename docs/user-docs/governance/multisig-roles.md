---
title: Operators & Multisigs
order: 27
section: Governance
---

# Operators & Multisigs

Every privileged action in the protocol goes through the access manager. The access manager maps each action to one role. It checks the caller's role, applies the holder's execution delay, and records scheduled and cancelled calls on-chain.

{% include diagram.html src="boss-governance-detail.png" caption="Governance roles and the access manager." %}

| Role | Holder | Delay | Powers |
|---|---|---|---|
| Admin | Multisig | None | Grants and revokes roles, unpauses, sets limits and custody accounts, sets the voucher signer, sets the recovery rate |
| Risk Council | Multisig of several people | None for default and reversing a repayment; 24 hours for the rest | Default, cure, write-down, closing defaulted loans, loan amendments, interest adjustments, reversals, corrections |
| Trustee | The Trustee | None | Opens and services loans, disbursements, bank withdrawals, cash conversions, expenses |
| Cash reporter | 2-of-2 multisig | None | Books incoming wires, repayments and bank income |
| Whitelist admin | Platform backend | None | Approves addresses to hold PLUSD |
| Guardian | Multisig | None | Cancels scheduled calls of operational roles |
| Pauser | Multisig | None | Pauses contracts |
| Upgrader | Multisig | None | Upgrades contracts |
| Security Agent | The Security Agent | None | Writes and attests security records |
| Inspection operator | The lending vehicle | None | Enters inspections; a second operator approves each one |

The mint role on PLUSD is held by two contracts: the deposit manager and the minter. No person holds it.

## Admin

#### Powers

- Grants and revokes every role
- Unpauses contracts
- Sets deposit and mint limits, custody accounts, the treasury and the voucher signer
- Sets the one-time recovery rate on the withdrawal queue
- Cancels any scheduled call

#### Powers it does NOT have

- Cannot pause, upgrade, or take loan, cash or default actions directly. It can, however, grant itself any of those roles.

#### Composition

Multisig.

#### Tempo

No delay. The access manager refuses an Admin holder with a delay.

## Risk Council

#### Powers

- Declares default, cures, writes down and closes defaulted loans
- Amends loan economics and adjusts interest
- Reverses disbursements and repayments and corrects the vault's accounting

#### Powers it does NOT have

- No upgrade authority
- No role-grant authority
- Cannot pause
- Cannot move custody funds

#### Composition

Multisig of several people. See [Risk Council](/governance/risk-committee/).

#### Tempo

Declaring a default and reversing a repayment run without a delay. Every other call waits 24 hours. The Guardian or the Admin can cancel during the wait.

## Guardian

#### Powers

- Cancels a scheduled call of an operational role during its delay

#### Powers it does NOT have

- Cannot grant or revoke roles
- Cannot pause or unpause
- Cannot upgrade
- Cannot move funds

#### Composition

Multisig.

#### Tempo

Instant. Each cancellation is recorded on-chain.

## Signer-set rotation

The Admin changes a role holder by revoking the old holder and granting the new one. The contracts do not check that different roles are held by different people.
