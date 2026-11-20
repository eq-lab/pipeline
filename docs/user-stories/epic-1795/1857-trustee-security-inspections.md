# User Stories: #1857 — Trustee inspections: enter and approve (four-eyes), variances and flags (SecurityRegistry)

Issue: [#1857](https://github.com/eq-lab/pipeline/issues/1857) (epic #1795)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#security-inspections-1857), [docs/product-specs/loan-security-state.md](../../product-specs/loan-security-state.md)

Trustee app (`packages/trustee`), loan detail `/loans/{id}?chain=<stellar chain>` of a Stellar loan with security terms and a goods record that is open and `PendingPerfection` or `Active`, Stellar wallet connected. Enter inspection and Approve invoke the SecurityRegistry directly (`VITE_STELLAR_SECURITY_REGISTRY_ID`), no AccessManager relay, and render on the connected wallet's `can_call` for `record_inspection` / `approve_inspection`. Served values are shown verbatim and `—` when missing; the app computes nothing. Two wallets that hold the inspection role (both Trustee API users), a non-empty inspector panel and the loan's terms are needed.

---

## Story 1: Enter an inspection on a goods record

**Persona:** Trustee operator whose wallet can call `record_inspection`.

**Steps:**

1. Open the loan detail and find a goods record. Read its Inspector panel block and Inspections table.
2. Click "Enter inspection" beside the Inspections heading.
3. Pick the inspector from the panel, the kind and the inspection date; enter the quantity found, the grade (or leave it empty), the certificate number and the 64-hex certificate hash. Leave the prefilled region and site hash.
4. Click "Enter inspection" in the dialog and approve in the wallet.

**Expected outcomes:**

- The dialog shows the record's commodity, document quantity and reference grade verbatim, prefills region and site hash from the record, and says an entered inspection counts for nothing until a second operator approves it.
- One transaction calling `record_inspection(caller, record_id, inspection)` directly on the SecurityRegistry is signed; the button shows the wallet, submit and confirm stages.
- The card shows "Inspection #N entered on record #R. Transaction … It counts once a second operator approves it."
- After one or two indexer cycles the inspection appears with "Awaiting approval", its Inspector and Certificate cells filled.

---

## Story 2: A sampling assay has no quantity

**Persona:** Trustee operator whose wallet can call `record_inspection`.

**Steps:**

1. Open "Enter inspection" and choose the kind SamplingAssay.
2. Fill the rest of the form.

**Expected outcomes:**

- The quantity field is disabled with "Not measured by a sampling assay" and the form validates without it.
- The grade may stay empty ("Leave empty if not measured").

---

## Story 3: The form validates input before the wallet opens

**Persona:** Trustee operator whose wallet can call `record_inspection`.

**Steps:**

1. Open "Enter inspection" and try, in turn: no inspector, a date after today (UTC), a quantity with 8 decimals, a hash that is not 64 hex characters, an empty certificate number.

**Expected outcomes:**

- The dialog shows the first failing rule ("Pick an inspector from the panel.", "The inspection date can't be in the future.", "Enter the quantity found, at most 7 decimals.", "Enter the 64-character hex hash.", "Enter the certificate number.") and the confirm button stays disabled.
- Nothing is sent to the wallet.

---

## Story 4: A second operator approves

**Persona:** A different Trustee operator whose wallet can call `approve_inspection`.

**Steps:**

1. Open the same loan detail and find the inspection that shows "Awaiting approval".
2. Click "Approve", read the inspection and the loan's served tolerances, then click "Approve inspection" and sign.

**Expected outcomes:**

- The dialog says approving computes the variances against the document quantity, the lot's latest inspection and the reference grade, and that a variance above the loan's tolerance flags the record (only the Risk Council clears it).
- One transaction calling `approve_inspection(caller, inspection_id)` directly on the registry is signed; the card shows "Inspection #N approved. Transaction … Variances and any flag show once indexed."
- After indexing the row shows the approver, the three variances in bps, a "Flagged" pill when flagged, and "latest" when it is the lot's latest inspection.

---

## Story 5: The entering wallet cannot approve its own inspection

**Persona:** The operator who entered the inspection.

**Steps:**

1. Open the loan detail with the wallet that entered an awaiting inspection.

**Expected outcomes:**

- The row shows no Approve button, only "Entered by this wallet. A second operator approves it."
- Other awaiting rows entered by another wallet still show Approve.
- If the wallet approves through a stale page anyway, the dialog shows "The operator who entered an inspection can't approve it. A second operator must approve it. (SameOperator)".

---

## Story 6: Errors are shown by contract error name

**Persona:** Trustee operator.

**Steps:**

1. Enter an inspection naming an inspector that was removed from the panel after the page loaded.
2. Approve an inspection that another operator has just approved.

**Expected outcomes:**

- The first shows "The inspector is not on the inspector panel. The panel may have changed; reload. (NotInspector)".
- The second shows "This inspection has already been approved. (AlreadyApproved)".
- Other contract codes show their name and number, and "View details" shows the raw error. Cancelling in the wallet shows "You cancelled the transaction".

---

## Story 7: A wallet without the role, a paused registry and an empty panel

**Persona:** Any connected wallet.

**Steps:**

1. Open the loan detail with a wallet that cannot call `record_inspection` / `approve_inspection`, then with no wallet, then while the SecurityRegistry is paused, then on a loan whose served panel is empty.

**Expected outcomes:**

- The buttons are disabled with "This wallet is not allowed to enter inspections." / "This wallet is not allowed to approve inspections.", "Connect a Stellar wallet to enter an inspection." / "Connect a Stellar wallet to approve.", "The SecurityRegistry is paused. Inspections can't be entered or approved until it resumes.", and "No inspectors are on the panel. The Risk Council sets the panel." respectively.
- No copy names a role.

---

## Story 8: The inspector panel is shown with a link to manage it

**Persona:** Any Trustee user.

**Steps:**

1. Open the loan detail of a loan with security records.

**Expected outcomes:**

- The Security records card shows an "Inspector panel" block listing the served inspectors as addresses, or "No inspectors are on the panel." when the list is empty, and a link to `/risk-council/inspectors`.

---

## Story 9: Latest inspection and the counted-quantity note

**Persona:** Any Trustee user.

**Steps:**

1. Open the loan detail and read a goods record's rows.

**Expected outcomes:**

- A "Latest inspection" row under Counted quantity reads "{quantity} {unit} · Inspection #{id} · {date}" from the served lot, or `—` when none is served.
- The row carries the note "Counted quantity is the smaller of the document quantity and the latest approved inspection."

---

## Story 10: An open flag links to the Risk Council

**Persona:** Any Trustee user.

**Steps:**

1. Open the loan detail of a loan with a flagged record.
2. Click "Open" in the Open flag row.

**Expected outcomes:**

- The record shows "Inspection #N. The Risk Council settles it."
- The link opens `/risk-council/security/{loan}?chain=<chain>`, where the flag is resolved. A record with no `flagged_by` shows no such row.

---

## Story 11: An EVM loan is read-only

**Persona:** Trustee user on an EVM loan.

**Steps:**

1. Open the loan detail of an EVM loan with security records.

**Expected outcomes:**

- The Inspector, Certificate and Latest inspection data, the panel block and any open flag render from the served data.
- There is no "Enter inspection" and no "Approve" button.
