# User story: #603 — Stellar deposit/withdraw page surfaces DepositManager unreachable banner

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/603
**Status:** Initial

---

## Overview

When the Stellar DepositManager or WithdrawalQueue contract is unconfigured or
unreachable (i.e. `VITE_STELLAR_DEPOSIT_MANAGER_ID` is empty or the Soroban RPC
cannot resolve the contract addresses, or `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` is
empty on the withdraw path), the deposit/withdraw page shows the existing
"DepositManager not reachable" danger banner up front — mirroring the EVM
behavior. The three-step action card is not shown until the relevant manager is
reachable. The banner copy correctly references the relevant Stellar env var for
the active direction.

---

## Story 1 — Stellar: banner appears when DepositManager is unconfigured

**Given** the user has a Stellar wallet connected

**And** `VITE_STELLAR_DEPOSIT_MANAGER_ID` is empty (or the contract addresses
cannot be resolved)

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- A danger banner with the title "DepositManager not reachable" is visible
- The banner detail line reads: `Check VITE_STELLAR_DEPOSIT_MANAGER_ID and RPC connectivity.`
- No three-step action card is rendered
- No low-balance banner is rendered

---

## Story 2 — Stellar: banner does not flash during initial address load

**Given** the user has a Stellar wallet connected

**And** `useStellarDepositManagerAddresses` is still loading (`isLoading: true`)

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The "DepositManager not reachable" banner is NOT shown
- The page renders without error (no premature unreachable signal)

---

## Story 3 — Stellar: banner does not show when manager is configured

**Given** the user has a Stellar wallet connected

**And** `VITE_STELLAR_DEPOSIT_MANAGER_ID` resolves to valid contract addresses

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The "DepositManager not reachable" banner is NOT shown
- The three-step action card is rendered normally

---

## Story 4 — Stellar: banner does not show when wallet is disconnected

**Given** no Stellar wallet is connected

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The "DepositManager not reachable" banner is NOT shown
- The "Connect your wallet first" yellow banner is shown instead

---

## Story 5 — EVM: banner env var is EVM-specific (regression guard)

**Given** the user is on the EVM tab with a connected wallet

**And** the EVM DepositManager is unreachable

**When** they navigate to `/deposit?direction=deposit`

**Then:**

- The banner detail reads: `Check VITE_DEPOSIT_MANAGER_ADDRESS and RPC connectivity.`
- The Stellar env var `VITE_STELLAR_DEPOSIT_MANAGER_ID` does NOT appear

---

## Story 6 — Stellar withdraw: banner appears when WithdrawalQueue is unconfigured

**Given** the user has a Stellar wallet connected

**And** `VITE_STELLAR_DEPOSIT_MANAGER_ID` resolves to valid contract addresses

**And** `VITE_STELLAR_WITHDRAWAL_QUEUE_ID` is empty

**When** they navigate to `/deposit?direction=withdraw`

**Then:**

- A danger banner with the title "DepositManager not reachable" is visible
- The banner detail line reads: `Check VITE_STELLAR_WITHDRAWAL_QUEUE_ID and RPC connectivity.`
- No three-step action card is rendered
