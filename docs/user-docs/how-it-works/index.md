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

A backend service, the relayer, connects the off-chain world to the protocol layer. The Independent Trustee, a licensed trust company, signs loan and cash operations on-chain through the Trustee role.

{% include diagram.html src="boss-system-architecture.png" caption="Pipeline architecture — origination layer and relayer off-chain, the protocol layer on-chain, the capital layer of custody accounts and the USD bank account. Every privileged call goes through the access manager." %}

<div class="callout safety">
Smart contracts hold no USDC. The only contract that can move USDC out of custody is the withdrawal queue, and only up to the allowance the withdrawal account has set.
</div>

## Origination layer

*Facilitates loan origination and underwriting.*

This layer onboards Loan Originators: established lenders in commodity trade finance, including private credit funds, with their own underwriting and borrower networks. The Originator sources and underwrites each deal and lends a minimum of 5–20% of it alongside the pool, on the same terms.

Before submitting deals, each Originator passes KYB and KYT, AML and sanctions checks, and a review of its audited financials and track record, and signs the master facility agreement. Every party to a deal passes KYB, AML and sanctions checks. Pipeline screens each deal against the Credit Policy. The Risk Council approves each facility, then the lending vehicle's independent director.

## Capital layer

*Handles all operations with principal.*

It has three custody accounts, each an MPC wallet with a 3-of-5 quorum in which the Independent Trustee holds a mandatory key. The deposit account receives lender USDC. The withdrawal account pays lender withdrawals. The capital wallet receives protocol fees.

A USD bank account handles fiat operations: lender wires in and out, drawdowns into borrowers' collection accounts and receipts from them, and conversion between USD and USDC. The Independent Trustee co-signs every payment out of it. Lenders who wire USD pass KYC or KYB first.

The protocol keeps a cash book of the bank account. Every bank movement that changes the pool is recorded on-chain.

## Protocol layer

*Implements all on-chain smart contracts.*

It issues PLUSD and sPLUSD as the lender-facing tokens. Each facility has a participation contract that holds its terms and its lenders' shares: the lending vehicle's, for the pool, and the Originator's. Together they form the public loan book. The security registry records the security behind each facility. The operational contracts are the deposit manager, the minter, the withdrawal queue, the pocket for defaulted loans and the access manager.

## Relayer

*Off-chain backend.*

The relayer indexes on-chain events. It runs KYT on lender addresses, deposits and withdrawal requests for sanctions and illicit funds. It approves screened addresses to hold PLUSD. It signs the vouchers that release a deposit or a withdrawal. It matches bank wires to their on-chain records by reference.

The relayer holds no custody. It cannot mint PLUSD on its own: a deposit mint needs a real USDC deposit, and the other mints need the cash reporter role. It cannot move USDC out of custody.

## Operators and governance

Operators do continuous work: deposits, withdrawals, wires, loan servicing. Operators are the holders of the custody accounts, the relayer, and the holders of the operational roles: the Independent Trustee (Trustee role), the cash reporter, the Security Agent and the inspection operators.

Governance handles privileged events: role grants, defaults, write-downs, upgrades. Every privileged call goes through the access manager, which maps each action to a role.

| Role | Powers | Delay |
|---|---|---|
| Admin | Grants and revokes roles, sets limits and accounts, unpauses, sets the withdrawal recovery rate | None |
| Risk Council | Approves facilities, declares default, reverses repayment entries | None |
| Risk Council | Writes down, cures, amends loan terms, reverses other entries | 24 hours |
| Guardian | Cancels a scheduled call of a guarded role | None |
| Pauser | Pauses a contract | None |
| Upgrader | Upgrades a contract | None |

Each role is held separately. Governance roles are held by multisigs. The Risk Council role is held by the Risk Council's multisig of three voting members. The cash reporter role is held by a 2-of-2 multisig. In lender decisions under the master facility agreement, the Risk Council casts the lending vehicle's vote and the Originator votes its own share.
