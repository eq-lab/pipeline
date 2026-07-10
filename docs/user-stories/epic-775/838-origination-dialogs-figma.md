# User Stories: #838 — Trustee Origination: update Approve-mint & Reject dialogs to Figma; drop footer note + Request changes

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#838](https://github.com/eq-lab/pipeline/issues/838)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

A UI/design pass over the Origination review page (`/origination/:id`), building on
merged #829 (approve/reject wiring) and #831 (on-chain `draw_loan` mint):

- **Approve now opens a confirmation dialog** (Figma node `4116-13943`) before minting —
  a deliberate new pre-mint confirmation gate. Clicking "Approve" opens the dialog
  showing a transaction preview built from the real submitted `loan_data`; the on-chain
  mint (the existing #831 sign → submit → poll → #829 review flow) only fires when the
  trustee clicks "Mint loan". "Cancel" (or Escape, or a backdrop click) closes the dialog
  without minting — but only while no mint is in flight; once "Mint loan" is clicked,
  the dialog cannot be dismissed until the sequence settles.
- **The Reject dialog is re-skinned** to Figma node `4116-14123` — title now reads
  "Reject request — `<originator>`", a single-line reason input with a placeholder
  replaces the old textarea, and the submit button now reads "Send to originator". The
  underlying validation (reason must be ≥5 characters after trimming) and the
  `POST /v1/loan-book/submissions/{id}/review` call are unchanged.
- **Two removals**: the footer note "Approval mints the loan NFT from your Trustee
  key…" and the inert "Request changes" button are both gone — the button had no
  backend endpoint, and the note is now redundant with the Approve dialog's own copy.

**Explicitly unchanged:** the #831 chain-first orchestration (sign → submit → poll →
review), its idempotency guard (no double on-chain mint on retry), its
wallet-rejection/tx-failure error mapping, and the #829 review REST contract. This issue
only changes *when* the mint fires (behind a confirm dialog) and *how* the surrounding
dialogs are styled.

---

## Story 1: Approve opens a confirmation dialog showing the transaction preview

**Persona:** Trustee operator reviewing an InReview submission.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in with a session holding the `trustee` role, and
`GET /v1/loan-book/submissions` returns at least one `InReview` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination/<id>` for an InReview submission.
2. Click "Approve".

**Expected outcomes:**

- No on-chain mint or review call fires yet. Instead, a dialog opens titled
  "Approve & mint loan" with the subtitle "Transaction preview — sent from your Trustee
  key.".
- A dark, monospace transaction-preview block renders `originator`, `economics`
  (facility/senior/equity/offtaker/rate/dates), `metadataURI`, and `initialLocation`,
  each read from the submission's real `loan_data` — any missing field renders `—`,
  never a fabricated value.
- The dialog shows "Cancel" and "Mint loan" buttons. No green
  "senior + equity == facility size"-style checklist rows are present (no backing data
  for them).
- The page underneath the backdrop is not directly interactable.

---

## Story 2: Cancel closes the dialog without minting; Mint loan runs the existing orchestration

**Persona:** Trustee operator who opens the Approve dialog, then decides whether to
proceed.

**Pre-conditions:** Same as Story 1, with the Approve dialog open.

**Steps:**

1. With the dialog open, click "Cancel".
2. Reopen the dialog (click "Approve" again) and press Escape.
3. Reopen the dialog a third time and click "Mint loan".

**Expected outcomes:**

- Step 1: the dialog closes; no wallet signature is requested; no review call is made;
  the submission remains InReview with the Approve/Reject buttons still shown.
- Step 2: Escape also closes the dialog without minting, identical to Cancel.
- Step 3: the wallet is prompted to sign `draw_loan`; the "Mint loan" button's label
  swaps through "Waiting for wallet signature…" → "Submitting on-chain…" →
  "Confirming…" → "Finalizing approval…"; Cancel is disabled and Escape/backdrop-click
  no longer close the dialog while this is in flight. On success, the dialog closes and
  the page's footer flips to the green "Approved & minted · `<date>`" banner.

---

## Story 3: A failed mint shows a retryable error inside the dialog

**Persona:** Trustee operator whose wallet signature is rejected, or whose on-chain
transaction fails.

**Pre-conditions:** Same as Story 1, with the Approve dialog open, and a wallet
configured to reject the signature request (or a simulated on-chain failure).

**Steps:**

1. Click "Mint loan".
2. Reject the wallet's signature prompt (or let the simulated failure occur).

**Expected outcomes:**

- No review call is made — the submission stays InReview.
- An inline, retryable error message renders inside the dialog (e.g. "Signature
  cancelled. Click Approve again to retry.").
- Cancel becomes available again (it was only locked while the mint was actually in
  flight); clicking it closes the dialog and clears the error. Reopening the dialog
  later starts fresh, with no stale error message.

---

## Story 4: Reject dialog matches the Figma re-skin; validation and submission unchanged

**Persona:** Trustee operator rejecting a submission with a documented reason.

**Pre-conditions:** Same as Story 1, arrived at an InReview submission's details page.

**Steps:**

1. Click "Reject".
2. Observe the dialog title and the reason field.
3. Type fewer than 5 non-whitespace characters (e.g. "Hi"), then observe the submit
   control.
4. Clear the field, type a reason of 5+ characters after trimming (e.g. "Missing export
   permit"), then click "Send to originator".

**Expected outcomes:**

- Step 2: the title reads "Reject request — `<originator name>`"; a subtitle reads "The
  request closes and the originator sees your reason."; the reason field is a
  single-line input showing the placeholder "e.g. offtaker price below facility
  covenant" (not the old multi-row textarea).
- Step 3: the submit control (now labeled "Send to originator") is disabled, and an
  inline validation message appears.
- Step 4: the button becomes enabled once the trimmed length reaches 5 characters;
  clicking it fires `POST /v1/loan-book/submissions/{id}/review` with
  `{"decision":"Rejected","reason":"Missing export permit"}` (trimmed), and on success
  the page shows the red "Rejected · `<date>` — Missing export permit" banner.

---

## Story 5: The footer note and "Request changes" button are gone

**Persona:** Trustee operator viewing an InReview submission's action row.

**Pre-conditions:** Same as Story 1, arrived at an InReview submission's details page.

**Steps:**

1. Observe the action row below the Loan Terms / Deal Details cards.

**Expected outcomes:**

- The paragraph "Approval mints the loan NFT from your Trustee key. Disbursement is the
  separate Cash Management stage you co-sign next." no longer renders anywhere on the
  page.
- There is no "Request changes" button. Only "Reject" and "Approve" render, left-aligned
  with no leftover gap where the removed button used to be.
