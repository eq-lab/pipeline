# User Stories: #466 — Mobile home page balance states (0/0, has PLUSD, has sPLUSD)

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#466](https://github.com/eq-lab/pipeline/issues/466)

Breakpoint: `md` (768px). Below 768px is mobile; 768px and above is desktop.

Figma frames:
- State A (connected, 0/0): `1988:7074`
- State B (has PLUSD, 0 sPLUSD): `1984:6501`
- State C (has both PLUSD and sPLUSD): `1886:46777`

---

## Seeding connected wallet state via `pipeline.mock.wallet.*`

The app's localStorage mock layer drives all wallet reads in dev/test. Seed these keys
in the browser console (or in Vitest `beforeEach`) to reproduce each state:

```js
// Shared: mark wallet as connected
localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000001");

// Shared: PLUSD contract address (from the staked-PLUSD vault's `asset()` function)
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.asset",
  "0xaaaa000000000000000000000000000000000001"
);

// State A — clear all balance keys (or don't set them):
//   No `pipeline.mock.wallet.balance.*` keys → all balances resolve as undefined

// State B — 1 000 PLUSD, no sPLUSD:
localStorage.setItem(
  "pipeline.mock.wallet.balance.0xaaaa000000000000000000000000000000000001",
  "1000000000000000000000"
);

// State C — 1 000 PLUSD + 1 000 sPLUSD shares (rate ≈ 1.0428 PLUSD/share):
localStorage.setItem(
  "pipeline.mock.wallet.balance.0xaaaa000000000000000000000000000000000001",
  "1000000000000000000000"
);
localStorage.setItem(
  "pipeline.mock.wallet.balance.<STAKED_PLUSD_ADDRESS>",
  "1000000000000000000000"
);
localStorage.setItem(
  "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  "1042800000000000000"
);
```

Replace `<STAKED_PLUSD_ADDRESS>` with the value of `ENV.STAKED_PLUSD_ADDRESS` for
your environment (see `.env`). After seeding, reload the page and resize the viewport
to 402px width to observe the mobile layout.

---

## Story 1: State A — Connected wallet, 0 PLUSD, 0 sPLUSD (402px viewport)

**Persona:** A user who has just connected their EVM wallet but holds no PLUSD and no
sPLUSD shares.

**Pre-conditions:**
- App is running and the home route (`/`) is loaded.
- Wallet is connected (EVM) with zero PLUSD and zero sPLUSD balances.
- Viewport width is set to approximately 402px.

**Seeding:** see "State A" block above (only the shared keys, no balance keys).

**Steps:**

1. Load the home page at `/` with the mobile viewport (402px wide) and wallet connected
   with no balances.
2. Observe the page heading.
3. Observe the top card (portfolio area).
4. Observe the left column (balances area).
5. Observe the right card (stake area).
6. Observe whether a "Recent activity" section is present.
7. Scroll to the bottom of the page.

**Expected outcomes:**

- **Step 2 (heading):**
  - The heading reads "Welcome back" (not "Welcome"), confirming the mobile connected
    greeting.

- **Step 3 (portfolio card — top):**
  - A yellow `PortfolioPlaceholderCard` is visible, full width.
  - The label "Total Balance" appears above the balance figure.
  - The balance shows `$0.00`.
  - A link reads "Get PLUSD to start" and navigates to `/deposit`.
  - The portfolio chart (synthetic bars) is visible.
  - Segmented time-range tabs (7D / 1M / 3M / 1Y / All) are present; "7D" is active
    by default.
  - `ConnectWalletPromoCard` is NOT visible (user is already connected).

- **Step 4 (left column — balances):**
  - A white `StartHereCard` is visible with:
    - Eyebrow: "Start here"
    - Headline: "Get PLUSD" (with PLUSD coin icon)
    - Subtitle: "Convert USDC 1:1"
    - "Buy" button is enabled.
    - "Sell" button is **disabled** (no PLUSD to sell in State A).

  - Below `StartHereCard`, a white `EarnedCard` shows:
    - Label: "Earned"
    - Value: "Nothing yet" (muted, not "Coming soon").

- **Step 5 (right card — stake):**
  - A white `StakeCard` is visible (approximately 189px wide).
  - Eyebrow: "Stake PLUSD"
  - Main line: "Earn X.XX%" (live APY or "—" if unavailable)
  - Subtitle: "From loan coupons and T-bills"
  - The circular CTA reads "Nothing to Stake" and is **disabled**.

- **Step 6 (recent activity):**
  - No "Recent activity" section is visible in the mobile layout (the entire block is
    hidden when the wallet has no balance in State A).

- **Step 7 (stats strip):**
  - At the bottom of the page a horizontally scrollable stats strip shows:
    "Exchange rate", "Total Value Locked", and "Current APY".

---

## Story 2: State B — Connected wallet, has PLUSD, 0 sPLUSD (402px viewport)

**Persona:** A user who holds PLUSD but has not yet staked any.

**Pre-conditions:**
- App is running, home route loaded.
- Wallet is connected (EVM) with a non-zero PLUSD balance (e.g. 1 000 PLUSD) and no
  sPLUSD shares.
- Viewport width is set to approximately 402px.

**Seeding:** see "State B" block above (shared keys + PLUSD balance key).

**Steps:**

1. Load the home page at `/` with the mobile viewport (402px wide) and wallet holding
   PLUSD.
2. Observe the page heading.
3. Observe the top portfolio card.
4. Observe the left balances column.
5. Observe the right stake card.
6. Observe the "Recent activity" section.

**Expected outcomes:**

- **Step 2 (heading):**
  - The heading reads "Welcome back".

- **Step 3 (portfolio card — top):**
  - Label "Total Balance" is visible.
  - The balance figure shows the formatted PLUSD value (e.g. `$1,000.00`), not the
    static `$0.00` placeholder.
  - A link reads "Stake PLUSD to start earning" and navigates to `/stake`.
  - The portfolio chart is visible (synthetic growth bars).

- **Step 4 (left column — balances):**
  - `StartHereCard` shows the connected "PLUSD Balance" variant:
    - Eyebrow: "PLUSD Balance"
    - A PLUSD coin icon appears next to the balance value (e.g. `$1,000.00`).
    - A `"$1,000.00 USDC"` caption appears below the balance row (USDC sub-line;
      PLUSD is 1:1 with USDC).
    - Both "Buy" and "Sell" buttons are **enabled**.

  - `EarnedCard` shows:
    - Label: "Earned"
    - Value: "Nothing yet" (muted).

- **Step 5 (stake card):**
  - `StakeCard` shows the standard Stake PLUSD promo:
    - Eyebrow: "Stake PLUSD"
    - Main line: live APY
    - The circular "Stake" CTA is **enabled** (user has PLUSD to stake).

- **Step 6 (recent activity):**
  - The "Recent activity" section is present in the mobile layout below the balance
    row (shown for States B and C because the user has a position).
  - If no activity exists in the mock environment, the card renders its empty state
    (this is acceptable — illustrative rows are not required for this issue).

---

## Story 3: State C — Connected wallet, has both PLUSD and sPLUSD (402px viewport)

**Persona:** A user who holds PLUSD and has also staked some, receiving sPLUSD shares.

**Pre-conditions:**
- App is running, home route loaded.
- Wallet is connected (EVM) with both a PLUSD balance and a non-zero sPLUSD share
  balance (e.g. 1 000 PLUSD + 1 000 sPLUSD shares at a rate of ~1.0428 PLUSD/share).
- Viewport width is set to approximately 402px.

**Seeding:** see "State C" block above (all keys including sPLUSD balance and
convertToAssets rate).

**Steps:**

1. Load the home page at `/` with the mobile viewport (402px wide) and wallet holding
   both PLUSD and sPLUSD.
2. Observe the page heading.
3. Observe the top portfolio card.
4. Observe the left balances column.
5. Observe the right stake card.
6. Observe the "Recent activity" section.

**Expected outcomes:**

- **Step 2 (heading):**
  - The heading reads "Welcome back".

- **Step 3 (portfolio card — top):**
  - Label "Total Balance" is visible.
  - The balance shows the combined PLUSD + sPLUSD-equivalent total (e.g. `$2,042.80`
    for 1 000 PLUSD + 1 000 shares × 1.0428 PLUSD/share).
  - No "Get PLUSD to start" or "Stake PLUSD to start earning" link is shown (State C
    has the earning caption instead).
  - The earning caption reads "—" as a placeholder (no real earned-balance API exists
    yet; tracked in issue #389).
  - The portfolio chart is visible.

- **Step 4 (left column — balances):**
  - `StartHereCard` shows the "PLUSD Balance" connected variant:
    - Eyebrow: "PLUSD Balance"
    - PLUSD coin icon + balance value (e.g. `$1,000.00`).
    - A `"$1,000.00 USDC"` caption appears below the balance row (USDC sub-line;
      always shown — shows `"$0.00 USDC"` when PLUSD balance is zero).
    - Both "Buy" and "Sell" buttons are **enabled** (State C activates both even if
      PLUSD = 0; enablement is keyed on "has a position").

  - `EarnedCard` shows:
    - Label: "Earned"
    - Value: "—" placeholder rendered in the green positive color token
      (`--color-pipeline-chart-positive`).

- **Step 5 (stake card — State C variant):**
  - `StakeCard` switches to the "Staked PLUSD" display:
    - Eyebrow: "Staked PLUSD"
    - Top number (large): the sPLUSD shares count (e.g. `1,000.00`)
    - Sub-line: the PLUSD-equivalent with "sPLUSD" suffix (e.g. `1,042.80 sPLUSD`)
    - A circular "Stake More" CTA is **enabled** (anchored bottom-right).
    - An "Unstake" text link is visible below the "Stake More" button.

- **Step 6 (recent activity):**
  - The "Recent activity" section is present in the mobile layout.
  - If no activity exists in the mock environment, the card renders its empty state
    (acceptable).

---

## Story 4: Desktop layout unchanged at 768px and above (regression check)

**Persona:** A returning LP on a 1440px-wide desktop browser.

**Pre-conditions:**
- App is running, home route loaded.
- Any wallet state (connected or disconnected).
- Viewport width is set to 1440px.

**Steps:**

1. Load the home page at `/` in a 1440px-wide viewport.
2. Observe the TopBar and main content.
3. Connect a wallet (or seed via localStorage) and reload.
4. Observe the desktop 7-column grid.

**Expected outcomes:**

- **Step 2 (disconnected, 1440px):**
  - The 7-column grid `Card` (white background) is visible.
  - `ConnectWalletPromoCard` occupies approximately 4 of 7 columns.
  - `RecentActivityCard` occupies the right 3 columns, spanning 2 rows.
  - `StartHereCard` and `EarnedCard` are stacked in columns 1–2 of row 2.
  - `StakeCard` is in columns 3–4 of row 2.
  - The heading reads "Welcome" (not "Welcome back" — desktop greeting is always
    "Welcome" per issue scope).
  - The mobile-only single-column stack is NOT visible (it is hidden at 768px+).
  - `QnaSection` is visible at the bottom.

- **Step 3–4 (connected, 1440px):**
  - `PortfolioPlaceholderCard` replaces `ConnectWalletPromoCard` in the top-left grid
    slot (col 1–4, row 1).
  - The card shows `$0.00` (the connected-state desktop placeholder — connected balance
    states are mobile-only for this issue).
  - A "Get PLUSD to start" link points to `/deposit`.
  - `StartHereCard` in the desktop grid shows the **disconnected** variant ("Start here
    / Get PLUSD / Convert USDC 1:1") — **not** the "PLUSD Balance" connected variant.
  - `StakeCard` in the desktop grid shows the standard promo (not "Staked PLUSD").
  - `EarnedCard` in the desktop grid shows "Coming soon" (not "Nothing yet").
  - No mobile-specific classes or content bleed into the desktop grid.
