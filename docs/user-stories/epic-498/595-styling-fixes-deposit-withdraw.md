# User story: #595 — Styling fixes for deposit/withdraw page

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/595
**Status:** Initial

---

## Overview

These stories verify the eight styling and behaviour corrections applied to
the deposit/withdraw page components. All fixes are in shared `packages/ui`
components (`CoinIcon`, `DepositHeader`, `TokenInput`, `QuickAmountChip`,
`ConversionCard`, `TokenAmountDisplay`, `InfoRow`). The stake page shares
these components and must not regress.

---

## Story 1 — DepositHeader coin icon is 72px on desktop

**Given** the user is on the `/deposit` page on a desktop viewport (≥ 768px)

**When** the page renders

**Then:**

- The PLUSD coin icon above the "1:1 Conversion" heading measures 72×72px
  (previously 40×40px — CoinIcon `xl` size)
- The heading still reads "1:1 Conversion" in the Besley serif font
- On mobile (< 768px) the coin icon is hidden and the heading is left-aligned

---

## Story 2 — DepositHeader has 32px bottom spacing

**Given** the user is on the `/deposit` page

**When** the page renders

**Then:**

- The spacing between the bottom of the DepositHeader and the top of the
  conversion card is 32px (via `mb-8` on the DepositHeader root)

---

## Story 3 — USDC identity is centered when input value is 0

**Given** the user is on the `/deposit` page with direction=deposit

**When** the amount input is empty or shows "0" (no sign prefix is shown)

**Then:**

- The USDC identity block (coin icon + "USDC" label + balance subtitle) is
  vertically centered within the token-input-row
- No "−" sign prefix is visible

**When** the user enters a non-zero amount (e.g. "2000")

**Then:**

- The "−" sign prefix appears to the left of the number
- The USDC identity block alignment does not cause misalignment with the sign

---

## Story 4 — Clicking token-input-row focuses the numeric input

**Given** the user is on the `/deposit` page

**When** the user clicks anywhere on the `token-input-row` area (the identity
block, not just the `<input>` element itself)

**Then:**

- The numeric input receives keyboard focus (cursor appears)
- The user can immediately start typing without clicking the input directly

**When** the input is disabled (e.g. an active on-chain request is in flight)

**Then:**

- Clicking the row does NOT move focus to the disabled input

---

## Story 5 — Conversion input card has 4px corner radius

**Given** the user is on the `/deposit` page

**When** the page renders

**Then:**

- The top conversion card (`data-testid="conversion-input-card"`) has a
  4px corner radius (token `--radius-pipeline-card`) on all four corners
- Previously this was 16px (`--radius-pipeline-card-lg`)

---

## Story 6 — Quick-amount chips use pill radius, no border, caption font

**Given** the user is on the `/deposit` page or `/stake` page

**When** the quick-amount chips render (e.g. "$1,000 (Min)", "$5,000", "Max")

**Then:**

- Each chip has a fully-rounded pill shape (`--radius-pipeline-pill`)
- No 1px hairline border is visible on the chip
- The chip label uses the caption font size (12px / `--text-pipeline-caption`)
  with regular weight (`--font-weight-regular`)
- Both selected and unselected chips use primary ink color (`--color-pipeline-ink`)

---

## Story 7 — TokenAmountDisplay has no horizontal padding and 32px bottom

**Given** the user is on the `/deposit` page

**When** the PLUSD output card renders

**Then:**

- The PLUSD token row has no left or right padding (the coin icon aligns
  flush with the card edge)
- There is 32px of bottom spacing within the `TokenAmountDisplay` (via `pb-8`)

---

## Story 8 — InfoRow uses body font size for all rows

**Given** the user is on the `/deposit` page or `/stake` page

**When** the Exchange rate and Network fee rows render at the bottom of the
conversion card

**Then:**

- Both "Exchange rate" and "Network fee" rows display at body font size
  (16px / `--text-pipeline-body`, line-height 22px)
- Previously both rows used caption size (12px)
- The `data-testid="info-row-network-fee"` element is present
- The `data-testid="info-row-exchange-rate"` element is present

---

## Story 9 — Conversion output card has no border

**Given** the user is on the `/deposit` page

**When** the PLUSD output card renders (`data-testid="conversion-output-card"`)

**Then:**

- No visible border appears around the output card
- The card still has the white background from the `white` Card variant

---

## Story 10 — Stake page components do not regress

**Given** the user navigates to the `/stake` page

**When** the page renders with connected wallet and non-zero balances

**Then:**

- Quick-amount chips still use the pill radius, no border, caption font
  (same as deposit — shared component change)
- Exchange rate and Network fee rows still show at body font size
- The conversion input/output card layout renders without visual defects
- All existing stake/unstake test scenarios pass (approve, confirm, claim,
  quick-amount chips, exchange rate preview)
