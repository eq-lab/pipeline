# Elliptic KYT for Stellar — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan
**Author:** Elliptic KYT integration
**Related:** [`2026-05-06-crystal-kyt-integration-design.md`](./2026-05-06-crystal-kyt-integration-design.md) (EVM/Crystal precedent)

## Problem

KYT/AML screening exists for EVM chains via **Crystal Intelligence** (`packages/shared/src/crystal/`, relayer Phase 2). Stellar chains currently force-disable KYT (`StellarRelayerSettings.crystal_enabled = false`) because Crystal does not support Stellar. Stellar LPs therefore reach the whitelist with **no transaction/address risk screening** — only Sumsub KYC.

We will add KYT for Stellar using **Elliptic** (`aml-api.elliptic.co`), following the same process already established for EVM: one-time address screening for new profiles, deposit-transaction screening, and withdrawal-address screening, all feeding the existing whitelist allow/disallow gate.

## Goals

- Screen Stellar addresses and deposit transactions via Elliptic before whitelisting.
- Reuse the existing KYT gate architecture (whitelist allow requires KYT-clear; a KYT-fail disallows an already-allowed profile).
- Keep provider separation clean: EVM→Crystal, Stellar→Elliptic, each chain uses exactly one provider.
- Follow repo conventions: provider module under `packages/shared/src/`, external test files, env-driven config, no committed secrets.

## Non-goals (YAGNI)

- No asynchronous / webhook Elliptic flow — synchronous endpoints only.
- No `destination_of_funds` transaction analysis on withdrawals (withdrawals are address-screened only, mirroring EVM).
- No API-secret rotation at runtime (read once at startup, like Crystal/Sumsub).
- No change to EVM/Crystal screening behavior beyond the shared column rename (§4).

## Decisions (resolved during brainstorming)

1. **Storage:** Rename the existing `crystal_*` KYT columns to provider-agnostic `kyt_*` (both `lp_profiles` and `contract_logs`). Both Crystal (EVM) and Elliptic (Stellar) write these shared columns. Chosen over reusing the `crystal_`-prefixed names as-is (misleading) and over parallel `elliptic_*` columns (duplicated gate/frontend logic).
2. **Withdrawal scope:** Mirror EVM — withdrawals get a `wallet_exposure` address screen only; no withdrawal transaction analysis. Deposits get full `source_of_funds` transaction screening.

## Architecture

### 1. Provider module — `packages/shared/src/elliptic/`

New module mirroring `crystal/`, exported from `packages/shared/src/lib.rs`.

- **`signing.rs`** — HMAC-SHA256 request signer implementing the scheme from the reference scripts:
  ```
  request_text = timestamp + METHOD + path.to_lowercase() + payload
  hmac_key     = base64_decode(api_secret)          # decoded, not raw
  signature    = base64( HMAC_SHA256(hmac_key, request_text) )
  ```
  Follows the existing `sumsub/` HMAC pattern (established in-repo). Unit-tested against a known vector derived from `address.sh`/`transaction.sh`.
- **`client.rs`** — `EllipticClient::new(settings)` plus:
  - `screen_wallet(address) -> EllipticResponse`
    `POST /v2/wallet/synchronous`
    body: `{"subject":{"asset":<asset>,"blockchain":<blockchain>,"type":"address","hash":<address>},"type":"wallet_exposure"}`
  - `screen_transaction(tx_hash, output_address, customer_reference) -> EllipticResponse`
    `POST /v2/analyses/synchronous`
    body: `{"subject":{"output_type":"address","asset":<asset>,"blockchain":<blockchain>,"type":"transaction","hash":<tx_hash>,"output_address":<output_address>},"type":"source_of_funds","customer_reference":<customer_reference>}`
  Each call: build body → sign → send with headers `x-access-key`, `x-access-sign`, `x-access-timestamp`, `content-type: application/json`, `accept: application/json`. Non-2xx → `bail!` with status + body (same error handling as `CrystalClient::risk_check`).
- **`models.rs`** — request structs + `EllipticResponse` capturing the risk score and triggered-rules list.
  > **Response schema to be confirmed against a live payload during implementation.** The Elliptic docs are JS-rendered and not machine-readable via fetch. Implementation will run `address.sh`/`transaction.sh` once against the live API (billed calls) to capture the exact field names, then model them. Parsing is defensive (`Option`, `#[serde(default)]`) like the Crystal models, so unexpected fields never panic.
- **`config.rs`** — `EllipticSettings` + `EllipticSettings::from_env()` + risk-decision method (§2).

### 2. Risk decision

`EllipticSettings::is_risky(risk_score, triggered_rules) -> bool` returns `true` when:
- `risk_score >= ELLIPTIC_RISK_THRESHOLD`, **or**
- any triggered rule name is in the configurable hard-fail set (`ELLIPTIC_HARD_FAIL_RULES`; default = fail on any triggered rule / any positive risk score — conservative).

Analogous to Crystal's `risk_score_threshold` + `hard_fail_signals`. Exact threshold semantics finalized once the live response range is known.

### 3. Config / env (`ELLIPTIC_*`)

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `ELLIPTIC_ENABLED` | no | `false` | Master toggle for the Stellar KYT phase |
| `ELLIPTIC_API_KEY` | when enabled | — | `x-access-key` header |
| `ELLIPTIC_API_SECRET` | when enabled | — | HMAC key (base64-decoded before use) |
| `ELLIPTIC_BASE_URL` | no | `https://aml-api.elliptic.co` | API base |
| `ELLIPTIC_ASSET` | no | `holistic` | `subject.asset` |
| `ELLIPTIC_BLOCKCHAIN` | no | `holistic` | `subject.blockchain` |
| `ELLIPTIC_RISK_THRESHOLD` | no | conservative | `risk_score` cutoff |
| `ELLIPTIC_HARD_FAIL_RULES` | no | all | CSV of rule names that force a fail |

`StellarRelayerSettings`: replace hardcoded `crystal_enabled = false` with `elliptic_enabled` read from `ELLIPTIC_ENABLED`. `EllipticClient` is constructed in the Stellar relayer only when enabled (mirrors the EVM `crystal_client` pattern).

### 4. DB migration — `crystal_* → kyt_*`

One migration renames columns on `lp_profiles` and `contract_logs`:

| Old | New |
|---|---|
| `crystal_kyt_status` | `kyt_status` |
| `crystal_address_risk` | `kyt_address_risk` |
| `crystal_address_risk_signals` | `kyt_address_signals` |
| `crystal_tx_risk` | `kyt_tx_risk` |
| `crystal_tx_signals` | `kyt_tx_signals` |
| `crystal_sender_risk` | `kyt_sender_risk` |
| `crystal_sender_signals` | `kyt_sender_signals` |
| `crystal_screened_at` | `kyt_screened_at` |

All references updated: `kyc_repo.rs` (queries, `CrystalTransferResult`, `RequestInfo`, `RequestEventRow`, allow/disallow gates, setters), `crystal_check.rs`, the frontend status derivation that reads `crystal_kyt_status`, and any API query. Status semantics unchanged: `NULL`=pending, `1`=clear, `2`=failed. Both providers write these columns.

### 5. Relayer wiring — Stellar Phase 2

New `packages/worker/src/relayer/elliptic_check.rs` mirroring `crystal_check.rs`:

- `phase_check_elliptic(elliptic, kyc_repo, chain_id)`:
  - **2a — addresses:** `fetch_unscreened_profiles(chain_id)` → `screen_wallet` → store `kyt_address_risk`/`kyt_address_signals`/`kyt_screened_at` → set profile `kyt_status` clear/failed.
  - **2b — events:** Stellar-scoped unverified transfers →
    - `DepositRequested` → `screen_transaction(source_of_funds)` + mark sender profile failed on risk.
    - `WithdrawalRequested` → `screen_wallet` (address only) + mark profile failed on risk.

Inserted into `stellar/job.rs` loop between Phase 0 (populate) and Phase 3 (whitelist sync), gated on `settings.elliptic_enabled`.

Requires a **Strkey-case-preserving** unverified-transfers fetch (the existing `fetch_unverified_transfers` is shared/EVM-lowercasing; add a Stellar-scoped variant or a chain-filtered parameter that preserves case, consistent with `populate_profiles_from_deposits_stellar` and `fetch_profiles_to_allow_stellar`).

### 6. Whitelist gate (Stellar)

- `fetch_profiles_to_allow_stellar`: add `AND p.kyt_status = 1` when Elliptic is enabled (mirrors the EVM Crystal allow gate). When disabled, behavior unchanged.
- `fetch_profiles_to_disallow`: already gates on `kyt_status = 2` + an `enabled` flag — pass `elliptic_enabled` for Stellar chains so a newly-failed profile gets disallowed.

### 7. Tests — `packages/shared/tests/elliptic.rs`

Per repo convention (external test files; pure unit tests, no DB / no env-gated Postgres):

- **Signing:** signature matches a known vector reproduced from `address.sh` (fixed timestamp/method/path/payload → expected base64 signature).
- **Parsing:** a captured real `wallet_exposure` response and a `source_of_funds` response parse into `EllipticResponse`; a no-risk / empty response parses to a clean result.
- **Risk decision:** below-threshold is clear; at/above threshold is risky; a hard-fail rule triggers; a non-configured rule is ignored.

## Data flow

```
Stellar relayer loop (per chain, elliptic_enabled):
  Phase 0  populate_profiles_from_deposits_stellar
  Phase 2  phase_check_elliptic
             2a new profiles      -> screen_wallet         -> kyt_status
             2b DepositRequested  -> screen_transaction    -> kyt_status (+ sender profile)
                WithdrawalRequested -> screen_wallet       -> kyt_status (+ profile)
  Phase 3  phase_sync_whitelist_stellar
             allow    : kyt_status = 1 (+ sumsub, + deposit exists)
             disallow : kyt_status = 2 on already-allowed
  Phase 4  yield-mint (unchanged)
```

## Risks & open items

- **Response schema** — confirmed from a live call during implementation (see §1). If live calls are undesirable, sample responses must be supplied instead.
- **`asset`/`blockchain` values** — reference scripts use `holistic`/`holistic` (auto-detect) and work with a Stellar `G…` address; kept as configurable defaults.
- **`customer_reference`** — the reference script passes an LP `G…` address. We pass the LP wallet address as `customer_reference` so Elliptic customer records align with our profiles.

## Verification (lint per AGENTS.md)

- `cargo clippy --all -- -D warnings` after Rust changes.
- Frontend/docs lint (`npx tsx scripts/lint-docs.ts`) if TS/docs touched.
