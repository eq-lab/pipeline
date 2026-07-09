# User Stories: #807 — Trustee Overview: add reconciliation drift text + provenance chips (mock)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#807](https://github.com/eq-lab/pipeline/issues/807)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

This adds two **static, presentation-only, mock** pieces of chrome to the existing Overview
page's Capital Allocation card (built in #797, merged): a green reconciliation-drift string in
the card header, and a row of four provenance chips below the legend. Both were explicitly
deferred in #797 ("no backing field") and are added here as interim static mock text per an
explicit requester decision — no new API, no computed values, no change to the real
`GET /v1/capital-allocation` total/bucket rendering. Visual fidelity (spacing, colors, radii) is
verified separately by the QA agent's Figma comparison.

---

## Story 1: Capital Allocation header shows the static reconciliation drift text

**Persona:** Trustee operator checking the protocol's capital allocation at a glance.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in, and the backend `GET /v1/capital-allocation` returns any
response (loading, error, full data, or partial data).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Observe the Capital Allocation card's header row, to the right of the "Capital Allocation"
   label.

**Expected outcomes:**

- The header row shows the green, bold, letter-spaced text
  `RECONCILES TO PLUSD BACKING · DRIFT < 0.01%`, right-aligned opposite the "Capital Allocation"
  label.
- This text is a static mock string — it is not derived from any API field and does not change
  based on the actual bucket/total values returned.
- The drift text renders in every card state (loading skeleton, error surface, full data, partial
  data) because it lives in the always-rendered header row, not the data-dependent body.

---

## Story 2: Capital Allocation card shows four static provenance chips below the legend

**Persona:** Trustee operator wanting a quick visual sense of where each number in the card comes
from.

**Pre-conditions:** Signed in; the backend `GET /v1/capital-allocation` request has resolved
successfully (loaded, non-error state) — chips only render once the card exits its loading/error
states.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Wait for the Capital Allocation card to finish loading.
3. Observe the row of pills directly below the per-bucket legend.

**Expected outcomes:**

- Exactly four pills render, in this order:
  1. `on-chain balance · current block` (blue dot + text, brand-token colour)
  2. `Relayer API · refreshed 2m ago` (green dot + text, positive-token colour)
  3. `Trustee feed · reconciled today` (amber/olive dot + text)
  4. `stale values are labeled inline` (red dot + text)
- Each pill is a small rounded rectangle with a colour dot on the left and a label, in a
  subtle-fill / thin-border style matching its dot colour.
- These four strings are static mock text — they are not derived from any API field and do not
  reflect the actual freshness or source of the displayed data.
- The pill row wraps onto multiple lines at narrow widths rather than overflowing or clipping.

---

## Story 3: Provenance chips do not render while the card is loading or erroring

**Persona:** Trustee operator loading the Overview page on a slow connection, or hitting an API
failure.

**Pre-conditions:** Signed in; the `GET /v1/capital-allocation` request is either delayed (loading
state) or fails (error state).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated, while the request is in flight or
   failing.
2. Observe the Capital Allocation card.

**Expected outcomes:**

- While loading: the card shows its skeleton (per #797 Story 4) and the header's drift text, but
  **no** provenance chips — they belong to the loaded-data branch, visually anchored under the
  legend.
- On error: the card shows its inline error surface (per #797 Story 5) and the header's drift
  text, but **no** provenance chips.
- Once the request resolves successfully, the chips appear (Story 2) alongside the real total,
  bar, and legend.

---

## Out of scope for this issue (unchanged from #797 / covered elsewhere)

- Cash in Transit card, Active Deal card, and the Needs Attention section — not part of this
  issue (Needs Attention is #799).
- Bar percentages or any change to the placeholder allocation bar's rendering.
- Any change to `GET /v1/capital-allocation` wiring, `useCapitalAllocationCard.ts`, or the real
  total/bucket values — the data path from #797 is untouched.
- Wiring the drift text or provenance chips to real backend data — tracked as tech debt
  (`docs/exec-plans/tech-debt-tracker.md`, TD-40) for a future follow-up.
