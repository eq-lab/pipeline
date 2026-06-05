# User Stories: #503 — Below-min deposit banner visual fixes

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#503](https://github.com/eq-lab/pipeline/issues/503)

Viewport: 402×874 (mobile). Mock scenario: `connected-below-min` (USDC balance below minimum deposit).

---

## Story 1: Banner title uses sans-serif body style

**Persona:** A connected LP whose USDC balance is below the minimum deposit threshold, viewing the deposit page on mobile.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with a USDC balance below the minimum deposit amount.
- Viewport width is 402px.

**Steps:**

1. Load `/deposit` in a 402px-wide viewport with a below-min USDC balance.
2. Observe the yellow banner that replaces the steps card.
3. Read the banner title text.

**Expected outcomes:**

- The banner title "Add funds to your USDC balance" is rendered in the body sans-serif typeface (Graphik LC), not in Besley serif.
- The title uses the body text size (16px/22px), not the heading-s size (20px/30px).

---

## Story 2: Banner subtitle shows whole-number minimum without currency symbol

**Persona:** Same LP as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Load `/deposit` in a 402px-wide viewport with a below-min USDC balance.
2. Read the banner subtitle text.

**Expected outcomes:**

- The subtitle reads "Minimum amount — 1,000 USDC" (no `$` prefix, no decimal places).
- The minimum value is formatted with a thousands separator (comma).

---

## Story 3: "Copy Address" button stays on a single line

**Persona:** Same LP as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Load `/deposit` in a 402px-wide viewport with a below-min USDC balance.
2. Observe the "Copy Address" button in the banner.

**Expected outcomes:**

- The button label "Copy Address" renders on a single line without wrapping.
- The overall banner height is approximately 92px (matching the Figma design), not 150px.

---

## Story 4: "Copy Address" button copies the wallet address

**Persona:** Same LP as Story 1.

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Load `/deposit` in a 402px-wide viewport with a below-min USDC balance.
2. Click or tap the "Copy Address" button.
3. Observe the button label change.

**Expected outcomes:**

- After clicking, the button label temporarily changes to "Copied".
- The wallet address is written to the clipboard.
