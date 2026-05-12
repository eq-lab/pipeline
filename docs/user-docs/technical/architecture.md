---
title: Technical architecture
order: 20
section: Technical overview
---

# Technical architecture

For engineers and auditors. Off-chain custody, on-chain protocol, off-chain relayer, on-chain governance. Every privileged call routes through one AccessManager.

## Layers and components

### Capital Layer

BitGo institutional custody. Four wallets:

- **Intake Wallet** — USDC deposits pending KYT
- **Capital Wallet** — lender USDC plus USYC reserve (15% USDC buffer, 10–20% band)
- **Treasury Wallet** — protocol fees
- **Withdrawal Queue Wallet** — USDC for queued withdrawals

Each wallet under identical 5-share, 3-of-5 cosigner topology (Trustee, Pipeline Team x2, External Counterparties x2).

A USD bank account in the Trustee's name for offtaker wires and on/off-ramping.

### Protocol Layer

- Tokens: PLUSD (ERC-20), sPLUSD (ERC-4626).
- Registry: LoanRegistry (ERC-721).
- Operational contracts: DepositManager, YieldMinter, WithdrawalQueue, WhitelistRegistry.
- Role hub: AccessManager (OZ v5).
- Recovery: ShutdownController, RecoveryPool (dormant).

### Origination Layer

Off-chain backend used by onboarded Originators to submit and manage deals. Components:

- **Sumsub integration** — KYB/KYC for new Originators, borrowers, offtakers, and CMA providers. Originators submit counterparty packs through the Originator UI; results flow into the underwriting record attached to each deal.
- **CTRM integration** — vessel tracking and cargo monitoring (Kpler primary, secondary feeds per deal). CTRM data drives the daily LTV refresh and triggers margin-call events when thresholds breach.
- **Originator UI** — the front end Originators use to upload loan information (term sheet, counterparty pack, security package, hedging plan), track approval status, monitor live facilities, and manage their equity stake across deals.

The layer holds no custody and writes no on-chain state directly — approved deals reach the Protocol Layer via the Risk committee's RISK_COUNCIL Safe.

### Governance Layer

Three MPCs with distinct signer sets:

- **ADMIN** — 3-of-5, 3-day timelock (7-day for upgrades, 14-day meta-timelock on the delay parameter) — role grants, unpauses, upgrades, parameter changes, attestor rotation
- **RISK_COUNCIL** — 3-of-5, 3-day timelock — `setDefault`, write-down closures, exchange-coefficient changes on WithdrawalQueue
- **GUARDIAN** — 2-of-5, instant — pause, cancel pending actions, revoke operational-role holders one at a time

### Relayer

Pipeline backend connecting the Capital Layer and the Protocol Layer. Indexes events, co-signs YieldAttestations alongside the Trustee, and signs KYT attestations off-chain that the lender or address holder submits at claim or enrol time. Holds no custody share. Cannot mint PLUSD alone. On lender withdrawal claims, the lender (not the Relayer) calls `WithdrawalQueue.claim`; the queue contract pulls USDC from the Withdrawal Queue Wallet via the wallet's standing allowance. The Relayer's only on-chain role is `WHITELIST_REVOKER`.

{% include diagram.html src="boss-system-architecture.png" caption="Technical architecture — capital, relayer, protocol, and origination layers, with governance routed through AccessManager." %}

## Trust assumptions, summarised

| Assumption | Mitigation if it fails |
|---|---|
| **Trustee key uncompromised** | Single Trustee key cannot move funds (3-of-5 requires Team co-sign). Compromise blocks operations but does not enable theft. |
| **Pipeline Team keys uncompromised** | Team alone cannot move funds (Trustee + at least one external required). Compromise blocks operations but does not enable theft. |
| **BitGo policy enforcement uncompromised** | External counterparty cosigners provide an independent check. BitGo cannot pull the hardware circuit breaker. |
| **Relayer uncompromised** | Cannot mint PLUSD alone. Cannot move funds out of Capital or Treasury Wallets. Worst case: denial of service on yield mints and whitelist writes. GUARDIAN revokes instantly. |
| **Smart contracts bug-free** | Off-chain custody isolation — bugs cannot drain Capital Layer dollars. WithdrawalQueue exchange coefficient is the deterministic recovery mechanism in MVP. |
| **Governance Safes uncompromised** | Distinct signer sets, timelocks, and meta-timelocks. Defensive lever (GUARDIAN) is fast; constructive lever (ADMIN) is slow. |
