# User Stories: #797 — Trustee: implement the Overview page (Figma 4116-8854)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#797](https://github.com/eq-lab/pipeline/issues/797)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This replaces the #786 placeholder body of the `/` Overview route with the real Overview page:
the "Overview" header and the Capital Allocation card wired to `GET /v1/capital-allocation`.
Per the human-confirmed scope decisions (2026-07-08, recorded in
`docs/exec-plans/active/issue-797-trustee-overview-page.md`), the reconciliation header,
provenance chips, percentages/proportional bar fill, header timestamp, standalone Cash-in-Transit
card, Active Deal card, and the Needs Attention section are all out of scope for this issue —
these stories only cover what #797 actually ships. Visual fidelity (spacing, colors, radii) is
verified separately by the QA agent's Figma comparison.

---

## Story 1: Overview page renders the header and Capital Allocation card with full data

**Persona:** Trustee operator checking the protocol's capital allocation at a glance.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and the backend `GET /v1/capital-allocation` returns a
response where every bucket and `total` are populated (e.g. `total: "115190000.000000"`).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the page header and the Capital Allocation card.

**Expected outcomes:**

- The page shows an "Overview" title. No timestamp is shown next to it (no `as_of`/
  `generated_at` field exists in any API response yet).
- A "Capital Allocation" card renders below the header with:
  - A large total value in fully-expanded whole-dollar format (e.g. `$115,190,000`).
  - A legend with five rows, each showing a coloured dot, a label, and a compact dollar value:
    Capital Wallet, In transit, Trust account, Deployed, T-Bills (USYC) (e.g. `$8.4M`, `$4.95M`,
    `$1.2M`, `$96M`, `$4.64M`).
  - No percentage labels anywhere on the card.
  - No green "RECONCILES TO PLUSD BACKING" header and no provenance chips ("on-chain balance ·
    current block", etc.) — these are not rendered.
- No "Cash in Transit" card, no "Active Deal" card, and no "Needs Attention" section appear
  anywhere on the page.

---

## Story 2: Capital Allocation card shows "—" for buckets the backend has not populated

**Persona:** Trustee operator viewing the Overview page while most of the backend's data sources
are still unindexed (today's actual backend state — only `deployed` is sourced).

**Pre-conditions:** Signed in; the backend returns a response where `total` and `buckets.deployed`
are populated but `capital_wallet`, `in_transit`, `trust_account`, and `tbills` are all `null`.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the Capital Allocation card's total and legend.

**Expected outcomes:**

- The total renders the formatted `total` value (not `$0`, not blank).
- The "Deployed" legend row shows its formatted compact value.
- The "Capital Wallet", "In transit", "Trust account", and "T-Bills (USYC)" legend rows each
  show `—` in place of a dollar value — never `$0` and never a blank/missing row.
- The placeholder allocation bar still renders (see Story 3) — it does not disappear or error
  out when some buckets are null.

---

## Story 3: Allocation bar is a styled placeholder, not a proportional/data-driven fill

**Persona:** Trustee operator visually scanning the allocation bar for a proportions overview.

**Pre-conditions:** Signed in; any Capital Allocation response (full or partial data).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the horizontal bar above the legend in the Capital Allocation card.

**Expected outcomes:**

- A horizontal segmented bar renders with five colour segments (matching the legend dot
  colours), styled per the Figma card.
- The segments are equal-width / inert — they are NOT sized proportionally to each bucket's
  share of the total (no `bucket/total` computation backs the bar). This holds regardless of
  how skewed the underlying bucket values are (e.g. even when `deployed` is 90%+ of `total`).
- No percentage text is rendered on or near the bar.

---

## Story 4: Capital Allocation card shows a loading skeleton, then resolves

**Persona:** Trustee operator loading the Overview page on a slow connection.

**Pre-conditions:** Signed in; the `GET /v1/capital-allocation` request is delayed.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated, while the request is in flight.
2. Observe the Capital Allocation card before the response resolves.
3. Wait for the response to resolve.

**Expected outcomes:**

- While loading, the card shows a token-styled skeleton in place of the total and legend (no
  flash of `—` or `$0` placeholders that could be mistaken for real data).
- Once the response resolves, the skeleton is replaced by the real total, bar, and legend
  (per Story 1 or 2, depending on the response payload).

---

## Story 5: Capital Allocation card shows an inline error surface when the request fails

**Persona:** Trustee operator viewing the Overview page while the API is unreachable or errors.

**Pre-conditions:** Signed in; `GET /v1/capital-allocation` returns a non-2xx response or the
request fails outright.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated, with the endpoint failing.
2. Observe the Capital Allocation card.

**Expected outcomes:**

- The card renders an inline error surface (not a blank card, not a silent failure) inside the
  card's boundary — the rest of the page (header) still renders normally.
- No total, bar, or legend rows render while the error surface is showing.
- The page does not crash; navigating away and back retries the request (the 30 s poll / query
  retry behavior applies).
