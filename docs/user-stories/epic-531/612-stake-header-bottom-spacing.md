# User Stories: #612 — Stake header bottom spacing too small vs deposit page

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#612](https://github.com/eq-lab/pipeline/issues/612)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake hero — node 1497-95313.

---

## Story 1: Stake header has adequate bottom spacing matching Deposit page

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the vertical gap between the stake header (chart icon + "Earn 8.42% p.a." heading) and the conversion card below it.
3. Open `/deposit` in the same browser.
4. Observe the vertical gap between the deposit header (PLUSD icon + "1:1 Conversion" heading) and the conversion card below it.

**Expected outcomes:**

- The gap between the stake header and conversion card is approximately 32 px (matching `mb-8`).
- The gap is visually consistent with the gap on the Deposit page.
- The stake header is not noticeably closer to the card than on the Deposit page.
