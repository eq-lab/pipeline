# User story: #641 — Stellar deposit minimum raised to 1,000 USDC

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/641
**Status:** Initial

> **Note:** This issue reverses #598 (which had lowered the Stellar minimum to
> 1 USDC). The Stellar deposit minimum is now 1,000 USDC, aligning the Stellar
> rail with the EVM $1,000 minimum.

---

## Overview

The Stellar DepositManager contract does not expose a minimum-deposit getter.
The frontend applies a Stellar-specific minimum of 1,000 USDC as a frontend
constant. EVM behavior is unchanged and still uses the EVM DepositManager
`minDeposit()` value.

---

## Story 1 — Stellar Min chip shows $1,000 (Min)

**Given** the user is on the Stellar tab with a connected wallet and at least
1,000 USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The quick amount row shows a Min chip labeled `$1,000 (Min)`
- Clicking the Min chip enters `1000.00` in the amount input
- Step actions use the Stellar flow, not the EVM `minDeposit()` value

---

## Story 2 — Stellar deposit is blocked below 1,000 USDC

**Given** the user is on the Stellar tab with `500` USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The low-balance banner is visible
- The minimum text reads `1,000 USDC`
- No deposit step action is available (Confirm remains disabled)

---

## Story 3 — Stellar deposit proceeds at exactly 1,000 USDC

**Given** the user is on the Stellar tab with 1,000 USDC available and both
trustlines enabled

**When** they enter `1000` in the deposit amount input

**Then:**

- The below-min banner is not shown
- The Confirm button is enabled (amount meets the 1,000 USDC minimum)

---

## Story 4 — EVM minimum remains contract-driven

**Given** the user switches back to the EVM network

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The Min chip and low-balance threshold come from the EVM
  `DepositManager.minDeposit()` read
- The Stellar 1,000 USDC frontend constant is not used for EVM
