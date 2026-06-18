# User Stories — Issue #575: Connect Wallet modal right-pane headline anchored to top

Parent epic: [#556 Connect Wallet modal](https://github.com/eq-lab/pipeline/issues/556)
Issue: [#575](https://github.com/eq-lab/pipeline/issues/575)
Figma: node 2858-57637

---

## Story 1 — Right-pane headline is positioned at the top of the pane, directly below the wordmark

**As a** desktop user opening the Connect Wallet modal,
**I want** to see the "Access real-world / yield on-chain" headline near the top of the right pane, directly below the Pipeline wordmark,
**so that** the layout matches Figma node 2858-57637 (wordmark at y≈48, headline at y≈104, 24 px gap).

### Acceptance criteria

- At desktop viewport (≥ 1024 px) the right-pane overlay `<p>` headline is visually near the top of the right pane, not at the bottom.
- The Pipeline wordmark appears first (top-left), and the headline appears directly below it with approximately 24 px gap.
- The rest of the pane below the headline is occupied by the hero photo, not by the headline pushed down.

### Steps

1. Open the app at ≥ 1024 px viewport width.
2. Click "Connect Wallet" in the TopBar to open the modal.
3. Observe the right pane: the Pipeline wordmark and headline should appear stacked near the top-left.

**Expected:** Wordmark at top-left, headline directly below with ~24 px gap, remainder of pane is empty photo.
**Previously broken:** The content wrapper used `justify-between`, which pushed the headline to the bottom of the pane (measured y≈631 in a 727 px-tall pane).
