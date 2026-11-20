# User story: #1896 — Trustee: Approve shows the "View loan" link for loan id 0

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1896
**Status:** Initial

---

## Overview

LoanRegistry `next_loan_id` starts at 0, so the first loan drawn on a fresh registry has id 0. The wallet-connect parsers (`toLoanId`, minter `toId`) accept any `u32` including 0, so the Approve flow keeps the drawn loan id and the origination detail page links to it. Spec: `docs/frontend/trustee-flows.md` (Approve ordering, "View loan" link).

Persona: trustee on pipeline-test with a Stellar trustee wallet that holds `TRUSTEE`, signed in on the Stellar chain.

**Precondition:** a registry whose `next_loan_id` is 0 (a fresh deployment) and a Ready submission in the origination queue.

---

## Story 1 — The first loan shows its deep link

**Given** a Ready submission and a registry with no loans

**When** the trustee clicks **Approve** and signs the `draw_loan` transaction

**Then:**

- The transaction succeeds and the page shows the Approved banner
- The banner shows a **View loan #0** link pointing to `/loans/0`

---

## Story 2 — The link opens loan 0

**Given** the Approved banner from Story 1

**When** the trustee clicks **View loan #0**

**Then:**

- The app opens `/loans/0` and renders the loan detail for loan 0, not a not-found state

---

## Story 3 — Later loans are unaffected

**Given** the registry now holds loan 0

**When** the trustee approves a second submission

**Then:**

- The banner shows **View loan #1** pointing to `/loans/1`
