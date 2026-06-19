# Issue #688: [FE] [Stellar] Home page Total Balance & Stake-CTA read EVM tokens only (follow-up to #684)

Source: https://github.com/eq-lab/pipeline/issues/688

## Scope

Make the home page (`packages/frontend/src/routes/index.tsx`) balance reads chain-aware so a Stellar-connected session shows real PLUSD/sPLUSD balances instead of `$0.00` Total Balance and a permanently disabled Stake CTA. This is a follow-up to #684, which already fixed the connection gate (`isConnected` is now derived from `useWalletView().kind`).

In scope:

- Add Stellar balance hooks to the home page, mirroring the unconditional-hooks + chain-select pattern in `useStakeFlow.ts` / `useDepositFlow.ts`.
- Select PLUSD balance, sPLUSD share balance, and the sPLUSD→PLUSD conversion from the active chain (`kind === "stellar"` vs EVM default).
- Recompute these home-page derivations from the active-chain values so they work for both chains:
  - `totalBalanceFormatted` (PortfolioPlaceholderCard "Total Balance").
  - `stakeDisabled` (Stake CTA gating).
  - `mobileHomeState` (`empty` / `plusd` / `splusd`), and the props derived from it (`mobilePlusdBalance`, `mobileSplusdShares`, `mobileSplusdInPlusd`, RecentActivityCard visibility).
- Update the stale code comments in `index.tsx` (lines ~64-75 docblock and ~135-139) that state Stellar wiring is deferred.

Out of scope:

- Any change to `PortfolioPlaceholderCard`, `StartHereCard`, `EarnedCard`, `StakeCard`, or other child component internals beyond passing them correct values. Their existing props (`mobileTotalBalance: string`, `mobilePlusdBalance: string`, `mobileSplusdShares: bigint | undefined`, `mobileSplusdInPlusd: bigint | undefined`) are reused as-is.
- EVM behavior changes — the EVM path must remain byte-for-byte equivalent to today.
- Stellar staking/unstaking flow, TopBar, or AccountDropdown changes (already handled in #675).
- Chart/portfolio history wiring (still a placeholder).

## Assumptions and Risks

- **Decimal-scale mismatch is the central risk.** EVM balances are 18-decimal bigints; Stellar SAC balances are 7-decimal (`SAC_DECIMALS = 7`). The existing `formatBigintUSD` helper hardcodes `formatUnits(value, 18)`, and the child components (`PortfolioPlaceholderCard`, `StakeCard`) receive bigints/strings. The plan must format Stellar values at 7 decimals and pass already-formatted strings where the contract is a string, and 7-decimal bigints only where the child re-formats at the Stellar scale. The safest approach (chosen below) is to compute the **formatted display strings** on the active chain and pass those, rather than passing raw mixed-scale bigints into an 18-decimal formatter.
- `useStellarSacToken({ assetCode: "PLUSD" })` returns `balance` as a **Horizon decimal string** (e.g. `"1.2345678"`), not a bigint. `sacDisplayToRaw(balance)` converts it to a 7-decimal raw bigint (this is exactly what `useStakeFlow` does at lines 382-391, guarded by try/catch). PLUSD is 1:1 with USD, so the display string maps directly to USD via `formatUsdcDisplay`.
- The TopBar already established the exact #675 pattern for these reads (`TopBar.tsx` lines 104-128): resolve issuer/contract from `useStellarDepositManagerAddresses()`, read PLUSD via `useStellarSacToken`, read sPLUSD via `useStellarStakedPlusdBalance`, gate PLUSD on `hasTrustline`, hide zero rows. Reuse this pattern and its helpers (`sacRawToDisplay`, `formatUsdcDisplay`).
- Rules of Hooks: every Stellar hook must be called unconditionally at the top of `Home()`, exactly as `useStakeFlow` does. Do not call hooks inside `kind === "stellar" ? …` branches.
- `useStellarStakedPlusdBalance()` returns `balance` as a raw 7-decimal bigint (vault share balance) — same scale `StakeCard`'s `mobileSplusdShares` already expects on the EVM path? **No** — on EVM today `splusdBalance` is an 18-decimal ERC-20 balance. `StakeCard` must therefore be checked: confirm whether it formats `mobileSplusdShares` at a fixed decimal scale (would break for Stellar) — see Open Questions / Implementation Step 6.
- For Total Balance on Stellar, sPLUSD must be converted to PLUSD-equivalent via `useStellarUnstakeConvertToAssets(shares)` (the Stellar analogue of `useStakedPlusdConvertToAssets`), which returns a 7-decimal PLUSD bigint. PLUSD is 1:1 USD, so `(plusdRaw + sPlusdInPlusdRaw)` at 7 decimals → USD via a 7-decimal format.
- No new product/design decision: "Total Balance = PLUSD + sPLUSD-converted-to-PLUSD" is the established convention already implemented for EVM (index.tsx lines 156-160); the Stellar path reuses it at the Stellar scale.

## Open Questions

_None._ (Resolved from the codebase: Total Balance composition, chain-aware selection pattern, and Stellar 7-decimal display all have established precedents in `index.tsx` (EVM), `useStakeFlow.ts`, and `TopBar.tsx`/#675. The one item the coder must verify mechanically — whether `StakeCard` re-formats `mobileSplusdShares`/`mobileSplusdInPlusd` at a fixed 18-decimal scale — is a code-reading task covered in Implementation Step 6, not a product decision. If that verification reveals `StakeCard` hardcodes 18-decimal formatting for those bigint props, prefer passing pre-formatted display strings; if `StakeCard`'s prop contract cannot express the Stellar scale without a component change, that is an in-scope mechanical fix to keep the props chain-correct, still no product decision required.)

## Implementation Steps

All edits are in `packages/frontend/src/routes/index.tsx` unless noted.

1. **Imports.** Add to the existing `@/wallet` import block: `useStellarSacToken`, `useStellarStakedPlusdBalance`, `useStellarUnstakeConvertToAssets`, `useStellarDepositManagerAddresses`, `sacDisplayToRaw`, `sacRawToDisplay`, `SAC_DECIMALS`, `formatUsdcDisplay`. (`useStellarWallet`, `useWalletView` are already imported.) Keep `useEvmToken`, `useStakedPlusdAsset`, `useStakedPlusdConvertToAssets` for the EVM path.

2. **EVM reads — leave unchanged.** Keep the existing EVM hook calls (`useStakedPlusdAsset`, the two `useEvmToken` calls, `useStakedPlusdConvertToAssets`) and their derived `plusdBalance`, `plusdFormatted`, `splusdBalance` (EVM), `splusdInPlusd` (EVM). Rename the EVM-derived locals if needed to disambiguate (e.g. `evmPlusdBalance`, `evmTotalBalanceBigint`).

3. **Stellar reads — add unconditionally**, mirroring `TopBar.tsx` lines 104-128 and `useStakeFlow.ts` lines 242-258:
   - `const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();`
   - `const stellarPlusd = useStellarSacToken({ assetCode: "PLUSD", assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "", contractId: stellarAddresses?.plusd ?? "" });`
   - `const stellarSplusd = useStellarStakedPlusdBalance();`
   - sPLUSD raw share balance: `const stellarSplusdShares = stellarSplusd.balance;` (7-decimal bigint or `undefined`).
   - sPLUSD → PLUSD-equivalent: `const { data: stellarSplusdInPlusd } = useStellarUnstakeConvertToAssets(stellarSplusdShares);` (7-decimal bigint).
   - PLUSD raw balance (only when there is a trustline): convert the Horizon string to a 7-decimal bigint via `sacDisplayToRaw`, guarded by try/catch exactly as `useStakeFlow.ts` lines 382-391, and treat no-trustline as `undefined`.

4. **Active-chain selection** (after all hooks, before JSX), gated on `kind === "stellar"`:
   - `plusdBalanceActive` (raw bigint at active scale), `splusdSharesActive` (raw bigint at active scale), `splusdInPlusdActive` (raw bigint at active scale), and the **active decimals** (`SAC_DECIMALS` for Stellar, `18` for EVM).
   - `plusdFormattedActive` (display string with no `$`, used for `StartHereCard`'s `mobilePlusdBalance`): EVM keeps `plusdFormatted`; Stellar uses `formatUsdcDisplay(stellarPlusd.balance)` or a `sacRawToDisplay`-based locale string consistent with how `StartHereCard` renders it (match the EVM string shape — check whether `mobilePlusdBalance` includes a `$`).

5. **Total Balance.** Generalize `formatBigintUSD` to accept a `decimals` argument (default 18 to preserve current call sites), or add a small Stellar-scale branch:
   - Compute `totalBalanceBigint` per chain as `(plusdBalanceActive ?? 0n) + (splusdInPlusdActive ?? 0n)` at the active decimals.
   - `totalBalanceFormatted = isConnected ? formatBigintUSD(totalBalanceBigint, activeDecimals) : "$0.00"`.
   - Verify both `$0.00` cases (undefined and `0n`) still hold for Stellar.

6. **Mobile state, Stake gating, and child props.** Recompute from active-chain values:
   - `mobileHomeState = isConnected ? deriveMobileHomeState(plusdBalanceActive, splusdSharesActive) : "empty"` — `deriveMobileHomeState` is scale-agnostic (it only compares `> 0n`), so no change to the helper.
   - `stakeDisabled = isConnected && (plusdBalanceActive === undefined || plusdBalanceActive === 0n)`.
   - `StakeCard` props: `mobileSplusdShares={splusdSharesActive}` and `mobileSplusdInPlusd={splusdInPlusdActive}`. **Before wiring, read `packages/frontend/src/components/StakeCard.tsx`** to confirm how it formats those two bigint props. If it formats at a hardcoded 18-decimal scale, the Stellar 7-decimal bigint would render ~1e11× too large. If so, either (a) add an optional `decimals`/scale prop to `StakeCard` for those values, or (b) pass pre-formatted display strings — choose the minimal change that keeps EVM unchanged and matches the existing prop contract. Document the choice inline.
   - `StartHereCard` prop `mobilePlusdBalance={plusdFormattedActive}` (string) — confirm in `StartHereCard.tsx` the expected string shape and match it for Stellar.
   - `PortfolioPlaceholderCard` prop `mobileTotalBalance={totalBalanceFormatted}` (already a formatted string — no scale concern).

7. **Comments.** Update the `index.tsx` module docblock (lines ~64-76) and the inline NOTE (lines ~135-139) to state that balances are now sourced from the active chain (EVM via `useEvmToken`, Stellar via `useStellarSacToken` + `useStellarStakedPlusdBalance`), referencing #688. Remove the "deferred to a follow-up sub-issue of epic #463" language.

8. **Lint.** Run `npx tsx scripts/lint-docs.ts` (per AGENTS.md, after any TypeScript change) and the frontend typecheck/lint (`yarn workspace @pipeline/frontend lint` / `tsc`), fixing any errors. Ensure no unused EVM/Stellar locals (suppress with `void x` only if a hook must stay mounted but its result is unused, matching the `useStakeFlow` `void stellarUsdcToken` precedent).

## Test Strategy

Tests live in `packages/frontend/src/routes/-index.test.tsx`, which already has a `renderHomeStellar()` helper (switches `useWalletView` to `"stellar"` via `StellarViewSwitcher`) and Stellar kit mocks. Add a new `describe("Home page — Stellar connected balances (#688)")` block. Use the localStorage mock keys (per `wallet/stellar/mock.ts`): `balanceSacPlusd` (PLUSD Horizon string), `stakedPlusdShareBalance` (sPLUSD raw 7-decimal bigint string), and `stakedPlusdConvertToAssets` (rate) so `useStellarUnstakeConvertToAssets` resolves. Also set the Stellar wallet connected mock and ensure `useStellarDepositManagerAddresses` resolves a PLUSD issuer/contract (or mock it) so `useStellarSacToken` matches the balance entry.

Cases:

1. **Stellar connected, has PLUSD, 0 sPLUSD** → Total Balance reflects PLUSD (not `$0.00`); Stake CTA enabled; mobile state `plusd`.
2. **Stellar connected, has sPLUSD** → Total Balance includes sPLUSD-converted-to-PLUSD; mobile state `splusd`; RecentActivityCard present on mobile.
3. **Stellar connected, zero balances / no trustline** → Total Balance `$0.00`; Stake CTA disabled; mobile state `empty`.
4. **Decimal-scale assertion** → with a known PLUSD balance (e.g. `"1234.5678900"`), assert the rendered Total Balance is `"$1,234.57"` (7-decimal source formatted to 2dp), proving the value is NOT mis-scaled through the 18-decimal path.
5. **EVM regression** → existing EVM connected tests (`describe("Home page — connected state (mock)")` and the mobile State A/B/C blocks) must still pass unchanged.

Run the home-page test file specifically plus the full frontend unit suite. No backend/e2e changes.

## Docs to Update

- None required (pure frontend bug fix; no user- or agent-facing behavior spec change beyond making the existing connected-portfolio view correct for Stellar). The corrected behavior is already described by epic #463's user stories.
- If the coder hits an unforeseen scale gap in a shared component requiring a deferred shortcut, log it in `docs/exec-plans/tech-debt-tracker.md` per AGENTS.md (do not fix unrelated issues inline).
