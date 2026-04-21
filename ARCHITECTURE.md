# ARCHITECTURE

## Overview

Pipeline is a decentralised commodity trade finance protocol. The system is split into two rails:

- **Cash rail** — real USDC and USYC held in two MPC wallets (Capital Wallet, Treasury Wallet), never touched by smart contracts.
- **Token rail** — PLUSD and sPLUSD ERC-20/ERC-4626 tokens on Ethereum. On-chain state drives cash-rail actions via event-driven authorisation.

## Repository Layout

```
pipeline/
├── packages/
│   ├── frontend/          # React/TypeScript web app (LP dashboard + Operations Console)
│   ├── api/               # Rust REST API server (data access, session management)
│   └── worker/            # Rust background worker (bridge service, price feed, indexer)
├── contracts/             # Solidity smart contracts (Hardhat or Foundry project)
├── scripts/               # Repository tooling (doc linter, codegen)
├── docs/                  # All product, design, and operational documentation
└── .github/workflows/     # CI: lint, test
```

## Packages

### `packages/frontend`

React/TypeScript single-page application.

Two logical views served from the same app, gated by authenticated role:

- **LP dashboard** — wallet-connected view for LPs (deposit, stake, withdraw, yield history).
- **Operations Console** — role-gated back-office interface for Trustee, Team, and Originator operators.

**Entry point:** `packages/frontend/main.ts`
**Auth:** WalletConnect v2 / RainbowKit for LPs; email + password + 2FA for operators.
**Web3:** ethers.js for contract interactions; reads on-chain state via the API (which queries the internal indexer).
**Port:** 3000 (dev)

### `packages/api`

Rust REST API server. Serves data to the frontend.

Responsibilities:
- Expose read endpoints over LoanRegistry, WhitelistRegistry, PLUSD, sPLUSD, WithdrawalQueue state (sourced from internal indexer).
- Operator session management (email + password + 2FA, JWT or session tokens).
- Proxy authenticated requests to the worker (e.g., submit origination request, acknowledge alert).
- Serve reconciliation invariant status, withdrawal queue state, and yield history.

**Port:** 8080 (dev)

### `packages/worker`

Rust long-running background service. This is the bridge service described in the spec.

Responsibilities:
- On-chain event listener: USDC Transfer, WithdrawalRequested, LoanMinted, RepaymentSettled, TreasuryYieldDistributed.
- MPC auto-signing participant (Capital Wallet) for 4 scoped transaction categories.
- PLUSD MINTER, WithdrawalQueue FILLER, LoanRegistry loan_manager roles.
- WhitelistRegistry WHITELIST_ADMIN (KYC/screening writes).
- Deposit mint queue (FIFO, rebuilt from Transfer log delta on restart).
- USDC ↔ USYC automated rebalancing (target 15% USDC ratio, bands 10–20%).
- Weekly USYC NAV yield event pre-building (Thursday, ~17:00 ET).
- Price feed ingestion (Platts/Argus, ~15min polling), CCR computation, threshold notifications.
- Reconciliation invariant computation and publishing.
- Append-only audit log writes.

### `contracts/`

Solidity smart contracts. Deployed to Ethereum mainnet.

| Contract | Standard | Custom lines |
|----------|----------|-------------|
| PLUSD | OZ ERC-20Pausable + `_update` hook | ~5 |
| sPLUSD | OZ ERC-4626 (unmodified) | 0 |
| WhitelistRegistry | Custom | ~80 |
| WithdrawalQueue | Custom | ~180 |
| LoanRegistry | OZ ERC-721 + extension | ~200 |
| FoundationMultisig | Safe (Gnosis) | 0 |

Total custom audit surface: ~470 lines.

## Layering Model

Dependency direction (no backwards imports):

```
contracts (Ethereum)
    ↑  (worker listens to events, submits txs)
worker (Rust)
    ↑  (api reads worker state / DB)
api (Rust)
    ↑  (frontend calls API)
frontend (TypeScript)
```

- `contracts` has no knowledge of off-chain components.
- `worker` depends on `contracts` ABIs and the MPC vendor SDK. It does NOT import from `api` or `frontend`.
- `api` depends on the internal indexer DB (populated by `worker`). It does NOT import from `worker` directly at runtime — they communicate via a shared DB or message queue.
- `frontend` depends on `api` for data and on ethers.js for direct wallet interactions (deposit, stake, unstake, withdrawal request).

## Cross-Cutting Concerns

| Concern | Owner |
|---------|-------|
| Authentication (LP) | frontend (wallet signature via WalletConnect/RainbowKit) |
| Authentication (operators) | api (email + password + TOTP/WebAuthn) |
| MPC signing | worker (via MPC vendor SDK — Fireblocks or BitGo, pending) |
| KYC/screening | worker (Sumsub + Chainalysis webhooks/API) |
| On-chain indexing | worker (custom EQ LAB indexer, writes to shared DB) |
| Key management | worker (AWS KMS / GCP KMS for hot keys; MPC key via vendor ceremony) |
| Audit logging | worker (append-only, mirrored to third-party log sink) |
| Notifications | worker (email + optional Telegram/Slack webhook) |

## Deployment Targets

| Service | Target |
|---------|--------|
| Ethereum contracts | Mainnet (Soroban documented alternative) |
| API | TBD cloud (containerised) |
| Worker | TBD cloud (containerised, HSM-backed KMS) |
| Frontend | TBD static hosting or CDN |

## Open Architecture Decisions

See [`docs/design-docs/index.md`](./docs/design-docs/index.md) for design documents covering:
- Split-rail architecture and security model
- Bridge service security and MPC permission scoping
- WhitelistRegistry enforcement model
