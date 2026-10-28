---
title: Audits & addresses
order: 23
section: Technical overview
---

# Audits & addresses

This page lists deployed contract addresses, third-party audits, formal verification status, and live-data dashboards for the Pipeline protocol. Contract addresses: to be published.

## Deployed contract addresses

| Contract | Role | Address | Explorer |
|---|---|---|---|
| Access manager | Role hub, delayed-call scheduler | *To be published* | — |
| PLUSD | Permissioned dollar token | *To be published* | — |
| sPLUSD | Staking vault share over PLUSD | *To be published* | — |
| Deposit manager | USDC deposit with voucher-gated claim | *To be published* | — |
| Withdrawal queue | First-in, first-out withdrawal queue | *To be published* | — |
| Minter | Cash book; PLUSD mints for wires, interest and fees | *To be published* | — |
| Loan registry | One non-transferable record per loan | *To be published* | — |
| Security registry | Collateral records per loan | *To be published* | — |
| Debt token factory | One debt token per loan | *To be published* | — |
| Pocket | Holds defaulted loans' PLUSD for sPLUSD holders | *To be published* | — |

Verify addresses against this page before any on-chain interaction. Third-party pages showing addresses are not a source of truth.

## Third-party audits

An independent security audit is in progress. The report will be published when it is complete.

## Formal verification

No formal verification results are published.

## Live data

A Protocol Dashboard will publish pool state and queue depth. Link: *URL to be published*. Until then, the authoritative state lives on-chain and can be read at the addresses above.

## Bug bounty

A public bug bounty will be established. Scope, payout tiers, and the submission process will appear here. Until then, security reports can be sent to *security contact — to be published*.

---

See also:

- [Custody](/security/custody/)
- [Capital safeguards](/security/capital-safeguards/)
- [Emergency response](/security/emergency-response/)
