# User Stories: #1423 — Home state 3: wallet connected, PLUSD = 0, sPLUSD = 0, KYB verification pending

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1423](https://github.com/eq-lab/pipeline/issues/1423)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route),
[docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-98417&m=dev
— frame `6701:98417` (" PLUSD = 0, sPLUSD = 0, Veryfying account")

This state renders only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged — no mobile frame exists yet for this state (decision recorded on #1421, reapplied for
#1422 and here).

The #1419 desktop grids must match Figma pixel-for-pixel, shared cards included. This state reuses
the compact Get PLUSD / Stake PLUSD / Earnings cards and the anchored `AddUsdCard` Shape B frame
already shipped by #1421/#1422/#1430; the only new geometry is the disabled 160×40 Stake CTA.

Two deliberate deviations from the frame, both expected by QA:

- The `AddUsdCard` heading ships as `Verifying account…` (correct spelling, real ellipsis). The
  frame reads "Veryfying account..." — a typo, not reproduced.
- The three 1–3px Shape B deltas that
  [bank-transfers.md](../../frontend/bank-transfers.md) already documents for the shared border
  idiom still apply.

---

## Story 1: A connected, empty, KYB-pending LP sees the state-3 grid

**Persona:** An LP who signed in, submitted KYB documents that are still under review, connected a
wallet, and holds no PLUSD and no sPLUSD.

**Pre-conditions:**
- A valid session exists (signed in).
- `GET /v1/lps/me` resolves with `kyb_status: "UnderReview"`.
- A wallet is connected (EVM or Stellar view).
- Both the PLUSD and the sPLUSD balance render as zero at two decimal places.
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the top-left card (col 1–4, row 1).
3. Observe the top-right card (col 5–7, rows 1–2).
4. Observe the bottom-left stack (col 1–2, row 2).
5. Observe the bottom-right stack (col 3–4, row 2).
6. Observe the bottom strip (col 1–7, row 3).

**Expected outcomes:**

- Step 2: A pale-yellow "Total Balance" card, **643 × 274** at (32, 32)
  (`data-node-id="6701:98528"`, `data-variant="get-plusd"`), 16px interior padding. The eyebrow
  "Total Balance" is Body 16/22 in primary ink (`#262524`, 100×22); `$0.00` sits flush under it at
  Heading M 28/36 (75×36); 4px below, an **underlined** `Get PLUSD to start` link (139×22, Body
  16/22) in brand navy `#000080`. The 224×36 period tabs (7D selected) sit top-right and the chart
  occupies 611×144 at (16, 114). No unrealized-PnL caption, no `Connect wallet` control, no
  "Get Started" heading and no "Sign Up" button appear.
- Step 3: `RecentActivityCard`, **477.71 × 634** at (690.29, 32), 16px padding, title "Recent
  activity", showing its empty placeholder — the 240×240 illustration above the caption
  **"You will see all transactions here"**.
- Step 4: `StartHereCard` stacked above `StakeCard`, `gap-4`, in a **313.14 × 344** column at
  (32, 322) (`data-node-id="6701:98773"`). Both are 313.14 × 164 compact cards with 16px padding:
  - "Start here / Get PLUSD / Convert with USDC 1:1" (`6701:98774`) — the 24px PLUSD glyph sits 4px
    before the Heading-20 title; the button row at y=92 holds a 61×40 navy "Buy" (`6701:98787`) and
    a 61×40 "Sell" at 32% opacity (`6701:98788`), 8px apart.
  - "Stake PLUSD / Earn &lt;apy&gt; p.a. / From senior loan coupons and T-bills" (`6701:98789`) — the
    button row at (16, 108) holds **one 160 × 40 disabled button labelled "Nothing to Stake"**
    (`6701:98802`): fill `rgba(184,191,190,0.12)` at 32% opacity with a primary-ink label, 4px
    radius.
  - **No 128px circular Stake button appears in this state.**
- Step 5: `AddUsdCard` in its `verifying` variant (`data-variant="verifying"`,
  `data-node-id="6701:98539"`, **313.14 × 246**) stacked above `EarnedCard`, `gap-4`, in a
  313.14 × 344 column at (361.14, 322) (`data-node-id="6701:98538"`). The card shows
  "Verifying account…" over "We are reviewing your documents.", the striped-check illustration
  (291 × 193.66, anchored at card-box (174, 66.34) and clipped by the card's bottom-right corner),
  and a **122 × 40** dark `View Status` button at (16, 190). `EarnedCard` is the **313.14 × 82**
  compact card (`6701:98762`): "Earnings" over "Tracked once you stake" at Heading 20 in 30%-alpha
  ink, with no trailing icon.
- Step 6: `QnaSection` renders unchanged — the **1136 × 89** FAQ strip at (32, 682), three 368-wide
  cells.
- Across the whole grid: the white panel spans the 1200px content column edge to edge, so the cards
  measure 1136px across; row 1 is 274px tall, row 2 is 344px, and the welcome heading ("Welcome
  back", 48px) sits 32px to the left of the first card with the 492×40 stats cell at its right.

---

## Story 2: View Status opens the Account page

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "View Status" on the `AddUsdCard`.

**Expected outcomes:**

- The app navigates to `/account` (the Figma node carries the dev annotation "Open Account"). The
  account-setup modal does **not** reopen: `kyb_status: "UnderReview"` freezes LP writes, so the
  setup modal would only open read-only
  ([kyb-lp-verification.md](../../product-specs/kyb-lp-verification.md)).
- The Account page shows the LP's submitted profile and its `under-review` documents state
  ([account-page.md](../../frontend/account-page.md)).

---

## Story 3: Buy navigates, Sell and Stake are inert

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Buy" on `StartHereCard`.
2. Return to `/`. Observe the "Sell" button.
3. Observe the "Stake" CTA on `StakeCard`.
4. Click "Get PLUSD to start" on the Total Balance card.

**Expected outcomes:**

- Step 1: navigates to `/deposit?direction=deposit` — the wallet is connected, so no connect modal
  opens.
- Step 2: "Sell" is disabled at 32% opacity (zero PLUSD).
- Step 3: the Stake CTA is disabled and labelled "Nothing to Stake"; its accessible name is the
  same string. Clicking it does nothing.
- Step 4: navigates to `/deposit?direction=deposit`, the same target as Buy.

---

## Story 4: A non-zero balance falls through to the legacy layout

**Persona:** A signed-in, wallet-connected LP whose `kyb_status` is `UnderReview` but who already
holds PLUSD (or sPLUSD).

**Pre-conditions:** Signed in, `kyb_status: "UnderReview"`, wallet connected, at least one of the
PLUSD / sPLUSD balances rendering above `$0.00`.

**Steps:**

1. Load `/`.

**Expected outcomes:**

- The desktop grid renders today's pre-#1419 connected layout — the `"legacy"` branch: the default
  `PortfolioPlaceholderCard` (`data-node-id="1497:95048"`), the taller cards and the 128px circular
  Stake button, with **no `AddUsdCard`** in the grid. `UnderReview` with a non-zero balance is a
  combination the product has not designed (precedence rule,
  [home-screen-states.md](../../product-specs/home-screen-states.md)).
- Because an unresolved balance reads as displayed-zero, this layout may be preceded by a brief
  state-3 frame while the balance request is in flight (TD-121).

---

## Story 5: A disconnected wallet, another KYB status, or an unresolved LP read falls through

**Persona:** A signed-in LP in any neighbouring combination.

**Pre-conditions:** One of — `kyb_status: "UnderReview"` with **no** wallet connected; a connected
wallet with `kyb_status` `Passed` / `ChangesRequested` / `Failed` / `NotStarted`; or
`GET /v1/lps/me` still pending or failed with a non-404 error.

**Steps:**

1. Load `/`.

**Expected outcomes:**

- Every one of these renders the `"legacy"` branch (disconnected: `ConnectWalletPromoCard`;
  connected: the default `PortfolioPlaceholderCard`). None of them renders the `verifying`
  `AddUsdCard` or the `Get PLUSD to start` compact card. Request failures do not imply an empty
  account, so no loading or empty-account UI is fabricated.

---

## Story 6: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** Same as Story 1, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile layout keeps its existing `isConnected`-only rendering (`PortfolioPlaceholderCard`
  default variant, `StartHereCard` + `EarnedCard` left, `StakeCard` right with the circular CTA, no
  `RecentActivityCard` while balances are empty). No "Verifying account…" copy and no
  "Get PLUSD to start" compact card appear on mobile.
