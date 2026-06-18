# User Stories: #610 — Stake header icon differs from Figma

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#610](https://github.com/eq-lab/pipeline/issues/610)

Viewport: 402×874 (mobile) and 1280×800 (desktop).

Figma references: Stake hero — node 1497-95313; Activity hero — node 1497-94912.

---

## Story 1: Stake page hero icon circle renders with the correct muted-fill color

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the 72×72 circular icon badge above the "Stake" heading (`data-testid="stake-header"`).

**Expected outcomes:**

- The circle background is a warm muted gray matching Figma fill-test/primary
  (`#bfbdbb1f` = `rgba(191, 189, 187, 0.12)`) — driven by the
  `--color-pipeline-fill-muted` CSS token.
- The circle is **not** the darker `--color-pipeline-surface-muted` tone.

---

## Story 2: Stake page chart glyph renders as a light muted gray

**Persona:** Any user visiting `/stake`.

**Pre-conditions:**

- App is running at `/stake`.

**Steps:**

1. Open `/stake` in a browser.
2. Observe the bar-chart icon glyph inside the 72×72 hero circle.

**Expected outcomes:**

- The chart glyph appears as a light muted gray (effective `rgb(56, 55, 53, 0.3)`)
  matching Figma content-test/tertiary — driven by `--color-pipeline-ink-subtle`.
- The glyph is **not** solid near-black (which would indicate the full
  `--color-pipeline-ink` token).

---

## Story 3: Activity page hero icon is unaffected by the change

**Persona:** Any user visiting `/transactions`.

**Pre-conditions:**

- App is running at `/transactions`.

**Steps:**

1. Open `/transactions` in a browser.
2. Observe the 72×72 circular arrow-clock icon badge above the "Activity" heading.

**Expected outcomes:**

- The circle background uses the same muted fill as the stake hero
  (`--color-pipeline-fill-muted`).
- The arrow-clock glyph renders as a muted gray (the SVG bakes `fill-opacity="0.3"`,
  so the ink token produces the correct ~0.3 effective opacity).
- No double-opacity / overly faint rendering of the arrow-clock glyph.
