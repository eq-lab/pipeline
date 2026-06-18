# User Stories: #613 — Stake input section gap between tabs and input should be 2px

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#613](https://github.com/eq-lab/pipeline/issues/613)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake input card — node 1497-95317.

---

## Story 1: Stake/Unstake tabs sit 2px above the PLUSD input box

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the vertical gap between the Stake/Unstake tab row and the PLUSD input box inside the input card.

**Expected outcomes:**

- The gap between the tabs and the input box is **2px** (matching Figma node 1497-95317).
- The gap is not 16px (the previous incorrect value).
