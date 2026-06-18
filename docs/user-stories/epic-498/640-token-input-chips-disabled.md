# User story: #640 — Token input chips disabled when wallet not connected

**Epic:** #498 — Deposit/withdraw page  
**Issue:** https://github.com/eq-lab/pipeline/issues/640  
**Status:** Initial

---

## Overview

When the wallet is disconnected, the `TokenInput` component is rendered with `disabled=true`. The quick-amount chips must also be non-interactive in this state — they should not fire `onQuickAmountClick` and should render with the disabled visual style.

---

## Story 1 — Chips are non-interactive when wallet is disconnected

**Given** no wallet is connected, on the deposit page (`/deposit`).

**When** the user clicks any quick-amount chip in the token input chips row.

**Then** nothing happens — the input amount does not change and no action fires.

**How to test**

1. Open `/deposit` with no wallet connected.
2. Observe the numeric input is greyed out (disabled).
3. Click the "Min" chip or any other quick-amount chip.
4. Verify the input value does not change.

---

## Story 2 — Chips become interactive after wallet connects

**Given** the wallet was disconnected (chips were non-interactive).

**When** the user connects a wallet.

**Then** the quick-amount chips become interactive — clicking them sets the input amount as expected.

---

## Story 3 — Per-item disabled still works (regression guard)

**Given** a connected wallet.

**When** a specific chip has `item.disabled = true` (e.g. the Min chip when the balance is below minimum).

**Then** that individual chip is non-interactive regardless of wallet connection state.
