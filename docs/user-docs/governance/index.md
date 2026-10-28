---
title: Overview
order: 24
section: Governance
---

# Overview

Governance has an off-chain side and an on-chain side. Off-chain, the Trustee runs the loans and the bank account, and the Risk Council takes credit decisions. On-chain, every privileged action goes through the access manager. The access manager maps each action to a role and checks the caller's role before it runs.

## The four governance surfaces

| Body | Type | Function |
|---|---|---|
| Fiduciary trustee | Off-chain legal entity | Opens and services loans, books cash movements between the bank and the protocol, settles bank withdrawals. On-chain role: Trustee. |
| Risk Council | Credit body, a multisig of several people | Declares default, writes down, cures, amends loan terms, reverses wrong entries. On-chain role: Risk Council. Acts for the Majority Lenders while Pipeline is the only lender. |
| Protocol roles | On-chain roles | Admin, Guardian, Pauser, Upgrader. They manage roles, parameters, pauses and upgrades. |
| Operators | Off-chain staff and the platform backend | Book bank wires and repayments (Cash reporter), approve token holders (Whitelist admin), screen addresses and sign deposit and withdrawal vouchers (platform backend). |

## On-chain surface

| Role | Delay | Powers |
|---|---|---|
| Admin | None. The access manager refuses an admin with a delay. | Grants and revokes roles, unpauses, sets limits, custody accounts, the voucher signer and the treasury, sets the one-time recovery rate on the withdrawal queue |
| Risk Council | None for default and for reversing a repayment; 24 hours for everything else | Default, write-down, cure, closing a defaulted loan, amending loan economics, adjusting interest, reversing disbursements and repayments, accounting corrections |
| Guardian | None | Cancels a scheduled call of an operational role during its delay |
| Pauser | None | Pauses a contract |
| Upgrader | None | Upgrades a contract |

The Pauser stops a contract. Only the Admin starts it again. The Guardian can cancel a delayed Risk Council action while its 24 hours run.

## Distinct signer sets

Each role is held by its own signer set. The Admin, Guardian, Pauser and Upgrader roles are held by multisigs. The Risk Council is a multisig of several people. The Cash reporter is a 2-of-2 multisig. The contracts do not check that roles are held by different people.

## Delays

Each role holder has an execution delay. A holder with a delay schedules a call, waits, then executes it. The Risk Council delay is 24 hours. Declaring a default and reversing a repayment run without a delay. Other roles run without a delay. The Admin role cannot carry a delay, so Admin changes take effect at once.
