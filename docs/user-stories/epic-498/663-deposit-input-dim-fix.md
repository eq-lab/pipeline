# User Stories: #663 — Deposit page: top input must not dim while typing

Epic: [#498 — Deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/498)
Issue: [#663](https://github.com/eq-lab/pipeline/issues/663)

Viewport: 402×874 (mobile) and 1440×900 (desktop). Scenario: connected user with
sufficient allowance already approved (no approval step needed), typing a fresh amount.

---

## Story 1: Input card stays fully visible while the user is actively typing

**Persona:** A connected LP who already has a sufficient USDC allowance pre-approved,
visiting the deposit page to make a new deposit.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with a USDC balance ≥ the minimum deposit threshold.
- The USDC allowance already covers any reasonable deposit amount (step 1 is pre-approved).
- No pending deposit request exists.

**Steps:**

1. Navigate to `/deposit`.
2. Click the top (amount) input to focus it.
3. Start typing a deposit amount (e.g., "2", "20", "200", "2000").
4. Observe the USDC input card while typing is in progress (input still focused).

**Expected result:**

- The USDC input card renders at full opacity while the input has focus.
- The card does NOT dim / grey out / appear disabled while the user is typing.
- The numeric input field is clearly active and responsive.

**Anti-regression:** The input card must NOT render with visually reduced opacity (even
if the `opacity-30` CSS class is technically present, the `focus-within:opacity-100`
override must keep it fully visible while the input has focus).

---

## Story 2: Input card dims after the user leaves the field (amount committed)

**Persona:** Same connected LP as Story 1, who has finished entering an amount and
tabbed away or clicked elsewhere.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with sufficient balance and pre-approved allowance.
- A non-zero deposit amount has been entered.
- The top input does NOT have focus (user has blurred).
- No confirmed deposit request exists yet.

**Steps:**

1. Navigate to `/deposit`.
2. Enter a deposit amount (e.g. 2000 USDC).
3. Click outside the input or press Tab to move focus away.
4. Observe the USDC input card.

**Expected result:**

- The USDC input card renders at 30% opacity (the `opacity-30` class is in effect).
- This signals that step 1 (Approve) is complete and step 2 (Confirm) is the active action.
- The dimming is a visual affordance only — the input remains editable if clicked again,
  at which point it returns to full opacity.
