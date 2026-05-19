# Issue #307: Wire up /withdraw — three-step flow (Approve → Confirm → Claim USDC)

Source: https://github.com/eq-lab/pipeline/issues/307

## Scope

Replace the static `/withdraw` page (`packages/frontend/src/routes/withdraw.tsx`) with a fully wired three-step state machine that mirrors the deposit flow shipped in #235, but pointed at the **WithdrawalQueue** contract (#274 hooks) and at the **withdrawal voucher** API endpoint.

In scope:

1. New API hook `useWithdrawalVoucher(requestId)` in `packages/frontend/src/api/useWithdrawalVoucher.ts`, exported via `packages/frontend/src/api/index.ts`. Analogous to `useDepositVoucher` (#235) but reads `GET /v1/withdrawals/{request_id}/voucher?wallet=<addr>`. Same shape (`status: "idle" | "pending" | "ready" | "failed"`, retry/polling semantics, mock-key reactivity).
2. Rewrite `packages/frontend/src/routes/withdraw.tsx` into the three-step state machine:
   - Step 1 "Allow Pipeline to use PLUSD" — `useApproval({ token: plusd, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS })`
   - Step 2 "Confirm PLUSD burn" — `useRequestWithdrawal.write(amountBig)` (#274)
   - Step 3 "Claim your USDC" — `useClaimWithdrawal.write(requestId, voucher.signature)` (#274)
   - Active-request handling (lock input + chips on `PendingVerification`/`PendingClaim`, mirror #243).
   - `PendingVerification` → step 2 in loading state (mirror #242).
   - Quick-amount chips as percentages of live PLUSD balance: 25%/50%/75%/Max.
   - No min-withdrawal gate, no low-balance banner — disabled steps are the only "insufficient balance" affordance.
   - Faded-input affordance on step 2 mirrors deposit's `isInputFaded`.
   - Exchange-rate row "1 PLUSD = 1 USDC", network fee `—`.
   - Toast emissions for approve/request/claim phases, mirroring deposit (`useToast` calls keyed by `withdraw-approve-tx`, `withdraw-tx`, `withdraw-claim-tx`).
3. New mock-key plumbing:
   - Add a "Connected, PendingClaim withdrawal request, voucher ready" scenario in `packages/frontend/src/routes/test/-scenarios.ts`, mirroring the existing deposit `request-pending-claim` scenario.
   - Document the new mock key `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher` in `packages/frontend/src/api/README.md`.
4. Tests:
   - New `packages/frontend/src/routes/-withdraw.test.tsx` (analogous to `-deposit.test.tsx`) covering enable/disable gates, step transitions, active-request lock, voucher-ready claim, no-balance disablement.
   - New `packages/frontend/src/api/useWithdrawalVoucher.test.tsx` mirroring `useDepositVoucher` coverage (mock-path, real-fetch path, error path, disabled-when-undefined).
5. Documentation:
   - Add `useWithdrawalVoucher` row to `docs/frontend/hooks.md` (alphabetical position between `useWithdrawalQueueAddresses` and `useToast` — or wherever the alphabetical sort puts it).
   - Update `packages/frontend/src/api/README.md` with the new `useWithdrawalVoucher` public-API entry, type definitions, mock-key schema row, and DevTools snippet.
   - Note the deposit/withdraw symmetry in `packages/frontend/src/wallet/README.md` (short cross-reference paragraph; nothing more — the hook lives in `@/api`, not `@/wallet`).

Out of scope (per Issue body):

- Min-withdrawal gate (contract has none).
- Whitelist / Chainalysis preflight UI (revert surfaces as `useRequestWithdrawal.error`).
- Low-balance banner — no design exists; steps stay disabled when `balance === 0n` or `amount > balance`.
- Receipt-confirmation polling beyond what `useRequestWithdrawal` already does.
- `cancelWithdrawal`, queue-position display, shutdown-state UI.
- Permit-based approval replacement for `useApproval`.

## Assumptions and Risks

**Assumptions**

- The hooks landed in #274 (`useWithdrawalQueueAddresses`, `useRequestWithdrawal`, `useClaimWithdrawal`) match the shapes documented in `packages/frontend/src/wallet/useWithdrawalQueue.ts` — confirmed by reading the file: addresses hook returns `{ plusd, usdc, isLoading, error }`; write hooks return `{ write, data: { hash, requestId? | amount? }, isPending, isSuccess, error, reset }`.
- `useRequests` from `@/api` (#229) already supports `Withdraw` request rows with the same shape as `Deposit` rows — confirmed: `useRequests.ts` exports a `RequestType` union that includes `"Withdraw"` and a `RequestStatus` that includes `"PendingVerification"` and `"PendingClaim"`.
- `useApproval({ token, spender })` is generic and works with PLUSD as the token and `ENV.WITHDRAWAL_QUEUE_ADDRESS` as the spender — confirmed: the hook signature accepts any `{ token, spender }` pair and uses `pipeline.mock.wallet.allowance.<token>.<spender>` mock keys.
- Toast `useToast` API surface from `@/lib/toast` (`show` / `update`) is the same as used in `deposit.tsx`.
- `useToken({ token: plusd, spender: WQ })` will return PLUSD balance/decimals/symbol on the real path **provided** PLUSD has the standard ERC-20 metadata. There is no PLUSD-specific minDeposit hook (none needed — no min).
- `useDepositVoucher`'s reactive `subscribeMockVersion` pattern can be cloned verbatim for `useWithdrawalVoucher`; React Query queryKey scoped to `["withdrawal-voucher", requestId, address, mockVer]` is sufficient.
- `ENV.WITHDRAWAL_QUEUE_ADDRESS` is already plumbed (confirmed by grep in `packages/frontend/src/lib/env.ts`).

**Risks**

- **Real-path requestId discovery.** Per #274 the wagmi write hook returns `{ hash }` only — `requestId` is mock-only. On the real path we rely entirely on `useRequests` to surface the active `Withdraw` row's `request_id`. The deposit page handles this exact pattern; mirroring it should be safe but the brief post-success / pre-API-poll window may show step 2 loading without a `requestId` — handle the same way as deposit (`loading: requestWithdrawal.isPending || isPendingVerification || (requestWithdrawal.isSuccess && !requestIsConfirmed && activeRequest === null)`).
- **PLUSD balance source.** The Issue body suggests `useToken({ token: plusd })` if #220 has landed. `useToken` is already in the wallet module barrel (confirmed) — no fallback needed. If PLUSD metadata reads fail on the real path (no `symbol()` / `decimals()` exposed), balance will be `undefined`; steps stay disabled. Acceptable for this Issue; document in a comment.
- **Quick-amount percentage rounding.** Using integer math (`balance * 25n / 100n`) is the simplest faithful interpretation; documented in code.
- **`useApproval` for PLUSD when WQ is zero-address.** `useApproval` already has zero-spender safe-guards (no-op + typed error); covered.
- **Active-request type filtering.** `useRequests` returns `Withdraw` rows alongside `Deposit`/`Stake`/`Unstake`; filter by `r.type === "Withdraw"`.

**Dependencies**

- Hard dependency on #274 — merged (commit `9ef82eb` and `cfcbef0`). Verified the hooks exist in `packages/frontend/src/wallet/useWithdrawalQueue.ts`.
- Soft dependency on #229 (`useRequests`) — landed.
- Soft dependency on #235 (deposit flow) — landed; deposit is the structural template.
- Soft dependency on #243 (input-lock pattern) — landed in deposit.
- Soft dependency on #242 (PendingVerification visual) — landed in deposit.

## Open Questions

_None_

## Implementation Steps

### 1. New hook — `useWithdrawalVoucher`

Create `packages/frontend/src/api/useWithdrawalVoucher.ts` by cloning `useDepositVoucher.ts` and changing:

- File-level JSDoc — replace "deposit" with "withdrawal", path with `/v1/withdrawals/{request_id}/voucher`.
- `mockVersion`/`mockListeners`/`getMockVersion`/`subscribeMockVersion` — keep identical (the global mock event covers all `pipeline.mock.api.*` keys).
- `queryKey` → `["withdrawal-voucher", requestId, address, mockVer]`.
- `queryFn` → `apiFetch<VoucherResponse>(/v1/withdrawals/${requestId}/voucher?wallet=${address ?? ""})`.
- Re-export the same `VoucherResponse` shape — but re-declare locally in this file (do not re-export from `useDepositVoucher`) to keep the API symmetrical and to allow future divergence (e.g. EIP-712 domain differs but the `signature` field shape is identical, so locally re-declaring is cheap).

Update `packages/frontend/src/api/index.ts`:

- Export `useWithdrawalVoucher` (named export).
- Export the local `VoucherResponse` / `VoucherStatus` / `UseWithdrawalVoucherResult` types — if names collide with deposit's `VoucherResponse`, alias them on export (`WithdrawalVoucherResponse`, etc.). **Recommended approach:** rename the new file's types to `WithdrawalVoucherResponse` and `UseWithdrawalVoucherResult` (the `VoucherStatus` literal-union is identical across both hooks; either re-export the existing one or re-declare it — re-declaring is the safer choice to keep the two hooks independent).

### 2. New test — `useWithdrawalVoucher.test.tsx`

Create `packages/frontend/src/api/useWithdrawalVoucher.test.tsx`. Use the existing API-hook test scaffolding (look at `useRequests.test.tsx` for the QueryClientProvider setup pattern). If no prior `useDepositVoucher.test.tsx` exists in the repo (it does not — confirmed), structure this test from scratch with these cases:

1. Disabled when `requestId` is `undefined` — returns `status: "idle"`, no fetch issued.
2. Disabled when wallet is disconnected — `status: "idle"`.
3. Mock-key path (`pipeline.mock.api.GET./v1/withdrawals/42/voucher` set in localStorage) — `apiFetch` short-circuits via the mock layer; `status: "ready"`, data matches.
4. Real-fetch path — stub global `fetch` with a `{ signature: "0xdead…" }` response; expect `status: "pending"` then `"ready"`.
5. Retry on 404 ("Not Found") with exponential-stable retry — assert `query.failureCount` increases up to 20.
6. Reactive refetch — mutate `pipeline.mock.api.…/voucher` localStorage key; assert the queryKey advances via the `mockVer` counter.

Use `vi.useFakeTimers()` for retry-interval assertions where required; see `useRequests.test.tsx` for the pattern.

### 3. Rewrite `withdraw.tsx`

Replace the contents of `packages/frontend/src/routes/withdraw.tsx` with the equivalent of `deposit.tsx` but for the withdraw flow. Concretely:

**Imports** (mirror deposit, swap targets):

```ts
import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ConversionCard, DepositHeader, StepsCard } from "@pipeline/ui";
import {
  useWallet,
  useWithdrawalQueueAddresses,
  useRequestWithdrawal,
  useClaimWithdrawal,
  useToken,
} from "@/wallet";
import { useRequests, useWithdrawalVoucher } from "@/api";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc } from "@/lib/usdc";
import { useToast } from "@/lib/toast";
```

(`parseUsdc`/`formatUsdc` are decimal-agnostic — they accept any `decimals`. Their names are USDC-only by historical accident; reuse them for PLUSD's 18 decimals. No new util needed.)

**State sources**

- `const { address, isConnected } = useWallet();`
- `const { plusd } = useWithdrawalQueueAddresses();`
- `const plusdAddr = (plusd ?? ZERO_ADDRESS) as `0x${string}`;`
- `const { decimals, balance, formattedBalance, allowance, approve, isApprovePending, isApproveSuccess, refetchBalance } = useToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS });`
- `const requestWithdrawal = useRequestWithdrawal();`
- `const claim = useClaimWithdrawal();`
- `const { data: requestsData } = useRequests({ refetchInterval: 60_000 });`

**Local state**

- `const [amountInput, setAmountInput] = useState("");`

**Derived**

- `const amountBig = parseUsdc(amountInput, decimals);` (the helper is decimal-agnostic.)
- `const isReady = decimals !== undefined && balance !== undefined;`
- `const canDeposit = isReady && amountBig > 0n && amountBig <= (balance as bigint);` — equivalent of deposit's `meetsMin + hasBalance`. (No min.)
- `const needsApproval = allowance !== undefined && amountBig > 0n && allowance < amountBig;`
- `activeRequest` — first item from `requestsData?.requests.filter(r => r.type === "Withdraw" && (r.status === "PendingVerification" || r.status === "PendingClaim")).sort(by created_at desc)`.
- `requestId = activeRequest?.request_id ?? requestWithdrawal.data?.requestId;`
- `requestIsConfirmed = activeRequest !== null || (requestWithdrawal.isSuccess && requestId !== undefined);`
- `isPendingClaim = activeRequest?.status === "PendingClaim";`
- `isPendingVerification = activeRequest?.status === "PendingVerification";`
- `isAmountLocked = activeRequest !== null;`
- `isInputFaded = isConnected && !needsApproval && amountBig > 0n && !requestIsConfirmed;`
- `voucher = useWithdrawalVoucher(isPendingClaim ? requestId : undefined);`

**Step gates** (mirror deposit one-for-one)

- `canApprove = isConnected && canDeposit && needsApproval && !isApprovePending && !requestIsConfirmed;`
- `canConfirm = isConnected && canDeposit && !needsApproval && !requestWithdrawal.isPending && !requestIsConfirmed;`
- `canClaim = isConnected && requestId !== undefined && voucher.status === "ready" && !claim.isPending && !claim.isSuccess;`

**Step state derivations** — same as deposit:

- `step1State` — "success" when `(!needsApproval && amountBig > 0n && isConnected) || requestIsConfirmed`.
- `step2State` — "success" when `isPendingClaim || claim.isSuccess`.
- `step3State` — "success" when `claim.isSuccess`.

**Effects**

- Refetch balance on `claim.isSuccess` and on `requestWithdrawal.isSuccess`.
- Sync `amountInput` to `formatUsdc(BigInt(activeRequest.amount), decimals)` when `isAmountLocked && decimals !== undefined && activeRequest`.
- Toast effects: approve (`withdraw-approve-tx`), request (`withdraw-tx`), claim (`withdraw-claim-tx`) — mirror deposit's three blocks. Use copy: "Approving PLUSD…", "Approval confirmed", "Sending…", "Withdrawal submitted" (+ View action to `/transactions`), "Withdrawal failed", "Claiming…", "USDC claimed", "Claim failed".

**Quick-amount handler**

```ts
const onQuickAmount = useCallback(
  (idx: number) => {
    if (isAmountLocked) return;
    if (decimals === undefined || balance === undefined) return;
    let next: bigint;
    if (idx === 0) next = (balance * 25n) / 100n;
    else if (idx === 1) next = balance / 2n;
    else if (idx === 2) next = (balance * 75n) / 100n;
    else if (idx === 3) next = balance;
    else return;
    setAmountInput(formatUsdc(next, decimals).replace(/,/g, ""));
  },
  [balance, decimals, isAmountLocked],
);
```

**Render**

Same outer skeleton as `deposit.tsx`. `ConversionCard.input` uses PLUSD; `ConversionCard.output` uses USDC. Quick-amount chip labels are `["25%", "50%", "75%", "Max"]`. No low-balance banner — always render the `StepsCard`. `networkFee="—"`.

Step labels:

1. `"Allow Pipeline to use PLUSD"` / actionLabel `"Approve"`.
2. `"Confirm PLUSD burn"` / actionLabel `"Confirm"`.
3. `"Claim your USDC"` / actionLabel `"Claim"`.

The Step 3 `onAction` handler: `claim.write(BigInt(requestId), voucher.data.signature as `0x${string}`)`.

Keep the route export at the bottom: `export const Route = createFileRoute("/withdraw")({ component: Withdraw });`.

### 4. Mocks layer — new test scenario

Update `packages/frontend/src/routes/test/-scenarios.ts`:

- Hoist constants for `PLUSD_ADDRESS` and `WQ_ADDRESS` near `DM_ADDRESS` — use fresh non-overlapping addresses (or reuse the existing `0x1111…` PLUSD address). Recommend `WQ_ADDRESS = "0x4444000000000000000000000000000000000004"`.
- Extend `WALLET_CONNECTED_BASE` with the WithdrawalQueue named-alias mock keys (`pipeline.mock.wallet.contract.withdrawalQueue.plusd`, `…usdc`) and PLUSD ERC-20 metadata (`decimals` = `"18"`, `symbol` = `"PLUSD"`). **Important:** do this carefully so existing deposit scenarios are unaffected. Two options:
  1. Add the keys to `WALLET_CONNECTED_BASE` directly — all scenarios get them. This is fine because the keys are namespaced.
  2. Or create a parallel `WITHDRAWAL_CONNECTED_BASE` that includes everything and spread it only into the new scenario. **Prefer option 1** to keep the registry simple and to allow free navigation between `/deposit` and `/withdraw` from any scenario.
- Add a new scenario at the end of `SCENARIOS`:

```ts
// 10. Connected, PendingClaim withdrawal request, voucher ready ─────────────
{
  id: "withdrawal-pending-claim",
  title: "Connected, PendingClaim withdrawal request, voucher ready",
  description:
    "Withdrawal verification passed; a claim voucher is available. Step 3 is enabled on /withdraw.",
  keys: {
    ...WALLET_CONNECTED_BASE,
    [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "100000000000000000000", // 100 PLUSD
    [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]:
      "1000000000000000000000",
    "pipeline.mock.api.GET./v1/requests": JSON.stringify({
      requests: [
        {
          type: "Withdraw",
          amount: "10000000000000000000", // 10 PLUSD
          request_id: "77",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    }),
    "pipeline.mock.api.GET./v1/withdrawals/77/voucher": JSON.stringify({
      request_id: "77",
      amount: "10000000000000000000",
      user: WALLET_ADDRESS,
      signature: "0xaabbccdd…", // same shape as deposit voucher mock
    }),
    "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal":
      JSON.stringify({ hash: "0xc1a1…", amount: "10000000" }),
  },
},
```

Keep `enableScenarioKeys` / `enableScenario` helpers unchanged.

### 5. `/test` Mocks tab — sanity-check rendering

The `/test → Mocks` tab renders `SCENARIOS` automatically; no further code needed. Verify the new scenario card appears and activates correctly (covered by manual UX check, not unit test).

### 6. Route test — `-withdraw.test.tsx`

Create `packages/frontend/src/routes/-withdraw.test.tsx`. Use `-deposit.test.tsx` as the structural template — copy its entire scaffolding (wagmi/AppKit mocks, `@/api` mock with mutable `mockRequestsData` / `mockVoucherData`, the `WalletProvider` + `ToastProvider` wrapper).

Differences:

- Replace `useRequestDeposit` / `useClaim` mock plumbing with `useRequestWithdrawal` / `useClaimWithdrawal`.
- Replace `useDepositVoucher` mock with `useWithdrawalVoucher` mock — same shape (`{ data, status, error, refetch }`).
- Seed PLUSD balance + decimals + allowance via mock keys (18 dp).
- Use the withdraw route module path.

Required test cases:

1. **Connected, balance > 0, allowance 0** — step 1 enabled, step 2 disabled. Click Approve → calls `useApproval.approve` (assert via mock approve key being read or wagmi spy).
2. **Allowance ≥ amount, no active request** — step 2 enabled. Click Confirm → calls `useRequestWithdrawal.write(amountBig)`.
3. **PendingVerification mock** — step 2 in loading state (not greyed); input locked; chips disabled.
4. **PendingClaim + voucher mock** — step 3 enabled. Click Claim → calls `useClaimWithdrawal.write(BigInt(requestId), signature)`.
5. **Zero PLUSD balance** — all step buttons disabled, no low-balance banner rendered.
6. **`claim.isSuccess`** — step 3 shows Done/success badge.
7. **Disconnected wallet** — all step buttons disabled (regression).
8. **Quick-amount chips** — `25%` sets amount to `balance * 25 / 100`; `Max` sets amount to `balance`. Verify formatted input.
9. **PendingClaim → Completed** transition leaves the input editable again (regression for the lock release).
10. **Step labels render** — assert "Allow Pipeline to use PLUSD", "Confirm PLUSD burn", "Claim your USDC" are present in DOM order.

Coverage target: parity with `-deposit.test.tsx` minus the min-deposit / banner cases (which do not apply).

### 7. Documentation updates

**`packages/frontend/src/api/README.md`** (must update):

- Add `useWithdrawalVoucher` to the "Public API" import example.
- Add a new subsection right after the `useRequests` section describing `useWithdrawalVoucher` (signature, status enum, retry/polling behaviour). Use the existing `useRequests` block as a template.
- Add new rows to the localStorage mock-key table:
  - `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher` → JSON `{ signature: "0x…", request_id, amount, user }`.
  - `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher?wallet=<addr>` → per-wallet override.
- Add a DevTools snippet that seeds a withdrawal-voucher mock for `request_id=77`.

**`docs/frontend/hooks.md`** (must update):

- Add a row for `useWithdrawalVoucher` (`@/api`) with a description analogous to a hypothetical `useDepositVoucher` row — note: a `useDepositVoucher` row does NOT currently exist in `hooks.md` (confirmed by grep). To preserve symmetry, **also add a row for `useDepositVoucher`** in the same edit. Both rows go alphabetically (after `useDepositManagerMinDeposit`, before `useRequestDeposit`).

**`packages/frontend/src/wallet/README.md`** (optional symmetry note):

- Locate the section that lists `useWithdrawalQueueAddresses` / `useRequestWithdrawal` / `useClaimWithdrawal`. Append a one-line cross-reference: "The `/withdraw` page composes these hooks with `useWithdrawalVoucher` from `@/api`; see `src/api/README.md` for the voucher endpoint contract."

### 8. Lint + typecheck

After every code change, run from repo root:

```bash
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend build
npx tsx scripts/lint-docs.ts
```

Fix all warnings/errors before committing.

## Test Strategy

**Unit / integration tests added**

1. `packages/frontend/src/api/useWithdrawalVoucher.test.tsx` — 6 cases:
   - disabled when `requestId === undefined`;
   - disabled when wallet disconnected;
   - mock-key path returns parsed JSON instantly with `status: "ready"`;
   - real-fetch path transitions `pending → ready`;
   - 404 triggers retry loop (up to 20 attempts);
   - mock-key write between renders advances `mockVer` and re-issues the query.

2. `packages/frontend/src/routes/-withdraw.test.tsx` — 10 cases listed under Step 6 above.

**Fast-suite gates**

- `yarn workspace @pipeline/frontend lint` — no warnings.
- `yarn workspace @pipeline/frontend build` — succeeds.
- `yarn workspace @pipeline/frontend test` — all suites green; new files included.
- `npx tsx scripts/lint-docs.ts` — passes (docs row additions must satisfy the doc-linter).

**Manual UX verification** (driven by `ux-tester` after the coder lands the change; not the planner's responsibility)

- Activate the "Connected, PendingClaim withdrawal request, voucher ready" scenario from `/test → Mocks`. Visit `/withdraw`; confirm step 3 is the only enabled step; click Claim and see the success badge land.
- Activate "Connected, allowance ≥ amount, no active request" + manually edit the `/v1/requests` mock to no withdrawal row; confirm step 2 is the live action; click Confirm → see the toast + step 2 success.
- Activate the existing "fresh wallet" scenario; visit `/withdraw`; confirm steps are all disabled and no banner appears (regression against the deposit page which DOES render a banner).
- Toggle DevTools localStorage to remove the WQ named-alias keys and confirm the page still renders cleanly (zero-address path).

**Figma**

The Issue references the withdraw page but no new Figma node — the existing static page already targets node `1498-100351`. The state-machine wiring does not change the visual layout. After the coder lands the change, `ux-tester` does a visual diff against Figma `1498-100351` (deposit-shaped three-step variant) to confirm the layout still matches.

## Docs to Update

- `packages/frontend/src/api/README.md` — `useWithdrawalVoucher` public-API section, mock-key rows, DevTools snippet.
- `docs/frontend/hooks.md` — add rows for `useWithdrawalVoucher` (and `useDepositVoucher` for symmetry).
- `packages/frontend/src/wallet/README.md` — one-line cross-reference noting the deposit/withdraw symmetry.
- `packages/frontend/src/routes/test/-scenarios.ts` — comment block for the new scenario; verify `-scenarios.test.ts` either auto-iterates or gets a new row.

No product-spec change required: the behaviour described in the Issue is already in `docs/initial_spec.md` / the existing withdraw spec; this Issue is pure UI wiring that mirrors deposit. Re-verify by reading the relevant section of the spec during implementation; if any deviation is discovered, log it in the exec plan's decision log (do not silently diverge).
