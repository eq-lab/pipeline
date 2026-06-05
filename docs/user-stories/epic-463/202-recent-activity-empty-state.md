# User Stories: #202 — Recent activity empty-state uses distinct 240×240 SVG

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#202](https://github.com/eq-lab/pipeline/issues/202)
Plan: `docs/exec-plans/completed/issue-202-recent-activity-empty-illustration.md`

> Migrated from `docs/STORIES.md` (S-202). The issue predates epic #463 — desktop home
> page work built under the old workflow.

---

## Story 1 (TC-202-1): RecentActivityCard renders ActivityEmptyIllustration, not WalletIllustration

**Persona:** User / QA

**Pre-conditions:** Dev server running at `http://localhost:3000`.

**Steps:**

1. Navigate to `http://localhost:3000/`
2. In DevTools Console: `document.querySelector('[data-node-id="1497:94567"] img')` (should be null — no img in the card)
3. In DevTools Console: `document.querySelector('[data-node-id="1497:94567"] [data-tone]')?.getAttribute('data-tone')`

**Expected outcomes:** No `<img>` inside the Recent activity card; `data-tone` returns `"muted"`.

---

## Story 2 (TC-202-2): ActivityEmptyIllustration is 240×240 square with correct SVG mask

**Persona:** User / QA

**Pre-conditions:** Dev server running.

**Steps:**

1. In DevTools Console: `getComputedStyle(document.querySelector('[data-tone="muted"]')).aspectRatio`
2. In DevTools Console: `getComputedStyle(document.querySelector('[data-tone="muted"]')).width`
3. In DevTools Console: `getComputedStyle(document.querySelector('[data-tone="muted"]')).maskImage`

**Expected outcomes:** `aspectRatio` = `"1 / 1"`; `width` = `"240px"`; `maskImage` contains `striped-activity-empty.svg` (not `striped-wallet.svg`).

---

## Story 3 (TC-202-3): ConnectWalletPromoCard continues to use WalletIllustration (landscape)

**Persona:** User / QA

**Pre-conditions:** Dev server running.

**Steps:**

1. Navigate to `http://localhost:3000/`
2. In DevTools Console: `getComputedStyle(document.querySelector('[role="region"][aria-labelledby="connect-wallet-promo-card-title"] [data-tone]')).maskImage`

**Expected outcomes:** Returns a URL containing `striped-wallet.svg`; aspect ratio is `313.672 / 200` (landscape).

---

## Story 4 (TC-202-4): ActivityEmptyIllustration Storybook stories exist

**Persona:** Developer / QA

**Pre-conditions:** Storybook running at `http://localhost:6006`.

**Steps:**

1. Navigate to `Components/ActivityEmptyIllustration > Muted (Recent activity empty state)`
2. Navigate to `Components/ActivityEmptyIllustration > Primary (high-contrast variant)`

**Expected outcomes:** Both stories render the striped-square silhouette; Muted = muted ink color; Primary = dark ink color; no coin-slot or wallet shape visible.
