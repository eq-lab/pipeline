# User Stories: #465 — Mobile home page base layout + wallet-not-connected state

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#465](https://github.com/eq-lab/pipeline/issues/465)

Breakpoint: `md` (768px). Below 768px is mobile; 768px and above is desktop.

---

## Story 1: Mobile wallet-not-connected state (402px viewport)

**Persona:** A new visitor on a mobile device (iPhone SE / 402px-wide viewport) who has not yet connected a wallet.

**Pre-conditions:**
- App is running and the home route (`/`) is loaded.
- No wallet is connected (neither EVM nor Stellar).
- Viewport width is set to 402px.

**Steps:**

1. Load the home page at `/` in a 402px-wide viewport.
2. Observe the page header (TopBar).
3. Tap the hamburger icon (three horizontal bars) in the top-right corner of the TopBar.
4. Observe the mobile nav menu that opens.
5. Review the menu contents.
6. Tap the "Connect Wallet" button inside the mobile nav menu.
7. Dismiss the connect chooser modal (press Escape or tap outside).
8. Tap the X (close) button at the top of the mobile menu.
9. Observe the main content area below the TopBar.
10. Scroll to the bottom of the page and observe the stats strip.

**Expected outcomes:**

- **Step 2 (TopBar):**
  - The Pipeline logo is visible on the left.
  - The inline nav buttons (Home / Convert / Earn / Activity) are NOT visible — they are hidden below the `md` breakpoint.
  - A hamburger button (three-bar icon) is visible on the right side of the TopBar.
  - The "Connect Wallet" desktop button is NOT visible.

- **Step 4 (mobile menu opens):**
  - A full-width overlay panel slides in from the top of the screen.
  - A semi-transparent dark scrim covers the rest of the page.
  - The Pipeline logo appears in the panel.
  - A close (×) button appears in the top-right corner of the panel.

- **Step 5 (menu contents):**
  - Four navigation items are listed, each with a filled dark circular icon badge:
    - Home
    - Convert
    - Earn
    - Activity
  - A divider separates the four nav items from a "Pipeline Overview" item.
  - A second divider separates "Pipeline Overview" from the wallet section.
  - A full-width "Connect Wallet" CTA button is visible at the bottom of the panel (dark background, light text).

- **Step 6 (Connect Wallet in menu):**
  - The mobile menu closes.
  - The ConnectChooserModal opens, showing "Connect EVM" and "Connect Stellar" buttons.

- **Step 7 (dismiss modal):** The ConnectChooserModal closes. The page returns to the disconnected home view.

- **Step 8 (close menu button):** The mobile nav menu closes and the scrim disappears.

- **Step 9 (main content):**
  - "Welcome" heading is visible (approximately 32px, serif font).
  - The Exchange rate / TVL / APY stats strip is NOT visible near the heading.
  - `ConnectWalletPromoCard` is rendered full-width (no side margins), approximately 256px tall.
  - Below the promo card, a horizontal flex row shows:
    - Left column: `StartHereCard` stacked above `EarnedCard` (flex-1 width).
    - Right column: `StakeCard` with a fixed width of approximately 189px and height of approximately 224px.
  - The `RecentActivityCard` is visible below the flex row (shown for both connected and disconnected states on mobile per issue comment).
  - The 7-column desktop grid Card (`Card variant="white"`) is NOT visible.
  - `QnaSection` is NOT visible (hidden on mobile with `hidden md:block`-style utility).

- **Step 10 (stats strip):**
  - At the bottom of the page, a horizontally scrollable row shows three stats:
    - "Exchange rate" — a live `1 sPLUSD = X.XXXX PLUSD` value.
    - "Total Value Locked" — a formatted dollar amount.
    - "Current APY" — a formatted percentage.
  - An external-link icon button appears after the stats.
  - The strip overflows horizontally on narrow viewports rather than wrapping.

---

## Story 2: Desktop layout unchanged at 768px and above

**Persona:** A returning LP on a 1440px-wide desktop browser who has not yet connected their wallet.

**Pre-conditions:**
- App is running and the home route (`/`) is loaded.
- No wallet is connected.
- Viewport width is set to 1440px (or any width >= 768px).

**Steps:**

1. Load the home page at `/` in a 1440px-wide viewport.
2. Observe the TopBar.
3. Observe the main content area.
4. Resize the viewport to exactly 768px wide.
5. Observe the TopBar and main content again.

**Expected outcomes:**

- **Step 2 (TopBar at 1440px):**
  - The Pipeline logo is visible on the left.
  - The four inline nav buttons (Home / Convert / Earn / Activity icon buttons) are visible in the center of the TopBar.
  - A "Connect Wallet" button is visible on the right.
  - The hamburger icon is NOT visible.

- **Step 3 (main content at 1440px):**
  - The 7-column grid `Card` (white background) is visible.
  - `ConnectWalletPromoCard` occupies columns 1–4 of the grid (approximately 4/7 of the card width), with `min-h-[274px]`.
  - `RecentActivityCard` occupies columns 5–7 and spans 2 rows.
  - `StartHereCard` and `EarnedCard` are stacked in columns 1–2 of the second row.
  - `StakeCard` occupies columns 3–4 of the second row.
  - `QnaSection` occupies the full width of the third row.
  - The "Welcome" heading is approximately 64px (desktop title size).
  - The Exchange rate / TVL / APY stats strip appears to the right of the "Welcome" heading (inside `WelcomeHeader`).
  - The mobile-only layout div (single-column stack) is NOT visible.

- **Steps 4–5 (at 768px):**
  - Desktop layout (7-column grid, inline nav) is still active — the breakpoint is `md` (768px), which is inclusive.
  - Hamburger icon is still NOT visible.
  - The inline nav is still visible.
