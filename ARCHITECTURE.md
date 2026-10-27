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
**Auth:** wagmi + viem + Reown AppKit (WalletConnect v2) for LPs, plus a self-serve email +
password + OTP credential (`packages/frontend/src/auth/`, `docs/frontend/auth-components.md#emailauthflow`)
that resolves to the same `accounts` JWT — LP header entry point pending #1282. Operators do not use it: they authenticate by wallet signature, and only an `auth_users` row carries a role.
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
- On-chain event listener: USDC Transfer, WithdrawalRequested, LoanDrawn, StatusUpdated, Disbursed, Undisbursed, LoanDefaulted, LoanClosed, PaymentRecorded, PaymentUnrecorded, LoanWrittenDown, InterestAdjusted, LoanRolledOver, EconomicsAmended, CollateralRegistry lot/coverage events (EVM and Stellar).
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
| Authentication (LP) | frontend (wallet signature via wagmi + viem + Reown AppKit / WalletConnect v2, or self-serve email + password + OTP) |
| Authentication (operators) | api (wallet signature over a server challenge; roles come from the `auth_users` allow-list) |
| MPC signing | worker (via MPC vendor SDK — Fireblocks or BitGo, pending) |
| KYC/screening | worker (Sumsub + Chainalysis webhooks/API) |
| On-chain indexing | worker (custom EQ LAB indexer, writes to shared DB) |
| Key management | worker (AWS KMS / GCP KMS for hot keys; MPC key via vendor ceremony) |
| Audit logging | worker (append-only, mirrored to third-party log sink) |
| Notifications | worker (email + optional Telegram/Slack webhook) |

**Per-chain task model.** The worker spawns one independent tokio task per configured chain for each enabled job (indexer, price-poller, relayer). Chains are listed in the `CHAINS` environment variable (comma-separated chain IDs); each chain is configured via `CHAIN_<id>_*` prefixed variables. Every such variable also carries its network kind — `CHAIN_<id>_<EVM|STELLAR>_<KEY>` for a fact all jobs share, `CHAIN_<id>_<EVM|STELLAR>_<COMPONENT>_<KEY>` for one component's setting — and a key of the other kind aborts startup rather than being silently ignored, so the prefixes can never drift from `CHAIN_<id>_TYPE`. Indexer tuning is per-chain on the same pattern: `CHAIN_<id>_<TYPE>_INDEXER_POLLING_BLOCK_RANGE`, `_POLLING_INTERVAL_MS` and `_LOG_CONFIRMATIONS_DELAY` fall back to the all-chain `JOB_INDEXER_*` form and then to a built-in default, so a conservative confirmation depth on one chain is not imposed on the rest; the confirmation delay has no Stellar spelling at all, since that arm indexes at a fixed zero confirmations (deterministic finality at ledger close). A single-chain deployment sets `CHAINS=1` and is operationally identical to the previous design. The API validates `chain_id` against `CHAINS` and has no default on reads: routes that act on one chain's state (auth, vouchers, KYC, ramp addresses, per-loan, pnl, positions history, stats prices and yield) require it, and feed or aggregate routes take it as an optional filter (omitted = every configured chain, listed below). The the only request-path use of `DEFAULT_CHAIN_ID` is the target chain of `POST /v1/loan-book/loan` when `chain_id` is omitted (until #1610); `GET /v1/chains` and the migration backfill also read it. `GET /v1/chains` (public, no parameters) lists every chain in `CHAINS`, in `CHAINS` order, as `{ chain_id, kind }` with `kind` `evm` or `stellar`, plus `default_chain_id` (`DEFAULT_CHAIN_ID`), so a client can tell a chain the API does not serve from one that has no data. LoanBook is the exception: `GET /v1/loan-book` treats an omitted `chain_id` as all configured chains and a well-formed but unconfigured one as `200` with an empty list; `GET /v1/loan-book/submissions` omitted returns all rows, a configured id filters by the submission's target chain, an unconfigured one is `200` empty (a malformed or repeated `chain_id` is `400` on both); the per-loan routes (`/v1/loan-book/{loan_id}/…`) require `chain_id`, since a loan id is unique only within a chain; wallet auth (`GET /v1/auth/challenge`, `POST /v1/auth/verify`), the voucher routes (`GET /v1/deposits/{request_id}/voucher`, `GET /v1/withdrawals/{request_id}/voucher`), `GET /v1/pnl` and `GET /v1/positions/history` likewise require `chain_id` (missing or not in `CHAINS` is `400`) and take the chain kind from `CHAINS`; `GET /v1/requests` takes an optional `chain_id` filter (omitted returns all chains, a configured id filters, an unconfigured one is `200` with an empty list, malformed or repeated is `400`) and each item carries its `chain_id`. `GET /v1/stats/prices` and `GET /v1/stats/yield` require `chain_id` (missing, malformed or not in `CHAINS` is `400`); `GET /v1/stats` and `GET /v1/stats/vaults` take an optional `chain_id` filter with the same semantics as `/v1/requests` (omitted returns every configured chain's vaults in `CHAINS` order, an unconfigured id is `200` with an empty list, malformed or repeated is `400`) and each vault item carries its `chain_id`. `GET /v1/financial-position`, `GET /v1/capital-allocation` and `GET /v1/withdrawal-queue` follow the `GET /v1/loan-book` rule: omitted `chain_id` = the union over all configured chains (items carry `chain_id`), a configured id = that chain, a well-formed unconfigured id = `200` with an empty or zeroed response, malformed or repeated = `400`. The API's LoanBook readers — and the financial-position / capital-allocation fan-out — are scoped to each chain's required `CHAIN_<id>_<TYPE>_API_LOAN_REGISTRY_ADDRESS` (startup fails without it), so a LoanRegistry redeploy cannot mix loan ids; portfolio is still chain-scoped only (migrating in #1538). `GET /v1/dashboard/summary`, `GET /v1/dashboard/tvl-history`, `GET /v1/dashboard/yield-history` and `GET /v1/audit-log` follow the same `chain_id` rule (omitted = all configured chains, a configured id = that chain, a well-formed unconfigured id = `200` with a zeroed or empty response and no DB call, malformed or repeated = `400`; no `DEFAULT_CHAIN_ID` fallback). The dashboard sums per-chain amounts normalized to base-6 USDC, weights its rates by principal over the union of active loans, builds its series on one shared time grid, and reads loans through each chain's LoanRegistry address; its cumulative yield is the historical `YieldMinted` rows plus Minter `CashRepaid` mints net of `CashRepaymentReversed`. The audit feed merges chains newest-first, each item carries its `chain_id`, and amounts are rendered with that row's chain kind. `POST /v1/kyc/applicants`, `POST /v1/kyc/token` and `GET /v1/kyc/status/{wallet_address}` and `GET /v1/ramp/addresses` require `chain_id` (missing, malformed or not in `CHAINS` is `400`); the KYC routes take the wallet kind from `CHAINS`, and the Sumsub webhook `POST /v1/kyc/callback` has no chain. `GET /v1/ramp/events` follows the audit-log rule (omitted = pending events of every configured chain with ramp/custody addresses, merged newest-first, a configured id = that chain, an unconfigured id = `200` empty, malformed or repeated = `400`) and each event carries its `chain_id`; classification uses that chain's own address sets. KYC and whitelist state (`lp_profiles`, `kyc_outbox`) is sharded by `chain_id` so that regulatory actions and KYC status on one chain do not affect other chains. See `docs/design-docs/multi-chain-kyc-sharding.md` for the rationale. The indexer is now polymorphic via `CHAIN_<id>_TYPE=evm|stellar`; Stellar chains run a dedicated `StellarEventPoller` while EVM chains continue to use the existing `EvmEventPoller`. Both can track the chain's USDC transfers as `AssetTransfer` rows (custody↔ramp movements and every transfer touching the withdrawal-queue wallet, with a running `wallet_balance_after`); the EVM poller fetches them by topic filter only, never by an address-only `eth_getLogs`, configured per chain via `JOB_INDEXER_EVM_<id>_{ASSET_ADDRESS,WITHDRAWAL_QUEUE_WALLET_ADDRESS,CUSTODY_ADDRESSES,RAMP_ADDRESSES}` (grouped under the job prefix next to the Stellar `JOB_INDEXER_STELLAR_*` asset-tracking keys). The price-poller is also polymorphic and configured per chain via `CHAIN_<id>_<TYPE>_PRICE_POLLER_*`, sampling the vault named by `…_PRICE_POLLER_STAKED_PLUSD_ADDRESS`: Stellar chains run a dedicated `StellarPricePoller` that samples `convert_to_assets` via `simulateTransaction` at the current ledger (no historical backfill — Soroban RPC has no historical-state replay). The relayer dispatches `relayer/stellar/` for Stellar chains and its one-for-one EVM mirror, `relayer/evm/`, for EVM chains.

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
