---
title: Audits & addresses
order: 17
section: Security & Transparency
---

This page lists deployed contract addresses, third-party audits, formal verification status, and live-data dashboards for the Pipeline protocol. Contracts are not yet deployed to mainnet; this page lists placeholders today and will be updated at launch.

## Deployed contract addresses

| Contract | Role | Address | Etherscan |
|---|---|---|---|
| AccessManager | Role hub, timelock scheduler | *Deployed at launch* | — |
| PLUSD | ERC-20 receipt token | *Deployed at launch* | — |
| DepositManager | Atomic deposit entry | *Deployed at launch* | — |
| sPLUSD | ERC-4626 yield vault | *Deployed at launch* | — |
| WhitelistRegistry | KYC + venue allowlist | *Deployed at launch* | — |
| WithdrawalQueue | FIFO withdrawal queue | *Deployed at launch* | — |
| LoanRegistry | Soulbound loan NFT registry | *Deployed at launch* | — |
| ShutdownController | Terminal wind-down switch | *Deployed at launch* | — |
| RecoveryPool | Post-shutdown USDC escrow | *Deployed at launch* | — |

Each address will be verified on Etherscan at deployment. Verify addresses against this page before any on-chain interaction. Third-party URLs displaying addresses are not a source of truth.

## Third-party audits

| Auditor | Scope | Report date | Report link |
|---|---|---|---|
| *Pending engagement* | — | — | — |

Audit engagements will appear here with their full reports. Pre-audit, assume the custom code surface has not yet been externally reviewed and treat this protocol as pre-audit.

## Formal verification

Formal verification scope is being scoped for the mint-path invariants: reserve counters, supply caps, and shutdown gates. The target is to publish the specification and proofs on this page before mainnet launch. If not available at launch, this section will be marked as deferred with a revised target date.

## Live data

A Protocol Dashboard publishes reserve composition, cumulative counters, and queue depth in real time. Link: *URL to be published at launch*. Until the dashboard is live, the authoritative real-time state lives on-chain — readable via any Ethereum RPC node using the addresses above.

## Bug bounty

A public bug bounty will be established before mainnet. Scope, payout tiers, and the submission process will appear here. Until then, security reports can be sent to *security contact — to be published*.

---

See also:

- [Custody](/pipeline/security/custody/)
- [Supply safeguards](/pipeline/security/supply-safeguards/)
- [Emergency response](/pipeline/security/emergency-response/)
