# User Stories — Issue #644: Activity page + home: chain-aware empty state

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#644](https://github.com/eq-lab/pipeline/issues/644)
Figma (desktop with data): node 1497-94912 | Figma (desktop empty): node 1497-94567

---

## Story 1 — Stellar active + Stellar connected: rows render, no empty state

**As a** user with the Stellar chain active and a connected Stellar wallet,
**I want** to see my Stellar transaction rows on the Activity page and home card,
**so that** I can view my history without a spurious empty-state overlay appearing at the same time.

### Acceptance criteria

- On `/transactions` with the Stellar chain pill selected and Stellar wallet connected, rows returned by the API are rendered.
- The "You will see all transactions here" empty-state caption is **not** shown simultaneously with rows.
- The `RecentActivityCard` on the home dashboard shows the list (not the empty illustration) in the same configuration.

### How to test

1. Open the app in a browser.
2. Connect the Stellar wallet only (leave EVM disconnected).
3. Select the Stellar chain pill in the top bar.
4. Use the Mocks tab (or `/test` DevTools) to seed at least one Deposit request for the Stellar address.
5. Navigate to `/transactions`.
6. Verify rows are visible and the empty-state caption is absent.
7. Navigate to the home dashboard and verify the `RecentActivityCard` shows the list.

---

## Story 2 — Stellar active + Stellar disconnected: empty state shows

**As a** user with the Stellar chain active but no Stellar wallet connected,
**I want** to see the empty-state illustration on the Activity page,
**so that** I get clear feedback that I need to connect before I can view activity.

### Acceptance criteria

- On `/transactions` with the Stellar chain pill selected and Stellar wallet **not** connected, the empty-state illustration and caption "You will see all transactions here" render.
- No transaction rows are visible.
- The `RecentActivityCard` also shows the empty state.

### How to test

1. Disconnect the Stellar wallet; keep EVM connected if desired.
2. Select the Stellar chain pill.
3. Navigate to `/transactions`.
4. Verify the empty-state illustration and caption appear.
5. Verify no rows are shown.

---

## Story 3 — EVM active + EVM disconnected: empty state shows (Stellar connection irrelevant)

**As a** user with the EVM chain active but EVM wallet disconnected,
**I want** to see the empty state even if a Stellar wallet is connected,
**so that** the active chain — not a non-active chain — determines what is shown.

### Acceptance criteria

- On `/transactions` with the EVM chain pill selected and EVM wallet disconnected, the empty state renders regardless of Stellar wallet state.
- Switching to the EVM chain pill from Stellar resets the view to EVM logic immediately.

### How to test

1. Connect Stellar wallet; disconnect EVM wallet.
2. Select the EVM chain pill.
3. Navigate to `/transactions`.
4. Verify the empty-state illustration shows (EVM is the active chain and it is disconnected).

---

## Story 4 — Mutual exclusivity: empty state and rows never render simultaneously

**As a** user,
**I want** the Activity page to show either my transaction rows or the empty state, never both at once,
**so that** the page is not visually broken.

### Acceptance criteria

- At any point in time, at most one of the following is visible: {loading indicator, error state, empty-state illustration, transaction rows}.
- Switching tabs or chain pills does not cause a momentary state where both rows and the empty state are mounted.

### How to test

1. Connect EVM wallet with several requests in the mock.
2. Switch between Buy/Sell/Stake/Unstake tabs.
3. Verify the empty state appears only when a tab has zero rows; rows appear only when the tab has at least one row.
4. Verify both are never visible simultaneously.
