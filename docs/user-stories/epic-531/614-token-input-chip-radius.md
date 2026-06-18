# User Stories: #614 — Token input chips use pill radius; Figma uses 4px (shared with deposit)

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#614](https://github.com/eq-lab/pipeline/issues/614)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake init state — node 1497-95326.

---

## Story 1: Stake page chips render with 4px corner radius

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.
- Wallet is connected with a non-zero PLUSD balance.

**Steps:**

1. Open `/stake` in a browser.
2. Locate the row of quick-amount chips (`data-testid="token-input-chips"`) — the
   25% / 50% / 75% / Max buttons inside the conversion card.
3. Inspect the visual shape of any chip button.

**Expected outcomes:**

- Each chip button has slightly-rounded corners (approximately 4 px radius).
- The chips are **not** full-pill / capsule shaped (no 9999 px border-radius).

---

## Story 2: Deposit page chips render with 4px corner radius

**Persona:** Any user visiting `/deposit`.

**Pre-conditions:**

- App is running at `/deposit`.
- Wallet is connected with a non-zero USDC balance.

**Steps:**

1. Open `/deposit` in a browser.
2. Locate the row of quick-amount chips (`data-testid="token-input-chips"`) inside
   the conversion card.
3. Inspect the visual shape of any chip button.

**Expected outcomes:**

- Each chip button has slightly-rounded corners (approximately 4 px radius).
- The chips are **not** full-pill / capsule shaped.
- The chip styling matches the Stake page chips (same shared component).
