# User Stories: #250 — Home Connect-Wallet section: wired Connect + Portfolio placeholder when connected

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#250](https://github.com/eq-lab/pipeline/issues/250)
Plan: `docs/exec-plans/completed/issue-250-home-connect-wire-portfolio-placeholder.md`

> Migrated from `docs/STORIES.md` (S-250). The issue predates epic #463 — desktop home
> page work built under the old workflow.

---

## Story 1 (TC-250-1): Disconnected — Connect promo CTA opens the wallet modal

**Persona:** User (no wallet connected).

**Pre-conditions:** Dev server running; no `pipeline.mock.wallet.*` keys in localStorage.

**Steps:**

1. Navigate to `http://localhost:3000/`
2. Observe the top-left card — should show "Connect Wallet" / "Access real-world yield on-chain"
3. Click the "Connect" button

**Expected outcomes:** The Reown AppKit wallet-selection modal opens (same modal as the header "Connect" CTA). No page navigation occurs.

---

## Story 2 (TC-250-2): Connected via DevTools mock — Portfolio placeholder renders correctly

**Persona:** User / QA.

**Pre-conditions:** Dev server running.

**Steps:**

1. In DevTools Console: `localStorage.setItem('pipeline.mock.wallet.isConnected', 'true'); localStorage.setItem('pipeline.mock.wallet.address', '0x1234000000000000000000000000000000000001')`
2. Refresh the page (or navigate to `http://localhost:3000/`)
3. Observe the top-left card

**Expected outcomes:**

- The "Connect Wallet" promo card is gone — the top-left slot now shows the Portfolio placeholder.
- "Total Balance" eyebrow label, "$0.00" heading, and "Get PLUSD to start" muted link are visible.
- A `7D | 1M | 3M | 1Y | All` segmented tab control is visible in the top-right of the card.
- A 100-bar stacked monotonic-growth chart in the design-system positive green (`--color-pipeline-chart-positive`) fills the body of the card.
- A `+$42.80 earning` caption appears below the `$0.00` balance.
- The grid does not reflow — the card height is approximately the same as the Connect Wallet promo card (~274px min).
- Clicking "Get PLUSD to start" navigates to `/deposit`.

---

## Story 3 (TC-250-3): Switching tabs updates the active pill — no network call

**Persona:** User (connected via mock as above).

**Pre-conditions:** Story 2 completed; DevTools Network panel open.

**Steps:**

1. Click the "1M" tab in the Portfolio placeholder card
2. Observe the tab control and DevTools Network panel

**Expected outcomes:**

- The "1M" pill becomes visually active (white pill background); "7D" becomes inactive (no background).
- No network request is logged in the DevTools Network panel for this interaction.
- The chart re-renders for the 1M period and the "+$X earning" caption updates to "+$92.80 earning". The $0.00 balance does not change. No network request is logged.

---

## Story 4 (TC-250-4): Disconnecting via mock — reverts to Connect Wallet promo

**Persona:** QA.

**Pre-conditions:** Story 2 completed (connected state).

**Steps:**

1. In DevTools Console: `localStorage.removeItem('pipeline.mock.wallet.isConnected'); localStorage.removeItem('pipeline.mock.wallet.address')`
2. Refresh the page
3. Observe the top-left card

**Expected outcomes:** The "Connect Wallet" promo card reappears; the Portfolio placeholder is gone. Grid layout is unchanged.
