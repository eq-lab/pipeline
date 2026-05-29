# Issue #447: [FE] Restructure wallet module: EVM into src/wallet/evm/

Source: https://github.com/eq-lab/pipeline/issues/447

## Scope

Pure structural refactor of the frontend wallet module — **no behavior change**. Part of epic #444 (sub-issue 0, prerequisite; land first and in isolation).

In scope:

- Move every existing EVM module from `packages/frontend/src/wallet/` into a new `packages/frontend/src/wallet/evm/` folder, carrying `*.test.ts(x)` files alongside their modules.
- Rename the three connection-layer files (and their exported hook identifiers) so they parallel the planned `useStellar*` names:
  - `WalletProvider.tsx` → `evm/EvmWalletProvider.tsx`, export `WalletProvider` → `EvmWalletProvider`
  - `useWallet.ts` (also exports `useContractRead`) → `evm/useEvmWallet.ts`, export `useWallet` → `useEvmWallet`
  - `useToken.ts` → `evm/useEvmToken.ts`, export `useToken` → `useEvmToken`
- Keep the barrel at `packages/frontend/src/wallet/index.ts`; re-export the EVM public surface from `./evm/*` under the new names.
- Update every internal and external import site, including `main.tsx`.
- Tighten the ESLint `no-restricted-imports` exemption from `src/wallet/**` to `src/wallet/evm/**`.
- Update `packages/frontend/src/wallet/README.md` and the affected `docs/frontend/*` / `docs/FRONTEND.md` references.

Out of scope (later sub-issues of #444):

- Any Stellar code (`stellar/`, `StellarWalletProvider`, `useStellarWallet`, `useStellarToken`), `WalletViewContext`, the Stellar half of the ESLint boundary, env vars, mock keys, and all UI changes (segmented control, connect chooser modal).
- Renaming the non-connection-layer modules (they keep their current names per the issue).
- Renaming exported **types** (`WalletState`, `UseContractReadArgs`, `ContractReadResult`, `UseTokenArgs`, `UseTokenResult`). The issue only calls out renaming the hook functions; types stay as-is to minimize churn (see Open Questions).

## Assumptions and Risks

- **Decision — rename hooks only, not types.** The issue text and epic #444 only rename the hook functions (`useWallet`→`useEvmWallet`, `useToken`→`useEvmToken`) and the provider (`WalletProvider`→`EvmWalletProvider`). Associated exported types keep their names. The barrel re-exports the same type names, so external type imports are unaffected.
- All EVM modules move into `evm/` as one unit, so the existing relative `./` imports **between** them remain valid — only references to the two renamed files (`./useWallet` → `./useEvmWallet`, `./useToken` → `./useEvmToken`) and the renamed identifiers need editing.
- `WalletViewContext` does not exist yet (created in a later sub-issue); the "`src/wallet/` holds only `index.ts`" end-state in the issue is the post-#444 target, not the post-#447 target. After #447, `src/wallet/` holds `index.ts`, `README.md`, and the `evm/` folder. This is expected — do not create placeholder files.
- Risk: deep-path test imports and hoisted `vi.mock("@/wallet/config", …)` factories are easy to miss — they break tests at runtime, not at typecheck. The Implementation Steps enumerate every one (verified by grep) so none are dropped.
- Risk: the ESLint exemption is keyed on path. After moving, the barrel `index.ts` must import **no** chain libs directly (it currently does not — it only re-exports), so narrowing the exemption to `src/wallet/evm/**` must not surface new lint errors in `index.ts`. Confirm by running lint.
- Risk: `prettier --check` is part of `yarn lint`; the moved/edited files must stay formatted. Run `prettier --write` on touched files (or `yarn lint` then fix) before finishing.
- Risk: Vitest path aliases resolve `@/` to `src/`. Moving files under `evm/` is transparent to the alias, but any string literal in `vi.mock(...)` must be updated by hand — TypeScript will not catch a stale mock-path string.
- Mismerge/duplication risk with epic #444 siblings: this must land before sub-issues 1–3. No other active plan touches `src/wallet/`.

## Open Questions

_None_

## Implementation Steps

All paths are under `packages/frontend/`.

### 1. Create `src/wallet/evm/` and move modules (git mv to preserve history)

Move these into `src/wallet/evm/`, keeping their names, with their `*.test.ts(x)` siblings:

- `useDepositManager.ts` (+ `useDepositManager.test.tsx`)
- `useStakedPlusd.ts` (+ `useStakedPlusd.test.tsx`)
- `useWithdrawalQueue.ts` (+ `useWithdrawalQueue.test.tsx`)
- `useApproval.ts` (+ `useApproval.test.tsx`)
- `useNetworkFeeEstimate.ts` (+ `useNetworkFeeEstimate.test.tsx`)
- `useTermsAcknowledgement.ts` (+ `useTermsAcknowledgement.test.tsx` if present)
- `config.ts`, `chain.ts`, `mock.ts` (+ `mock.test.ts`), `estimateGas.ts`, `gas.ts`, `simulate.ts`, `units.ts`, `cache.ts` (+ `cache.test.ts`), `WalletGateContext.ts`
- `abis/` (entire folder: `depositManager.ts`, `erc20.ts`, `stakedPlusd.ts`, `withdrawalQueue.ts`)
- `useContractRead.test.tsx` → `evm/` (tests the `useContractRead` export of the renamed file)

### 2. Rename the three connection-layer files + their exports

- `git mv src/wallet/WalletProvider.tsx src/wallet/evm/EvmWalletProvider.tsx`; rename `export function WalletProvider` → `export function EvmWalletProvider` (line ~161). Move `WalletProvider.test.tsx` if it exists.
- `git mv src/wallet/useWallet.ts src/wallet/evm/useEvmWallet.ts`; rename `export function useWallet` → `export function useEvmWallet` (line ~41). Keep `useContractRead`, `WalletState`, `UseContractReadArgs`, `ContractReadResult` exports as-is. Move `useWallet.test.tsx` → `evm/useEvmWallet.test.tsx` and update its internal references.
- `git mv src/wallet/useToken.ts src/wallet/evm/useEvmToken.ts`; rename `export function useToken` → `export function useEvmToken` (line ~119). Keep `UseTokenArgs`, `UseTokenResult`. Move `useToken.test.tsx` → `evm/useEvmToken.test.tsx`.

### 3. Fix intra-module references to the renamed files/identifiers

These `evm/` files import `useWallet` from `./useWallet` and must change to `useEvmWallet` from `./useEvmWallet`:

- `evm/useDepositManager.ts` (line ~31)
- `evm/useStakedPlusd.ts` (line ~45)
- `evm/useToken.ts` → now `evm/useEvmToken.ts` (line ~24): `import { useWallet }` → `import { useEvmWallet }` and update the call site
- `evm/useApproval.ts` (line ~25)
- `evm/useWithdrawalQueue.ts` (line ~34)
- `evm/useNetworkFeeEstimate.ts` (line ~45)

For each, also update the **call sites** inside the function bodies: `useWallet()` → `useEvmWallet()`.

`evm/EvmWalletProvider.tsx` keeps its `./config`, `./mock`, `./WalletGateContext`, `./useTermsAcknowledgement` relative imports (all now siblings in `evm/`).

### 4. Rewrite the barrel `src/wallet/index.ts`

- `export { WalletProvider } from "./WalletProvider";` → `export { EvmWalletProvider } from "./evm/EvmWalletProvider";`
- `export { useWallet, useContractRead } from "./useWallet";` → `export { useEvmWallet, useContractRead } from "./evm/useEvmWallet";`
- `export type { WalletState, UseContractReadArgs, ContractReadResult } from "./useWallet";` → `from "./evm/useEvmWallet";`
- `export { useToken } from "./useToken";` → `export { useEvmToken } from "./evm/useEvmToken";`
- `export type { UseTokenArgs, UseTokenResult } from "./useToken";` → `from "./evm/useEvmToken";`
- Update all remaining `./<module>` paths to `./evm/<module>` (useDepositManager, useWithdrawalQueue, useStakedPlusd, useApproval, mock, units, useTermsAcknowledgement, useNetworkFeeEstimate).
- Update the file's top doc comment that names the ESLint boundary to reference `src/wallet/evm/**`.

### 5. Update external consumers — barrel imports (rename hook identifiers + call sites)

Files importing `useWallet`/`useToken` from `@/wallet` — rename to `useEvmWallet`/`useEvmToken` in both the import and every call site:

- `src/components/TopBar.tsx` (import line 4; calls lines 61, 63; update the JSDoc on lines 11–12)
- `src/components/RecentActivityCard.tsx` (line 4 import; line 78 call)
- `src/api/useDepositVoucher.ts` (line 21 import; line 78 call)
- `src/api/useWithdrawalVoucher.ts` (line 21 import; line 78 call)
- `src/api/useRequests.ts` (line 16 import; line 99 call)
- `src/routes/transactions.tsx` (line 13 import; line 58 call)
- `src/routes/deposit.tsx` (imports ~11/15; calls 128, 148, 166)
- `src/routes/stake.tsx` (imports 14/15; calls 68, 80, 81)
- `src/routes/test.tsx` (imports 25/28; calls 148, 171; section title strings on 271/318 — `"Wallet (useWallet)"` / `"USDC token (useToken)"` — see Open Questions resolution: rename the labels to `useEvmWallet`/`useEvmToken` and update the matching assertions in `src/routes/-test.test.tsx` lines 195/201)

### 6. Update external consumers — deep-path imports (rewrite to `@/wallet/evm/*`)

Non-test source:

- `src/routes/index.tsx`: `@/wallet/useWallet` → `@/wallet/evm/useEvmWallet` (rename `useWallet`→`useEvmWallet`, call line 64); `@/wallet/useToken` → `@/wallet/evm/useEvmToken` (rename `useToken`→`useEvmToken`, call line 70); `@/wallet/useStakedPlusd` → `@/wallet/evm/useStakedPlusd` (name kept)
- `src/components/WelcomeHeader.tsx`: `@/wallet/useStakedPlusd` → `@/wallet/evm/useStakedPlusd`

> Prefer routing these through the `@/wallet` barrel where the symbol is exported, but the issue's contract is path-correctness; keeping the deep paths pointed at `evm/` is acceptable and lower-risk. Coder may consolidate to barrel imports if trivial.

### 7. Update test files — deep-path imports + `vi.mock` factory strings

For each, rewrite `@/wallet/WalletProvider` → `@/wallet/evm/EvmWalletProvider` (and the `WalletProvider` identifier → `EvmWalletProvider`), `@/wallet/config` → `@/wallet/evm/config`, `@/wallet/mock` → `@/wallet/evm/mock`:

- `src/components/TopBar.test.tsx` (line 21 import + 141/143 JSX; line 85 `vi.mock("@/wallet/config")`)
- `src/components/AccountDropdown.test.tsx` (line 22 + 167/169; line 85 `vi.mock`; comment line 8 mentions `useWallet().disconnect()` → `useEvmWallet()`)
- `src/api/useStats.test.tsx` (line 50 `vi.mock("@/wallet/config")`)
- `src/api/useRequests.test.tsx` (line 17 `@/wallet/mock`; line 57 `vi.mock("@/wallet/config")`)
- `src/api/useWithdrawalVoucher.test.tsx` (line 20 `@/wallet/mock`; line 60 `vi.mock`)
- `src/routes/-index.test.tsx` (line 20 + 140/142; line 80 `vi.mock`; comments 179/182/191 reference `useWallet`)
- `src/routes/-deposit.test.tsx` (line 42 + 397/401; line 130 `vi.mock`)
- `src/routes/-stake.test.tsx` (line 38 + 275/277; line 113 `vi.mock`)
- `src/routes/-test.test.tsx` (line 17 + 169/171/375/377; line 87 `vi.mock`; assertions 195/201)
- `src/components/RecentActivityCard.test.tsx` (mocks the barrel `useWallet` → `useEvmWallet`: comment line 4, `vi.mock` factory key line 52 `useWallet: () => …` → `useEvmWallet`)
- `src/routes/-transactions.test.tsx` (mocks barrel `useWallet` → `useEvmWallet`: comments 4/50, factory key line 60)

> The barrel mocks (`RecentActivityCard.test.tsx`, `-transactions.test.tsx`) mock `@/wallet` and override the `useWallet` property — that property name must become `useEvmWallet` to match the renamed barrel export, or the component will receive the real hook.

### 8. Tighten the ESLint boundary

In `packages/frontend/eslint.config.js`, the block at lines 37–63: change `ignores: ["src/wallet/**", "src/api/**", "src/lib/env.ts"]` to `ignores: ["src/wallet/evm/**", "src/api/**", "src/lib/env.ts"]`. Update the explanatory comment (lines 38–41) to say the EVM chain libs are only importable from `src/wallet/evm/**`. Do **not** add the Stellar half (that is sub-issue 1).

### 9. Update docs

- `packages/frontend/src/wallet/README.md`: update the Public API import block and headings — `WalletProvider` → `EvmWalletProvider`, `useWallet` → `useEvmWallet`, `useToken` → `useEvmToken`; update the ESLint-boundary sentence (the boundary file is now `src/wallet/evm/**`); update the "same-tab mock bridge is installed automatically by `WalletProvider`" note to `EvmWalletProvider`; update the "Adding to the public surface" section that points at `useWallet.ts`/`src/wallet/` to `evm/useEvmWallet.ts`/`src/wallet/evm/`.
- `docs/FRONTEND.md` (lines 125–132): `useToken`→`useEvmToken`, `useWallet()`→`useEvmWallet()`; module path `src/wallet/` stays.
- `docs/frontend/hooks.md` (rows ~26 and ~31): rename `useToken`→`useEvmToken` and `useWallet`→`useEvmWallet` in the hook-name column; the `@/wallet` module column stays.
- `docs/frontend/utils.md` (line ~11): internal path `src/wallet/cache.ts` → `src/wallet/evm/cache.ts`.

### 10. Verify (see Test Strategy)

## Test Strategy

No new tests — this is a behavior-preserving refactor; the existing suite is the regression net.

1. `yarn workspace @pipeline/frontend test` (Vitest) — the full frontend suite must pass with no behavior change. Pay attention to the moved `*.test.ts(x)` files and the rewritten `vi.mock` paths; a stale mock string manifests as a runtime test failure (component receives the real hook / a missing config export), not a typecheck error.
2. `yarn workspace @pipeline/frontend build` (`tsc -b && vite build`) — typecheck + build must pass. This catches any missed import-path or identifier rename.
3. `yarn workspace @pipeline/frontend lint` (`eslint . && prettier --check .`) — must pass. Specifically confirm:
   - The narrowed `no-restricted-imports` exemption produces **no** new violations (i.e. no file under `src/wallet/` but outside `src/wallet/evm/` imports wagmi/viem/AppKit/TanStack Query — the barrel must remain re-export-only).
   - Moved/edited files are prettier-clean (`prettier --write` on touched files if needed).
4. From repo root, run `npx tsx scripts/lint-docs.ts` (per AGENTS.md, after any TS doc change) to validate documentation structure.
5. Manual sanity (optional, no UX-tester needed for a no-op refactor unless the manager opts in): `yarn workspace @pipeline/frontend dev`, load the app, confirm TopBar/AccountDropdown/deposit/stake render and the wallet connect path is unchanged.

Edge cases to watch:

- `useContractRead` is exported from the renamed `useEvmWallet.ts` but keeps its own name — verify the barrel still re-exports it and `useContractRead.test.tsx` (moved into `evm/`) still resolves.
- Barrel-mock tests (`RecentActivityCard.test.tsx`, `-transactions.test.tsx`) override the `useWallet` property of the mocked `@/wallet` — these must switch to `useEvmWallet` or the mock silently no-ops.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — hook/provider names, ESLint-boundary path, mock-bridge note, "Adding to the public surface" paths.
- `docs/FRONTEND.md` — `useWallet`/`useToken` references (lines 125–132).
- `docs/frontend/hooks.md` — `useWallet`/`useToken` hook-name rows.
- `docs/frontend/utils.md` — `src/wallet/cache.ts` internal path.
- No product-spec update required: no user- or agent-facing behavior changes (pure refactor).
