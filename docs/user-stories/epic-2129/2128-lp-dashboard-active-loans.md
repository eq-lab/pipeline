# User story: #2128 — LP Dashboard: Active Loans count and Liquid Cover honesty

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2128
**Status:** Initial

---

## Overview

On the LP Protocol Dashboard the Active Loans tab badge counts only non-terminal loans, and Liquid Cover shows `—` unless both liquid figures are real. Spec: `docs/frontend/dashboard-components.md#deploymentmonitorpanel`, `#withdrawalqueuepanel`.

## Story 1: Active Loans badge excludes Closed / Default

**Pre-conditions:** Dev server running; `pipeline.mock.api.GET./v1/loan-book` holds two active loans (`Performing`, `WatchList`) followed by one `Closed` and one `Default` loan.

**Steps:**

1. Open the Protocol Dashboard and look at the Loan Book panel.

**Expected:**

- The Active Loans tab badge reads `2`.
- The table lists all four rows, active first, terminal after.

## Story 2: Liquid Cover is `—` while liquid figures are null

**Pre-conditions:** `pipeline.mock.api.GET./v1/withdrawal-queue` has `in_queue_usd` greater than 0 and at least one item; `pipeline.mock.api.GET./v1/financial-position` has `cash_stablecoins` and `tokenized_tbills` both `null`.

**Steps:**

1. Open the Protocol Dashboard and look at the Withdrawal Queue summary cards.

**Expected:**

- The Liquid Cover card reads `—`, not `0.0x`.

## Story 3: Liquid Cover computes when both figures are real

**Pre-conditions:** As Story 2, but `cash_stablecoins` is `"1000000.000000"`, `tokenized_tbills` is `"850000.000000"` and `in_queue_usd` is `"1850000.000000"`.

**Expected:**

- The Liquid Cover card reads `1.0x`.
- With only one of the two figures real, the card reads `—`.
