# User Stories: #814 — Protocol Dashboard: In-Origination tab — display the Figma field set (frontend-only)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#814](https://github.com/eq-lab/pipeline/issues/814)
Plan: `docs/exec-plans/active/issue-814-in-origination-figma-field-set.md`
Figma reference: [node 4116-9155](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=4116-9155&m=dev) (the Trustee Origination page frame — the same field set implemented for #813)

Re-maps the Loan Book panel's **In Origination** tab from the Active-Loans-shaped columns
(Borrower/Commodity · Principal · Collateral · LTV · Duration · Rate · Protection · Status,
built in #755) to the Figma `4116-9155` field set: Originator · Commodity · Facility · Corridor
· Rate · Maturity · Submitted · Status — the same eight columns the Trustee Origination page
(#813) shows, sourced from the same `GET /v1/loan-book/submissions` payload. The **Active Loans**
tab and its `LoanBookTable` 7-column layout are unchanged. Per the human-confirmed Open-Question
resolutions on issue #814:

1. The Figma "Commodity · valuation" sub-line is omitted entirely (no valuation-mode source for
   pre-mint submissions; mirrors #813) — the Commodity cell shows only the commodity name.
2. Status renders as the dashboard's existing simple color-coded label (green `Approved` / red
   `Rejected` / amber `InReview` / muted otherwise) — the trustee's Review-button / "Approved &
   minted" pill treatment is **not** adopted (the LP app is read-only for submissions, no review
   route exists).
3. Table styling reuses the dashboard Loan Book table's existing visual language (12px caption
   headers, `border-collapse`, `overflow-x-auto`) — the trustee's grid layout is **not** adopted.

Visual fidelity (spacing, colors, radii) beyond these decisions is verified separately by the QA
agent's Figma comparison.

---

## Story 1: In Origination tab renders the new eight-column field set

**Persona:** LP viewing the Protocol Dashboard's Loan Book panel.

**Pre-conditions:** Dev server running; `GET /v1/loan-book/submissions` returns at least one
submission with a complete `loan_data` payload.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book/submissions",
     JSON.stringify([
       {
         id: 1,
         status: "InReview",
         reason: null,
         originator: "0xabc",
         created_at: "2026-06-18T10:00:00Z",
         updated_at: "2026-06-18T10:00:00Z",
         loan_data: {
           to: "0xdef",
           metadata_uri: "ipfs://meta",
           originator: "Auric Andes",
           borrower_id: "borrower-1",
           commodity: "Gold pyrite concentrate",
           corridor: "PE-CN",
           governing_law: "England",
           economics: {
             original_facility_size: "3500000.000000",
             original_senior_tranche: "3000000.000000",
             original_equity_tranche: "500000.000000",
             original_offtaker_price: "3500000.000000",
             senior_interest_rate_bps: 1400,
             origination_date: 1750000000,
             original_maturity_date: 1797292800,
           },
           initial_ccr: 1500000,
           initial_location: {
             location_type: "Vessel",
             location_identifier: "MV Example",
             tracking_url: "https://example.com",
             updated_at: 1750000000,
           },
         },
       },
     ]),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Click the **In Origination** tab inside the Loan Book panel.

**Expected outcomes:**

- The table header row shows exactly these eight columns, in order: **Originator, Commodity,
  Facility, Corridor, Rate, Maturity, Submitted, Status**.
- None of the Active-Loans-shaped headers (**Borrower / Commodity, Principal, Collateral, LTV,
  Duration, Protection**) appear on this tab.
- The row shows: Originator **"Auric Andes"** (from `loan_data.originator`, not the top-level
  submitter address `"0xabc"`); Commodity **"Gold pyrite concentrate"** with **no** valuation
  sub-line beneath it; Facility **"$3,500,000"** (fully expanded, not compact `"$3.5M"`); Corridor
  **"PE → CN"** (hyphen rendered as an arrow); Rate **"14.0%"**; Maturity **"15 Dec 2026"**;
  Submitted **"18 Jun"**; Status **"InReview"** in amber.
- The Active Loans tab, when selected, still shows its original 7-column set unaffected.

---

## Story 2: Missing/malformed `loan_data` fields render "—", never a fabricated value

**Persona:** LP viewing a submission whose payload has an incomplete or malformed `loan_data`.

**Pre-conditions:** Dev server running; the submissions response has one entry with
`economics` missing or `senior_interest_rate_bps` non-numeric.

**Steps:**

1. Set a submissions mock where one entry's `loan_data.economics` is missing (or
   `senior_interest_rate_bps` is a non-numeric value) and `commodity`/`corridor` are empty
   strings.
2. Navigate to `http://localhost:3000/dashboard` and select the In Origination tab.

**Expected outcomes:**

- Every field that cannot be read from `loan_data` renders **"—"** — never `$0`, `0.0%`, a blank
  cell, or a fabricated/inferred value.
- The row still renders (no crash, no blank row) — only the affected cells show "—".
- An unrecognized or empty `status` string renders as "—"/a neutral fallback rather than
  crashing or defaulting to one of the known status colors.

---

## Story 3: Status column keeps the dashboard's simple color-coded label (no Review button / pill)

**Persona:** LP scanning submission statuses at a glance.

**Pre-conditions:** Dev server running; the submissions response includes one row of each
status: `InReview`, `Approved`, `Rejected`.

**Steps:**

1. Set a submissions mock with three rows, one per status.
2. Navigate to `http://localhost:3000/dashboard` and select the In Origination tab.
3. Observe the Status cell for each row.

**Expected outcomes:**

- `InReview` renders as amber text reading **"InReview"** — no navy "Review" button.
- `Approved` renders as green text reading **"Approved"** — no "Approved & minted · &lt;date&gt;"
  pill.
- `Rejected` renders as red text reading **"Rejected"** — no pill, no hover tooltip.
- Clicking anywhere on a row does not navigate anywhere (the LP app has no submission-review or
  origination-detail route).

---

## Story 4: Loading / error / empty states still render per tab

**Persona:** LP viewing the Loan Book panel while the submissions request is slow, failing, or
returns no rows.

**Pre-conditions:** Dev server running.

**Steps:**

1. **Loading:** No submissions mock key set and the real API is unreachable/slow; navigate to
   `http://localhost:3000/dashboard`, select In Origination while the request is in flight.
2. **Error:** `GET /v1/loan-book/submissions` returns a non-2xx response; select In Origination.
3. **Empty:** Submissions mock returns `[]`; select In Origination.

**Expected outcomes:**

- Loading: the In Origination tab body shows a loading state; the rest of the panel (summary
  cards, Active Loans tab) is unaffected.
- Error: the tab body shows an inline error with a Retry action; clicking Retry re-fires the
  query.
- Empty: the tab body shows an empty-state caption ("No loans in origination") — no table.
- In all three cases, the tab's count badge and the Active Loans tab remain fully functional.

---

## Story 5: Corridor arrow substitution and full-width layout

**Persona:** LP viewing the In Origination table on a narrow viewport.

**Pre-conditions:** Dev server running; a submission with `loan_data.corridor` containing a
hyphen (e.g. `"PE-CN"`).

**Steps:**

1. Set the Story 1 mock data.
2. Navigate to `http://localhost:3000/dashboard`, select In Origination.
3. Resize the viewport below 768px width.

**Expected outcomes:**

- The Corridor cell shows **"PE → CN"** (hyphen replaced by an arrow glyph) — the underlying data
  is unchanged, only the separator glyph differs.
- At narrow widths, the table scrolls horizontally inside an `overflow-x-auto` wrapper rather
  than wrapping, clipping, or reflowing into stacked cards.
