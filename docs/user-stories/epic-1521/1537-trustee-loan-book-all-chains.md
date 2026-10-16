# User Stories: #1537 — Trustee: loan book across all chains; per-loan calls send the loan's own chain_id

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1537](https://github.com/eq-lab/pipeline/issues/1537)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#loan-book--tables),
[docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md)

Trustee app (`packages/trustee`) against a staging API whose `CHAINS` includes both the Stellar
testnet (`99000001`) and Hoodi (`560048`), with at least one drawn loan on each. No Figma for the
Chain column, the chain filter, or the gate line (implementer-derived from the #1536 patterns).

---

## Story 1: The Loans page lists every chain and shows each loan's chain

**Persona:** Trustee monitoring the book.

**Pre-conditions:** Signed in, on `/loans`.

**Steps:**

1. Open the Network tab and reload.
2. Read the table header and the rows.

**Expected outcomes:**

- The request is `GET /v1/loan-book` with no `chain_id`; the five summary tiles show the served `summary`.
- A "Chain" column sits between Originator and Commodity · spot; Stellar loans read "Stellar", Hoodi loans read "Hoodi".
- Two loans with the same id on different chains both appear as separate rows.

---

## Story 2: The chain filter narrows the book server-side

**Persona:** Trustee monitoring one chain.

**Pre-conditions:** Story 1.

**Steps:**

1. In the "Chain" select next to the status tabs choose "Hoodi"; then choose "All chains".

**Expected outcomes:**

- Choosing Hoodi fires `GET /v1/loan-book?chain_id=560048`; only Hoodi rows remain, the tab counts and the summary tiles change to the served values for that chain (nothing is recomputed in the browser).
- "All chains" returns to the unfiltered request and the full row set.

---

## Story 3: Opening a loan carries its chain to every per-loan call

**Persona:** Trustee opening a Hoodi loan.

**Pre-conditions:** Story 1, a Hoodi loan with the same id as a Stellar loan.

**Steps:**

1. Click the Hoodi row.
2. Inspect the URL and the Network tab.

**Expected outcomes:**

- The URL is `/loans/<id>?chain=560048`; the hero shows the Hoodi loan's originator and commodity, and its meta line reads "Loan #<id> · Hoodi · …".
- `GET /v1/loan-book/<id>/valuations?chain_id=560048` and `…/financials?chain_id=560048` are sent (plus `…/ccr-history?…&chain_id=560048` for a Watchlist loan); none is sent with the Stellar id.
- Removing `?chain=…` from the URL and reloading shows the Stellar loan with the same id (pre-#1537 links keep working).

---

## Story 4: On-chain actions are disabled for a non-Stellar loan

**Persona:** Trustee on the Story 3 detail page.

**Pre-conditions:** Story 3; trustee wallet connected.

**Steps:**

1. Read the "Other actions on this loan" card; click Update lifecycle.
2. Click Escalate to Risk Council.
3. Navigate directly to `/loans/<id>/record-coupon?chain=560048`.

**Expected outcomes:**

- Update lifecycle, Record coupon and Close loan are disabled and a muted line reads "On-chain actions run on Stellar only — this loan lives on Hoodi, and signing them from the Trustee app is not supported yet."; clicking opens no dialog and prompts no wallet.
- Escalate to Risk Council opens `/risk-council/escalate/<id>?chain=560048` showing the Hoodi loan.
- The Record Coupon page shows the same line and "Record on the ledger" stays disabled whatever amount is entered.
- A Stellar loan shows no such line and all actions work as before; Record coupon / Close loan navigate with `?chain=99000001` and return to the detail page with it.

---

## Story 5: Needs Attention and the Audit Log stay unambiguous across chains

**Persona:** Trustee on the Overview and Audit Log pages.

**Pre-conditions:** A Watchlist (or past-maturity) loan on Hoodi; a Stellar loan with the same id.

**Steps:**

1. Open `/` and read the Needs Attention Loans group.
2. Open `/audit-log`.

**Expected outcomes:**

- The Hoodi row's subtitle ends with "· Hoodi" and its Open link goes to `/loans/<id>?chain=560048`.
- Audit-log rows for the Stellar loan show the Stellar loan's "Originator — Commodity" name, not the Hoodi loan's.
