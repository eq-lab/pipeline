# Issue #1628: LP: Max / % chips can exceed the balance; deposit has no balance check

Source: https://github.com/eq-lab/pipeline/issues/1628 — high (reverted tx / silently disabled
Confirm), found in the 2026-10-22 calculations review. Branch: `fix/1628-amount-chips-balance-gate`.

Status: Completed 2026-10-22 — PR pending (see issue).

## Root cause

1. `useDepositFlow` / `useStakeFlow` quick-amount handlers wrote `formatUsdc(next, dec)` (Intl,
   2 dp, half-up) into the input, which the route re-parses with `parseUsdc`. Any balance with
   more than two fractional digits rounded **up** past the balance, so Max / 75% failed the
   `amount <= balance` gate and Confirm went disabled with no message.
2. The deposit direction gated only on `amount >= minDeposit`; `hasBalance` compared the balance
   with the minimum, not with the amount. A `$10,000` chip on a `$5,000` balance enabled Approve
   and Confirm and the request reverted on-chain.

## Decision

- New `formatUsdcInput(value, decimals)` in `@/lib/usdc` (viem `formatUnits`: exact, no grouping,
  no rounding). All chip handlers and the locked-amount sync use it. Percentages were already
  BigInt floor division in base units; with exact formatting they can no longer exceed the balance.
- `evmDepositMeetsMin` / `stellarDepositMeetsMin` additionally require `amount <= balance`, so
  every deposit step CTA is balance-gated like withdraw / stake / unstake.
- `FlowState.exceedsBalance` and `StakeFlowState.exceedsBalance` (true when the typed amount is
  over the live balance, never while locked to an in-flight request). Both routes render
  `InlineError` "Insufficient balance" right-aligned under the input while it is true.

## Steps

1. `lib/usdc.ts` helper + tests (6 / 7 / 18 dp round-trip).
2. Flow hooks: chip handlers, deposit balance gate, `exceedsBalance`.
3. Routes: `InlineError` line; existing chip tests drop the `.00` suffix; new #1628 tests.
4. Specs: `wallet-flows.md` business rule, `dashboard-components.md` deposit + stake routes,
   `hooks.md` FlowState field list; user stories doc + index row.

## Open Questions

_None_ — copy "Insufficient balance" reuses the mapped-error wording from `userError.ts`.
