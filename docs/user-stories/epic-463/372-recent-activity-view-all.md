# User Stories: #372 — Home: Recent activity "View All" button affordance

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#372](https://github.com/eq-lab/pipeline/issues/372)
Plan: `docs/exec-plans/completed/issue-372-view-all-button.md`

> Migrated from `docs/STORIES.md` (S-372). The issue predates epic #463 — desktop home
> page work built under the old workflow.

---

## Story 1 (TC-372-1): "View All" renders as button-sized control (connected + data)

**Persona:** End-user with connected wallet and at least one transaction.

**Pre-conditions:** Mock wallet connected (`pipeline.mock.wallet.address` + `isConnected`); `pipeline.mock.api.GET./v1/requests` set with ≥1 request; dev server running.

**Steps:**

1. Navigate to `/`
2. Locate the "Recent activity" card
3. Inspect the "View All" link via `document.querySelector('a[href="/transactions"]')`

**Expected outcomes:**

- `height` = 48px (`h-12`)
- `paddingLeft` / `paddingRight` = 12px (`px-3`)
- `borderRadius` = 8px (`rounded-lg`)
- `fontWeight` = 600 (semi-bold / `--font-weight-emphasized`)
- `color` = muted ink (`rgba(56, 55, 53, 0.6)` = `--color-pipeline-ink-muted`), not primary black
- `innerHTML` contains a `<svg>` chevron-right icon, not the literal `→` character

---

## Story 2 (TC-372-2): "View All" navigates to /transactions

**Persona:** End-user.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click the "View All" button

**Expected outcomes:** Browser navigates to `/transactions`; Activity nav button becomes `aria-pressed="true"`.

---

## Story 3 (TC-372-3): "View All" absent when no data

**Persona:** End-user (disconnected or connected with zero rows).

**Pre-conditions:** No mock wallet keys set (disconnected state).

**Steps:**

1. Navigate to `/`
2. Inspect the "Recent activity" card

**Expected outcomes:** No `a[href="/transactions"]` element present; empty state illustration and caption shown instead.
