# Issue #641: [FE] Set Stellar deposit minimum to 1,000 USDC (reverses #598)

Source: https://github.com/eq-lab/pipeline/issues/641

## Scope

Raise the frontend Stellar deposit minimum from **1 USDC** back to **1,000 USDC**, reversing #598. This is a single-constant change plus the downstream test and doc updates it forces.

The product decision is **confirmed** in the issue comments ("yes, we revert" — equilibrium-de, 2026-06-18). No further product gate is required for this revert.

In scope:

- `STELLAR_MIN_DEPOSIT` in `packages/frontend/src/wallet/useDepositFlow.ts:197` changes from `1n * 10n ** BigInt(SAC_DECIMALS)` to `1000n * 10n ** BigInt(SAC_DECIMALS)`.
- Any Stellar deposit test in `packages/frontend/src/routes/-deposit.test.tsx` that types a sub-1,000 amount and expects Confirm to be reachable must be updated so the typed amount meets the new minimum.
- The #598 user-story doc (`docs/user-stories/epic-498/598-stellar-min-deposit-one.md`) must be updated to reflect that the Stellar minimum is now 1,000 USDC (the revert).

Out of scope:

- EVM behavior. EVM continues reading `DepositManager.minDeposit()`; the Stellar constant is never used for EVM (verified at `useDepositFlow.ts` — `STELLAR_MIN_DEPOSIT` is referenced only on the Stellar branches).
- Any on-chain / Soroban contract change. Soroban exposes no min-deposit getter; this stays a frontend constant per the issue Notes.
- Renaming or relocating the constant.

## Assumptions and Risks

- **Assumption:** `SAC_DECIMALS = 7` (confirmed in `packages/frontend/src/wallet/stellar/useStellarSacToken.ts:59`), so `1000 * 10^7 = 10_000_000_000n` raw — the intended 1,000 USDC at 7 dp.
- **Assumption:** The existing JSDoc comment block at `useDepositFlow.ts:191-196` describes the `$1` value and must be updated to describe `$1,000` so the constant and its doc stay consistent.
- **Risk — test regression:** The test "both rows show 'Enable complete' badges and Confirm is reachable when both trustlines exist" (`-deposit.test.tsx`, ~line 2206) types `"2"` into the amount input and asserts Confirm is **not** disabled. With the minimum raised to 1,000 USDC, `2 < 1,000` makes `stellarDepositMeetsMin` false, so Confirm would stay disabled and the test would fail. The coder must change the typed amount in this specific test to a value ≥ 1,000 (e.g. `"2000"`). The seeded SAC USDC balance / `usdcBalance` default ("5000") already covers a 2,000 amount, so no balance seed change is needed. The companion "Confirm blocked until BOTH trustlines exist" tests (~lines 2232, 2249) assert Confirm is **disabled** regardless of amount, so they remain correct with `"2"` — but the coder should confirm they don't accidentally pass for the wrong reason (they're disabled by missing trustline, not by min).
- **Risk — other Stellar min assertions:** Re-grep `-deposit.test.tsx` for any Stellar deposit test asserting a "1 USDC" minimum label, a Min-chip value of `1.00`, or a below-min banner reading `1 USDC`. The current Min-chip / below-min assertions in that file are EVM-scenario based (minDeposit mock `1000000000` = 1,000 USDC at 6 dp) and are unaffected, but the coder must verify no Stellar-specific 1-USDC assertion exists before changing the constant.
- **Risk (low):** The Stellar Min chip label is derived from the same constant (`stellarMinChipLabel`, `useDepositFlow.ts:1060`) and the below-min banner text (`useDepositFlow.ts:598`) both flow from `STELLAR_MIN_DEPOSIT`, so the one-line constant change propagates everywhere automatically — no per-call-site edits in the hook.

## Open Questions

_None_

## Implementation Steps

1. In `packages/frontend/src/wallet/useDepositFlow.ts`:
   - Change line 197 from `const STELLAR_MIN_DEPOSIT = 1n * 10n ** BigInt(SAC_DECIMALS);` to `const STELLAR_MIN_DEPOSIT = 1000n * 10n ** BigInt(SAC_DECIMALS);`.
   - Update the JSDoc block at lines 191-196 to describe the 1,000 USDC value (e.g. "$1,000 at 7 dp = 1000 × 10^7 = 10_000_000_000n") and keep the note that Soroban exposes no on-chain minimum getter so this stays a frontend constant.
2. In `packages/frontend/src/routes/-deposit.test.tsx`:
   - In the Stellar test "both rows show 'Enable complete' badges and Confirm is reachable when both trustlines exist" (~line 2206), change the typed amount from `"2"` to a value ≥ 1,000 (e.g. `"2000"`) so `stellarDepositMeetsMin` is satisfied and the Confirm-enabled assertion holds. Verify the seeded balance still covers it.
   - Grep the file for any remaining Stellar-context assertion of a "1 USDC" minimum (Min chip `1.00`, below-min banner `1 USDC`); update any found to `1,000` / `1000.00` as appropriate. (None expected beyond the one above based on planner research, but confirm.)
3. In `docs/user-stories/epic-498/598-stellar-min-deposit-one.md`:
   - Update the title, overview, and Stories 1-2 to state the Stellar minimum is **1,000 USDC** (reverted by #641). Story 1 Min chip should read `$1,000 (Min)` and fill `1000.00`; Story 2 below-min text should read `1,000 USDC` and the example "below" balance should be a sub-1,000 amount (e.g. `500` USDC). Add a one-line note that #641 reverses #598. Story 3 (EVM contract-driven) is unchanged.
   - Confirm `docs/user-stories/epic-498/503-below-min-banner.md` already states "Minimum amount — 1,000 USDC" (it does); no change needed there, but it now correctly applies to the Stellar rail too.

## Test Strategy

- Run the frontend unit/component suite covering the deposit page: `packages/frontend/src/routes/-deposit.test.tsx` (the file with the Stellar trustline + min-gate tests). All Stellar deposit tests must pass with the updated minimum.
- Specifically verify:
  - The "Confirm reachable when both trustlines exist" test passes with the amount bumped to ≥ 1,000.
  - The "Confirm blocked until BOTH trustlines exist" tests still pass (Confirm disabled).
  - EVM Min-chip / below-min tests (minDeposit mock = 1,000 USDC at 6 dp) are untouched and still pass — confirms EVM path is unaffected.
- Run `npx tsx scripts/lint-docs.ts` after editing the user-story doc to validate documentation structure (per AGENTS.md).
- Edge cases to keep covered by the existing/updated tests: amount exactly at 1,000 (meets min), amount just below 1,000 (blocked), and the Min chip filling `1000.00`.

## Docs to Update

- `docs/user-stories/epic-498/598-stellar-min-deposit-one.md` — flip from 1 USDC to 1,000 USDC; note the #641 revert.
- No product-spec change required: `docs/product-specs/deposits.md:28` already states the minimum deposit default is 1,000 USDC, and there is no Stellar-specific 1-USDC note in that spec. This revert realigns code with the existing spec.
- `docs/user-stories/epic-498/503-below-min-banner.md` already reads "1,000 USDC" — verify only, no edit expected.
