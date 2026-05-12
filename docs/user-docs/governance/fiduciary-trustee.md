---
title: Fiduciary trustee
order: 25
section: Governance
---

# Fiduciary trustee

Independent legal entity that performs every action the Pipeline Team cannot perform alone.

## Role

Without the Trustee's signature, no USDC moves. Without the Trustee's co-signature, no yield mints. Without the Trustee's on-ramping instruction, no offtaker repayment lands as USDC.

## Operational responsibilities

- Holds one cosigner share on each MPC wallet (Capital, Treasury, Withdrawal Queue)
- Second signer on every YieldAttestation alongside the Relayer
- Receives offtaker repayment wires through its correspondent account
- Instructs USD → USDC on-ramping via the Payment Agent (Circle Mint)
- Sells USYC against the Hashnote redemption rail to realise T-bill yield
- Tops up the Withdrawal Queue Wallet against the queue's outstanding obligations
- Records loan repayments on LoanRegistry

## Independence

The Trustee is operationally and beneficially independent from the Pipeline Team. It cannot act under direction of the Team in matters affecting investor assets. The 3-of-5 cosigner topology means no Team-only quorum exists — Trustee participation is required on every transfer.

## Mapping to the legal stack

On the docs, "Trustee" is operational shorthand. The actual entities:

- **The Trust Company** — governance, custody quorum, USD account.
- **Trade Company (Cayman SPC)** — lender of record; receives offtaker wires; instructs on-ramping.
- **Collateral Trust (BVI)** — pledged collateral and enforcement.

Full hierarchy on the [Legal structure](/how-it-works/legal-structure/) page.

## Why a fiduciary trustee, not a contract

Three reasons. Legal — physical-cargo trade finance requires a legal entity that signs loan documents, receives wires, holds collateral, acts in court. A contract cannot. Operational — banking rails and Hashnote redemptions require a regulated counterparty with KYC and a correspondent relationship. Architectural — splitting the lever between operating team and independent fiduciary means a bug in on-chain code cannot drain capital.
