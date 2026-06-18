# User Stories: #611 — Stake header heading renders bold; Figma uses regular weight

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#611](https://github.com/eq-lab/pipeline/issues/611)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake hero — node 1497-95313.

---

## Story 1: Stake page heading "Earn 8.42% p.a." renders at regular weight

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the heading text ("Earn 8.42% p.a.") rendered below the chart hero icon.

**Expected outcomes:**

- The heading uses **Besley Regular** (computed `font-weight: 400`).
- The heading does **not** appear bold (i.e. computed `font-weight` is not 700).
- Font size remains 28 px with 36 px line-height, matching Figma node 1497-95313.
