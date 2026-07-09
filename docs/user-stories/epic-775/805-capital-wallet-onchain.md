# User Stories: #805 — Trustee Overview: read Capital Wallet balance directly from the Stellar contract + fold into total

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#805](https://github.com/eq-lab/pipeline/issues/805)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

Extends the Overview page's Capital Allocation card (built in #797, extended in #807). The
Capital Wallet bucket (`buckets.capital_wallet`) is still `null` from
`GET /v1/capital-allocation` — this issue reads its USDC balance **directly from the Stellar
contract** (the existing USDC custody account, `usdc.balance(ENV.STELLAR_USDC_CUSTODY_ID)`) as a
real, interim, on-chain source, renders it as the `capital_wallet` legend value, and folds it
into the displayed total under a documented double-count guard (see
`docs/exec-plans/tech-debt-tracker.md` TD-41). A human-requested scope addition (Figma node
`4116:8961`) also adds a per-bucket percentage pill to each legend row, computed against the
same guarded total — a deliberate, explicitly-approved exception to the "no client-computed
percentages" rule from #797/TD-39.

Trust account (`trust_account`) is explicitly **out of scope** for this issue (deferred — no
account address confirmed yet).

---

## Story 1: Capital Wallet legend value shows the real on-chain USDC balance when the backend bucket is not yet indexed

**Persona:** Trustee operator checking the protocol's capital allocation at a glance.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in. `GET /v1/capital-allocation` returns `buckets.capital_wallet:
null` (current backend reality). The Stellar env vars are configured
(`VITE_STELLAR_RPC_URL`, `VITE_STELLAR_USDC_ID`, `VITE_STELLAR_USDC_CUSTODY_ID`) and the custody
account is NOT the USDC issuer (a real, funded custody balance).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Wait for the Capital Allocation card to finish loading.
3. Observe the "Capital Wallet" row in the legend.

**Expected outcomes:**

- The Capital Wallet row shows a real, non-"—" dollar figure (e.g. `$8.4M`) sourced from a live
  Soroban `usdc.balance()` read against the configured custody account — verify via the Network
  tab that a Soroban RPC `simulateTransaction` call actually returns a result; this is never a
  fabricated or hardcoded value.
- If the backend `capital_wallet` bucket is later populated (non-`null`), the legend shows the
  **backend** value instead, not the on-chain read — the on-chain source is only a fallback.

---

## Story 2: Displayed total folds in the on-chain Capital Wallet balance, guarded against double-counting

**Persona:** Trustee operator wanting an accurate total capital figure without waiting on the
backend to index every bucket.

**Pre-conditions:** Same as Story 1 — `buckets.capital_wallet: null`, on-chain balance available.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Note the backend-only total that `deployed` alone would produce (e.g. `$96,000,000`).
3. Observe the card's big total figure once the on-chain read resolves.

**Expected outcomes:**

- The displayed total equals `backend total + on-chain Capital Wallet balance` (e.g.
  `$96,000,000 + $8,400,000 = $104,400,000`), not the backend-only total.
- If the backend's `capital_wallet` bucket is later populated (non-`null`), the total reverts to
  the backend's own total as-is — the on-chain balance is NOT added a second time (double-count
  guard).
- If the backend `total` is `null` but the on-chain balance is known, the total shows the
  on-chain balance alone as the sole known real figure (not `—`).
- If neither the backend total nor the on-chain balance is known, the total shows `—` — never a
  fabricated number.

---

## Story 3: A failed or unconfigured on-chain read degrades only the Capital Wallet value, not the whole card

**Persona:** Trustee operator on a page load where the custody account happens to be
misconfigured (e.g. still pointing at the USDC issuer) or the Soroban RPC is temporarily
unreachable.

**Pre-conditions:** Signed in; `GET /v1/capital-allocation` succeeds and returns
`buckets.capital_wallet: null`, but the on-chain `usdc.balance()` read fails or returns the
i64-max issuer sentinel (~9.2 × 10¹⁸).

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated, with the on-chain read failing.
2. Observe the Capital Allocation card.

**Expected outcomes:**

- The card still renders normally (total, bar, other legend rows, provenance chips) — it does
  NOT show the card-level error surface.
- The Capital Wallet legend value shows `—`, never a garbage ~$922B figure (the sentinel guard)
  and never a stale/fabricated number.
- The displayed total falls back to the backend total alone (no on-chain addend).

---

## Story 4: Each legend row shows its percentage of the displayed total (Figma node `4116:8961`)

**Persona:** Trustee operator wanting a quick sense of each bucket's relative share of total
capital.

**Pre-conditions:** Signed in; the Capital Allocation card has finished loading with at least
one populated bucket.

**Steps:**

1. Navigate to `http://localhost:5174/` while authenticated.
2. Wait for the Capital Allocation card to finish loading.
3. Observe each legend row (e.g. "T-Bills (USYC) $4.64M").

**Expected outcomes:**

- Each row with a known bucket value shows a small pill — a colored dot (matching the row's own
  legend color) followed by a whole-percent figure (e.g. `4%`) — immediately before the label and
  dollar value.
- The percentage equals `bucket_value ÷ displayed_total` (the SAME total from Story 2, i.e.
  including the on-chain Capital Wallet fold-in when applicable), rounded to the nearest whole
  percent.
- Percentages are independently rounded per row and are **not** normalized to sum to 100 — e.g.
  `7% + 4% + 1% + 83% + 4% = 99%` is expected and correct, matching the Figma reference.
- A row whose bucket value is `null`/unknown (rendering `—` for its dollar value) shows **no**
  percentage pill at all — never a fabricated `0%`. If the total itself is unknown, no row shows
  a percentage.

---

## Out of scope for this issue

- **Trust account** (`trust_account`) — deferred; no on-chain account address confirmed yet. The
  legend row still renders `—` until a future issue.
- The `in_transit`, `deployed`, and `tbills` buckets' underlying data sources — unchanged, still
  sourced entirely from `GET /v1/capital-allocation`.
- The inert allocation bar's segment widths — still non-proportional/equal-width placeholders
  (TD-39); this issue only adds percentages to the legend text, not the bar.
- Any backend change to `capital_allocation.rs` — it still returns `capital_wallet: null`; the
  real indexing work is tracked separately and, once shipped, makes the on-chain read and the
  total/percentage client-side arithmetic in this issue a no-op (TD-41).
- The reconciliation drift text and provenance chips (#807) — unchanged.
