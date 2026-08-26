# Issue #1184: Activity disconnected empty state — add a Connect Wallet button

Source: https://github.com/eq-lab/pipeline/issues/1184
Figma: review annotation `3001:10286` on Activity screenshot `2999:8572` ("Исправить состояние — Добавить кнопку Connect Wallet").

## Scope

When the Activity page renders its empty state while **disconnected**, a primary-dark "Connect Wallet" button renders below the caption and opens the shared connect modal. Connected-but-no-rows keeps the caption-only empty state. Out of scope: filter tabs (#37 has no issue yet), the connect-flow ordering (#1155).

## Assumptions and Risks

- No dedicated design frame exists for the disconnected Activity state; the annotation names the fix directly. Button uses the existing `Button` `variant="primary-dark"` (same as the header's Connect Wallet), 16px above the caption block — consistent with the connect-banner CTA idiom.
- `EmptyState` takes a ReactNode caption; the button renders as a sibling below `EmptyState` inside the existing centering wrapper — no `@pipeline/ui` API change.

## Open Questions

_None_

## Implementation Steps

1. `routes/transactions.tsx`: wire `useConnectModal()`; inside the empty-state wrapper render `<Button variant="primary-dark" onClick={open}>Connect Wallet</Button>` (`data-testid="transactions-connect-wallet-button"`, `mt-4`) only when `!isConnected`.
2. Tests (`-transactions.test.tsx`): disconnected empty state shows the button and clicking opens the modal; connected empty state hides it.
3. Spec: `dashboard-components.md` Transactions route — empty-state rule.

## Test Strategy

Route tests as above; manual on localhost disconnected.

## Docs to Update

`docs/frontend/dashboard-components.md` (Transactions route empty state).
