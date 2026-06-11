# Issue #549: [FE] [Stellar] Protocol contract foundation: addresses config, typed Soroban clients, SAC token support

Source: https://github.com/eq-lab/pipeline/issues/549

Part of epic #498 (Deposit/withdraw page). This issue lays the Stellar plumbing for wiring the deposit/withdraw page to the protocol's OWN Soroban contracts (`deposit_manager`, `withdrawal_queue`), as opposed to the existing third-party Blend integration (#457). No UI work in this issue.

## Scope

In scope:

1. **Env config** — add Soroban contract IDs the frontend actually calls (the two managers), mirroring the EVM pattern in `packages/frontend/src/lib/env.ts`. USDC/PLUSD are NOT in env — they are derived via on-chain `asset()` / `share()` reads. `access_manager` and `staked_pl_usd` are explicitly excluded (per body edit comment: RBAC is internal; the staked vault belongs to the Stake page epic).
2. **Checked-in contract spec/bindings** — capture the `deposit_manager` and `withdrawal_queue` Soroban interfaces as checked-in artifacts (generated bindings or spec) for determinism and offline tests. No runtime WASM/spec fetching.
3. **Typed contract clients** for `deposit_manager` and `withdrawal_queue` under `packages/frontend/src/wallet/stellar/`.
4. **SAC token layer** — extend the Stellar token support so the protocol USDC/PLUSD SACs can report balance, decimals (7, NOT 6), and trustline existence.
5. **Address-derivation hook** — Stellar analogue of `useDepositManagerAddresses`: read `asset()` / `share()` from `deposit_manager` to obtain the USDC/PLUSD SAC contract IDs (and their classic `code:issuer` for trustline checks).
6. **Docs** — record the fetched manager interfaces under `docs/generated/` so later tasks don't re-derive them.
7. **Test** — a page-independent unit/integration test (or `scripts/` snippet) exercising `asset()`, `share()`, `paused()`, a USDC balance read, and a trustline flag against testnet config.

Out of scope:

- Any UI / page wiring (deposit/withdraw flows, claim flows). Acceptance explicitly says "no UI changes."
- `request_deposit` / `request_withdrawal` / `claim_request` write transactions — clients should EXPOSE these typed methods, but no flow/hook that submits them is built here.
- `access_manager` integration and `staked_pl_usd` (Stake page epic).
- Any change to the existing Blend hooks (`useBlendDeposit`, etc.) or to `VITE_STELLAR_USDC_ISSUER` (Circle testnet issuer — leave it; the protocol issuer is derived, not configured).

## Assumptions and Risks

- **Decimals divergence.** The protocol SACs use **7 decimals** (Stellar SAC standard), while EVM USDC uses 6. Any scaling code must read decimals from the SAC, not assume 6. This is the single most likely source of a silent bug. Plan: read decimals from the SAC `decimals()` view (or derive from SAC metadata) rather than hardcoding.
- **Two distinct USDC issuers.** The protocol's classic USDC issuer is `GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM`, which differs from `VITE_STELLAR_USDC_ISSUER` (Circle testnet, `GBBD47…`) used by the existing Blend `useStellarToken`. The existing `useStellarToken` matches on `usdcIssuer` from `chain.ts`; the new protocol token layer must NOT reuse that issuer constant — it must use the issuer derived from the SAC's `asset()` metadata. Risk: accidentally reusing `usdcIssuer` from `chain.ts` would match the wrong asset.
- **Testnet resets.** Stellar testnet is periodically reset; deployed contract IDs can vanish (warning in issue). The plan keeps the live test resilient: tests that hit testnet must skip/soft-fail rather than hard-fail CI, OR be a `scripts/` snippet run on demand. Checked-in bindings mean unit tests do not depend on testnet liveness.
- **Bindings toolchain.** `stellar contract bindings typescript` requires the Stellar CLI and network access at generation time (one-off, by the coder). If unavailable, fall back to hand-writing a minimal typed client from the spec already captured in the issue comments (full `deposit_manager` / `withdrawal_queue` / `access_manager` specs are in issue #549 comments). Either way the OUTPUT is checked in.
- **SAC interface for reads.** SAC `balance(addr) -> i128` requires the account to have the asset; for a missing trustline a SAC `balance` read may error or return 0 depending on host. Trustline existence is most reliably detected via Horizon `loadAccount().balances` (the pattern already in `useStellarToken`), matching on the SAC's classic `code:issuer`. Plan uses Horizon for trustline/balance reads (consistent with existing hook) and reserves Soroban `balance()` only where a contract-id balance is genuinely needed.
- **Provider mounting.** New hooks must sit inside the existing shared `QueryClientProvider` (mounted by `EvmWalletProvider`) — the existing `useStellarToken` documents this. No new provider.

## Open Questions

_None._ The body edit comment resolved the env-vs-derived split (managers in env; USDC/PLUSD derived; access_manager excluded; staked_plUsd deferred), decimals (7), the bindings-checked-in decision, and the issuer caveat. Acceptance criteria are explicit and page-independent.

## Implementation Steps

1. ✅ **Env additions** — `packages/frontend/src/lib/env.ts`:
   - Add `STELLAR_DEPOSIT_MANAGER_ID: readString("VITE_STELLAR_DEPOSIT_MANAGER_ID", "")` and `STELLAR_WITHDRAWAL_QUEUE_ID: readString("VITE_STELLAR_WITHDRAWAL_QUEUE_ID", "")`.
   - Use an empty-string default (Soroban contract IDs have no natural "zero" sentinel like EVM's zero address); document that empty = "unconfigured → short-circuit hooks return `undefined` without an RPC call" (mirroring the EVM zero-address short-circuit semantics).
   - Do NOT add `access_manager`, `staked_pl_usd`, USDC, or PLUSD env vars.
   - Mirror the doc-comment style of the existing EVM/Stellar entries.

2. ✅ **Update `.env.example`** — add the two `VITE_STELLAR_DEPOSIT_MANAGER_ID` / `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` frontend vars (the `CHAIN_99000001_STELLAR_*` indexer block already lists the addresses; add the `VITE_`-prefixed frontend equivalents with the verified testnet values as commented examples). Leave `.env` for the human to fill if they wish — note it in the PR.

3. ✅ **Expose IDs in `chain.ts`** — `packages/frontend/src/wallet/stellar/chain.ts`:
   - Add `export const depositManagerId: string = ENV.STELLAR_DEPOSIT_MANAGER_ID;` and `export const withdrawalQueueId: string = ENV.STELLAR_WITHDRAWAL_QUEUE_ID;` alongside the existing Soroban constants. Keep `sorobanRpcUrl` / `networkPassphrase` reuse.

4. ✅ **Generate & check in bindings** — create `packages/frontend/src/wallet/stellar/contracts/`:
   - Run `stellar contract bindings typescript --id <deposit_manager> --network testnet --output-dir …` (and same for `withdrawal_queue`), OR hand-write minimal typed clients from the spec in the issue comments. Place the generated/authored client modules here (e.g. `depositManager.ts`, `withdrawalQueue.ts`, plus any shared spec XDR / types).
   - Each client must wrap a `@stellar/stellar-sdk` contract `Client` constructed from `{ contractId, rpcUrl: sorobanRpcUrl, networkPassphrase }`, and expose the verified subset: read views `asset()`, `share()`, `paused()`, `verifier()`, `get_request(id)`, `digest(...)`; write builders `request_deposit(sender, amount)` / `request_withdrawal(sender, amount)` and `claim_request(request_id, verifier_signature)`. Types: `Request { amount: i128; claimed: bool; timestamp: u64; user: Address }`.
   - Add a short header comment noting the source (testnet WASM, fetched 2026-06-10) and the testnet-reset caveat.

5. ✅ **Address-derivation hook** — `packages/frontend/src/wallet/stellar/useStellarDepositManagerAddresses.ts` (mirror EVM `useDepositManagerAddresses` in `src/wallet/evm/useDepositManager.ts`):
   - Returns `{ usdc, plusd, usdcAsset, plusdAsset, isLoading, error }` where `usdc`/`plusd` are the SAC contract IDs from `asset()`/`share()`, and `usdcAsset`/`plusdAsset` carry the classic `{ code, issuer }` (from SAC metadata, needed for trustline checks).
   - Short-circuit to `undefined` data (no RPC) when `depositManagerId` is empty.
   - Support the established mock-key pattern (`pipeline.mock.wallet.stellar.contract.*`) consistent with `useMock`/`readMock` and `STELLAR_MOCK_KEYS` in `src/wallet/stellar/mock.ts`. Use `@tanstack/react-query` with long/forever cache (addresses are static per deployment), matching the EVM `CACHE_FOREVER` approach.

6. ✅ **SAC token layer** — extend Stellar token support to the protocol SACs without breaking the existing Circle-issuer `useStellarToken`:
   - Add a parameterized read (e.g. `useStellarSacToken({ assetCode, assetIssuer, contractId })`) or generalize the existing hook so callers pass the asset identity instead of hardcoding `usdcIssuer` from `chain.ts`. Keep the existing `useStellarToken` (Circle USDC, Blend) untouched in behavior.
   - Balance + trustline: reuse the Horizon `loadAccount().balances` scan pattern from `useStellarToken`, matching on the SAC's classic `code:issuer` (the protocol issuer `GC5SUAXM…`, derived, NOT `usdcIssuer`). No trustline → `"0"`, 404 → `"0"`, both non-errors. Expose a `hasTrustline: boolean` flag.
   - Decimals: surface **7** for these SACs (read via the SAC `decimals()` view or the contract client; do not hardcode 6). Provide a raw↔display scaling helper keyed on the SAC decimals.

7. ✅ **Docs (`docs/generated/`)** — add `docs/generated/stellar-protocol-contracts.md` capturing: the verified testnet addresses table, the `deposit_manager` / `withdrawal_queue` interface subset (signatures + `Request` struct), the SAC facts (7 decimals, classic `code:issuer`, trustline requirement), and the on-chain verification snapshot (`asset()==usdc`, `share()==plusd`, unpaused, verifier key). Link it from `docs/references/index.md` if appropriate. Note `docs/generated/` is currently empty, so this is the first artifact there.

8. ✅ **Lint** — run `npx tsx scripts/lint-docs.ts` (docs structure) and the frontend lint/typecheck (`npm run lint` / `tsc`) from `packages/frontend`. Ensure no `import.meta.env` access leaks outside `env.ts` (ESLint `no-restricted-syntax`).

## Test Strategy

- **Unit tests (Vitest, offline, CI-safe)** — co-located `*.test.tsx` next to each new module, mocking `@stellar/stellar-sdk` (`Horizon.Server`, contract `Client`/`rpc.Server`) at the module level via `vi.mock`, following `useStellarToken.test.tsx` and `blendPool.test.ts`:
  - Contract clients: `asset()` / `share()` / `paused()` / `verifier()` decode correctly from mocked simulation results; `get_request` decodes the `Request` struct; write builders produce the expected invocation args (sender, i128 amount; `claim_request` with `bytesN(64)` signature). Edge: empty `depositManagerId` → short-circuit, no `Client` constructed.
  - `useStellarDepositManagerAddresses`: derives USDC/PLUSD SAC IDs from mocked `asset()`/`share()`; mock-key fast-path; empty-env short-circuit; error surfaced.
  - SAC token layer: balance present (7-decimal scaling, NOT 6); issuer mismatch → ignored; no trustline → `"0"` + `hasTrustline=false`; unfunded 404 → `"0"`, no error; disconnected → `undefined`.
- **Acceptance live check (page-independent)** — a `packages/frontend/scripts/` snippet (or a Vitest test gated behind an env flag / `it.skipIf`) that, against testnet config, reads `asset()`, `share()`, `paused()` from `deposit_manager`, a USDC balance for a known funded address, and a trustline flag. Because testnet resets, this MUST NOT hard-fail CI — gate it so the default CI run stays green using mocks; the live path runs on demand. Document how to run it.
- Verify the live `asset()==usdc` / `share()==plusd` / unpaused / verifier-key invariants from the issue when the live check is run.

## Docs to Update

- `docs/generated/stellar-protocol-contracts.md` — NEW (step 7): addresses, manager interfaces, SAC facts, verification snapshot.
- `docs/references/index.md` — add a pointer to the new generated doc if the index enumerates generated artifacts.
- `.env.example` — add the two `VITE_STELLAR_*_ID` frontend vars (step 2).
- No `docs/product-specs/` change required: this issue is infrastructure/plumbing with no user- or agent-facing behavior change (no UI). If a coder finds a spec that already describes the Stellar deposit/withdraw target, note it, but creating one is out of scope here.
