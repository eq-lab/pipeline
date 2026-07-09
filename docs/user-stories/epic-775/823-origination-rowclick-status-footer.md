# User Stories: #823 — Trustee Origination: row-click navigation + status-conditional detail footer (Approved/Rejected blocks)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#823](https://github.com/eq-lab/pipeline/issues/823)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

Extends the #813 Origination table and the #821 details page with two changes: (1) the
entire submissions-table row now navigates to `/origination/:id` for ALL statuses —
Approved and Rejected rows included, which only had a status pill (no Review control)
before — passing the row's `SubmissionView` via router state; (2) the details page's
always-shown "Request changes / Reject / Approve" footer is replaced by a
status-conditional block: `InReview` keeps the existing inert buttons, `Approved` shows a
green "Approved & minted · `<date>`" banner (Figma node `4116:9656`; the Figma's "funded
from batch #B-102 →" segment is deliberately omitted — no backing field, never
fabricated), and `Rejected` shows a red "Rejected · `<date>` — `<reason>`" banner (no
Figma reference; mirrors the Approved banner's shape in red tokens). Both dates are
`updated_at` formatted as "2 Jan" via `formatSubmittedDate`. An unknown/unrecognized
status falls back to the InReview footer. Visual fidelity (spacing, colors, radii) is
verified separately by the QA agent's Figma comparison.

---

## Story 1: Clicking anywhere on an Approved row navigates to its details page

**Persona:** Trustee operator wanting to inspect an already-minted submission's terms.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and `GET /v1/loan-book/submissions` returns at least
one `Approved` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Locate an Approved row (green "Approved & minted · `<date>`" pill, no Review button)
   and click anywhere on the row (not just the pill).

**Expected outcomes:**

- The click navigates to `/origination/<id>`, where `<id>` is that row's submission id.
- The details page renders that submission's data immediately (via router state, no
  loading flash).

---

## Story 2: Clicking anywhere on a Rejected row navigates to its details page

**Persona:** Trustee operator reviewing why a submission was rejected.

**Pre-conditions:** Same as Story 1, but with at least one `Rejected` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Locate a Rejected row (red "Rejected" pill) and click anywhere on the row.

**Expected outcomes:**

- The click navigates to `/origination/<id>` for that row's submission.
- The details page renders that submission's data immediately (via router state).

---

## Story 3: InReview row-click and the Review link both work without double-navigating

**Persona:** Trustee operator triaging an in-review submission from the table.

**Pre-conditions:** At least one `InReview` submission exists.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Click the row itself, away from the "Review" button, for one InReview row.
3. On another InReview row (or after navigating back), click the "Review" button
   directly.

**Expected outcomes:**

- Clicking the row body navigates to `/origination/<id>` for that submission.
- Clicking the "Review" button also navigates to the same `/origination/<id>` — exactly
  once (no duplicated navigation/history entry from both the row and the button firing).
- The "Review" button remains its own focusable, keyboard-accessible control, styled as
  the solid-navy Figma button.

---

## Story 4: Rows are keyboard-accessible

**Persona:** Trustee operator navigating the table via keyboard.

**Pre-conditions:** The Origination table has at least one row of any status.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Tab to a table row (not the Review button) and press Enter (or Space).

**Expected outcomes:**

- The row is reachable via Tab (each row has a non-negative tab stop) and has an
  accessible name identifying which submission it opens.
- Pressing Enter or Space while the row is focused navigates to `/origination/<id>` for
  that row's submission, the same as a mouse click. Space does not scroll the page.

---

## Story 5: Approved submission's details page shows the green "Approved & minted" banner

**Persona:** Trustee operator confirming a submission's mint status from its details
page.

**Pre-conditions:** Arrived at `/origination/<id>` for an `Approved` submission (via row
click or direct URL).

**Steps:**

1. Open the details page for an Approved submission.
2. Observe the area below the Loan Terms / Deal Details cards, where the action buttons
   used to always render.

**Expected outcomes:**

- No "Request changes" / "Reject" / "Approve" buttons render.
- A green banner renders instead, reading "Approved & minted · `<date>`", where `<date>`
  is the submission's last-updated date formatted like "2 Jan" (no year).
- No "funded from batch #…" text or any batch number appears anywhere on the page — this
  segment has no backing data and is never fabricated.

---

## Story 6: Rejected submission's details page shows the red "Rejected" banner with the reason

**Persona:** Trustee operator understanding why a submission was rejected.

**Pre-conditions:** Arrived at `/origination/<id>` for a `Rejected` submission with a
non-empty `reason`.

**Steps:**

1. Open the details page for a Rejected submission.
2. Observe the area below the Loan Terms / Deal Details cards.

**Expected outcomes:**

- No "Request changes" / "Reject" / "Approve" buttons render.
- A red banner renders instead, reading "Rejected · `<date>` — `<reason>`", where `<date>`
  is the last-updated date formatted like "5 May" and `<reason>` is the submission's
  rejection reason text.

---

## Story 7: InReview submission's details page still shows the original inert action buttons

**Persona:** Trustee operator reviewing a submission still awaiting a decision.

**Pre-conditions:** Arrived at `/origination/<id>` for an `InReview` submission.

**Steps:**

1. Open the details page for an InReview submission.
2. Observe the area below the Loan Terms / Deal Details cards.

**Expected outcomes:**

- The original note ("Approval mints the loan NFT from your Trustee key...") and the
  three buttons — "Request changes", "Reject", "Approve" — render exactly as before,
  visually present but disabled/inert (clicking does nothing).
- Neither the green Approved banner nor the red Rejected banner renders.
