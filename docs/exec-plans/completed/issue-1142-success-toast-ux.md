# Issue #1142: Success toasts: include action + amount, hand-dismissable, navigate home after terminal success

Source: https://github.com/eq-lab/pipeline/issues/1142

## Scope

Three changes to confirmed-action feedback:

1. **Action + amount in terminal success toasts** — stake/unstake ("Staked 100.00 PLUSD" /
   "Unstaked 25.50 sPLUSD"), deposit/withdraw step-2 ("Deposited …" / "Withdrawal of … submitted"),
   and the withdraw claim ("Claimed … USDC"). The deposit claim toast already shows the amount
   (`+X PLUSD`, via `lastClaimAmountRef` in `deposit.tsx` ~309) — that ref-capture pattern is the
   template for the rest.
2. **Hand-dismissable toasts** — an × dismiss button on every toast, all tones (incl. pending, so a
   stuck pending toast — cf. #1129 — can always be cleared). Auto-dismiss behavior unchanged
   (non-pending 5 s default; pending sticky).
3. **Navigate home after flow-terminal success** — stake/unstake step-2 success and
   deposit/withdraw **claim** (step-3) success → `navigate({ to: "/" })`. Intermediate steps
   (approval, trustline, request/step-2 of deposit) do NOT navigate. `ToastProvider` mounts in
   `main.tsx` above the router, so the toast survives the route change.

Out of scope: error-toast lifecycles (#1129), trustee app, toast visual redesign (no Figma given).

## Assumptions and Risks

- Toast plumbing: `packages/frontend/src/lib/toast/ToastProvider.tsx` already exposes
  `dismiss(id)`; the UI component `packages/ui/src/components/Toast/Toast.tsx` has `title`,
  `action`, `icon` but no dismiss affordance. The × is a new optional `onDismiss` prop on the UI
  component (separate from the `action` slot), wired by the provider.
- Amount availability at success time: the routes clear `amountInput` on success
  (`stake.tsx` ~73, `deposit.tsx` ~102/121), so toasts must read a ref captured **when the
  pending toast is shown** (step pending-start — the input is still populated then), mirroring
  `lastClaimAmountRef`. For the withdraw claim, `flow.lockedAmountRaw` + `flow.decimals` feed the
  same ref that deposit claim uses.
- Asset labels: stake tab stakes PLUSD; unstake tab redeems sPLUSD shares — use the tab's own
  asset wording. Deposit step-2 moves USDC; withdraw step-2 burns PLUSD; withdraw claim pays USDC.
- Risk: navigating on step-2 success for stake/unstake unmounts the stake route — its toast
  effects' cleanup must not dismiss or orphan the success toast (they don't today: toasts live in
  the provider). Verify the success `toast.update` runs before `navigate` in the same effect.
- Risk: the deposit claim toast has a "View" action to `/transactions`; after navigating home the
  action remains valid (global toast) — keep it.
- The stake/deposit route test files may be #1003-broken (`localStorage`); the toast lib tests
  (`useToast.test.tsx`, `Toast.dom.test.tsx`) and the ui `Toast` component are the reliable seams
  — put the dismiss coverage there and verify any route-test failure is the known TypeError on a
  clean tree before touching it.

## Open Questions

_None_ — the issue body fixed the decisions (terminal-only navigation incl. claim-not-request for
deposit/withdraw; × on all tones; auto-dismiss unchanged), and the amounts all exist in flow/route
state already.

## Implementation Steps

1. ✅ **UI Toast dismiss** — `packages/ui/src/components/Toast/Toast.tsx`: add optional
   `onDismiss?: () => void`; when set, render an × icon button (24 px hit target,
   `aria-label="Dismiss"`, `data-testid="toast-dismiss"`) right-aligned after the `action` slot,
   `currentColor` so it inherits each tone's ink. Update `Toast.stories.tsx` with a dismissable
   variant.
2. ✅ **Provider wiring** — `packages/frontend/src/lib/toast/ToastProvider.tsx`: pass
   `onDismiss={() => dismiss(entry.id)}` to every rendered `Toast`.
3. ✅ **Stake/unstake toasts + navigation** — `packages/frontend/src/routes/stake.tsx`:
   - Add `lastActionAmountRef` captured when `flow.step2Tx.isPending` flips true (from
     `amountInput`, which is still populated at that moment).
   - Step-2 success title → `Staked ${amount} PLUSD` / `Unstaked ${amount} sPLUSD`
     (fallback to today's value-less titles when the ref is empty).
   - After the success `toast.update`, `void navigate({ to: "/" })` in the same branch.
4. ✅ **Deposit/withdraw step-2 titles** — `deposit.tsx`: capture the amount the same way at step-2
   pending-start; success titles → `Deposited ${amount} USDC` (deposit) /
   `Withdrawal of ${amount} PLUSD submitted` (withdraw). No navigation here (non-terminal).
5. ✅ **Claim (step-3) navigation + withdraw amount** — `deposit.tsx`:
   - Withdraw claim success title → `Claimed ${lastClaimAmountRef.current} USDC` (fallback
     "USDC claimed").
   - After the step-3 success `toast.update` (both directions), `void navigate({ to: "/" })`.
     Keep the deposit claim's existing `+X PLUSD` title and "View" action.
6. ✅ **Gate** — `npx tsx scripts/lint-docs.ts`; `yarn build` + `tsc --noEmit` in
   `packages/frontend` (and confirm trustee build since `@pipeline/ui` changed); targeted vitest;
   `/test-fast`.

## Test Strategy

(✅ implemented: Toast.dom.test.tsx dismiss coverage + useToast.test.tsx provider-path × test — 19/19; both route test files confirmed #1003-broken (localStorage TypeError, 42 resp. 109 pre-existing failures), so route-level assertions were skipped per the fallback below.)

- `packages/ui` `Toast` (or `packages/frontend/src/lib/toast/Toast.dom.test.tsx`, whichever runs
  cleanly): × renders when `onDismiss` set, absent otherwise; clicking calls the handler; present
  on pending tone too.
- `useToast.test.tsx`: dismissing via the provider-rendered × removes the entry (extend the
  existing dismiss coverage to the DOM path if the file runs in this env).
- Route-level toast titles/navigation: if `-stake.test.tsx` / `-deposit.test.tsx` run, add
  assertions (success toast title contains the entered amount; `navigate` called with `/` on
  terminal success only — mock navigate); if they're #1003-broken, verify on a clean tree, note
  it, and rely on the lib/ui tests + manual check.
- Edge cases: success with an empty captured ref (recovered in-flight request after reload) →
  fallback titles, still navigates; step-2 deposit success → NO navigation.

## Docs to Update

- `docs/frontend/ui-components.md#toast` — `onDismiss` prop + the all-tones dismiss rule.
- `docs/frontend/wallet-flows.md` — step/toast model: terminal-success toasts carry
  action + amount; terminal success navigates home (stake/unstake step 2; deposit/withdraw claim).
- `docs/frontend/dashboard-components.md#deposit-and-withdraw-route` (claim toast note) — extend
  with the withdraw claim amount + navigation.
