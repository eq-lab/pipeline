---
title: Overview
order: 6
section: How Pipeline works
---

# Overview

Pipeline comprises three layers working in concert:

- An off-chain origination layer that sources and underwrites trade loans.
- A segregated capital layer that holds principal and funds trades.
- An on-chain protocol layer that tokenises lender claims and tracks every loan publicly.

A relayer lets the capital layer talk to the protocol layer. A fiduciary trustee manages lender assets and commodity collateral through a dedicated trust structure, co-signs every privileged action, and acts independently of the Pipeline team.

{% include diagram.html src="boss-system-architecture.png" caption="Pipeline architecture — origination, capital, and protocol layers connected by the relayer, under fiduciary trustee oversight." %}

<div class="callout safety">
A bug or exploit in on-chain code cannot drain lender capital unilaterally.
</div>

## Origination layer

*Facilitates loan origination and underwriting.*

This layer onboards qualified Originators — commodity trade finance experts (including private credit funds) with their own borrower networks. Originators structure deals, contribute the equity tranche (first-loss capital, up to 30%), and stand as merchant of record on the underlying trade. Pipeline provides senior capital.

Each Originator clears KYC, audited financials, track record review, sanctions and AML, and signs the facility agreement before submitting deals.

## Capital Layer

*Securely handles all operations with principal.*

It includes four on-chain accounts in the institutional BitGo custody: Intake Wallet (holds USDC deposits pending KYT), Capital Wallet (lender USDC + USYC reserve), Withdrawal Queue Wallet (queued withdrawals), and Treasury Wallet (protocol fees).

Another important component of the capital layer is a USD bank account managed by the Trustee for fiat operations: loan disbursements, offtaker wires, on-ramping.

No protocol contract can spend funds from any of these wallets — every movement is gated by a 3-of-5 cosigner quorum.

## Protocol Layer

*Implements all on-chain smart contracts.*

It implements PLUSD and sPLUSD as the lender-facing tokens and LoanRegistry as the public loan book. Also, this layer runs the operational contracts — DepositManager, YieldMinter, WithdrawalQueue, WhitelistRegistry, and AccessManager. Plus the dormant Recovery System (ShutdownController, RecoveryPool).

## Relayer

*Off-chain backend.*

It indexes on-chain events, co-signs YieldAttestations alongside the Trustee (neither can mint alone), and signs KYT attestations off-chain that the lender or address holder submits at claim or enrol time. The Relayer holds no custody and cannot mint PLUSD alone (all mints double-validated on smart contracts). Neither can it move USDC out of the capital layer. The only on-chain role the Relayer holds is `WHITELIST_REVOKER` for fast sanctions response.

The hardware circuit breaker that disconnects the Capital Layer from the protocol contracts is a custody-side action triggered by the Trustee and Team under the BitGo cosigner policy. The Relayer raises the alarm; the cosigner quorum pulls the lever.

## Operators and governance

Operators do continuous work — every block, every withdrawal. Operators are the cosigners on each MPC wallet of the capital layer, the Relayer, and contract role-holders. Initially appointed operators are the Trustee, Pipeline Team, and two external reliable counterparties.

Governance handles privileged events — role grants, defaults, shutdowns. Both interact with the protocol from the outside; neither has unilateral control. At the initial development stage, governance is three MPCs — ADMIN (3/5, 3-day timelock standard, 7-day for upgrades), RISK_COUNCIL (3/5, 3-day timelock), GUARDIAN (2/5, instant) — with distinct signer sets and non-overlapping powers. A 14-day meta-timelock gates the delay parameter itself. Defensive action is fast; constructive action is slow.
