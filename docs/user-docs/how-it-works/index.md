---
title: Overview
order: 6
section: How Pipeline works
---

# Overview

Pipeline has three layers:

- An off-chain origination layer that sources and underwrites trade loans.
- A capital layer of custody accounts and a USD bank account that hold principal and fund trades.
- An on-chain protocol layer that issues lender tokens and records every loan and its security.

A backend service, the relayer, connects the off-chain world to the protocol layer. Pipeline's Trustee runs the lending vehicle, loans and cash operations through the Trustee role.

{% include diagram.html src="boss-system-architecture.png" caption="Pipeline architecture — origination layer and relayer off-chain, the protocol layer on-chain, the capital layer of custody accounts and the USD bank account. Every privileged call goes through the access manager." %}

<div class="callout safety">
Smart contracts hold no USDC. The only contract that can move USDC out of custody is the withdrawal queue, and only up to the allowance the withdrawal account has set.
</div>

## Origination layer

*Facilitates loan origination and underwriting.*

This layer onboards qualified Originators. These are commodity trade finance experts, including private credit funds, with their own borrower networks. Originators structure deals, contribute the equity tranche (first-loss capital, up to 30%), and stand as merchant of record on the underlying trade. Pipeline provides senior capital.

Each Originator clears KYB and KYT, audited financials, track record review, sanctions and AML, and signs the facility agreement before submitting deals. Every counterparty on a deal passes KYB and KYT.

## Capital Layer

*Handles all operations with principal.*

It has three custody accounts. The deposit account receives lender USDC. The withdrawal account pays lender withdrawals. The capital wallet holds the loan records and the per-loan debt tokens, and receives protocol fees.

A USD bank account managed by the Trustee handles fiat operations: lender wires in and out, loan disbursements, borrower and offtaker repayments, and conversion between USD and USDC.

The protocol keeps a cash book of the bank account. Every bank movement that changes the pool is recorded on-chain.

## Protocol Layer

*Implements all on-chain smart contracts.*

It issues PLUSD and sPLUSD as the lender-facing tokens. The loan registry is the public loan book. The security registry records the security behind each loan. The operational contracts are the deposit manager, the minter, the withdrawal queue, the pocket for defaulted loans, the debt token factory and the access manager.

## Relayer

*Off-chain backend.*

The relayer indexes on-chain events. Every lender passes KYB. The relayer runs KYT on lender addresses and deposits for sanctions and illicit funds. It approves screened addresses to hold PLUSD. It signs the vouchers that release a deposit or a withdrawal. It matches bank wires to their on-chain records by reference.

The relayer holds no custody. It cannot mint PLUSD on its own: a deposit mint needs a real USDC deposit, and the other mints need the cash reporter role. It cannot move USDC out of custody.

## Operators and governance

Operators do continuous work: deposits, withdrawals, wires, loan servicing. Operators are the holders of the custody accounts, the relayer, and the holders of the operational roles: Trustee, cash reporter, Security Agent and inspection operators.

Governance handles privileged events: role grants, defaults, write-downs, upgrades. Every privileged call goes through the access manager, which maps each action to a role.

| Role | Powers | Delay |
|---|---|---|
| Admin | Grants and revokes roles, sets limits and accounts, unpauses, sets the withdrawal recovery rate | None |
| Risk Council | Declares default, reverses repayment entries | None |
| Risk Council | Writes down, cures, amends loan terms, reverses other entries | 24 hours |
| Guardian | Cancels a scheduled call of a guarded role | None |
| Pauser | Pauses a contract | None |
| Upgrader | Upgrades a contract | None |

Each role is held separately. Governance roles are held by multisigs. The Risk Council role is held by a multisig of several people. The cash reporter role is held by a 2-of-2 multisig. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.
