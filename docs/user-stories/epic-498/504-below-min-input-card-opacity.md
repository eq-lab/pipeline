# User Stories: #504 — Below-min deposit state: USDC input card dimmed to 30% opacity

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#504](https://github.com/eq-lab/pipeline/issues/504)

Viewport: 402×874 (mobile) and 1440×900 (desktop). Mock scenario: `connected-below-min` (USDC balance below minimum deposit).

---

## Story 1: Input card is full opacity in the below-min state

**Persona:** A connected LP whose USDC balance is below the minimum deposit threshold, viewing the deposit page.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with a USDC balance below the minimum deposit amount.
- No pending deposit request exists.

**Steps:**

1. Navigate to `/deposit`.
2. Observe the USDC input card (the top section of the Conversion Card showing the USDC token icon, balance, and numeric input).

**Expected result:**

- The USDC input card renders at full opacity (no visual dimming).
- The numeric input field and quick-amount chips (Min, $5,000, $10,000, Max) are visible and interactive.
- The add-funds banner is shown below (in place of the steps card), but the input card itself is not grayed out.

**Anti-regression:** The input card must NOT carry the `opacity-30` CSS class in this state.

---

## Story 2: Input card IS dimmed in the approved/step-2-live state (but NOT while the input is focused)

**Persona:** A connected LP who has already approved an allowance and entered a deposit amount, viewing the deposit page while step 2 (Confirm) is live.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with sufficient USDC balance (≥ minimum deposit).
- The user has approved an allowance ≥ the entered amount.
- A non-zero amount is entered in the input field.
- The deposit request has not yet been confirmed.

**Steps:**

1. Navigate to `/deposit`.
2. Enter a deposit amount (e.g. 2000 USDC) and then click elsewhere to blur the input.
3. Observe the USDC input card after the allowance check resolves.

**Expected result:**

- The USDC input card renders at 30% opacity (the `opacity-30` class is applied, and `focus-within:opacity-100` is also present to restore full opacity while typing).
- This signals to the user that step 1 is complete and step 2 (Confirm) is now the active action.
- While the input is actively focused (user is typing), the card appears at full opacity — it must NOT dim while the user is entering a value (fix #663).
