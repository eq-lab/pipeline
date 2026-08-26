# Issue #1186: LP review #40 — Stake button inactive (grey) when PLUSD = 0 and sPLUSD = 0

Source: https://github.com/eq-lab/pipeline/issues/1186
Figma: review board `2999:9165`, annotation `3001:10317` on screenshot `2999:8575` (Home, connected, zero balances — active blue "Stake" flagged).

## Scope

The Home StakeCard CTA must render the disabled grey state ("Nothing to Stake") whenever the account's balances **display** as zero. Current code (`stakeDisabled` in `routes/index.tsx`, shipped with #413) already disables at raw `0n`/undefined PLUSD — and its tests assert exactly the reviewed state — so the reviewed regression is explained by **dust balances**: a raw amount > 0n that rounds to $0.00 at 2dp keeps the CTA active (and a dust sPLUSD flips `mobileHomeState` to `"splusd"`, rendering the always-active "Stake More" branch on a $0.00 account). Same staging account exhibited dust PnL in #1194.

Fix: derive both `stakeDisabled` and `deriveMobileHomeState` from the rendered 2dp value, not the raw bigint — consistent with #1194's sign-after-rounding rule.

Also in scope: repair the dead regression harness — `-index.test.tsx` fails wholesale (57 tests) because its `@/api` mock lacks `usePositionsHistory` (logged under BUG-18 observations); the existing "Nothing to Stake" tests cannot run without it, and this issue's new tests live in the same file.

Out of scope: /stake page gating (own flow), Unstake link behavior, the "Stake More" button in a genuinely funded splusd state.

## Assumptions and Risks

- Displayed-zero rule: a balance counts as zero when its 2dp rendering is `0.00`, i.e. `|value| < 0.005` after `formatUnits` (matches Intl halfExpand rounding).
- Dust sPLUSD now derives state `"empty"` (was `"splusd"`) — Total Balance, StartHere, and RecentActivity presence all shift to the empty state for dust accounts; that is the review's intent (the account reads as zero everywhere else already).
- Risk: cannot reproduce the reviewer's exact wallet; if their build predated #413 instead, the change is still correct and strictly stronger.

## Open Questions

_None_

## Implementation Steps

1. `packages/frontend/src/lib/format.ts`: add `isDisplayZero(value: bigint | undefined, decimals: number): boolean` — true for `undefined` and any value whose 2dp rendering is `0.00`.
2. `packages/frontend/src/routes/index.tsx`: `stakeDisabled = isConnected && isDisplayZero(plusdBalanceActive, activeDecimals)`; `deriveMobileHomeState` uses `!isDisplayZero(...)` for both balances.
3. `packages/frontend/src/routes/-index.test.tsx`: add `usePositionsHistory` to the `@/api` mock (undefined data), un-breaking the suite; add cases — connected + dust PLUSD → grey "Nothing to Stake"; dust sPLUSD → state empty (no "Stake More"); genuine balances unchanged.
4. `packages/frontend/src/lib/format.test.ts`: `isDisplayZero` unit cases (undefined, 0n, dust, half-cent boundary, real value, negative dust).
5. Spec `docs/frontend/dashboard-components.md` (#stakecard + mobile state derivation): displayed-zero rule, reference #1186/#1194.
6. Gates: prettier/eslint, tsc, vitest (format, EarnedCard-adjacent, full `-index.test.tsx`), build, docs lint.

## Test Strategy

Unit: `isDisplayZero` boundaries. Route: re-enabled `-index.test.tsx` suite (previously all failing) plus dust-PLUSD → disabled CTA, dust-sPLUSD → empty state, funded → active. Manual: localhost with dust mock balances.

## Docs to Update

- `docs/frontend/dashboard-components.md` — StakeCard disable rule + `deriveMobileHomeState` displayed-zero note.
- `docs/exec-plans/known-bugs.md` — mark the `-index.test.tsx` `usePositionsHistory` mock breakage resolved by this issue.
