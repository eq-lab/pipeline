# User Stories — Issue #572: Connect Wallet modal heading-l token

Parent epic: [#556 Connect Wallet modal](https://github.com/eq-lab/pipeline/issues/556)
Issue: [#572](https://github.com/eq-lab/pipeline/issues/572)
Figma: node 2858-57637

---

## Story 1 — "Connect Wallet" heading renders at 48 px (Heading-L)

**As a** desktop user opening the Connect Wallet modal,
**I want** the "Connect Wallet" heading in the left pane to render at 48 px Besley Regular,
**so that** it matches the Figma heading-L specification.

### Acceptance criteria

- At desktop viewport (≥ 1024 px) the `h2#connect-wallet-modal-heading` element has computed `font-size ≈ 48 px` and `line-height ≈ 56 px`.
- The heading font-family is Besley (display font), weight Regular (400).
- The heading color is `#262524` (ink).

### Steps

1. Open the app at ≥ 1024 px viewport width.
2. Click "Connect Wallet" in the TopBar to open the modal.
3. Inspect the `h2#connect-wallet-modal-heading` element in the left pane.

**Expected:** `font-size` ≈ 48 px, `line-height` ≈ 56 px.
**Previously broken:** `--text-pipeline-heading-l` CSS variable was undefined, causing a 16 px fallback.

---

## Story 2 — Right-pane headline renders at 48 px (Heading-L)

**As a** desktop user opening the Connect Wallet modal,
**I want** the right-pane "Access real-world yield on-chain" overlay headline to render at 48 px Besley,
**so that** it matches the Figma heading-L specification.

### Acceptance criteria

- At desktop viewport (≥ 1024 px) the right-pane overlay `<p>` headline has computed `font-size ≈ 48 px` and `line-height ≈ 56 px`.
- The headline is white and legible over the hero background.

### Steps

1. Open the app at ≥ 1024 px viewport width.
2. Click "Connect Wallet" in the TopBar to open the modal.
3. Inspect the right-pane overlay headline `<p>` element.

**Expected:** `font-size` ≈ 48 px, `line-height` ≈ 56 px.
**Previously broken:** Same missing `--text-pipeline-heading-l` token caused 16 px fallback.
