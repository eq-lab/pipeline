# User Stories: #1658 — LP deposit flow: approve errors, request lifecycle, assets headline, contract minimum

Issue: [#1658](https://github.com/eq-lab/pipeline/issues/1658) (split from #1629)
Spec: [docs/frontend/wallet-flows.md#request-state-model](../../frontend/wallet-flows.md#request-state-model),
[#business-rules](../../frontend/wallet-flows.md#business-rules),
[#step-error-state](../../frontend/wallet-flows.md#step-error-state),
[docs/frontend/dashboard-components.md#home-route](../../frontend/dashboard-components.md#home-route)

LP dashboard (`packages/frontend`) against staging. EVM stories use a wallet with USDC and PLUSD on
the staging EVM chain; Stellar stories use a funded Stellar wallet with both trustlines enabled.

---

## Story 1: A rejected approve is shown, not swallowed

**Persona:** LP on `/deposit` (EVM) with an allowance below the amount.

**Steps:**

1. Enter an amount of at least the minimum and click **Approve**.
2. Reject the transaction in the wallet.
3. Repeat on `/deposit?direction=withdraw` (PLUSD approve).

**Expected outcomes:**

- The "Approving USDC…" toast turns into a danger toast with a **Details** action; Details shows the raw error.
- Step 1 shows the red error state with a mapped one-line message and keeps its **Approve** button.
- Clicking **Approve** again and confirming clears the error and completes the approval.
- A balance or token-metadata read failure never paints the Approve row.

---

## Story 2: A request shows up without a manual refresh

**Persona:** LP completing a deposit (and a withdrawal) on EVM.

**Steps:**

1. Approve, then click **Confirm** and wait for the transaction to mine.
2. Watch the step card and the Recent activity list without reloading.

**Expected outcomes:**

- Step 2 stays in its loading state ("awaiting verification") and the amount is locked until the API lists the request; the list refreshes within a few seconds, not a minute.
- The same holds for Stellar `request_deposit` and for withdrawals.

---

## Story 3: Reloading right after Confirm cannot start a second request

**Persona:** LP who reloads `/deposit` immediately after the Confirm transaction mined, before the indexer has listed it.

**Steps:**

1. Click **Confirm** on EVM, wait for the receipt, and reload the page at once.
2. Look at the steps card and the amount input.

**Expected outcomes:**

- The amount input is locked to the submitted amount; **Approve** and **Confirm** are disabled; step 2 shows loading.
- Once the API lists the request, the page follows its status (`PendingVerification` → `PendingClaim` → Claim).
- Repeat on `/deposit?direction=withdraw`.

---

## Story 4: The Total Balance headline is the PLUSD value of the sPLUSD, not the share count

**Persona:** LP holding sPLUSD whose share price is above 1 (shares ≠ assets).

**Steps:**

1. Open `/` on desktop and at mobile width.
2. Compare the Total Balance heading and the Staked PLUSD card with the share count and the `convertToAssets` value.

**Expected outcomes:**

- The heading and the card's `· $` value show the `convertToAssets(shares)` amount (e.g. 1,000 shares worth 1,001.50 PLUSD show `$1,001.50`), the card's share line still shows the shares.
- While the conversion is unavailable for a non-zero balance the value reads `—`, never `$0.00`; a zero balance reads `$0.00`.

---

## Story 5: The Stellar minimum deposit comes from the contract

**Persona:** LP on `/deposit` with a Stellar wallet.

**Steps:**

1. Open `/deposit` and read the **Min** chip.
2. Click the chip, then enter an amount one unit below it.

**Expected outcomes:**

- The chip shows the DepositManager `min_deposit()` value (testnet: `$1,000`); clicking it fills exactly that amount.
- An amount below it keeps **Confirm** disabled; at or above it (and within the balance) Confirm is enabled.
- Until the value has loaded the chip reads `Min` and does nothing.
