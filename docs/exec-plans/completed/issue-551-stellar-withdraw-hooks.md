# Issue #551: [FE] [Stellar] Withdraw flow: request_withdrawal → voucher → claim_request hooks

Source: https://github.com/eq-lab/pipeline/issues/551

## Scope

Build the Stellar/Soroban counterpart of the EVM withdrawal hooks
(`packages/frontend/src/wallet/evm/useWithdrawalQueue.ts`) so the frontend can
drive a real PLUSD → USDC withdrawal against the testnet `withdrawal_queue`
contract `CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7` (corrected
live address per the 2026-06-16 issue comment; the checked-in
`contracts/withdrawalQueue.ts` header still cites the stale `CB5CT…G2SL`).

This issue is **symmetric to #550** (Stellar deposit hooks). #550's plan exists
at `docs/exec-plans/active/issue-550-stellar-deposit-hooks.md` but its hooks are
**not yet implemented** in the repo — only the foundation (#549) clients/SAC
layer exist. The two issues share the same submit+poll+`returnValue` helper,
the same voucher-fetch pattern, the same trustline action, and the same
in-flight-recovery approach. **The shared pieces must be factored once, not
duplicated.** See "Coordination with #550" below.

In scope — under `packages/frontend/src/wallet/stellar/` (and `src/api/`):

1. **Shared Soroban submit+poll helper** that returns the decoded `returnValue`
   (new vs `submitBlendTx`, which discards it). Both #550 and #551 consume it.
2. `useStellarRequestWithdrawal()` — write hook for
   `request_withdrawal(sender, amount: i128) → request_id: u128`. Builds (via the
   existing `WithdrawalQueueClient.buildRequestWithdrawal`) → signs → submits →
   polls → decodes `request_id` from the tx `returnValue`. PLUSD is pulled from
   the sender via Soroban auth in the same invocation (no approve step).
3. `useStellarClaimWithdrawal()` — write hook for
   `claim_request(request_id: u128, verifier_signature: BytesN<64>)`. Takes the
   request id and the decoded 64-byte ed25519 signature, builds (via
   `WithdrawalQueueClient.buildClaimRequest`) → signs → submits → polls.
4. `useStellarWithdrawalRequest(requestId)` — React Query wrapper over
   `WithdrawalQueueClient.getRequest(requestId)` for status (`claimed`,
   `amount`, `timestamp`, `user`) and resume validation.
5. `useStellarWithdrawalVoucher(requestId)` — React Query hook mirroring
   `src/api/useWithdrawalVoucher.ts`, fetching
   `GET /v1/withdrawals/{request_id}/voucher?wallet=<G…>&chain_id=<stellar>`.
   Per #555 the endpoint dispatches on `chain_id`; for Stellar it returns a
   hex-encoded 64-byte ed25519 signature (vs 65-byte EVM). Expose both the hex
   `signature` and a decoded `signatureBytes: Uint8Array` for `claim_request`.
6. **USDC trustline** support: expose `needsTrustline` (USDC, since claim pays
   out USDC) and a `useChangeTrust()` action for the USDC classic asset, so the
   UI (#553/withdraw page, out of scope) can insert a trustline step before
   claim. NOTE the asset direction is the mirror of #550: withdraw claims pay
   **USDC**, so the trustline guard is on `addresses.usdcAsset`, not PLUSD.
7. Client-side in-flight request recovery via `localStorage` keyed by account,
   validated through `get_request`.
8. Mock-layer keys + non-reactive readers, hook-level tests (mocked RPC), and a
   user-stories doc (ISSUE_PROTOCOL §6).

Out of scope: withdraw page/UI wiring (step model, trustline step insertion,
XLM-fee display) — owned by the withdraw UI issue. The deposit sibling is #550.
No backend/API changes (voucher + indexer already merged via #555/#528). No new
product behavior beyond exposing hooks.

## Coordination with #550

Both issues need the same shared infra. To avoid duplication and merge
conflicts, this plan **defines** the shared modules; whichever issue lands first
creates them, the second consumes them. The coder for #551 must check whether
#550 already merged these before re-creating them:

- **`stellar/-submitSoroban.ts`** (private, `-` prefix like `-useBlendSubmit.ts`):
  a generic `submitSorobanTx({ buildXdr | assembledXdr, sourceAddress, sign })`
  that runs sign → `TransactionBuilder.fromXDR` → `sendTransaction` →
  `pollTransaction`, and returns `{ hash, returnValue?: xdr.ScVal }`. This is the
  generalization of `submitBlendTx` that **surfaces `returnValue`**. The existing
  `WithdrawalQueueClient`/`DepositManagerClient` builders already simulate +
  assemble and return assembled XDR, so the helper takes the assembled XDR,
  signs it, and submits — it does NOT re-simulate.
- **`useStellarChangeTrust()`** — a classic-asset `changeTrust` action
  (Horizon, not Soroban), parameterized by `{ code, issuer }`. Shared because
  #550 needs it for PLUSD and #551 needs it for USDC. Put it in a dedicated
  `stellar/useStellarChangeTrust.ts` exporting a hook that takes the asset.
- **In-flight recovery helper** — a small `localStorage` module parameterized by
  a key namespace (`deposit` vs `withdrawal`) and account.
- **Voucher hooks** share no code beyond the `useWithdrawalVoucher` template;
  keep `useStellarDepositVoucher` and `useStellarWithdrawalVoucher` as separate
  thin hooks (they hit different endpoints), but both must add the `chain_id`
  query param (see Open Questions).

If #550 has NOT merged when #551 is implemented, #551 creates these shared
modules; the #550 coder then consumes them. Note this explicitly in the PR.

## Assumptions and Risks

- **Foundation is merged.** #549 is present: `WithdrawalQueueClient`
  (`contracts/withdrawalQueue.ts`) with `buildRequestWithdrawal` /
  `buildClaimRequest` / `getRequest` / `paused` / `verifier` / `digest`, the SAC
  token layer (`useStellarSacToken.ts` with `SAC_DECIMALS=7`,
  `sacDisplayToRaw`/`sacRawToDisplay`, `hasTrustline`), the addresses hook
  (`useStellarDepositManagerAddresses.ts` exposing `usdcAsset`/`plusdAsset`), the
  wallet `signTransaction` (`useStellarWallet.ts`), `chain.ts` exporting
  `withdrawalQueueId`, and `env.ts` `STELLAR_WITHDRAWAL_QUEUE_ID` (defaults `""`).
- **Submit lifecycle template.** `submitBlendTx` in `blendPool.ts`
  (sign → `fromXDR` → `sendTransaction` → `pollTransaction`) is the template,
  but the `WithdrawalQueueClient` builders already simulate+assemble, so the new
  helper signs the assembled XDR directly (matches Blend's assembled-then-sign
  order). Confirm the assembled XDR is the correct envelope to hand to
  `signTransaction` (it should be).
- **`request_id` parsing from `returnValue`.** `request_withdrawal` returns
  `u128`. After `pollTransaction` SUCCESS, decode
  `(finalResult as Api.GetSuccessfulTransactionResponse).returnValue` (an
  `xdr.ScVal`) via `scValToNative` → `bigint`. `submitBlendTx` discards this, so
  the path is new. Risk: confirm the SDK exposes `returnValue` on the SUCCESS
  poll result for an assembled invoke-host-function tx. Flagged in Open
  Questions; fallback below.
- **Single auth entry (no approve step).** `request_withdrawal` pulls PLUSD via
  Soroban auth inside one invocation. Verify simulation yields exactly one
  signable auth entry; if a separate SAC-allowance auth appears, the hook needs
  a pre-step (flag in Open Questions during implementation).
- **7 decimals, i128.** Reuse `sacDisplayToRaw`/`sacRawToDisplay`/`SAC_DECIMALS`
  from `useStellarSacToken.ts`. Do NOT reuse EVM's 6-dp helpers.
- **USDC trustline (mirror of #550).** Claiming a withdrawal pays out USDC; an
  account that only ever held PLUSD via Soroban paths may lack a USDC trustline
  → claim fails. The trustline guard for withdraw is on USDC
  (`addresses.usdcAsset`), the opposite asset from #550's deposit (PLUSD).
  `changeTrust` is a classic Horizon op, signed via the same wallet kit, built
  with `Operation.changeTrust({ asset: new Asset(code, issuer) })`, submitted via
  `Horizon.Server.submitTransaction`.
- **Mock signing.** `signTransaction` rejects on the mock path by design — the
  write hooks must mock at their own result-level keys (the `-useBlendSubmit.ts`
  pattern), never relying on `signTransaction` in mock mode.
- **Dev-only verifier fallback.** The issue says the
  `VITE_STELLAR_VERIFIER_SECRET` local-signer fallback is **optional** on testnet.
  Since #555's production ed25519 endpoint is merged, recommend **omitting it**
  for parity with EVM (which has no fallback). Flagged in Open Questions.
- **Stale checked-in address.** `contracts/withdrawalQueue.ts` header cites
  `CB5CT…G2SL`; `.env.example` lines 96/186 also cite it. Update both to the live
  `CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7`. Doc/config-only,
  low risk.
- **`chain_id` for the voucher endpoint.** Per #555 the voucher route dispatches
  on a `chain_id` query param; the EVM `useWithdrawalVoucher` does **not** send
  one. The Stellar hook must append `&chain_id=<stellar synthetic id>`. The repo
  uses `99000001` as the Stellar testnet synthetic chain id (see
  `.env.example` `CHAIN_99000001_STELLAR_*`). Confirm this is the exact value the
  merged #555 route expects, and where it should live on the FE (likely a
  `chain.ts` export). Flagged in Open Questions.

## Open Questions

- What exact `chain_id` value must the Stellar voucher request send, and is it
  exposed to the FE today? The indexer/API config uses `99000001` for Stellar
  testnet, but #555's body left the synthetic-id representation as a planner
  decision — confirm the merged route's expected value before wiring
  `&chain_id=`. (Plan assumes `99000001`, sourced from a new `chain.ts` constant.)
- Should the dev-only `VITE_STELLAR_VERIFIER_SECRET` local-signing fallback be
  implemented at all? Recommendation: omit it for EVM parity now that #555's
  production endpoint is merged. Confirm.
- Does the Soroban `pollTransaction` SUCCESS result reliably expose
  `request_withdrawal`'s `returnValue` so we can decode `request_id` client-side?
  If not, what is the canonical id source for the real path (e.g. a
  `/v1/requests`-style list from the #528 indexer)? (Plan assumes `returnValue`
  is available; falls back to client-side recovery + indexer if not.)
- Is a Stellar request-list API (`GET /v1/requests?wallet=<G…>`) live from the
  #528 indexer so resume can mirror EVM, or must Stellar rely solely on
  client-side `get_request` + localStorage recovery? (Plan defaults to
  client-side recovery as the safe path; same open question as #550.)

## Implementation Steps

1. **Shared submit helper** — add `stellar/-submitSoroban.ts` (or extend an
   existing private module if #550 already created one). Export
   `submitSorobanTx({ assembledXdr, sourceAddress, sign })` returning
   `{ hash: string; returnValue?: xdr.ScVal }`: `sign(assembledXdr)` →
   `TransactionBuilder.fromXDR(signedTxXdr, passphrase)` → `sendTransaction`
   (throw on `ERROR`) → `pollTransaction` (throw on non-SUCCESS) → read
   `returnValue` off the SUCCESS response. Reuse `sorobanRpcUrl`/
   `networkPassphrase` from `chain.ts`. Keep it free of contract-specific logic.
2. **`useStellarRequestWithdrawal()`** in `stellar/useStellarWithdrawalQueue.ts`.
   State model copied from `-useBlendSubmit.ts`:
   `{ write(amountRaw: bigint), data: { hash, requestId? }, isPending, isSuccess,
   error, reset }`. Real path: construct `WithdrawalQueueClient` from
   `withdrawalQueueId`; fetch `sourceAccount` via `rpc.Server.getAccount(address)`;
   `client.buildRequestWithdrawal(address, amountRaw, sourceAccount)` → assembled
   XDR → `submitSorobanTx` → `scValToNative(returnValue)` → `requestId: bigint`
   (string in `data`). Unconfigured (`withdrawalQueueId === ""`): `write()` sets
   `Error("WithdrawalQueue not configured")`. Mock key
   `pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal` (JSON
   `{ hash, requestId? }`).
3. **`useStellarClaimWithdrawal()`** in the same module.
   `{ write(requestId: bigint, verifierSignature: Uint8Array), data: { hash },
   isPending, isSuccess, error, reset }`. Validate 64-byte sig (client also
   validates) → `client.buildClaimRequest(requestId, verifierSignature,
   sourceAccount)` → `submitSorobanTx`. Mock key
   `pipeline.mock.wallet.stellar.withdrawalQueue.claimWithdrawal` (JSON
   `{ hash, amount? }`).
4. **`useStellarWithdrawalRequest(requestId)`** — React Query wrapper over
   `WithdrawalQueueClient.getRequest(requestId)` returning
   `{ request, isLoading, error, refetch }` (`request: WithdrawalRequest`). Used
   for status polling and resume validation. Disabled when `requestId` is
   undefined or `withdrawalQueueId === ""`. Optional mock key.
5. **`useStellarWithdrawalVoucher(requestId)`** in `src/api/` (sibling of
   `useWithdrawalVoucher.ts`). Copy the polling/retry/status machine; use
   `useStellarWallet()` for the `wallet` query param and a `G…` address; **append
   `&chain_id=<stellar>`** to the request URL (value per Open Questions). Expose
   `data.signature` (hex) plus a decoded `signatureBytes: Uint8Array` (hex →
   bytes) for `useStellarClaimWithdrawal`. Reuse the same mock-version external
   store + `pipeline.mock.api.GET./v1/withdrawals/<id>/voucher[?wallet=…]` keys
   (the existing alias keys already cover withdrawals — confirm the Stellar hex
   `signature` value flows through unchanged).
6. **USDC trustline** — `useStellarChangeTrust(asset: { code, issuer })` in
   `stellar/useStellarChangeTrust.ts` (shared with #550): builds a classic
   `changeTrust` op via `Horizon.Server`, signs via `useStellarWallet().
   signTransaction`, submits via `Horizon.Server.submitTransaction`, exposes
   `{ submit, isPending, isSuccess, error, reset }`. Mock key
   `pipeline.mock.wallet.stellar.changeTrust`. In the withdraw module, expose a
   `needsTrustline` derived from `useStellarSacToken({ assetCode: "USDC",
   assetIssuer: usdcAsset.issuer, contractId: usdc }).hasTrustline === false`
   (USDC direction — the payout asset).
7. **In-flight recovery** — small `localStorage` module keyed by namespace +
   account (e.g. `pipeline.stellar.withdrawal.inflight.<G…>`) storing
   `{ requestId, amount, createdAt }`, written on a successful
   `request_withdrawal`, read on mount, validated via
   `useStellarWithdrawalRequest` (drop entries where `get_request` shows
   `claimed: true` or 404; ignore corrupt/foreign-account entries). Share the
   parameterized module with #550. Gate on the Open Question outcome — if a
   Stellar request-list API is live, prefer that and keep localStorage as a
   fallback only.
8. **Mock keys + readers** — add the new keys to `stellar/mock.ts`
   (`STELLAR_MOCK_KEYS`: `withdrawalQueueRequestWithdrawal`,
   `withdrawalQueueClaimWithdrawal`, `changeTrust`) with non-reactive
   `readMock…` readers, mirroring the Blend entries.
9. **Barrel exports** — export the new hooks from `src/wallet/index.ts` (Stellar
   namespace grouping) and the voucher hook from `src/api/index.ts`, matching the
   existing export grouping.
10. **Fix stale docs/config** — update `contracts/withdrawalQueue.ts` header
    comment to the live `CC3TWGF…GU3Q7` address + capture note; update
    `.env.example` lines 96 and 186 to the live address; ensure the Stellar
    voucher `chain_id` is documented.
11. **Docs** — update `src/wallet/README.md` (new Stellar withdraw mock-key
    schema + hook list) and `src/api/README.md` (`useStellarWithdrawalVoucher`
    mock keys + `chain_id` note).
12. **Lint** — run `npx tsx scripts/lint-docs.ts` and the frontend
    lint/typecheck; respect the ESLint `no-restricted-imports` boundary
    (stellar-sdk only via `contracts/`/`chain.ts`/boundary modules — the new
    `-submitSoroban.ts` and `useStellarChangeTrust.ts` live under
    `src/wallet/stellar/**`, which is allowed).

## Test Strategy

Hook-level tests with mocked Soroban RPC / Horizon (Vitest + React Testing
Library), following `useWithdrawalQueue.test.tsx`, `useBlendWithdraw.test.tsx`,
and `useWithdrawalVoucher.test.tsx` conventions:

- **`useStellarRequestWithdrawal`**: mock-key happy path (returns
  `{ hash, requestId? }`); real path with a stubbed `rpc.Server` returning a
  SUCCESS poll carrying a `u128` `returnValue` → asserts decoded `requestId`;
  paused-contract / simulation error → `error` set; declined signature
  (`signTransaction` rejects) → `error` set, `isPending` clears; unconfigured
  (`withdrawalQueueId === ""`) → `Error("WithdrawalQueue not configured")`;
  7-decimal scaling via `sacDisplayToRaw`; re-entrant `write()` guarded while
  `isPending`.
- **`useStellarClaimWithdrawal`**: mock-key happy path; rejects non-64-byte
  signature; missing-trustline claim failure surfaces a readable error; declined
  signature; unconfigured.
- **`useStellarWithdrawalRequest`**: returns parsed `WithdrawalRequest`; disabled
  when `requestId` undefined / unconfigured; surfaces query error.
- **`useStellarWithdrawalVoucher`**: idle (no requestId / disconnected),
  pending→ready polling transition, hex→bytes decode correctness, request URL
  includes `&chain_id=`, retriable 404/403 then ready, exhausted-retry → failed;
  mock-key fast path (un-keyed alias + per-wallet override).
- **`useStellarChangeTrust`**: happy path (mocked Horizon submit) for USDC;
  declined signature; mock-key path.
- **In-flight recovery**: write persists localStorage entry; mount reads it;
  `get_request` showing `claimed` evicts it; corrupt/foreign-account entries
  ignored.
- **Edge cases**: zero / over-balance amount, simulation-error mapping.

Manual/acceptance (documented in the user-stories doc, executed by the withdraw
UI issue / QA): on testnet with a funded account holding PLUSD,
request_withdrawal → poll `get_request` → fetch voucher → (USDC trustline if
missing) → claim succeeds; USDC balance increases, PLUSD decreases.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — new Stellar withdraw mock-key schema
  + hook list (`useStellarRequestWithdrawal`, `useStellarClaimWithdrawal`,
  `useStellarWithdrawalRequest`, `useStellarChangeTrust`).
- `packages/frontend/src/api/README.md` — `useStellarWithdrawalVoucher` mock keys
  + the `chain_id` query-param note.
- `packages/frontend/src/wallet/stellar/contracts/withdrawalQueue.ts` — header
  comment: live `CC3TWGF…GU3Q7` address + capture note.
- `.env.example` — lines 96 and 186: live `VITE_STELLAR_WITHDRAWAL_QUEUE_ID`
  / `CHAIN_99000001_STELLAR_WITHDRAWAL_QUEUE_ID` value; document the Stellar
  voucher `chain_id`.
- Epic user-stories doc (per ISSUE_PROTOCOL §6) — Stellar withdraw user story,
  shipped in the PR.
- No product-spec behavior change beyond exposing hooks; withdraw UX behavior is
  owned by the withdraw UI issue.
