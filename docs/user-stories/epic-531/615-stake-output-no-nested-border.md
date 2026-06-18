# User Stories: #615 — token-amount-display has stray border and asymmetric padding

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#615](https://github.com/eq-lab/pipeline/issues/615)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake output section — node 1497-95327.

---

## Story 1: sPLUSD output row has no inner border box inside the conversion card

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the sPLUSD output row inside the conversion card (the lower half of the card, below the input).

**Expected outcomes:**

- The sPLUSD output row has **no inner border** — it renders flush inside the conversion card with no nested box.
- There is no `1px solid rgba(56,55,53,0.18)` border drawn around the output row.
- Spacing between the sPLUSD row and the Exchange rate / Network fee rows comes from the section's own padding, not from extra padding on the output row.

---

## Story 2: sPLUSD output row padding is symmetric

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Inspect the spacing above and below the sPLUSD output row inside the output section.

**Expected outcomes:**

- The output row does **not** have asymmetric padding (no 0 horizontal / 32px bottom self-padding).
- The card section's uniform `16px` padding provides all spacing, consistent with the Figma design.
