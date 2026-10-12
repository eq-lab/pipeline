# User Stories: #1424 — Home state 4: wallet connected, PLUSD > 0, sPLUSD = 0, KYB passed, bank transfer unlocked

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1424](https://github.com/eq-lab/pipeline/issues/1424)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route),
[docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97340&m=dev
— frame `6701:97340` (" PLUSD > 0, sPLUSD = 0, Bank Transfer unlocked")

This state renders only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged — no mobile frame exists yet for this state (decision recorded on #1421, reapplied for
#1422/#1423 and here).

The #1419 desktop grids must match Figma pixel-for-pixel, shared cards included. This state reuses
the compact PLUSD-balance / Stake PLUSD / Earnings cards and the `AddUsdCard` Shape A frame already
shipped by #1421/#1422/#1423; the new geometry is the enabled 75×40 Stake CTA, the tinted Buy /
ink-muted Sell pair on the balance card, and the `unlocked` `AddUsdCard`.

Two deliberate deviations from the frame, both expected by QA:

- The Total Balance heading keeps the shipped sPLUSD binding
  (`formatBigintCurrency(splusdSharesActive)`), which renders `$0.00` here since sPLUSD is zero.
  The frame mocks `$1,000.00` (the PLUSD holding) — no backend endpoint serves a combined
  PLUSD+sPLUSD total, and summing them client-side is the derived metric the project forbids
  (human decision, 2026-10-12; a follow-up issue will catch up once the backend serves a total).
- The Add Funds modal opens with no `details`, so all six rows render `—` — the same inert-modal
  shape #1283/#1282 already shipped at `/test?tab=auth`, now reachable from `/` for the first time
  (human decision, 2026-10-12; follow-up once the backend serves wire details).

---

## Story 1: A connected, verified LP holding PLUSD sees the state-4 grid

**Persona:** An LP who signed in, passed KYB, connected a wallet, and holds PLUSD but has not
staked any of it yet.

**Pre-conditions:**
- A valid session exists (signed in).
- `GET /v1/lps/me` resolves with `kyb_status: "Passed"`.
- A wallet is connected (EVM or Stellar view).
- The PLUSD balance renders above `$0.00`; the sPLUSD balance renders as zero at two decimal
  places.
- Desktop viewport (≥768px wide).

**Steps:**

1. Load the home route (`/`).
2. Observe the top-left card (col 1–4, row 1).
3. Observe the top-right card (col 5–7, rows 1–2).
4. Observe the bottom-left stack (col 1–2, row 2).
5. Observe the bottom-right stack (col 3–4, row 2).
6. Observe the bottom strip (col 1–7, row 3).

**Expected outcomes:**

- Step 2: A pale-yellow "Total Balance" card, **642 × 274** at (32, 32)
  (`data-node-id="6701:97451"`, `data-variant="stake-or-add-usd"`), 16px interior padding. The
  eyebrow "Total Balance" is Body 16/22 in primary ink; `$0.00` sits flush under it at Heading M
  28/36; 4px below, the sentence **"Stake PLUSD or Add USD to start earning"** renders as one
  underlined brand-navy (`#000080`) run — "Stake PLUSD" is a link to `/stake?tab=stake`, "Add USD"
  is a button that opens the Add Funds modal, and "or" / "to start earning" are plain text styled
  identically. The period tabs (7D selected) sit top-right and the chart occupies the same position
  as the other #1419 branches. No unrealized-PnL caption appears.
- Step 3: `RecentActivityCard`, **477.71 × 634** at (690.29, 32), 16px padding, title "Recent
  activity", now showing **real activity rows** (not the empty placeholder) with a `View All` link
  (126 × 48) at the bottom — the LP has transaction history.
- Step 4: `StartHereCard` stacked above `StakeCard`, `gap-4`, in a **313.14 × 344** column at
  (32, 322) (`data-node-id="6701:97461"`). Both are 313.14 × 164 compact cards with 16px padding:
  - "PLUSD Balance" (`6701:97462`) — eyebrow "PLUSD Balance", the served PLUSD amount at Heading 20
    with no leading `$` (e.g. `1,000.00`), caption `$<amount> USDC` below it. The button row holds a
    61×40 **Buy** tinted `rgba(184,191,190,0.12)` with a primary-ink label (`6701:97475`) and a
    61×40 **Sell** untinted with an **ink-muted** label (`6701:97476`), both enabled.
  - "Stake PLUSD / Earn &lt;apy&gt; p.a. / From senior loan coupons and T-bills" — the button row
    holds a single **75×40 enabled "Stake"** button (`6701:97492`), `primary-blue`.
  - **No 128px circular Stake button appears in this state.**
- Step 5: `AddUsdCard` in its `unlocked` variant (`data-variant="unlocked"`,
  `data-node-id="6701:97494"`, **313.14 × 246**) stacked above `EarnedCard`, `gap-4`, in a
  313.14 × 344 column at (361.14, 322) (`data-node-id="6701:97493"`). The card shows "Add USD" /
  "Use a bank transfer" / "Transfers unlocked" with an enabled circular "Add Funds" CTA (128×128,
  bottom-right). `EarnedCard` is the compact 313.14 × 82 card: "Earnings" over "Tracked once you
  stake" (no served PnL total yet) or the served total once #1313 lands.
- Step 6: `QnaSection` renders unchanged — the FAQ strip at (32, 682).

---

## Story 2: Stake PLUSD and Add USD each do their own thing

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Stake PLUSD" in the Total Balance sentence.
2. Return to `/`. Click "Add USD" in the same sentence.
3. Close the modal. Click "Add Funds" on the `AddUsdCard`.

**Expected outcomes:**

- Step 1: navigates to `/stake?tab=stake` (the stake tab of the Stake page) — the wallet is
  connected, so no connect modal opens.
- Step 2: opens the Add Funds modal (`FundingDetailsModal`) with every one of its six rows reading
  `—` (`Company Name`, `Bank Name`, `Bank Address`, `Account Number`, `IBAN`, `SWIFT / BIC code`) —
  no fabricated wire details.
- Step 3: opens the same modal, from the same seam — `AddUsdCard.onAddFunds` and the Total
  Balance sentence's "Add USD" action both open one `FundingDetailsModal` instance.

---

## Story 3: Buy, Sell and Stake are all live

**Persona:** Same as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Buy" on the PLUSD Balance card.
2. Return to `/`. Click "Sell".
3. Return to `/`. Click "Stake" on the Stake PLUSD card.

**Expected outcomes:**

- Step 1: navigates to `/deposit?direction=deposit` — the wallet is connected, so no connect modal
  opens.
- Step 2: navigates to `/deposit?direction=withdraw` — Sell is enabled (PLUSD is held).
- Step 3: navigates to `/stake?tab=stake` — the Stake CTA is enabled (PLUSD is held), unlike
  state 3's disabled "Nothing to Stake".

---

## Story 4: Neighbouring combinations fall through to the legacy layout

**Persona:** A signed-in, wallet-connected LP in a combination adjacent to state 4.

**Pre-conditions:** One of — `kyb_status: "Passed"` with PLUSD also displaying as zero; `Passed`
with the sPLUSD balance above `$0.00`; `Passed` with no wallet connected; or `GET /v1/lps/me` still
pending or failed with a non-404 error.

**Steps:**

1. Load `/`.

**Expected outcomes:**

- Every one of these renders the `"legacy"` branch (disconnected: `ConnectWalletPromoCard`;
  connected: the default `PortfolioPlaceholderCard`, `data-node-id="1497:95048"`) — none of them
  renders the `unlocked` `AddUsdCard` or the "Stake PLUSD or Add USD to start earning" sentence.
  None of these combinations is designed (precedence rule,
  [home-screen-states.md](../../product-specs/home-screen-states.md)).
- Because an unresolved balance reads as displayed-zero, a `Passed` LP who actually holds PLUSD may
  render briefly as `"legacy"` while the balance request is in flight (TD-121, the same shape
  tracked for state 3).

---

## Story 5: Mobile is unaffected

**Persona:** Same as Story 1, on a mobile viewport (<768px).

**Pre-conditions:** Same as Story 1, viewport <768px wide.

**Steps:**

1. Load `/` at a 402px-wide viewport.

**Expected outcomes:**

- The mobile layout keeps its existing `isConnected`-only rendering (`deriveMobileHomeState`
  resolves to `"plusd"` here): `PortfolioPlaceholderCard` default variant, `StartHereCard` (PLUSD
  Balance mobile mode) + `EarnedCard` left, `StakeCard` right with the circular "Stake" CTA,
  `RecentActivityCard` shown. No "Stake PLUSD or Add USD to start earning" sentence and no tinted
  Buy / ink-muted Sell pair appear on mobile — those are desktop-only, scoped to
  `StartHereCard`'s `compactVariant="balance"`.
