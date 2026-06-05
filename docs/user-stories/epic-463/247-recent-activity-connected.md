# User Stories: #247 — RecentActivityCard connected state shows recent requests

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#247](https://github.com/eq-lab/pipeline/issues/247)
Plan: `docs/exec-plans/completed/issue-247-home-recent-activity-connected.md`
Figma: [Connected state 1497:95119](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95119&m=dev)

> Migrated from `docs/STORIES.md` (S-247). The issue predates epic #463 — desktop home
> page work built under the old workflow.

---

## Story 1: Connected + data — 3 rows and View All link

**Persona:** User with connected wallet and existing requests.

**Pre-conditions:** Dev server running; wallet connected (or mock key set); `pipeline.mock.api.GET./v1/requests` returns at least 3 rows.

**Steps:**

1. Set mock data: `localStorage.setItem('pipeline.mock.api.GET./v1/requests', JSON.stringify({ requests: [ { type: 'Deposit', amount: '1000000000', request_id: '1', status: 'Completed', created_at: '2026-05-15T12:00:00Z' }, { type: 'Withdraw', amount: '2000000000', request_id: '2', status: 'PendingClaim', created_at: '2026-05-14T09:30:00Z' }, { type: 'Stake', amount: '1000000000000000000000', assets: '1000000000000000000000', shares: '999500000000000000000', status: 'Completed', created_at: '2026-05-13T18:00:00Z' } ] }))`
2. Navigate to `http://localhost:3000/`
3. Observe the "Recent activity" card in the right column

**Expected outcomes:**

- Three `ActivityRow` entries are rendered inside the card.
- First row shows "Buy" with "+1,000.00 USDC" (completed Deposit).
- Second row shows "Sell" with "−2,000.00 USDC" and "Pending" (PendingClaim Withdraw).
- Third row shows "Stake" with "−1,000.00 PLUSD" / "+999.50 sPLUSD".
- A right-aligned "View All →" link is present below the rows.
- Clicking "View All →" navigates to `/transactions`.
- The "You will see all transactions here" caption is absent.
- Card height is approximately 564 px (does not reflow vs disconnected state).

---

## Story 2: Connected + more than 3 rows — cap at 3

**Persona:** User with connected wallet and 5+ requests.

**Pre-conditions:** Dev server running; mock set with 5 rows.

**Steps:**

1. Set mock data with 5 requests (add rows 4 and 5 to the fixture above)
2. Navigate to `http://localhost:3000/`
3. Observe the "Recent activity" card

**Expected outcomes:** Exactly 3 rows are rendered — the 4th and 5th are not shown. The "View All →" link is still present.

---

## Story 3: Connected + empty list — empty state

**Persona:** User with connected wallet but no requests.

**Pre-conditions:** Dev server running; `pipeline.mock.api.GET./v1/requests` returns `{ requests: [] }`.

**Steps:**

1. Set mock: `localStorage.setItem('pipeline.mock.api.GET./v1/requests', JSON.stringify({ requests: [] }))`
2. Navigate to `http://localhost:3000/`
3. Observe the "Recent activity" card

**Expected outcomes:**

- The `ActivityEmptyIllustration` (striped square) and "You will see all transactions here" caption render.
- No "View All →" link is visible.

---

## Story 4: Disconnected — empty state unchanged

**Persona:** User with no wallet connected.

**Pre-conditions:** Dev server running; wallet disconnected (no mock keys).

**Steps:**

1. Navigate to `http://localhost:3000/`
2. Observe the "Recent activity" card

**Expected outcomes:**

- The `ActivityEmptyIllustration` and "You will see all transactions here" caption render (existing behavior, unchanged).
- No "View All →" link is visible.
