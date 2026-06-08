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
│   ├── ui/                # Source-only shared design kit consumed by packages/frontend
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
**Auth:** wagmi + viem + Reown AppKit (WalletConnect v2) for LPs; email + password + 2FA for operators.
**Web3:** wagmi + viem for contract interactions; Reown AppKit for the WalletConnect modal. All blockchain access goes through `packages/frontend/src/wallet/`.
**Port:** 3000 (dev)

### `packages/ui`

Source-only shared design kit consumed by `packages/frontend`. Contains shared theme/tokens, fonts, assets, and UI components. No library build, no `dist/` output — Vite in the frontend workspace transpiles these sources directly via the `@source` directive. Private workspace package; not published to npm. `packages/frontend` declares `"@pipeline/ui": "workspace:^"` under `dependencies`; Tailwind v4 class scanning into `@pipeline/ui` sources is anchored by `@source "../../ui/src/**/*.{ts,tsx}"` in `packages/frontend/src/index.css`.

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
- On-chain event listener: USDC Transfer, WithdrawalRequested, LoanDrawn, StatusUpdated, CCRUpdated, LocationUpdated, LoanDefaulted, LoanClosed, PaymentRecorded, LoanRolledOver, EconomicsAmended, YieldMinted.
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
- `frontend` depends on `api` for data and on wagmi + viem (via the `wallet/` module) for direct wallet interactions (deposit, stake, unstake, withdrawal request).

## Cross-Cutting Concerns

| Concern | Owner |
|---------|-------|
| Authentication (LP) | frontend (wallet signature via wagmi + viem + Reown AppKit / WalletConnect v2) |
| Authentication (operators) | api (email + password + TOTP/WebAuthn) |
| MPC signing | worker (via MPC vendor SDK — Fireblocks or BitGo, pending) |
| KYC/screening | worker (Sumsub + Chainalysis webhooks/API) |
| On-chain indexing | worker (custom EQ LAB indexer, writes to shared DB) |
| Key management | worker (AWS KMS / GCP KMS for hot keys; MPC key via vendor ceremony) |
| Audit logging | worker (append-only, mirrored to third-party log sink) |
| Notifications | worker (email + optional Telegram/Slack webhook) |

**Per-chain task model.** The worker spawns one independent tokio task per configured chain for each enabled job (indexer, price-poller, relayer). Chains are listed in the `CHAINS` environment variable (comma-separated chain IDs); each chain is configured via `CHAIN_<id>_*` prefixed variables. A single-chain deployment sets `CHAINS=1` and is operationally identical to the previous design. The API resolves chain by an optional `chain_id` query parameter on every route, falling back to `DEFAULT_CHAIN_ID` when the parameter is absent. KYC and whitelist state (`lp_profiles`, `kyc_outbox`) is sharded by `chain_id` so that regulatory actions and KYC status on one chain do not affect other chains. See `docs/design-docs/multi-chain-kyc-sharding.md` for the rationale.

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
