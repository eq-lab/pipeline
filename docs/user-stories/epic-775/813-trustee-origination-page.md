# User Stories: #813 — Trustee: implement the Origination page (Figma 4116-9155)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#813](https://github.com/eq-lab/pipeline/issues/813)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This replaces the #786 placeholder body of the `/origination` route with the real Origination
page: an "Origination" header and a submissions table wired to
`GET /v1/loan-book/submissions` (Stellar-scoped, `chain_id=99000001`). Per the human-confirmed
Open-Question resolutions on issue #813, the Figma "Commodity · valuation" sub-line is omitted
entirely (no pre-mint data source), the `InReview` row's "Review" button is inert/disabled (no
review route exists yet), and `Rejected` renders a red pill with the reason on hover. Per a
same-issue human review follow-up, the Figma's static footer note ("The document set adapts to
the commodity…") is also deliberately NOT rendered — the table is the entire card content.
Visual fidelity (spacing, colors, radii) is verified separately by the QA agent's Figma
comparison.

---

## Story 1: Origination page renders the header and a full submissions table

**Persona:** Trustee operator reviewing loans currently in the origination pipeline.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and `GET /v1/loan-book/submissions?chain_id=99000001`
returns submissions covering all three statuses (`InReview`, `Approved`, `Rejected`).

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Observe the page header and the submissions table.

**Expected outcomes:**

- The page shows an "Origination" title.
- A white card renders below the header containing a table with the columns (in order):
  Originator, Commodity, Facility, Corridor, Rate, Maturity, Submitted, and a final
  status/action column with no header label.
- Each row shows: the originator name (bold), the commodity name (e.g. "Gold pyrite
  concentrate") with **no** valuation sub-line beneath it, the fully-expanded facility amount
  (e.g. "$3,500,000"), the corridor (e.g. "PE → CN"), the rate as a one-decimal percentage
  (e.g. "14.0%"), the maturity date as day + short month + year (e.g. "15 Dec 2026"), and the
  submitted date as day + short month only (e.g. "18 Jun").
- No footer note (or any other text) renders beneath the table — the Figma's static
  "The document set adapts to the commodity…" note is deliberately not part of this page.
- Every column has a fixed minimum width and consistent internal padding, so cell content
  (e.g. a long originator name or the "Approved · <date>" pill — copy amended by #829, see
  Story 2) never touches or overlaps the neighboring column.

---

## Story 2: Status/action column renders per-status per the resolved Open Questions

**Persona:** Trustee operator scanning submission statuses at a glance.

**Pre-conditions:** Signed in; the response includes at least one row of each status:
`InReview`, `Approved`, `Rejected` (with a non-null `reason` on the rejected row).

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Observe the status/action cell for each row.
3. Hover over the `Rejected` row's pill.

**Expected outcomes:**

- The `InReview` row shows a navy "Review" button. The button is **disabled/inert** — clicking
  it does nothing and it does not navigate anywhere (no submission-review route exists yet).
- The `Approved` row shows a green pill reading "Approved · &lt;date&gt;" with a small check
  icon (copy amended by issue #829 — reads "Approved" only, NOT "Approved & minted": the
  review endpoint is a pure DB status flip; the on-chain mint is deferred to the separate
  blocked issue #831).
- The `Rejected` row shows a red "Rejected" pill.
- Hovering the `Rejected` pill shows the submission's `reason` string as a tooltip (native
  `title` attribute).

---

## Story 3: Missing/malformed `loan_data` fields render "—", never a fabricated value

**Persona:** Trustee operator viewing a submission whose payload has an incomplete or malformed
`loan_data` (e.g. missing `economics`, non-numeric `senior_interest_rate_bps`).

**Pre-conditions:** Signed in; the backend returns a submission with `loan_data.economics`
missing, or `senior_interest_rate_bps` as a non-numeric value.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Observe the affected row's Facility, Rate, and Maturity cells.

**Expected outcomes:**

- Every field that cannot be read/parsed from `loan_data` renders "—" (an em dash) — never
  `$0`, `0.0%`, a blank cell, or a fabricated/inferred value.
- The row still renders (no crash, no blank row) — only the affected cells show "—".
- An unrecognized `status` string (neither `InReview`, `Approved`, nor `Rejected`) renders a
  neutral fallback label rather than crashing or defaulting to one of the three known styles.

---

## Story 4: Table shows a loading skeleton, then resolves

**Persona:** Trustee operator loading the Origination page on a slow connection.

**Pre-conditions:** Signed in; the `GET /v1/loan-book/submissions` request is delayed.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated, while the request is
   in flight.
2. Observe the card before the response resolves.
3. Wait for the response to resolve.

**Expected outcomes:**

- While loading, the card shows a token-styled skeleton in place of the table (no flash of an
  empty table or "—" placeholders that could be mistaken for real data).
- Once the response resolves, the skeleton is replaced by the real table (per Story 1) or the
  empty state (per Story 6), depending on the response payload.

---

## Story 5: Table shows an inline error surface when the request fails

**Persona:** Trustee operator viewing the Origination page while the API is unreachable or
errors.

**Pre-conditions:** Signed in; `GET /v1/loan-book/submissions` returns a non-2xx response or
the request fails outright.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated, with the endpoint
   failing.
2. Observe the card.

**Expected outcomes:**

- The card renders an inline error surface (not a blank card, not a silent failure) — the page
  header still renders normally above it.
- No table rows render while the error surface is showing.
- The page does not crash; the 30 s poll / query retry behavior still applies.

---

## Story 6: Table shows an empty-state caption when there are no submissions

**Persona:** Trustee operator viewing the Origination page when the origination pipeline is
empty.

**Pre-conditions:** Signed in; `GET /v1/loan-book/submissions` returns an empty array.

**Steps:**

1. Navigate to `http://localhost:5174/origination` while authenticated.
2. Observe the card.

**Expected outcomes:**

- The card shows an empty-state caption ("No loans in origination.") in place of the table.
- No footer note renders (see Story 1 — the Figma footer note is not part of this page at all).
