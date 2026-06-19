# Issue #674: [FE] [Stellar] Activity amounts formatted with wrong decimals (EVM 6/18 hardcoded; Stellar SAC is 7)

Source: https://github.com/eq-lab/pipeline/issues/674

## Scope

Fix activity-row amount formatting so it uses the decimal scale of the active chain instead of hardcoded EVM scales.

- `renderRequestRow` currently hardcodes EVM decimals:
  - Deposit / Withdraw: `formatTokenAmount(item.amount, 6)`
  - Stake / Unstake: `formatTokenAmount(item.{assets,shares}, 18)`
- The request list is single-chain (keyed off `useWalletView().kind`), so the active chain alone determines decimals for every row:

  | Chain | Deposit/Withdraw | Stake/Unstake (assets/shares) |
  |---|---|---|
  | EVM | 6 | 18 |
  | Stellar | 7 | 7 |

Single change to the shared `renderRequestRow` fixes both render surfaces:
- `/transactions` (Activity epic #522) — `packages/frontend/src/routes/transactions.tsx`
- Home Recent Activity (epic #463) — `packages/frontend/src/components/RecentActivityCard.tsx`

Out of scope: per-row chain fields, API contract changes, the documented fail-loud `—` behavior for missing Stake/Unstake fields (preserved), any change to row visuals.

## Assumptions and Risks

- The list is genuinely single-chain. Confirmed: `useRequests` keys off `useWalletView().kind` (see `packages/frontend/src/api/README.md:59` and `useRequests.ts`), so all rows share the active chain. Passing one chain-derived decimals value per render is correct.
- `WalletViewKind` is exactly `"evm" | "stellar"` (`WalletViewContext.tsx:18`); no third chain to handle.
- `SAC_DECIMALS = 7` is the canonical Stellar scale (`packages/frontend/src/wallet/stellar/useStellarSacToken.ts:60`). Reuse it rather than hardcoding `7` so the constant stays single-sourced.
- Both call sites already destructure `{ kind } = useWalletView()` and both test files already mock `useWalletView` with an `"evm" | "stellar"` typed return, so threading `kind` (or derived decimals) is low-risk.
- Risk: forgetting to update the JSDoc contract block in `renderRequestRow.tsx` (lines ~5–28) that documents the EVM 6/18 assumption — must be updated to reflect chain-awareness.

## Open Questions

_None_

## Implementation Steps

1. [x] In `packages/frontend/src/components/activity/renderRequestRow.tsx`:
   - Change the `renderRequestRow` signature to accept the active chain. Recommended: add a required `chainKind: WalletViewKind` (import the type from `@/wallet`) as a parameter so the function can derive decimals internally and callers cannot drift. Proposed signature: `renderRequestRow(item: RequestItem, chainKind: WalletViewKind, testId?: string)`.
   - Derive decimals from `chainKind`:
     - `paymentDecimals = chainKind === "stellar" ? SAC_DECIMALS : 6` (Deposit/Withdraw `item.amount`).
     - `stakeDecimals = chainKind === "stellar" ? SAC_DECIMALS : 18` (Stake/Unstake `item.assets` / `item.shares`).
   - Import `SAC_DECIMALS` from `@/wallet` (re-exported via `wallet/index.ts:103`) so the Stellar scale stays single-sourced.
   - Replace the four hardcoded calls: `formatTokenAmount(item.amount, 6)` → `formatTokenAmount(item.amount, paymentDecimals)` (Deposit ~98, Withdraw ~132); `formatTokenAmount(item.{assets,shares}, 18)` → `...stakeDecimals` (Stake ~170-172, Unstake ~191-193). Preserve the fail-loud `—` guards.
   - Update the JSDoc header block (lines ~5–28) to state the renderer is chain-aware and document the EVM 6/18 vs Stellar 7/7 mapping.

2. [x] In `packages/frontend/src/routes/transactions.tsx` (line ~173): pass the active chain to the renderer — `renderRequestRow(item, kind, `transactions-row-${i}`)`. `kind` is already in scope (line 89).

3. [x] In `packages/frontend/src/components/RecentActivityCard.tsx` (line ~152): pass the active chain — `renderRequestRow(item, kind)`. `kind` is already in scope (line 89).

4. [x] Run TypeScript/lint to confirm the new required parameter is supplied at both call sites and any other callers (only the two above + tests exist).

## Test Strategy

Both test files already mock `useWalletView` with `{ kind: "evm" | "stellar" }` and import `renderRequestRow`.

- `packages/frontend/src/routes/-transactions.test.tsx`:
  - Add a `describe("Transactions page — Stellar decimals (Issue #674)")` block. Set `mockUseWalletView.mockReturnValue({ kind: "stellar" })`. Use a fixture where Stellar amounts are at 7 dp: a `"10000000"` (1.0 at 7 dp) Deposit/Withdraw `amount`, and `assets`/`shares` at 7 dp.
  - Assert a 1.0 Stellar deposit renders `1.00 USDC` (not `10.00`), and a 1.0 Stellar stake renders `1.00 PLUSD` / `1.00 sPLUSD` (not `0.00`).
  - Keep/verify an existing EVM case still renders the 6/18-scaled fixtures correctly (regression guard).

- `packages/frontend/src/components/RecentActivityCard.test.tsx`:
  - Mirror the same Stellar-active case asserting `1.00 USDC` and non-zero Stake/Unstake amounts.

- [x] Run the frontend unit suite (`/test-fast` or the package's vitest) and `npx tsx scripts/lint-docs.ts` per AGENTS.md.

## Docs to Update

- None required (behavior fix, no product-spec/design-doc change). The only doc edit is the in-file JSDoc contract in `renderRequestRow.tsx`. `packages/frontend/src/api/useRequests.ts` line ~44 comment documents the EVM 6/18 assumption for `RequestItem`; optionally update that comment to note formatting is now chain-aware, but it is not load-bearing for the fix.
