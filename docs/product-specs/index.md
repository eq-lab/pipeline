# Product Specs Index

> Looking for user-facing documentation? See the [Pipeline user docs](https://eq-lab.github.io/pipeline/) — plain-English intro for lenders, borrowers, and reviewers. This directory is the technical source of truth those docs are built from.

Use this directory for feature and product requirement documents.

## How to write a product spec

- **Frame as behavior** — describe what the feature does, not what tasks need to be done to build it. Use present tense ("the relayer mints PLUSD", not "implement PLUSD minting").
- **Include implementation details only when they define behavior** — data models, role assignments, threshold values, and interface contracts belong here when they directly determine how the system behaves. Code-level implementation choices (data structures, algorithms, library versions) belong in exec plans.
- **Describe current behavior only** — no change history, no migration notes, no references to previous versions.
- **One spec per feature** — each file covers a single coherent domain. Cross-references are fine; duplication is not.
- **Keep it short** — target under 150 lines; hard limit is 200 lines.
- **No acceptance criteria** — acceptance criteria belong in `user-stories.md` only, not in feature specs.

Typical sections: **Overview** → **Behavior** → **API Contract** → **Data Model** → **Security**

---

## Current entries

| Spec | Domain | Description |
|------|--------|-------------|
| [lp-onboarding.md](./lp-onboarding.md) | LP Onboarding & Compliance | KYC/KYB, Chainalysis screening, whitelist, re-screening |
| [deposits.md](./deposits.md) | Deposits & PLUSD Minting | USDC → PLUSD flow, rate limiting, deposit queue |
| [staking.md](./staking.md) | Staking (sPLUSD) | ERC-4626 vault, stake/unstake, open access model |
| [loans.md](./loans.md) | Loan Management | LoanRegistry, origination, lifecycle, location tracking |
| [loans-data.md](./loans-data.md) | Loan Management | API contract, data model, events, security considerations |
| [yield.md](./yield.md) | Yield Distribution | Repayment waterfall, USYC NAV accrual, weekly distribution |
| [withdrawals.md](./withdrawals.md) | Withdrawals | FIFO queue, partial fills, automated payout, Treasury redemption |
| [smart-contracts.md](./smart-contracts.md) | Smart Contracts | Overview, governance, contracts table, security considerations, actor glossary |
| [smart-contracts-interfaces.md](./smart-contracts-interfaces.md) | Smart Contracts | PLUSD, DepositManager, YieldMinter, sPLUSD, WhitelistRegistry, WithdrawalQueue interfaces |
| [smart-contracts-registry.md](./smart-contracts-registry.md) | Smart Contracts | LoanRegistry, ShutdownController interfaces, Shutdown Mode, data models |
| [smart-contracts-operations.md](./smart-contracts-operations.md) | Smart Contracts | Role assignments, upgradeability, emergency response, deferred features |
| [security.md](./security.md) | Security & Threat Model | Threat model, peer comparison, known properties, accepted trust assumptions, internal rug containment |
| [security-defenses.md](./security-defenses.md) | Security & Threat Model | MVP defence stack, timelock action table, pause cascade, cross-rail sequence integrity |
| [relayer-service.md](./relayer-service.md) | Relayer Service | Event listening, MPC auto-signing, minting, USYC rebalancing, role assignments, security |
| [relayer-service-internals.md](./relayer-service-internals.md) | Relayer Service | Service decomposition architecture, blast radius analysis |
| [operations-console.md](./operations-console.md) | Operations Console | Overview, authentication, Trustee view |
| [operations-console-team.md](./operations-console-team.md) | Operations Console | Team view, Originator view, security considerations |
| [price-feed.md](./price-feed.md) | Price Feed & Notifications | CCR monitoring, threshold alerts, notification dispatch |
| [dashboards.md](./dashboards.md) | Dashboards | LP dashboard + 4-panel Protocol dashboard |
| [audit-logging.md](./audit-logging.md) | Audit Logging | Append-only log, third-party sink, compliance traceability |
