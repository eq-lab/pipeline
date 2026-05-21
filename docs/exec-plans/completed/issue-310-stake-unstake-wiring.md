# Issue #310: Wire up /stake — Stake (Approve → Stake) and Unstake flows via sPLUSD vault

Source: https://github.com/eq-lab/pipeline/issues/310

## Scope

Replace the static `/stake` page (`packages/frontend/src/routes/stake.tsx`) with a fully wired on-chain composition driven by the `SegmentedTabs` `Stake`/`Unstake` selector. Each tab is its own state machine:

- **Stake tab** — two steps: `Approve` PLUSD spend on the sPLUSD vault, then `Stake` (`sPLUSD.deposit(assets, receiver=connectedWallet)`).
- **Unstake tab** — single step (`sPLUSD.redeem(shares, receiver=connectedWallet, owner=connectedWallet)`); no allowance gate because the caller is the share owner.

No API integration — staking is a pure on-chain interaction per `docs/initial_spec.md:223` and `:233` (no whitelist on sPLUSD). All hook dependencies from #278 (sPLUSD vault), #220 (`useToken`), and #215 (`useApproval`) are already merged.

In scope:

1. Rewrite `packages/frontend/src/routes/stake.tsx`:
   - Replace hardcoded balances, exchange rate, disabled `StepsCard`, and the no-op tab switcher with real wiring through `@/wallet` hooks.
   - Manage `activeTab` (default `"stake"`) + `amountInput`; reset `amountInput` and call `useStake.reset()` / `useUnstake.reset()` / `useApproval.reset()` (exposed by `useToken` via `refetchAllowance` — see "Allowance reset" below) on tab switch so the prior tab's success/error never bleeds into the new tab.
   - Stake tab: composes `useToken({ token: plusd, spender: STAKED_PLUSD_ADDRESS })` for PLUSD balance + allowance + approve, `useStake()` for the deposit write, `useStakedPlusdConvertToShares(amountBig)` for the live preview, and `useStakedPlusdConvertToShares(1 PLUSD)` for the exchange-rate row.
   - Unstake tab: composes `useToken({ token: STAKED_PLUSD_ADDRESS })` (no spender — no approval surface), `useUnstake()`, `useStakedPlusdConvertToAssets(amountBig)` for the live preview, and `useStakedPlusdConvertToAssets(1 sPLUSD)` for the exchange-rate row.
   - Quick-amount chips operate on the active tab's input balance (PLUSD on Stake, sPLUSD on Unstake): `25%` / `50%` / `75%` / `Max`.
   - Step rendering: Stake tab uses `StepsCard` with two `StepRow`s (Approve + Stake); Unstake tab uses `StepsCard` with a single `StepRow` for visual parity with the Stake side (decision rationale below; revisit if Figma differs).
   - Disable / loading / Done state derivations mirror `deposit.tsx` / `withdraw.tsx` structurally.
2. Add new mock scenarios to `packages/frontend/src/routes/test/-scenarios.ts`:
   - "Connected, ready to stake (allowance 0)" — PLUSD balance + zero allowance + sPLUSD `convertToShares` rate.
   - "Connected, ready to stake (approved)" — same plus allowance ≥ amount + `stake` write mock.
   - "Connected, ready to unstake" — sPLUSD balance + `convertToAssets` rate + `unstake` write mock.
3. New test file `packages/frontend/src/routes/-stake.test.tsx` covering enable/disable gates, step transitions, quick-amount chips, preview rendering, and the cross-tab reset regression.
4. Documentation:
   - Update `packages/frontend/src/wallet/README.md` mock-key schema section: confirm rate-scalar examples still apply, add a short note that `/stake` consumes these mocks (no new keys are introduced — every key already exists from #278).
   - Add a one-line cross-reference in the same README noting that `/stake` composes `useToken` + `useStake` / `useUnstake` + `useStakedPlusdConvertTo*` (`stake.tsx`).
   - No new entries in `docs/frontend/hooks.md` — every hook is already documented (`useStake`, `useUnstake`, `useStakedPlusdAsset`, `useStakedPlusdConvertToShares`, `useStakedPlusdConvertToAssets`, `useToken`, `useApproval`).

Out of scope (per Issue body):

- API integration (no bridge service involvement; `useRequests` rows for `Stake` / `Unstake` are already wired into `/transactions` via #229 — outside this Issue).
- APR data wiring — keep `Earn 8.42% p.a.` hardcoded with a TODO referencing this scope decision.
- Whitelist gate — sPLUSD vault is open (`docs/initial_spec.md:233`); no UI state needed.
- Receipt polling beyond what `useStake` / `useUnstake` already do — accept broadcast-success as terminal, matching deposit/withdraw.
- Toast wiring — out of scope; #259 toasts exist but emitting on stake/unstake is not required by the Issue and is explicitly called out as "not blocking".
- EIP-2612 permit flow to skip the Approve step.
- Network fee estimation — leave `—` (tracked in #270).
- Low-balance banner — no design exists.

## Assumptions and Risks

**Assumptions**

- #278 hooks (`useStake`, `useUnstake`, `useStakedPlusdAsset`, `useStakedPlusdConvertToShares`, `useStakedPlusdConvertToAssets`) match the shapes documented in `packages/frontend/src/wallet/useStakedPlusd.ts` (verified by reading the file).
- The `useApproval` surface exposed through `useToken` accepts `STAKED_PLUSD_ADDRESS` as spender and uses the keyed mock `pipeline.mock.wallet.allowance.<plusd>.<stakedPlusd>` (verified — the hook is generic on `{ token, spender }`).
- `parseUsdc` / `formatUsdc` are decimal-agnostic and already used by `withdraw.tsx` for 18-dp PLUSD (verified in `packages/frontend/src/lib/usdc.ts:29`).
- `useStakedPlusdAsset()` returns the PLUSD token address; the page reads PLUSD address from this hook (not from `useWithdrawalQueueAddresses` or `useDepositManagerAddresses`) to keep the page coupling tight to the sPLUSD vault rather than to unrelated contracts. If the vault is unconfigured (zero address), the hook returns `plusd: undefined` and we fall back to `ZERO_ADDRESS` so the downstream `useToken({ token })` short-circuits cleanly (no RPC call). Steps stay disabled; this is the same pattern `withdraw.tsx` uses for `useWithdrawalQueueAddresses`.
- The sPLUSD share token's ERC-20 metadata (`decimals` / `symbol` / `balanceOf`) is read via `useToken({ token: STAKED_PLUSD_ADDRESS })` — no special "share token" hook is required.
- `TokenInput.token`, `TokenAmountDisplay.token`, and `CoinIcon` already accept the `"splusd"` literal (verified in the UI components).
- The existing test scaffolding from `-deposit.test.tsx` / `-withdraw.test.tsx` can be cloned for `-stake.test.tsx` (same wagmi/AppKit/QueryClient stubs).

**Risks**

- **Real-path write data shape.** `useStake.data` / `useUnstake.data` only carry `{ hash, shares? | assets? }` on the mock path; on the real path the data is `{ hash }`. We do not rely on `shares` / `assets` from the write result — the in-tab preview is always sourced from `useStakedPlusdConvertTo*`, which is the authoritative source. Code-level comment to make that explicit.
- **Exchange-rate hook firing with `0n` input.** `useStakedPlusdConvertToShares(0n)` returns `{ data: undefined, … }` and short-circuits without an RPC call. For the exchange-rate row we always call with `parseUnits("1", decimals)` to guarantee a non-zero input; when `decimals` is still undefined we render `—`.
- **Tab-switch state bleed.** Three sources of "Done" state exist (approve success, stake success, unstake success). On tab switch we must `reset()` all three plus clear the input so the new tab starts clean. The plan documents an explicit `resetActiveTabSurfaces` helper; if any reset is omitted the user can see the wrong Done badge after switching tabs.
  - `useStake` / `useUnstake` expose `reset()` directly.
  - The approve surface comes from `useToken` → `useApproval`; `useToken` does **not** currently re-export `useApproval.reset`. The current code path lets approve success persist across re-renders, which is fine for the single-tab Stake flow but on tab switch we want to clear the visible Done badge. **Mitigation:** rather than mutating `useToken`'s shape, derive `step1State` strictly from `hasSufficientAllowance` (a read of current allowance), not from `isApproveSuccess` — exactly as `withdraw.tsx` already does (see `step1State` derivation in `packages/frontend/src/routes/withdraw.tsx:207`). That way no "Done" badge needs explicit clearing; it disappears naturally because the next tab does not query the same allowance pair. Local helper still calls `useStake.reset()` and `useUnstake.reset()` for the write surfaces.
- **Quick-amount integer math.** Same pattern as `withdraw.tsx`: `balance * 25n / 100n`, `balance / 2n`, `balance * 75n / 100n`, `balance`. Acceptable rounding.
- **Unstake step composition (single step vs. wrapped in `StepsCard`).** The Issue explicitly leaves this ambiguous and points to Figma node `1498-101158`. The plan defaults to **wrapped in `StepsCard` with a single `StepRow`** for visual parity with the Stake side; ux-tester will diff against Figma and the coder swaps to a standalone primary button if needed. Either way, the gating logic is identical.
- **Allowance reset between tab switches.** Allowance is per (token, spender) — when the user switches from Stake → Unstake the Stake tab's `useToken({ token: plusd, spender: stakedPlusd })` no longer renders, so allowance staleness across tabs is naturally bounded. On switching back to Stake, the hook re-mounts and refetches — no manual `refetchAllowance` needed.

**Dependencies**

- Hard dependency on #278 — merged (verified: `packages/frontend/src/wallet/useStakedPlusd.ts` exists with all five hooks).
- Soft dependency on #220 (`useToken`) — merged (verified in barrel export).
- Soft dependency on #215 (`useApproval`) — merged (used internally by `useToken`).
- Soft dependency on #235 (deposit flow) and #307 (withdraw flow) — both merged; their `stake.tsx`/`withdraw.tsx` patterns are the structural templates for the rewrite.

## Open Questions

_None_

> Note: the Unstake-tab step composition (single button vs. `StepsCard` with one row) is intentionally decided in plan (default: `StepsCard` with one row) and revisited by ux-tester against Figma `1498-101158`; it is not a planner-level unknown.

## Implementation Steps

### 1. Rewrite `stake.tsx` ✅ DONE

Replace the file at `packages/frontend/src/routes/stake.tsx` with the new on-chain composition.

**Imports**

```ts
import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { parseUnits } from "viem";
import {
  Card,
  InfoRow,
  SegmentedTabs,
  StakeHeader,
  StepsCard,
  TokenAmountDisplay,
  TokenInput,
} from "@pipeline/ui";
import {
  useWallet,
  useToken,
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc } from "@/lib/usdc";
```

**State sources** (always called — React hook rules; gating happens in derived values)

- `const { isConnected } = useWallet();`
- `const { plusd: plusdFromVault } = useStakedPlusdAsset();`
- `const plusdAddr = (plusdFromVault ?? ZERO_ADDRESS) as `0x${string}`;`
- `const splusdAddr = ENV.STAKED_PLUSD_ADDRESS as `0x${string}`;`
- Stake-tab token reads (mounted always — guard with the activeTab branch only at render):
  - `const plusdToken = useToken({ token: plusdAddr, spender: splusdAddr });`
  - `const splusdToken = useToken({ token: splusdAddr });` (no spender — no approval branch).
- Write hooks (always called):
  - `const stake = useStake();`
  - `const unstake = useUnstake();`
- Local UI state:
  - `const [activeTab, setActiveTab] = useState<"stake" | "unstake">("stake");`
  - `const [amountInput, setAmountInput] = useState("");`

**Derived state — per-tab**

```ts
// Active-tab token resolution.
const isStakeTab = activeTab === "stake";
const inputToken = isStakeTab ? plusdToken : splusdToken;
const outputToken = isStakeTab ? splusdToken : plusdToken;

// Active-tab decimals + balance.
const decimals = inputToken.decimals;
const balance = inputToken.balance;
const formattedInputBalance = inputToken.formattedBalance;
const formattedOutputBalance = outputToken.formattedBalance;

// amountBig — parsed against the active input token's decimals.
const amountBig = parseUsdc(amountInput, decimals);

// hasBalance gate.
const isReady = decimals !== undefined && balance !== undefined;
const hasBalance =
  isReady && amountBig > 0n && amountBig <= (balance as bigint);

// Stake-tab only — approval gate.
const allowance = isStakeTab ? plusdToken.allowance : undefined;
const needsApproval =
  isStakeTab &&
  allowance !== undefined &&
  amountBig > 0n &&
  allowance < amountBig;
const hasSufficientAllowance =
  isStakeTab &&
  allowance !== undefined &&
  amountBig > 0n &&
  allowance >= amountBig;
```

**Preview hooks**

```ts
// Active-tab preview. Both hooks short-circuit to `data: undefined` when input is 0n.
const sharesPreview = useStakedPlusdConvertToShares(
  isStakeTab ? amountBig : undefined,
);
const assetsPreview = useStakedPlusdConvertToAssets(
  !isStakeTab ? amountBig : undefined,
);

// Exchange-rate hooks — always called with a fixed "1 unit" input when decimals are known.
const oneStake =
  isStakeTab && plusdToken.decimals !== undefined
    ? parseUnits("1", plusdToken.decimals)
    : undefined;
const oneUnstake =
  !isStakeTab && splusdToken.decimals !== undefined
    ? parseUnits("1", splusdToken.decimals)
    : undefined;
const rateSharesPerPlusd = useStakedPlusdConvertToShares(oneStake);
const rateAssetsPerSplusd = useStakedPlusdConvertToAssets(oneUnstake);
```

**Step gates**

```ts
const canApprove =
  isStakeTab &&
  isConnected &&
  hasBalance &&
  needsApproval &&
  !plusdToken.isApprovePending &&
  !stake.isSuccess;

const canStake =
  isStakeTab &&
  isConnected &&
  hasBalance &&
  hasSufficientAllowance &&
  !stake.isPending &&
  !stake.isSuccess;

const canUnstake =
  !isStakeTab &&
  isConnected &&
  hasBalance &&
  !unstake.isPending &&
  !unstake.isSuccess;
```

**Step state derivations**

```ts
// Stake-tab step 1 "Done" when allowance covers amount.
const step1State =
  isStakeTab && (hasSufficientAllowance || stake.isSuccess) && isConnected
    ? ("success" as const)
    : ("idle" as const);

// Stake-tab step 2 "Done" when stake.isSuccess.
const step2State = stake.isSuccess ? ("success" as const) : ("idle" as const);

// Unstake-tab single step "Done" when unstake.isSuccess.
const unstakeStepState = unstake.isSuccess
  ? ("success" as const)
  : ("idle" as const);
```

**Effects**

- Tab switching: `useCallback(onSelectTab)` that calls `setActiveTab(next)`, `setAmountInput("")`, `stake.reset()`, `unstake.reset()`. No explicit approve reset needed (see Risks).
- Balance refetch after write success:
  - `useEffect(() => { if (stake.isSuccess) { plusdToken.refetchBalance(); splusdToken.refetchBalance(); plusdToken.refetchAllowance?.(); } }, [stake.isSuccess]);`
  - `useEffect(() => { if (unstake.isSuccess) { plusdToken.refetchBalance(); splusdToken.refetchBalance(); } }, [unstake.isSuccess]);`

**Quick-amount handler**

```ts
const onQuickAmount = useCallback(
  (idx: number) => {
    if (decimals === undefined || balance === undefined) return;
    let next: bigint;
    if (idx === 0) next = (balance * 25n) / 100n;
    else if (idx === 1) next = balance / 2n;
    else if (idx === 2) next = (balance * 75n) / 100n;
    else if (idx === 3) next = balance;
    else return;
    setAmountInput(formatUsdc(next, decimals).replace(/,/g, ""));
  },
  [balance, decimals],
);
```

**Preview render values**

```ts
const previewOutputValue = isStakeTab
  ? sharesPreview.data !== undefined && splusdToken.decimals !== undefined
    ? formatUsdc(sharesPreview.data, splusdToken.decimals).replace(/,/g, "")
    : "0"
  : assetsPreview.data !== undefined && plusdToken.decimals !== undefined
    ? formatUsdc(assetsPreview.data, plusdToken.decimals).replace(/,/g, "")
    : "0";

// Exchange-rate row text.
const exchangeRateText = (() => {
  if (isStakeTab) {
    if (
      rateSharesPerPlusd.data === undefined ||
      splusdToken.decimals === undefined
    )
      return "—";
    const n = formatUnits4(rateSharesPerPlusd.data, splusdToken.decimals);
    return `1 PLUSD = ${n} sPLUSD`;
  }
  if (
    rateAssetsPerSplusd.data === undefined ||
    plusdToken.decimals === undefined
  )
    return "—";
  const n = formatUnits4(rateAssetsPerSplusd.data, plusdToken.decimals);
  return `1 sPLUSD = ${n} PLUSD`;
})();
```

`formatUnits4` is a private helper inside this file that formats a `bigint` to four decimal places using `formatUnits` from `viem` (truncated, not rounded). Implement as a local `function formatUnits4(value: bigint, decimals: number): string`.

**Render**

Keep the outer skeleton from the current `stake.tsx`. Inside the centred column:

1. `<StakeHeader title="Earn 8.42% p.a." />` with a `// TODO(#APR): wire live yield rate` comment.
2. **Input card** — same `Card variant="white"`:
   - `<SegmentedTabs ... onSelect={onSelectTab} />`
   - `<TokenInput token={isStakeTab ? "plusd" : "splusd"} tokenLabel={isStakeTab ? "PLUSD" : "sPLUSD"} balanceLabel={formattedInputBalance?.replace(/^\$/, "") ?? "—"} placeholderValue="0" value={amountInput} onValueChange={setAmountInput} disabled={!isConnected || !isReady} quickAmounts=[25%/50%/75%/Max with no `disabled`] onQuickAmountClick={onQuickAmount} />`
3. **Output card** — `Card variant="white"`:
   - `<TokenAmountDisplay token={isStakeTab ? "splusd" : "plusd"} tokenLabel={isStakeTab ? "sPLUSD" : "PLUSD"} balanceLabel={formattedOutputBalance?.replace(/^\$/, "") ?? "—"} value={previewOutputValue} />`
   - `<InfoRow label="Exchange rate" value={exchangeRateText} />`
   - `<InfoRow label="Network fee" value="—" />`
4. **Steps card** — conditional on `activeTab`:
   - Stake tab:
     ```tsx
     <StepsCard
       steps={[
         {
           label: "Allow Pipeline to use PLUSD",
           actionLabel: "Approve",
           disabled: !canApprove,
           loading: plusdToken.isApprovePending,
           state: step1State,
           onAction: () => plusdToken.approve?.(amountBig),
         },
         {
           label: "Confirm and stake PLUSD",
           actionLabel: "Stake",
           disabled: !canStake,
           loading: stake.isPending,
           state: step2State,
           onAction: () => stake.write(amountBig),
         },
       ]}
     />
     ```
   - Unstake tab:
     ```tsx
     <StepsCard
       steps={[
         {
           label: "Confirm and unstake sPLUSD",
           actionLabel: "Unstake",
           disabled: !canUnstake,
           loading: unstake.isPending,
           state: unstakeStepState,
           onAction: () => unstake.write(amountBig),
         },
       ]}
     />
     ```

Keep the existing `export const Route = createFileRoute("/stake")({ component: Stake });` at the bottom.

### 2. Mock scenarios ✅ DONE

Update `packages/frontend/src/routes/test/-scenarios.ts`. Extend `WALLET_CONNECTED_BASE` with the sPLUSD named alias for `asset()` so any "connected" scenario navigating to `/stake` resolves the PLUSD address from the vault:

```ts
"pipeline.mock.wallet.contract.stakedPlusd.asset": PLUSD_ADDRESS,
// sPLUSD ERC-20 metadata (the share token)
[`pipeline.mock.wallet.contract.${SPLUSD_ADDRESS}.decimals`]: "18",
[`pipeline.mock.wallet.contract.${SPLUSD_ADDRESS}.symbol`]: "sPLUSD",
```

Add `SPLUSD_ADDRESS` to the address constants near the top: `const SPLUSD_ADDRESS = "0x5555000000000000000000000000000000000005";`. Update the file-level comment block listing addresses.

Add three new scenarios at the end of `SCENARIOS`:

```ts
// 11. Connected, ready to stake (allowance 0) ────────────────────────────────
{
  id: "stake-ready-allowance-zero",
  title: "Connected, ready to stake (allowance 0)",
  description:
    "PLUSD balance present; no approval to the sPLUSD vault yet. Approve is the live action on /stake → Stake tab.",
  keys: {
    ...WALLET_CONNECTED_BASE,
    [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "100000000000000000000", // 100 PLUSD
    [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${SPLUSD_ADDRESS}`]: "0",
    [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
    "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
      "959600000000000000", // 0.9596 sPLUSD per PLUSD
    "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
      "1042100000000000000", // 1.0421 PLUSD per sPLUSD (for inverse preview)
  },
},

// 12. Connected, ready to stake (approved) ───────────────────────────────────
{
  id: "stake-ready-approved",
  title: "Connected, ready to stake (approved)",
  description:
    "Allowance ≥ amount. Stake is the live action on /stake → Stake tab; clicking settles via the mock stake key.",
  keys: {
    ...WALLET_CONNECTED_BASE,
    [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "100000000000000000000",
    [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${SPLUSD_ADDRESS}`]:
      "1000000000000000000000",
    [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
    "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
      "959600000000000000",
    "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
      "1042100000000000000",
    "pipeline.mock.wallet.contract.stakedPlusd.stake": JSON.stringify({
      hash: "0xabc1000000000000000000000000000000000000000000000000000000000abc",
      shares: "9596000000000000000",
    }),
  },
},

// 13. Connected, ready to unstake ────────────────────────────────────────────
{
  id: "unstake-ready",
  title: "Connected, ready to unstake",
  description:
    "sPLUSD balance present. Unstake is the live action on /stake → Unstake tab; clicking settles via the mock unstake key.",
  keys: {
    ...WALLET_CONNECTED_BASE,
    [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "0",
    [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "50000000000000000000", // 50 sPLUSD
    "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
      "959600000000000000",
    "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
      "1042100000000000000",
    "pipeline.mock.wallet.contract.stakedPlusd.unstake": JSON.stringify({
      hash: "0xde110000000000000000000000000000000000000000000000000000000000de",
      assets: "52105000000000000000",
    }),
  },
},
```

Keep `enableScenarioKeys` / `enableScenario` / `clearMocksAndReload` helpers unchanged.

### 3. Route test — `-stake.test.tsx` ✅ DONE

Create `packages/frontend/src/routes/-stake.test.tsx`. Clone the test scaffolding from `-withdraw.test.tsx`:

- Same wagmi / `@reown/appkit/react` / `@tanstack/react-query` / `@/wallet/config` mocks.
- Do **not** mock `@/api` — `/stake` does not consume it.
- Seed PLUSD and sPLUSD balance, allowance, decimals, symbol, and the sPLUSD vault mock keys via `localStorage` in `beforeEach`.
- Wrap `<Route.component />` in `<WalletProvider>` (no `ToastProvider` needed — no toasts on /stake in this Issue).

Required test cases:

**Stake tab**

1. Connected, PLUSD balance > 0, allowance 0 → step 1 "Approve" enabled; step 2 "Stake" disabled. Click Approve → `useApproval` write fires (assert via wagmi spy `mockWriteContract` called with the `approve` function).
2. Allowance ≥ amount → step 1 shows Done badge; step 2 "Stake" enabled. Click Stake → mock `stake` key resolves; `stake.isSuccess` flips → step 2 shows Done badge.
3. Stake `isSuccess` → step 2 Done badge present; click Stake disabled.
4. Quick-amount chips: `25%` sets input to `balance * 25n / 100n` formatted; `Max` sets to full balance. Assert the displayed `value` of the input.
5. Preview hook output rendered: with `convertToShares` rate `0.9596` and input `10` PLUSD, output card shows `9.5960` (or formatted 4-dp string).
6. Exchange-rate row text equals `1 PLUSD = 0.9596 sPLUSD` (truncated to 4 dp).

**Unstake tab**

7. Switch to Unstake tab → input token coin/label flips to sPLUSD; output flips to PLUSD; amount input clears.
8. Connected, sPLUSD balance > 0 → "Unstake" button enabled. Click Unstake → mock `unstake` key resolves; Done badge appears.
9. Quick-amount chips operate on sPLUSD balance (Max sets to sPLUSD balance).
10. Preview hook output rendered: with `convertToAssets` rate `1.0421` and input `10` sPLUSD, output card shows `10.4210`.
11. Exchange-rate row text equals `1 sPLUSD = 1.0421 PLUSD`.

**Cross-tab**

12. Tab switch from Stake → Unstake clears the input (`amountInput` reverts to `""`).
13. Tab switch from Stake (after a successful stake) → Unstake → no stale Done badge from the Stake step renders on the Unstake side.
14. Tab switch back to Stake after a fresh wallet load shows no stale state.

**Edge cases**

15. Disconnected wallet → all step buttons disabled on both tabs.
16. Zero balance on the active tab → action buttons disabled; no banner rendered (regression — assert no `LowBalanceBanner` or similar element).

Coverage parity target: structurally close to `-withdraw.test.tsx` (drop API/lock/voucher cases — N/A for stake).

### 4. Documentation updates ✅ DONE

**`packages/frontend/src/wallet/README.md`**

- Locate the section that lists `useStake` / `useUnstake` / `useStakedPlusdConvertTo*` hooks.
- Append a one-line cross-reference paragraph: `The /stake page composes useToken + useStake / useUnstake + useStakedPlusdConvertTo* (Stake tab) and useStakedPlusdConvertToAssets (Unstake tab); see packages/frontend/src/routes/stake.tsx.`
- Verify the mock-key schema table already documents all five `stakedPlusd.*` keys (it does — lines 388–395). No new rows required.

**`docs/frontend/hooks.md`** — no edits required; every hook used by `/stake` is already documented.

**Comment in code** — add a single-line `// TODO(#APR-followup): wire live yield rate; out of scope for #310` next to the hardcoded `8.42%` title.

### 5. Lint + typecheck + tests ✅ DONE

After every code change, run from the repo root:

```bash
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend build
yarn workspace @pipeline/frontend test
npx tsx scripts/lint-docs.ts
```

Fix all warnings/errors before committing.

## Test Strategy

**Unit / integration tests added**

- `packages/frontend/src/routes/-stake.test.tsx` — 16 cases listed in Step 3 above.

**Fast-suite gates**

- `yarn workspace @pipeline/frontend lint` — no warnings.
- `yarn workspace @pipeline/frontend build` — succeeds.
- `yarn workspace @pipeline/frontend test` — all suites green; new file included.
- `npx tsx scripts/lint-docs.ts` — passes.

**Manual UX verification** (driven by `ux-tester` after the coder lands the change; not the planner's responsibility)

1. Activate `stake-ready-allowance-zero` scenario; visit `/stake`; default Stake tab → step 1 Approve is the only enabled step. Click Approve → wagmi approval mock fires; subsequent allowance refetch unlocks step 2.
2. Activate `stake-ready-approved`; visit `/stake`; step 1 shows Done; step 2 Stake enabled. Click Stake → success badge appears.
3. Activate `unstake-ready`; visit `/stake`; switch to Unstake tab → Unstake button enabled. Click Unstake → success badge appears.
4. From any scenario, toggle between tabs and confirm `amountInput` clears and no stale Done badge bleeds across tabs.
5. Disconnect wallet (from a separate scenario or by clearing `pipeline.mock.wallet.isConnected`) → step buttons all disabled.
6. **Figma diff** against `1498-101158` for both Stake-tab and Unstake-tab variants — confirm the visual structure (header, input card with tabs, output card, steps card) matches. If the Unstake variant clearly shows a standalone primary button without the `StepsCard` chrome, swap the Unstake render branch to a single `Button`-equivalent primitive; gating logic stays unchanged.

**Figma**

- Issue body references Figma node `1498:101158` for the flow structure. The `ux-tester` should diff both tab states against this node after the coder finishes.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — one-line cross-reference paragraph noting that `/stake` composes the existing hooks.
- `packages/frontend/src/routes/test/-scenarios.ts` — three new scenarios + new `SPLUSD_ADDRESS` constant + `stakedPlusd.asset` named alias added to `WALLET_CONNECTED_BASE` + sPLUSD ERC-20 metadata keys.
- No product-spec change required: the behaviour described in the Issue is already in `docs/initial_spec.md` §4 (staking) and §`(unstake redeem path)`. This Issue is pure UI wiring. If any deviation is discovered during implementation, log it in this exec plan's decision log (do not silently diverge).
