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
| [lp-onboarding.md](./lp-onboarding.md) | LP Onboarding & Compliance | KYT screening, three whitelist enrolment paths, freshness window, manual review |
| [kyb-lp-verification.md](./kyb-lp-verification.md) | LP Onboarding & Compliance | KYB entity registration, document review lifecycle, notifications, settlement address |
| [deposits.md](./deposits.md) | Deposits & PLUSD Minting | EVM `requestDeposit` / `claimDeposit` (voucher-gated, deployed `hoodi-v5`), Stellar mint leg; designed Intake Wallet ticket model marked not deployed |
| [evm-requests-queue.md](./evm-requests-queue.md) | Deposits & PLUSD Minting | Deployed EVM VerifiedRequestsQueue: DepositManager, WithdrawalQueue, `VerifiedRequests` EIP-712 voucher, rate limiter, voucher API |
| [staking.md](./staking.md) | Staking (sPLUSD) | ERC-4626 vault, stake/unstake, open access model |
| [loans.md](./loans.md) | Loan Management | LoanRegistry, origination, lifecycle, location tracking |
| [loans-data.md](./loans-data.md) | Loan Management | API contract, data model, events, security considerations |
| [yield.md](./yield.md) | Yield Distribution | Repayment waterfall, USYC NAV accrual, weekly distribution |
| [book-rate-weighting.md](./book-rate-weighting.md) | Yield Distribution | Outstanding-senior weighting of book rate and tenor across loan book, dashboard and yield series |
| [yield-apy-semantics.md](./yield-apy-semantics.md) | Yield Distribution | Definitions of `/v1/pnl` avg_apy, `/v1/stats` apy, per-loan minted yield and dashboard cumulative LP yield; amounts-0 / rates-null convention |
| [loan-status-timeline.md](./loan-status-timeline.md) | Loans | One status-timeline rule for active, at-risk and accrual across loan book, dashboard, financial position, capital allocation and yield series |
| [withdrawals.md](./withdrawals.md) | Withdrawals | EVM `requestWithdrawal` / `claimWithdrawal` (voucher-gated, FIFO-funded), Treasury redemption; designed attestation queue marked not deployed |
| [smart-contracts.md](./smart-contracts.md) | Smart Contracts | Overview, governance, contracts table, security considerations, actor glossary |
| [smart-contracts-interfaces.md](./smart-contracts-interfaces.md) | Smart Contracts | PLUSD, YieldMinter, sPLUSD, WhitelistRegistry interfaces; designed (not deployed) DepositManager and WithdrawalQueue |
| [smart-contracts-registry.md](./smart-contracts-registry.md) | Smart Contracts | LoanRegistry, ShutdownController interfaces, Shutdown Mode, data models |
| [smart-contracts-operations.md](./smart-contracts-operations.md) | Smart Contracts | Role assignments, upgradeability, emergency response, deferred features |
| [security.md](./security.md) | Security & Threat Model | Threat model, peer comparison, known properties, accepted trust assumptions, internal rug containment |
| [security-defenses.md](./security-defenses.md) | Security & Threat Model | MVP defence stack, timelock action table, pause cascade, cross-rail sequence integrity |
| [relayer-service.md](./relayer-service.md) | Relayer Service | Event listening, MPC auto-signing, minting, USYC rebalancing, role assignments, security |
| [relayer-service-internals.md](./relayer-service-internals.md) | Relayer Service | Service decomposition architecture, blast radius analysis |
| [api-authorization-email.md](./api-authorization-email.md) | API Authorization | LP self-serve email/password signup, OTP verification, Turnstile bot defense |
| [api-authorization-password-reset.md](./api-authorization-password-reset.md) | API Authorization | Forgot/reset password by single-use emailed link, session cut-off on reset |
| [operations-console.md](./operations-console.md) | Operations Console | Overview, shared operator authentication and account lifecycle |
| [operations-console-team.md](./operations-console-team.md) | Operations Console | Team view, Originator view, security considerations |
| [trustee-dashboard.md](./trustee-dashboard.md) | Operations Console | Trustee dashboard technical-assignment spec: business flows by signing rail, data layer, API contracts |
| [trustee-risk-watchlist.md](./trustee-risk-watchlist.md) | Operations Console | Trustee risk/watchlist behavior: CCR color bands, manual Watchlist, Past Due lock + confirm, return to Performing, escalation proposal builder |
| [collateral-valuation.md](./collateral-valuation.md) | Collateral Valuation | Price sources and feed budget, standard-goods and NSR concentrate valuation modes, off-chain valuation record, CCR derivation |
| [price-feed.md](./price-feed.md) | Price Feed & Notifications | CCR monitoring, threshold alerts, notification dispatch |
| [dashboards.md](./dashboards.md) | Dashboards | LP dashboard + 4-panel Protocol dashboard |
| [dashboards-tvl-ledger.md](./dashboards-tvl-ledger.md) | Dashboards | TVL definition: PLUSD supply ledger (mint / burn paths, pending deposits, carve-out), per chain and summed |
| [dashboards-balance-sheet-sources.md](./dashboards-balance-sheet-sources.md) | Dashboards | Protocol Dashboard Panel A on-chain sources: Stellar and EVM PLUSD supply / USDC custody reads |
| [dashboards-yield-history.md](./dashboards-yield-history.md) | Dashboards | Protocol Dashboard Panel D: yield history, T-bill accrual, exchange rate, trailing yield |
| [home-screen-states.md](./home-screen-states.md) | Dashboards | LP home route (`/`) state table and precedence rule (epic #1419) |
| [audit-logging.md](./audit-logging.md) | Audit Logging | Append-only log, third-party sink, compliance traceability |
| [api-authorization.md](./api-authorization.md) | API Authorization | Signature-based login (EVM EIP-191 + Stellar SEP-0053), single-use nonce, ES256 JWT, allow-list & roles |
