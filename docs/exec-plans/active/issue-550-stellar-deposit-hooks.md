# Issue #550: [FE] [Stellar] Deposit flow: request_deposit → voucher → claim_request hooks

Source: https://github.com/eq-lab/pipeline/issues/550

## Scope

Build the Stellar/Soroban counterpart of the EVM deposit hooks
(`packages/frontend/src/wallet/evm/useDepositManager.ts`) so the frontend can
drive a real USDC → PLUSD deposit against the testnet `deposit_manager`
contract `CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI`.

In scope — three hook families plus glue, all under
`packages/frontend/src/wallet/stellar/`:

1. `useStellarRequestDeposit()` — write hook for `request_deposit(sender, amount: i128) → request_id: u128`. Builds + signs + submits + polls the Soroban tx, and **parses `request_id` from the tx `returnValue`** (the Soroban analogue of the EVM API-driven requestId — EVM cannot decode the return value, Soroban can).
2. `useStellarClaim()` — write hook for `claim_request(request_id: u128, verifier_signature: BytesN<64>)`. Takes the requestId and the 64-byte ed25519 voucher signature, builds + signs + submits + polls.
3. `useStellarDepositVoucher(requestId)` — React Query hook mirroring `packages/frontend/src/api/useDepositVoucher.ts`, fetching `GET /v1/deposits/{request_id}/voucher?wallet=<G…>`. The endpoint is already chain-aware (shipped in #555, **merged**) and dispatches on `chain_id`; for Stellar it returns a hex-encoded 64-byte ed25519 signature. Decode hex → `Uint8Array` for `claim_request`.
4. A `get_request(requestId)` polling read exposed as `useStellarDepositRequest(requestId)` (wraps `DepositManagerClient.getRequest`) for status (`claimed`, `amount`) and resume.
5. `needsTrustline` + a `changeTrust` action for the PLUSD classic asset, so the UI (#552, out of scope) can insert a trustline step before claim. Trustline detection reuses `useStellarSacToken({ assetCode: "PLUSD", … }).hasTrustline`.
6. Client-side in-flight request recovery via `localStorage` keyed by account, validated through `get_request` (see Open Questions on whether `/v1/requests` can replace this for Stellar).
7. Mock-layer keys + hook-level tests (mocked RPC) and a user-stories doc (ISSUE_PROTOCOL §6).

Out of scope: UI/page wiring (the deposit page step model, trustline step insertion, XLM-fee display) — that is #552. The withdraw sibling is #551. No backend/API changes (voucher + indexer already merged via #555/#528). No new product behavior beyond exposing hooks.

## Assumptions and Risks

- **Foundation is merged.** #549 (typed `DepositManagerClient`, SAC token layer, addresses hook, wallet `signTransaction`) is present under `packages/frontend/src/wallet/stellar/`. This issue consumes those, mirroring how `useBlendDeposit`/`-useBlendSubmit.ts` consume `blendPool.ts`.
- **Submit lifecycle pattern exists.** `submitBlendTx` in `blendPool.ts` (simulate → assemble → sign → send → poll) is the template for submitting the DepositManager builders, but the existing `DepositManagerClient.buildRequestDeposit`/`buildClaimRequest` already simulate+assemble and return assembled XDR — so the hook flow is: build (client) → sign (wallet) → rebuild from signed XDR → `sendTransaction` → `pollTransaction` → parse `returnValue`. Confirm the assembled XDR from the client is the correct envelope to hand to `signTransaction` (it should be; matches Blend's assembled-then-sign order).
- **Single auth entry (no approve step).** Per the issue, `request_deposit` pulls USDC via Soroban auth inside one invocation. Verify during implementation that simulation yields exactly one signable auth entry; if it yields a separate SAC-allowance auth, the plan's "one signature" assumption breaks and a pre-step is needed (note in Open Questions).
- **request_id parsing from `returnValue`.** `request_deposit` returns `u128`. After `pollTransaction` SUCCESS, decode `returnValue` (an `xdr.ScVal`) via `scValToNative` → `bigint`. Risk: the assembled-tx return value surfaces on the `GetTransactionResponse.returnValue` field; confirm the SDK exposes it on the poll result (Blend's helper discards it, so this path is new). Fallback: re-read via `get_request` enumeration is not possible without the id, so if `returnValue` is unavailable we must derive the id another way — flagged in Open Questions.
- **7 decimals, not 6.** Amounts are i128 with 7 decimals. Reuse `sacDisplayToRaw`/`sacRawToDisplay`/`SAC_DECIMALS` from `useStellarSacToken.ts`. Do NOT reuse EVM's 6-dp helpers.
- **PLUSD trustline.** Claiming mints a classic asset; without a trustline the claim fails. `changeTrust` is a classic Horizon operation (not Soroban) — build a `Operation.changeTrust({ asset: new Asset("PLUSD", issuer) })`, sign via the same wallet kit, submit via Horizon. The PLUSD classic `{ code, issuer }` comes from `useStellarDepositManagerAddresses().addresses.plusdAsset`.
- **Stale address in checked-in docs.** `contracts/depositManager.ts` header comment still cites the stale `CB62U…JCOO` id; `env.ts` `STELLAR_DEPOSIT_MANAGER_ID` defaults to `""` (configured via `.env`). Update the comment to the live `CARFA2…` address and ensure `.env`/`.env.example` carry it. Low risk, doc-only.
- **Mock signing.** `signTransaction` rejects on the mock path by design. Therefore the write hooks must mock at their own result-level keys (the `-useBlendSubmit.ts` pattern), never relying on `signTransaction` in mock mode.
- **Dev-only verifier fallback.** The issue permits an optional `VITE_STELLAR_VERIFIER_SECRET` local-signing escape hatch. Since #555 (the real ed25519 voucher endpoint) is merged, treat this as **optional / deferred** — #555's own plan lists "dropping the `VITE_STELLAR_VERIFIER_SECRET` dev fallback" as #550/#551's concern, implying it may not need to be added at all. Recommend NOT adding it (keep parity with EVM, which has no fallback). Flagged in Open Questions.

## Open Questions

- Does `GET /v1/requests?wallet=<G…>` return Stellar deposit requests now that the #528 indexer is merged (so we can mirror EVM's API-driven requestId/status), or must Stellar rely solely on client-side `get_request` + localStorage recovery? The `useRequests` types are EVM-centric ("USDC = 6 dp"). The issue says use client-side recovery "if no request-list API is exposed for Stellar yet" — confirm which path is live before finalizing the resume mechanism. (Plan defaults to client-side recovery as the safe path.)
- Should the dev-only `VITE_STELLAR_VERIFIER_SECRET` local-signing fallback be implemented at all, given #555's production ed25519 voucher endpoint is merged? Recommendation: omit it for EVM parity; confirm.
- Does the Soroban `pollTransaction`/`GetTransactionResponse` reliably expose `request_deposit`'s `returnValue` so we can decode `request_id` client-side? If not, what is the canonical id source for the real path?
- Confirm `request_deposit` simulation yields a single signable auth entry (no separate SAC-allowance signature). If a second auth/approve step appears, the hook surface needs an extra step.

## Implementation Steps

1. **Add a shared Soroban submit+poll helper** (mirror `submitBlendTx`) — either extend `contracts/depositManager.ts` or add `stellar/-useDepositSubmit.ts`. It must: take an assembled-or-buildable op, sign via injected `signTransaction`, rebuild `Transaction.fromXDR`, `sendTransaction`, `pollTransaction`, and return `{ hash, returnValue?: xdr.ScVal }`. Surface `returnValue` so the deposit path can decode `request_id`.
2. **`useStellarRequestDeposit()`** in `stellar/useStellarDepositManager.ts` (or a dedicated file). State model copied from `-useBlendSubmit.ts`: `{ write(amountRaw: bigint), data: { hash, requestId? }, isPending, isSuccess, error, reset }`. Real path: `DepositManagerClient.buildRequestDeposit(sender, amount, sourceAccount)` (fetch `sourceAccount` via `rpc.Server.getAccount`) → sign → submit+poll → `scValToNative(returnValue)` → `requestId`. Mock key: `pipeline.mock.wallet.stellar.depositManager.requestDeposit` (JSON `{ hash, requestId? }`). Unconfigured (`depositManagerId === ""`): `write()` sets `Error("DepositManager not configured")`.
3. **`useStellarClaim()`** in the same module. `{ write(requestId: bigint, verifierSignature: Uint8Array), data: { hash }, isPending, isSuccess, error, reset }`. Real path: validate 64-byte sig (client already validates) → `buildClaimRequest` → sign → submit+poll. Mock key: `pipeline.mock.wallet.stellar.depositManager.claim` (JSON `{ hash, amount? }`).
4. **`useStellarDepositRequest(requestId)`** — React Query wrapper over `DepositManagerClient.getRequest(requestId)` returning `{ request, isLoading, error, refetch }`. Used for status polling and resume validation. Mock key optional.
5. **`useStellarDepositVoucher(requestId)`** in `packages/frontend/src/api/` (sibling of `useDepositVoucher.ts`) — copy the polling/retry/status machine; use `useStellarWallet()` for the `wallet` query param; expose `data.signature` (hex) plus a decoded `signatureBytes: Uint8Array` helper (hex → bytes) for `useStellarClaim`. Reuse the same mock-version external store + `pipeline.mock.api.*` keys.
6. **Trustline support** — extend the deposit module to expose `needsTrustline` (from `useStellarSacToken({ assetCode: "PLUSD", assetIssuer: plusdAsset.issuer, contractId: plusd }).hasTrustline === false`) and a `useChangeTrust()` action that builds a classic `changeTrust` op for PLUSD, signs via the wallet, submits via Horizon (`Horizon.Server.submitTransaction`), and exposes `{ submit, isPending, isSuccess, error }`. Mock key: `pipeline.mock.wallet.stellar.changeTrust`.
7. **In-flight recovery** — add a small `localStorage` module keyed by account (e.g. `pipeline.stellar.deposit.inflight.<G…>`) storing `{ requestId, amount, createdAt }` written on a successful `request_deposit`, read on mount, and validated via `useStellarDepositRequest` (drop entries where `get_request` shows `claimed: true` or 404). Gate this behind the Open Question outcome — if `/v1/requests` covers Stellar, prefer that and keep localStorage as a fallback only.
8. **Mock keys + readers** — add the new keys to `stellar/mock.ts` (`STELLAR_MOCK_KEYS`) with non-reactive `readMock…` readers, mirroring the Blend entries. Document them in `packages/frontend/src/wallet/README.md` and `packages/frontend/src/api/README.md`.
9. **Barrel exports** — export the new hooks from `packages/frontend/src/wallet/index.ts` (and `api/index.ts` for the voucher hook), matching the existing Stellar export grouping.
10. **Fix stale docs** — update the `contracts/depositManager.ts` header comment to the live `CARFA2…` address and the interface-capture note; ensure `.env.example` documents `VITE_STELLAR_DEPOSIT_MANAGER_ID=CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI`.
11. **Lint** — run `npx tsx scripts/lint-docs.ts` and the frontend lint/typecheck; respect the ESLint `no-restricted-imports` boundaries (stellar-sdk only via `contracts/`/`chain.ts` boundary modules).

## Test Strategy

Hook-level tests with mocked Soroban RPC (Vitest + React Testing Library), following `useBlendDeposit.test.tsx` / `useDepositManager.test.tsx` conventions:

- **`useStellarRequestDeposit`**: happy path (mock-key result + real path with a stubbed `rpc.Server` returning a SUCCESS poll with a `u128` `returnValue` → asserts decoded `requestId`); paused-contract simulation error → `error` set; declined signature (`signTransaction` rejects) → `error` set, `isPending` clears; unconfigured (`depositManagerId === ""`) → configured-error; 7-decimal scaling assertion via `sacDisplayToRaw`.
- **`useStellarClaim`**: happy path; rejects non-64-byte signature; missing-trustline claim failure surfaces a readable error; declined signature.
- **`useStellarDepositVoucher`**: idle (no requestId / disconnected), pending→ready polling transition, hex→bytes decode correctness, retriable 404/403 then ready, exhausted-retry → failed. Mock-key fast path.
- **Trustline**: `needsTrustline` true when SAC `hasTrustline` is false; `useChangeTrust` happy path + declined signature (mocked Horizon).
- **In-flight recovery**: write persists localStorage entry; mount reads it; `get_request` showing `claimed` evicts it; corrupt/foreign-account entries ignored.
- **Edge cases**: zero/over-balance amount, simulation error mapping, re-entrant `write()` guarded while `isPending`.

Manual/acceptance (documented in the user-stories doc, executed by #552/QA): on testnet with a funded account, request → poll `get_request` → fetch voucher → claim succeeds; PLUSD balance increases by the deposited amount.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — new Stellar deposit mock-key schema + hook list.
- `packages/frontend/src/api/README.md` — `useStellarDepositVoucher` mock keys.
- `packages/frontend/src/wallet/stellar/contracts/depositManager.ts` — header comment: live contract address + capture note.
- `.env.example` — `VITE_STELLAR_DEPOSIT_MANAGER_ID` documented value.
- `docs/product-specs/user-stories.md` (or epic user-stories doc) — Stellar deposit user story per ISSUE_PROTOCOL §6 (ship in the PR).
- No product-spec behavior change beyond exposing hooks; deposit UX behavior is owned by #552.
