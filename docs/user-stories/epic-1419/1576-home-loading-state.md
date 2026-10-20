# User Stories: #1576 — Home: loading state while GET /v1/lps/me is in flight

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1576](https://github.com/eq-lab/pipeline/issues/1576) (TD-121, LP-read half)
Spec: [docs/frontend/dashboard-components.md#home-route](../../frontend/dashboard-components.md#home-route),
[docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md)

Desktop width (≥ 768px). To make the in-flight window observable, throttle the network in
DevTools (e.g. "Slow 3G") or add a breakpoint on the `GET /v1/lps/me` response. No Figma loading
frame exists; the skeleton is implementer-derived from the compact cards' heights.

---

## Story 1: A signed-in visitor sees a skeleton, not the legacy grid, until the LP read resolves

**Persona:** Signed-in LP with KYB not started, wallet disconnected (the state-2 population).

**Pre-conditions:** Signed in; network throttled.

**Steps:**

1. Reload `/` and watch the white dashboard panel while `GET /v1/lps/me` is pending.

**Expected outcomes:**

- The panel shows the 7-column grid with pulsing neutral blocks in the top-left (274px), the Balances column (two 164px blocks) and the third column (246px + 82px); Recent activity and the FAQ strip render as usual; no Buy / Sell / Stake / Connect / Sign Up / Verify control is shown.
- When the read resolves the blocks are replaced by the state-2 composition in place — no jump in the panel's height, and the old "Connect Wallet" promo + full-size cards never appear.

---

## Story 2: The same window with a connected wallet

**Persona:** Signed-in LP with a connected wallet and KYB under review.

**Pre-conditions:** As Story 1 with the wallet connected.

**Steps:**

1. Reload `/` with the network throttled.

**Expected outcomes:**

- The skeleton shows during the read (the LP read is independent of the wallet), then the state-3 composition replaces it in place.
- The mobile layout (narrow viewport) is unchanged: it never shows the skeleton.

---

## Story 3: A failed LP read still shows the legacy grid

**Persona:** Signed-in LP while the API is unreachable.

**Pre-conditions:** Signed in; block `GET /v1/lps/me` (DevTools request blocking) so it errors.

**Steps:**

1. Reload `/`.

**Expected outcomes:**

- After the request fails the panel renders the legacy composition (Connect Wallet promo or the portfolio card, full-size Start here / Earned / Stake cards), not the skeleton and not a KYB card — request failures do not imply an empty account.
