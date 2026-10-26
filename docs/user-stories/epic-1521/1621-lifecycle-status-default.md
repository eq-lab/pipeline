# User Stories: #1621 — Trustee: Update lifecycle silently resets a WatchList loan to Performing

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1621](https://github.com/eq-lab/pipeline/issues/1621)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#wired-actions)

Trustee app (`packages/trustee`) against a staging API that includes backend #1649
(`onchain_status` on `GET /v1/loan-book`), signed in with the trustee wallet on a Stellar loan.

---

## Story 1: A WatchList loan shown as Past Due opens with Watchlist preselected

**Persona:** Trustee updating CCR and location on a loan that is WatchList on chain but past maturity.

**Pre-conditions:** Loan whose `GET /v1/loan-book` entry has `status: "Past Due"` and `onchain_status: "WatchList"`.

**Steps:**

1. Open `/loans/<id>` (the page shows the Matured variant) and click **Update lifecycle**.

**Expected outcomes:**

- The Status selector shows **Watchlist**, not Active.

---

## Story 2: Editing only CCR and location keeps the loan on the watchlist

**Persona:** Trustee from Story 1.

**Steps:**

1. Without touching the Status selector, enter a CCR % and a location, then click **Confirm update**.

**Expected outcomes:**

- The `updateMutable` call carries status `WatchList`; the loan stays on the watchlist after the loan-book refetch.

---

## Story 3: A Disbursing WatchList loan also preselects Watchlist

**Persona:** Trustee on a loan whose off-ramp is incomplete.

**Pre-conditions:** Loan entry with `status: "Disbursing"` and `onchain_status: "WatchList"`.

**Steps:**

1. Open the loan and click **Update lifecycle**.

**Expected outcomes:**

- The Status selector shows **Watchlist**.

---

## Story 4: A Performing loan shown as Past Due preselects Active

**Persona:** Trustee on a past-maturity loan that is Performing on chain.

**Pre-conditions:** Loan entry with `status: "Past Due"` and `onchain_status: "Performing"`.

**Steps:**

1. Open the loan and click **Update lifecycle**.

**Expected outcomes:**

- The Status selector shows **Active**.

---

## Story 5: An unsettable on-chain status requires an explicit choice

**Persona:** Trustee on a loan whose `onchain_status` is `Approved`, `Default` or `Closed`, or missing.

**Steps:**

1. Open the loan and click **Update lifecycle**; fill CCR % and location.
2. Check **Confirm update**, then pick **Active** or **Watchlist** and check again.

**Expected outcomes:**

- The Status selector shows "Select status" and **Confirm update** stays disabled.
- After a status is picked, **Confirm update** enables and submits the chosen status.
