# User story: #598 — Stellar deposit minimum is 1,000 USDC

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/598
**Status:** Revised by #641

> **Note:** #641 reverses #598. The Stellar deposit minimum was lowered to 1 USDC
> by #598, then raised back to 1,000 USDC by #641. This document reflects the
> current state after the revert.

---

## Overview

The Stellar DepositManager contract does not expose a minimum-deposit getter.
Until a contract or API value exists, the frontend applies a Stellar-specific
minimum of 1,000 USDC. EVM behavior is unchanged and still uses the EVM
DepositManager `minDeposit()` value.

---

## Story 1 — Stellar Min chip uses 1,000 USDC

**Given** the user is on the Stellar tab with a connected wallet and at least
1,000 USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The quick amount row shows a Min chip for 1,000 USDC
- Clicking the Min chip enters `1000.00` in the amount input
- Step actions use the Stellar flow, not the EVM `minDeposit()` value

---

## Story 2 — Stellar deposit is blocked below 1,000 USDC

**Given** the user is on the Stellar tab with `500` USDC available

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The low-balance banner is visible
- The minimum text reads `1,000 USDC`
- No deposit step action is available

---

## Story 3 — EVM minimum remains contract-driven

**Given** the user switches back to the EVM network

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The Min chip and low-balance threshold come from the EVM
  `DepositManager.minDeposit()` read
- The Stellar 1,000 USDC frontend constant is not used for EVM
