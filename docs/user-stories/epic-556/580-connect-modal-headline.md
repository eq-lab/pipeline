# User Stories — Issue #580: Connect modal right pane overlay headline size and position

Parent epic: [#556 Connect page](https://github.com/eq-lab/pipeline/issues/556)
Issue: [#580](https://github.com/eq-lab/pipeline/issues/580)
Figma: node 2858-57637

---

## Story 1 — Overlay headline renders at Heading-L (48 px) near the top of the right pane

**As a** desktop user opening the Connect Wallet modal,
**I want** to see the "Access real-world / yield on-chain" headline at 48 px Besley, positioned below the Pipeline wordmark near the top of the right pane,
**so that** the layout matches Figma node 2858-57637.

### Acceptance criteria

- At desktop viewport (≥ 1024 px) the right-pane overlay headline `<p>` has computed `font-size ≈ 48 px`.
- The headline is positioned near the top of the pane, directly below the Pipeline wordmark (not anchored to the bottom).
- The headline font-family is Besley (display font).
- The headline text is white and legible.

### Steps

1. Open the app at ≥ 1024 px viewport width.
2. Click "Connect Wallet" in the TopBar to open the modal.
3. Inspect the right-pane headline `<p>` element.

**Expected:** `font-size` ≈ 48 px, positioned below the wordmark near the top.
**Previously broken:** `--text-pipeline-heading-l` CSS variable was undefined, causing 16 px fallback; `justify-between` pushed the headline to the bottom.
