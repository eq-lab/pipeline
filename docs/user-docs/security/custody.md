---
title: Custody
order: 30
section: Security & Transparency
---

# Custody

Lender USDC sits in BitGo institutional custody, never inside a smart contract. Four wallets, one cosigner topology, hardware circuit breaker.

## Four wallets, one topology

| Wallet | Holds | Funded by | Drawn for |
|---|---|---|---|
| **Intake Wallet** | USDC pending KYT | Lender deposits | Pending KYT or refund if failing checks |
| **Capital Wallet** | Lender USDC + USYC reserve | Lender KYT-cleared deposits, offtaker repayments, USYC sales | Loan originations, Withdrawal Queue Wallet top-ups, USYC purchases |
| **Treasury Wallet** | Protocol fees | Yield mint fee allocations | Operating expenses, OET runway |
| **Withdrawal Queue Wallet** | USDC for queued withdrawals | Periodic top-ups from Capital Wallet | Lender claims (via WithdrawalQueue contract pre-approved allowance) |

## Cosigner topology

Identical across all four wallets. Five shares, 3-of-5 threshold:

- Pipeline Team — two shares
- Trustee (The Trust Company) — one share
- External Counterparties — two shares (one each)

Hard policy rule: no transfer signs without both Team and Trustee. A Team-only or Trustee-only quorum is impossible.

## Why MPC, not multisig

MPC means no single share is ever a complete signing key. Compromising one cosigner reveals nothing — they would have shared a piece, but the piece is meaningless without three other valid pieces in the protocol. Stronger than a smart-contract multisig where every signer's key is a complete on-chain credential, and where on-chain coordination patterns can be observed and front-run.

## Hardware circuit breaker

Custody policy carries a hardware circuit breaker that disconnects the Capital Wallet and the Withdrawal Queue Wallet from the protocol contracts on alarm. Pre-approved allowances revoked, all standing transfer authorisations frozen. The breaker is a custody-side action: it does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever. The Trustee and Team execute it under the BitGo cosigner policy. The Relayer raises the alarm but does not pull the lever itself. See [Relayer security model](/technical/relayer-security/).

## Cosigner-policy attestations

BitGo publishes attestation logs of every cosigner-policy event. Pipeline publishes a digest on a fixed cadence as part of the dashboard transparency layer.
