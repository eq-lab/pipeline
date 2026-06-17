# User story: #598 — Stellar deposit minimum is 1 USDC

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/598
**Status:** Initial

---

## Overview

The Stellar DepositManager contract does not expose a minimum-deposit getter.
Until a contract or API value exists, the frontend applies a Stellar-specific
minimum of 1 USDC. EVM behavior is unchanged and still uses the EVM
DepositManager `minDeposit()` value.

---

## Story 1 — Stellar Min chip uses 1 USDC

**Given** the user is on the Stellar tab with a connected wallet and at least
1 USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The quick amount row shows a Min chip for 1 USDC
- Clicking the Min chip enters `1.00` in the amount input
- Step actions use the Stellar flow, not the EVM `minDeposit()` value

---

## Story 2 — Stellar deposit is blocked below 1 USDC

**Given** the user is on the Stellar tab with `0.5` USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The low-balance banner is visible
- The minimum text reads `1 USDC`
- No deposit step action is available

---

## Story 3 — EVM minimum remains contract-driven

**Given** the user switches back to the EVM network

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The Min chip and low-balance threshold come from the EVM
  `DepositManager.minDeposit()` read
- The Stellar 1 USDC frontend constant is not used for EVM
