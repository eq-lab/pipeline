# Issues #1152 + #1151: disconnected home CTAs open the connect flow; Sell gets a real disabled state

Sources: https://github.com/eq-lab/pipeline/issues/1152, https://github.com/eq-lab/pipeline/issues/1151
Figma: disconnected dashboard `1497:94556` (Sell rendered disabled next to active Buy; Stake circle active); review annotations `2999:9217`/`2999:9232` (Buy area + Stake circle → connect flow) and `2999:9202` (Sell → disabled).

## Scope

- #1152: with no wallet connected, clicking **Buy** or the **Stake circle** opens the shared connect-wallet modal (`useConnectModal().open()`) instead of navigating to /deposit and /stake.
- #1151: **Sell** renders disabled whenever there is nothing to sell — disconnected, or connected with a display-zero PLUSD balance (`isDisplayZero`, the #1186 rule). Mobile already gets this via `mobileHomeState === "empty"`; the desktop card never received the signal — the reviewed bug.
- Out of scope: the connect-flow ordering itself (#1155), the Activity empty state (#1184).

## Assumptions and Risks

- Sell's disabled reach includes connected-with-zero-PLUSD on desktop: the mobile card already disables Sell in the equivalent state (`"empty"`), so this only aligns desktop with existing mobile semantics; the design frame shows the disconnected case.
- The disabled style is the `Button` `secondary` variant's existing `disabled:opacity-[0.32]` — matches the faint grey Sell in `1497:94556`; no new styling.
- Existing `-index.test.tsx` assertions that disconnected Buy/Stake navigate will be updated to assert the connect modal opens — behavior change is the point of #1152.

## Open Questions

_None_

## Implementation Steps

1. `routes/index.tsx`: guard `onBuy`/`onSell`/`onStake` with `if (!isConnected) { openConnectModal(); return; }`; compute `sellDisabled = !isConnected || isDisplayZero(plusdBalanceActive, activeDecimals)` and pass to both `StartHereCard` instances.
2. `components/StartHereCard.tsx`: new optional `sellDisabled` prop, OR'd with the existing `mobileHomeState === "empty"` rule.
3. Tests (`-index.test.tsx`): rewrite disconnected Buy/Stake navigation tests to assert `openConnectModal` fires and `navigate` does not; Sell disabled when disconnected; desktop Sell disabled at display-zero PLUSD and enabled with balance (navigates to withdraw); connected Buy/Stake still navigate.
4. Specs: `dashboard-components.md` — StartHereCard Buy/Sell wiring + StakeCard/home-route disconnected-click rule (#1152/#1151, supersedes the #408-era "Stake navigates when disconnected" note).

## Test Strategy

Route-level tests in `-index.test.tsx` as above (harness repaired in #1186). Manual: localhost disconnected → Buy/Stake open the chooser, Sell inert; connect with zero balances → Sell/Stake disabled; funded → all navigate.

## Docs to Update

`docs/frontend/dashboard-components.md` (StartHereCard section, StakeCard/home-route click rules).
