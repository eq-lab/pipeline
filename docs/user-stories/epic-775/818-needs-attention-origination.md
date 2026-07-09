# User Stories: #818 — Trustee Overview: Needs Attention block — Origination group (in-review submissions)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#818](https://github.com/eq-lab/pipeline/issues/818)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This adds the "Needs Attention" block to the Trustee Overview page (`/`, built in #797),
rendering ONLY the Origination group, backed by real data:
`GET /v1/loan-book/submissions?status=InReview` (Stellar-scoped, `chain_id=99000001`). The
section lives inside the same white card as the Capital Allocation content and appears
directly below it. The Loans — Payments Due, Cash Management, and Risk Council groups from
the Figma reference are deliberately NOT built here — no backend endpoints exist for them yet
(tracked in #799). Per human-resolved Open Questions on #818: the row subtitle omits the
Figma's valuation-mode/documents text (unbacked pre-mint), and the "Review" button is rendered
per Figma but is inert (no wiring/navigation — a separate follow-up issue). Visual fidelity
(spacing, colors, radii) is verified separately by the QA agent's Figma comparison.

---

## Story 1: Needs Attention (Origination) renders one row per in-review submission

**Persona:** Trustee operator checking the Overview page for origination requests awaiting
review.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and `GET /v1/loan-book/submissions?status=InReview`
returns at least one in-review submission.

**Steps:**

1. Navigate to `http://localhost:5174/` (Overview) while authenticated.
2. Scroll below the Capital Allocation card.

**Expected outcomes:**

- A "Needs Attention" heading renders below the Capital Allocation card, inside the same white
  card surface.
- An "Origination" group header renders below the heading (uppercase, small caps label).
- One row renders per in-review submission, each showing:
  - A lightbulb icon inside a navy circle.
  - A title in the form `"<originator friendly name> — <commodity>: new request"` (e.g.
    "Open Mineral — Copper Concentrate: new request") — the friendly name from the submitted
    payload, NOT the submitter's wallet address.
  - A subtitle in the form `"<commodity> · <corridor> · submitted <date>"` (corridor rendered
    with an arrow, e.g. "PE → CN"; date as day + short month, e.g. "18 Jun").
  - A right-aligned "Review" button.

---

## Story 2: The "Review" button is present but inert

**Persona:** Trustee operator inspecting the Needs Attention row's action button.

**Pre-conditions:** Signed in; at least one in-review submission is present (per Story 1).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Locate a Needs Attention row's "Review" button.
3. Click the button.

**Expected outcomes:**

- The button reads "Review", styled as a solid navy button with white text (per Figma — no
  dimmed/disabled visual treatment).
- Clicking it does nothing — no navigation occurs, no action fires.
- The button is marked disabled/inert for assistive technology (accessible name conveys it is
  not yet available), consistent with the origination page's own inert Review button pattern.

---

## Story 3: The Needs Attention section is entirely absent when there are no in-review submissions

**Persona:** Trustee operator viewing the Overview page when the origination pipeline has no
pending reviews.

**Pre-conditions:** Signed in; `GET /v1/loan-book/submissions?status=InReview` returns an empty
array.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the area below the Capital Allocation card.

**Expected outcomes:**

- No "Needs Attention" heading, no "Origination" group header, and no rows render anywhere on
  the page — the whole section is omitted, not just the rows.
- The Capital Allocation card still renders normally above it.

---

## Story 4: Missing/malformed submission fields degrade gracefully, never fabricated

**Persona:** Trustee operator viewing an in-review submission whose payload has an incomplete
`loan_data` (e.g. missing `originator` or `corridor`).

**Pre-conditions:** Signed in; the backend returns an in-review submission with
`loan_data.originator`, `loan_data.commodity`, or `loan_data.corridor` missing/empty.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the affected row's title and subtitle.

**Expected outcomes:**

- A missing friendly originator name or commodity renders as "—" in the title rather than a
  blank, `undefined`, or crash.
- A missing corridor is dropped cleanly from the subtitle (no bare "—" segment in the middle
  of the joined string) rather than fabricated.
- The row still renders (no crash) — the rest of the page is unaffected.
