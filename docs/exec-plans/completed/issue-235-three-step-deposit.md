# Issue #235: Split /deposit into three steps — Approve, Confirm USDC transfer, Claim PLUSD

Source: https://github.com/eq-lab/pipeline/issues/235

## Scope

Convert the `/deposit` page from a two-step (Approve → Convert) flow to a three-step flow that mirrors the contract + API surface:

| # | Step label                       | Action button | Underlying hook |
|---|----------------------------------|---------------|-----------------|
| 1 | "Allow Pipeline to use USDC"     | Approve       | `useToken().approve` (via `useApproval`) |
| 2 | "Confirm USDC transfer"          | Confirm       | `useRequestDeposit.write` |
| 3 | "Claim your PLUSD"               | Claim         | `useClaim.write(requestId, signature)` after `useDepositVoucher` returns a signature |

Design reference: [Figma node 1498:100812](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100812&m=dev).

In scope:

- Step copy + ordering in `packages/frontend/src/routes/deposit.tsx`.
- New `useDepositVoucher(requestId, wallet)` hook in `packages/frontend/src/api/` that hits `GET /v1/deposits/{request_id}/voucher?wallet=<addr>`, with mock-layer support, retry/polling on the verifier-pending case (404 specifically) and a `status` field.
- Surfacing `requestId` from a real `requestDeposit` tx by adding the `DepositRequested` event to `depositManagerAbi` and decoding it from the tx receipt inside `useRequestDeposit` (real path). The mock path already returns `requestId` and must keep working.
- Wiring step-3 enable/disable + Claim onClick using the existing `useClaim` hook (already in `src/wallet/useDepositManager.ts`).
- Updating route/test file `packages/frontend/src/routes/-deposit.test.tsx` to cover the three-step flow end-to-end against mocks.
- README updates for the new mock key + the new `useDepositVoucher` hook.

Out of scope (per Issue):

- Tx confirmation modal / dedicated success screen.
- Receipt polling beyond what's needed to extract `requestId`.
- Voucher "failed / retry" UX beyond keeping Claim disabled + surfacing the error inline.
- Any backend changes to `/v1/deposits/{request_id}/voucher` (already shipped).

## Assumptions and Risks

**Assumptions**

- `StepsCard` already supports an arbitrary number of `steps` (verified in `packages/ui/src/components/StepsCard/StepsCard.tsx`) and `state: "success"` (verified — `StepItem.state?: "idle" | "success"` exists). No `@pipeline/ui` change is required.
- `useClaim` already exists with `write(requestId: bigint, verifierSignature: 0x${string})` and a mock key (`pipeline.mock.wallet.contract.depositManager.claim`) — keep using it as-is.
- The voucher endpoint returns the shape declared in `packages/api/src/routes/vouchers.rs` — `{ request_id, amount, user, signature }`. The signature is what the contract's `claim(requestId, verifierSignature)` expects (already aligned in #229's API contract).
- For the receipt-decode path, the page already runs inside `WagmiProvider`, so `useWaitForTransactionReceipt` from `wagmi` is available. We will add it to `useRequestDeposit` (not the page) to keep all wagmi/viem usage inside `src/wallet/`.
- The verifier produces a voucher with some latency (KYT + on-chain-allowed checks happen between `requestDeposit` and a successful voucher response). The endpoint returns `404` until the deposit row is visible and `403` until the KYT check passes. Polling on `404`/`403` is acceptable for this Issue; longer-running failure UX is out of scope.

**Risks**

- **`requestId` decoding**: `DepositRequested` is not in `depositManagerAbi` today. If the on-chain event name/signature differs from what we add, the decoded `requestId` will be missing. Mitigation: cross-check the canonical ABI in `docs.local/manager_abi.txt` (referenced by the existing ABI file) and add the exact event signature; on decode failure fall back to `data.requestId === undefined` and disable step 3 with a clear error. **Open question logged below** to confirm the event signature before implementation.
- **Voucher polling cadence**: a tight loop would hammer the API and burn the verifier's rate limit. Plan uses React Query with a bounded `retry` / `refetchInterval` (e.g. 2-3s, capped at ~60s) and stops once we get either `signature` or a non-retriable error.
- **Real wagmi receipt latency**: `useWaitForTransactionReceipt` resolves after a block confirmation (1-2s on Hoodi testnet). During that window step 2 stays in the "loading" state. Acceptable, but means step 3 doesn't light up immediately on a fresh testnet run. The mock path is unchanged.
- **Mock test file is `-deposit.test.tsx`**: the file is prefixed with `-` to make TanStack Router skip it. Vitest still discovers it. Confirm the test command (`pnpm -F frontend test`) picks it up — it currently does, per `packages/frontend/src/routes/-deposit.test.tsx` already existing and asserting against the route. No change to the convention.
- **Cross-Issue ordering**: this Issue assumes `#227` (state machine + steps 1/2), `#229` (`src/api/` module + mocked `apiFetch`), `#232` (min-deposit gate), and `#234` (`state: "success"` on step rows) have all landed. They are present on `main` / current branch (verified by reading code).

## Open Questions

- **Event signature for `requestId` extraction**: the current `depositManagerAbi` does not include `DepositRequested`. Before coding, confirm the canonical event signature from `docs.local/manager_abi.txt` (or the on-chain contract) and the position of the `requestId` argument. The Issue body says "emits a `DepositRequested(requestId, …)` event" — we need to confirm the full argument list (especially whether `user`/`amount` are indexed) so the decoder is correct. If `docs.local/manager_abi.txt` is unavailable to the coder, the coder may pull the event from the contract source under `packages/contracts/` (if present) instead.
- **Voucher polling cadence + timeout**: the Issue leaves cadence open. Proposed default: `refetchInterval: 3000` with no hard timeout; `retry` set so React Query keeps re-issuing while the endpoint returns 404/403. Confirm this is acceptable, or set a fixed max-attempts (e.g. 20 ≈ 60s) and surface a "Voucher not ready" error after that.

## Implementation Steps

### 1. ABI: add `DepositRequested` event

Edit `packages/frontend/src/wallet/abis/depositManager.ts`:

- Append a new entry of `type: "event"`, `name: "DepositRequested"`, with the canonical argument list confirmed in Open Questions. Expected shape (subject to confirmation):

```ts
{
  type: "event",
  name: "DepositRequested",
  inputs: [
    { name: "requestId", type: "uint256", indexed: true },
    { name: "user",      type: "address", indexed: true },
    { name: "amount",    type: "uint256", indexed: false },
  ],
  anonymous: false,
}
```

Keep the `as const` annotation so viem types stay tight.

### 2. `useRequestDeposit`: decode `requestId` on the real path

Edit `packages/frontend/src/wallet/useDepositManager.ts`:

- Import `useWaitForTransactionReceipt` from `wagmi` and `decodeEventLog` from `viem` (both are allowed inside `src/wallet/` per the ESLint boundary).
- On the real wagmi path (i.e. neither mock nor zero-address):
  1. Call `useWaitForTransactionReceipt({ hash: wagmiWrite.data, query: { enabled: !!wagmiWrite.data } })`.
  2. Once the receipt is available, iterate `receipt.logs`, attempt `decodeEventLog({ abi: depositManagerAbi, ...log })` and pick the first log where `eventName === "DepositRequested"`.
  3. Stash the decoded `requestId.toString()` in component state and surface it via the existing `data.requestId` field. Until the receipt + decode complete, `data` should be `{ hash }` with no `requestId` (existing behaviour).
- Mock path: unchanged (already returns `{ hash, requestId }`).
- Zero-address: unchanged.
- Keep `isSuccess` semantics aligned with `useApproval`'s "broadcast-accepted" definition — but introduce a new derived flag `isReceiptReady = data?.requestId !== undefined` so the page can wait for the decoded id before unlocking step 3. Alternative: simply gate on `data?.requestId !== undefined` directly in the page. Pick whichever is least intrusive; do not change the public type of `RequestDepositResult` beyond what already exists.

### 3. New hook: `useDepositVoucher`

Create `packages/frontend/src/api/useDepositVoucher.ts`:

- Signature: `useDepositVoucher(requestId: string | undefined): { data: VoucherResponse | undefined; status: "idle" | "pending" | "ready" | "failed"; error: Error | null; refetch: () => void }`.
- Reads the connected wallet from `useWallet()` (via `@/wallet`). When `requestId === undefined` or wallet is disconnected, return `{ data: undefined, status: "idle", error: null, refetch: noop }` (do not issue any fetch).
- Internally uses React Query, mirroring `useRequests.ts`:
  - `queryKey: ["deposit-voucher", requestId, address, mockVer]` (include the same `mockVer` external-store counter so DevTools writes to `pipeline.mock.api.*` instantly refetch).
  - `queryFn: () => apiFetch<VoucherResponse>(\`/v1/deposits/${requestId}/voucher?wallet=${address}\`)`.
  - `enabled: !!requestId && isConnected && !!address`.
  - `refetchInterval: 3000` while data is `undefined` and the last error is a 404/403; stop once `data.signature` is present. Use a simple `select` or a wrapper to flip `status`. Acceptable simplification: rely on React Query's default `retry: 3` + a manual `setInterval` via a custom `refetchInterval(query)` function that returns `3000` if `query.state.data === undefined && (query.state.error?.message.includes("not found") || query.state.error?.message.includes("not yet allowed"))`, else `false`. See Open Questions for cadence.
- Export the `VoucherResponse` type matching the backend (`request_id`, `amount`, `user`, `signature`).
- Derive `status`:
  - `"idle"` — query disabled (no `requestId` / disconnected).
  - `"pending"` — query enabled but `data === undefined` and `error === null`.
  - `"ready"` — `data?.signature` truthy.
  - `"failed"` — `error` truthy and not a retriable 404/403.

Update `packages/frontend/src/api/index.ts` to re-export `useDepositVoucher` and `VoucherResponse`.

### 4. Mock layer for `useDepositVoucher`

Mock-key contract (must match `apiFetch`'s lookup order):

- `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>` (most-specific) — JSON `{ request_id, amount, user, signature }`.
- `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher` (alias without query string) — same payload.

No code change is needed in `apiFetch` — the existing without-query fallback handles both. The hook only needs to format the URL identically to how it will be mocked (path + `?wallet=`).

### 5. `/deposit` page: three-step state machine

Edit `packages/frontend/src/routes/deposit.tsx`:

- Import `useClaim` from `@/wallet` and `useDepositVoucher` from `@/api`.
- Add to existing destructuring: `const claim = useClaim();`.
- Drive a new local `requestId` derivation:
  - `const requestId = requestDeposit.data?.requestId;` (string from mock or decoded receipt).
- Voucher hook: `const voucher = useDepositVoucher(requestId);` — pass `requestId` even when `undefined`; the hook short-circuits.
- Re-define `canApprove`, `canConvert` (rename to `canConfirm`), and add `canClaim`:
  - `canApprove` — unchanged from current logic.
  - `canConfirm` — current `canConvert` plus a new clause `requestId === undefined` (don't let users re-fire step 2 after a successful tx).
  - `canClaim = isConnected && requestId !== undefined && voucher.status === "ready" && !claim.isPending`.
- Step 1 copy: `"Allow contract to use USDC"` → `"Allow Pipeline to use USDC"`. Action label stays `"Approve"`.
- Step 2 copy: `"Confirm and receive PLUSD"` → `"Confirm USDC transfer"`. Action label: `"Convert"` → `"Confirm"`.
- Step 2 `state` becomes `"success"` once `requestDeposit.isSuccess && requestId !== undefined` (so the "Done" badge only appears once we've successfully captured the id).
- Step 3 (new):
  ```ts
  {
    label: "Claim your PLUSD",
    actionLabel: "Claim",
    disabled: !canClaim,
    loading: voucher.status === "pending" || claim.isPending,
    state: claim.isSuccess ? "success" : "idle",
    onAction: () => {
      if (requestId === undefined || !voucher.data?.signature) return;
      claim.write(BigInt(requestId), voucher.data.signature as `0x${string}`);
    },
  }
  ```
- Side effect: refetch USDC balance on `claim.isSuccess` so the "balance" row updates after PLUSD is claimed. Optionally also refetch on `requestDeposit.isSuccess` (already wired today).
- Update the JSDoc on the file:
  - Point Figma reference to node `1498-100812`.
  - Rewrite the "state-driven conversion page" doc to describe the three steps + voucher gating instead of the current two states.

### 6. Wallet README update

Edit `packages/frontend/src/wallet/README.md`:

- No new wallet mock keys are introduced (the `requestDeposit` mock key already documents `requestId`). Confirm the existing example matches `{ hash, requestId? }` shape (it does).

### 7. API README update

Edit `packages/frontend/src/api/README.md`:

- Add a row to the "useDepositVoucher mock keys" subsection (new subsection):
  | Key | Type | Purpose |
  |---|---|---|
  | `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher` | JSON `{ request_id, amount, user, signature }` | Bypasses the real voucher fetch. |
  | `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>` | JSON `…` | Per-wallet override. |
- Add a DevTools snippet that seeds a voucher and shows the `/deposit` page lighting up step 3.
- Add `useDepositVoucher` and `VoucherResponse` to the public-API table.

### 8. Route test update

Edit `packages/frontend/src/routes/-deposit.test.tsx`:

- Update existing assertions for renamed copy: `"Confirm"` button instead of `"Convert"`, `"Allow Pipeline to use USDC"` instead of `"Allow contract to use USDC"`.
- Add `seedBaseMocks` extensions:
  - Mock claim tx key (`pipeline.mock.wallet.contract.depositManager.claim` → `JSON.stringify({ hash: "0xclaim" })`).
  - Mock voucher key (`pipeline.mock.api.GET./v1/deposits/42/voucher` → `JSON.stringify({ request_id: "42", amount: "2000000000", user: WALLET_ADDRESS, signature: "0xsig" })`).
- New test cases (target ~5 additions):
  1. Three steps render with the new copy in order (1: Approve, 2: Confirm, 3: Claim).
  2. With sufficient allowance + amount typed but no `requestDeposit` yet → step 3 disabled.
  3. After mock `requestDeposit` resolves (`requestId === "42"`) but no voucher mock seeded → step 3 still disabled (voucher pending).
  4. With voucher mock seeded → step 3 enabled; clicking Claim calls `useClaim.write(42n, "0xsig")`. Assert by stubbing the mock claim key and observing `mockState` settlement, OR by spying on `useClaim` (preferred: keep the mock-key path used elsewhere and check side effects — e.g. step 3 transitions to `success` state).
  5. After `claim.isSuccess` → step 3 shows the success badge ("Done").
  6. Below-min amount still disables step 1 + 2 (existing behaviour preserved).

### 9. Lint + typecheck

After edits:

- `pnpm -F frontend lint`
- `pnpm -F frontend typecheck` (or whatever the workspace exposes)
- `pnpm -F frontend test -- routes/-deposit`
- `npx tsx scripts/lint-docs.ts` (per AGENTS.md)

## Test Strategy

**Automated (Vitest):**

- All test cases listed in step 8.
- Regression for #227, #232, #234 — keep the existing test cases passing without modification, only update the renamed button/label strings.

**Manual (Figma-driven, performed by `ux-tester` skill via Chrome DevTools MCP):**

- Walk the three-step flow on a local dev server using the mock-key DevTools snippets:
  1. Seed wallet + USDC + DM mocks with `allowance: "0"`, type 2000, click Approve → step 1 turns success.
  2. Re-seed allowance ≥ amount + `requestDeposit` mock with `requestId: "42"` → step 2 enabled, click Confirm → step 2 turns success.
  3. Seed the voucher mock and the `claim` mock → step 3 enabled, click Claim → step 3 turns success.
- Side-by-side compare against Figma node `1498-100812` for spacing, copy, button states, and the success badge style.

**Edge cases to cover in automated tests:**

- `requestId === undefined` after a hypothetical failed real-path receipt decode → step 3 stays disabled, no crash.
- `voucher.status === "failed"` → step 3 disabled; error shown (or silent) per the simplification in scope.
- Disconnecting mid-flow → all three buttons disabled.
- Below-min amount → steps 1 and 2 disabled (existing); step 3 also disabled (no `requestId`).

## Docs to Update

- `packages/frontend/src/api/README.md` — voucher mock keys + new hook docs (step 7).
- `packages/frontend/src/wallet/README.md` — only if confirmation reveals new public-surface changes; the existing `requestDeposit` row already documents `{ hash, requestId? }` (step 6).
- `packages/frontend/src/routes/deposit.tsx` — JSDoc + Figma reference (step 5).
- No product-spec change required: `docs/product-specs/deposits.md` already covers the conceptual three-step user flow (approve → request → claim with voucher). Verify and add a sentence on the new label copy only if the spec currently uses the old "Convert" naming. (If it does, append the new labels to the relevant subsection.)
