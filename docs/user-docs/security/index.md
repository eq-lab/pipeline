---
title: Overview
order: 28
section: Security & Transparency
---

# Overview

Four mechanisms protect lender capital. Overcollateralization and equity tranche absorb first loss. Institutional custody isolates principal from contract risk. Split-rail architecture means a contract bug cannot drain Capital Layer USDC. Terminal mode is deterministic if invoked.

## Security model in one diagram

{% include diagram.html src="boss-loss-defense.jpeg" caption="Layered protection. Credit losses absorb through overcollateralization, equity tranche, and contingent loss layers before reaching lender capital. Contract exploits face split-rail architecture, hardware circuit breaker, and institutional custody." %}

## Protection mechanisms

- Overcollateralization — 20% haircut
- Equity tranche — first-loss capital from the Originator on every loan. See [Investor protection](/security/investor-protection/).
- Custody — institutional MPC under 3-of-5 quorum across four wallets. See [Custody](/security/custody/).
- Capital safeguards — reserve invariants, two-step screened deposits, two-party yield mints, rate limits. See [Capital safeguards](/security/capital-safeguards/).
- Emergency response — incident playbook, GUARDIAN powers, hardware circuit breaker. See [Emergency response](/security/emergency-response/).

## Transparency

Every loan on a public on-chain registry. Every yield mint on-chain. Every governance action through AccessManager with publicly inspectable timelocks. Capital, Treasury, and Withdrawal Queue Wallet addresses published. Drift between PLUSD `totalSupply` and Capital Layer mark-to-market published as a Green / Amber / Red indicator with action thresholds.
