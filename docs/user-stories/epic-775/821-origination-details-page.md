# User Stories: #821 — Trustee: Origination details page /origination/:id — Loan Terms + Deal Details (NO collateral valuation)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#821](https://github.com/eq-lab/pipeline/issues/821)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This adds the Origination details / review page at `/origination/$id` (Figma node
`4116:9292`) and wires the previously-inert "Review" controls on both the #813 Origination
table and the #818 Needs Attention section to navigate to it, passing the clicked
submission. Supersedes the closed #816, which included a "Collateral valuation — NSR" card;
that card is **explicitly dropped** here — the Figma reference for it is incorrect (no
submission is anchored on-chain pre-mint, so there is no `loan_id` to call
`GET /v1/loan-book/{loan_id}/valuations` with). Per human-resolved Open Questions: only the
backend-backed status chip renders in the chip row (the Figma's static "Your key · one
click" chip and the valuation-derived "NSR · Net Smelter Return" chip are both omitted — no
data source, never fabricated); the "All three mint invariants pass" and "Originator
signature verified" banners are omitted entirely for the same reason; and the Approve /
Reject / Request changes buttons render per Figma but are inert (the Type-1 review/mint
signing flow is a separate future sub-issue). Visual fidelity (spacing, colors, radii) is
verified separately by the QA agent's Figma comparison.

---

## Story 1: Clicking "Review" on the Origination table navigates to the details page

**Persona:** Trustee operator reviewing an in-review submission from the Origination table.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and `GET /v1/loan-book/submissions` returns at least one
`InReview` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Locate an `InReview` row and click its "Review" control.

**Expected outcomes:**

- The "Review" control is a live, keyboard-focusable link/button (no longer disabled or
  dimmed) styled as the original solid-navy Figma button.
- Clicking it navigates to `/origination/<id>`, where `<id>` is that submission's `id`.
- The details page renders immediately with the clicked submission's data (no loading
  flash) — the row's full data is passed via router navigation state, not refetched.

---

## Story 2: Clicking "Review" on the Overview page's Needs Attention section navigates to the details page

**Persona:** Trustee operator triaging in-review submissions from the Overview page.

**Pre-conditions:** Signed in; at least one in-review submission exists so the Needs
Attention (Origination group) section renders (per #818).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Locate a Needs Attention row and click its "Review" button.

**Expected outcomes:**

- The button is live and keyboard-focusable (no longer disabled/inert), keeping the same
  Figma visual style (`#000080` background, white text, `h-[40px]`).
- Clicking it navigates to `/origination/<id>` for that row's submission, with the details
  page rendering that submission's data immediately (via router state).

---

## Story 3: Origination details page renders the heading, status chip, Loan Terms, and Deal Details

**Persona:** Trustee operator reviewing a submission's full terms before deciding.

**Pre-conditions:** Arrived at `/origination/<id>` via Story 1 or 2 (router state present).

**Steps:**

1. From the Origination table or Needs Attention section, click "Review" on an `InReview`
   submission.
2. Observe the resulting page.

**Expected outcomes:**

- A breadcrumb reads "Origination / `<originator>` — `<commodity>`", where `<originator>` is
  the submitted loan's friendly originator name (`loan_data.originator`, e.g. "Auric Andes
  S.A.C.") — **not** the authenticated submitter's wallet/address.
- A page heading repeats the same "`<originator>` — `<commodity>`" text.
- Exactly one chip renders in the chip row: the status chip (e.g. "Awaiting your review" for
  `InReview`). No other chip is present.
- A "Loan Terms" card renders seven rows: Facility size, Senior tranche, Equity tranche,
  Offtaker price (all fully-expanded USD, e.g. "$3,500,000"), Rate (e.g. "14.0% p.a."), Start
  date, and Maturity date (both formatted e.g. "10 Jul 2026").
- A "Deal Details" card renders four rows — Originator, Commodity, Corridor (arrow-formatted,
  e.g. "Peru → China"), Governing law — followed by a documents list, one row per document
  with a file icon and the document name.
- Three action buttons render at the bottom: "Request changes", "Reject", "Approve" — all
  visually present per Figma but disabled/inert (clicking does nothing).

---

## Story 4: No collateral valuation UI renders anywhere on the page

**Persona:** Trustee operator reviewing the details page, verifying no fabricated/incorrect
data is shown.

**Pre-conditions:** Same as Story 3.

**Steps:**

1. Navigate to `/origination/<id>` for any submission.
2. Inspect the full page content.

**Expected outcomes:**

- No "Collateral valuation" card, NSR waterfall, CCR figure, or valuation freshness chip
  appears anywhere on the page.
- No "All three mint invariants pass" or "Originator signature verified" green banner
  appears.
- No "Your key · one click" or "NSR · Net Smelter Return" chip appears in the chip row.
- No network call to `GET /v1/loan-book/{loan_id}/valuations` is made from this page.

---

## Story 5: Direct-URL / refresh access refetches the submission by id

**Persona:** Trustee operator who bookmarks or refreshes a details-page URL, losing router
navigation state.

**Pre-conditions:** A submission with a known `id` exists in
`GET /v1/loan-book/submissions`.

**Steps:**

1. Navigate directly to `http://localhost:5174/origination/<id>` (typed URL, not via a
   Review click) — or refresh an already-open details page.

**Expected outcomes:**

- The page shows a brief loading skeleton while the submissions list is fetched.
- Once loaded, the page renders the same Loan Terms / Deal Details / status chip content as
  if it had been reached via a Review click, matched by `id`.

---

## Story 6: An unknown id renders a graceful not-found state

**Persona:** Trustee operator who navigates to a details URL for a submission that does not
exist (e.g. stale link, typo).

**Pre-conditions:** `GET /v1/loan-book/submissions` does not return a submission with the
requested `id`.

**Steps:**

1. Navigate directly to `http://localhost:5174/origination/999999` (an id with no matching
   submission).

**Expected outcomes:**

- The page renders a "Submission not found." message — no crash, no blank white screen.
- A "Back to Origination" link is present and returns to `/origination`.

---

## Story 7: Missing/malformed submission fields degrade gracefully, never fabricated

**Persona:** Trustee operator viewing a submission whose payload has incomplete or missing
`loan_data` fields.

**Pre-conditions:** The backend returns a submission with one or more `loan_data` fields
missing/empty (e.g. missing `governing_law`, empty `documents`).

**Steps:**

1. Navigate to that submission's `/origination/<id>` details page.

**Expected outcomes:**

- Each missing field renders as "—" rather than blank, `undefined`, or a crash.
- An empty `documents` array renders "No documents provided." rather than an empty list with
  no explanation.
- The rest of the page (heading, other Loan Terms/Deal Details rows, action buttons) still
  renders normally.
