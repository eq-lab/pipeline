# User Stories: #1270 — Trustee: LP Counterparties menu item + list table

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1270](https://github.com/eq-lab/pipeline/issues/1270)
Spec: [docs/frontend/trustee-flows.md#lp-counterparties](../../frontend/trustee-flows.md#lp-counterparties)

Adds the "LP Counterparties" sidebar item and its list page: a table of every registered LP served
by `GET /v1/lps`, following the shipped Loan Book page (`/loans`) as the structural pattern. No
Figma exists for this screen — visual fidelity is not part of this doc.

Two things are **expected today, not defects** — do not file bugs for either:

- **Account Status reads "New" for every row.** `kyb_status` has no transition path yet (backend
  gap, tracked by issue #1274); every registered LP is `NotStarted` until #1274 lands.
- **Bank Info Available reads "—" for every row.** No backend field exists yet (issue #1275). A
  "No" here — not a "—" — **would** be a defect, since it fabricates a fact about the counterparty.

---

## Story 1: Sidebar shows LP Counterparties and navigates to the list page

**Persona:** Trustee operator locating the LP Counterparties section.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in.

**Steps:**

1. Observe the sidebar's middle group (Origination, Loans, Cash Management, LP Counterparties).
2. Click "LP Counterparties".

**Expected outcomes:**

- "LP Counterparties" appears between "Cash Management" and the divider that precedes Risk
  Council / Audit Log.
- Clicking it navigates to `/lp-counterparties` and marks the item active (brand text on a white
  background).

---

## Story 2: List renders the six headers and one row per LP, newest first

**Persona:** Trustee operator reviewing registered LP counterparties.

**Pre-conditions:** Signed in; `GET /v1/lps` returns at least two registered LPs.

**Steps:**

1. Navigate to `http://localhost:5174/lp-counterparties` while authenticated.
2. Observe the table.

**Expected outcomes:**

- The table shows six column headers: Legal Entity Name, Jurisdiction, First Registration Date,
  Account Status, Blockchain Address Available, Bank Info Available.
- One row renders per registered LP, most-recently-registered first.
- First Registration Date renders as day + short month + year (e.g. "18 Jun 2026").

---

## Story 3: Blockchain Address Available reflects whether a Stellar address is linked

**Persona:** Trustee operator checking which LPs have completed address linking.

**Pre-conditions:** Signed in; the response includes one LP with a linked `stellar_address` and
one without.

**Steps:**

1. Navigate to `/lp-counterparties`.
2. Compare the two rows' "Blockchain Address Available" cells.

**Expected outcomes:**

- The LP with a linked Stellar address shows "Yes".
- The LP without one shows "No".

---

## Story 4: Jurisdiction renders verbatim, "—" when absent

**Persona:** Trustee operator scanning LP jurisdictions.

**Pre-conditions:** Signed in; the response includes one LP with `country: null` and one with a
non-null `country`.

**Steps:**

1. Navigate to `/lp-counterparties`.
2. Compare the two rows' "Jurisdiction" cells.

**Expected outcomes:**

- The LP with no `country` shows "—".
- The other LP shows its `country` value exactly as served (no code-to-name translation, e.g.
  "CH" stays "CH", it is not expanded to "Switzerland").

---

## Story 5: Row click opens the placeholder detail page; Back returns to the list

**Persona:** Trustee operator drilling into one LP counterparty.

**Pre-conditions:** Signed in; at least one registered LP.

**Steps:**

1. Navigate to `/lp-counterparties`.
2. Click a row.
3. Observe the page that opens.
4. Use the browser Back button.

**Expected outcomes:**

- Clicking the row navigates to `/lp-counterparties/<id>`.
- That page shows the LP's legal name as its heading and the line "Document review and KYB
  confirmation land in issue #1271." (the real detail page ships in #1271).
- Browser Back returns to `/lp-counterparties`.

---

## Story 6: Keyboard activation opens the same detail page

**Persona:** Keyboard-only trustee operator.

**Pre-conditions:** Signed in; at least one registered LP.

**Steps:**

1. Navigate to `/lp-counterparties`.
2. Tab to focus the first row.
3. Press Enter.

**Expected outcomes:**

- Pressing Enter on a focused row navigates to `/lp-counterparties/<id>`, same as a click.

---

## Story 7: Empty state renders when no LPs are registered

**Persona:** Trustee operator viewing the page before any LP has registered.

**Pre-conditions:** Signed in; `GET /v1/lps` returns `{ "lps": [] }`.

**Steps:**

1. Navigate to `/lp-counterparties`.

**Expected outcomes:**

- The table area shows "No registered LP counterparties." and no rows.

---

Not covered (deliberately): visual fidelity (no Figma exists for this screen), and any behaviour
that depends on #1273 (document listing), #1274 (KYB status transitions), or #1275 (bank
requisites) — those ship in later sub-issues of epic #1269.
