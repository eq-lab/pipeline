# User Stories: #579 Connect Hero Asset Fix

Epic: #556 (Connect page)
Issue: https://github.com/eq-lab/pipeline/issues/579
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

## Context

The right-image panel of the `ConnectWalletModal` had two visual defects on desktop
viewports:

1. The hero asset (`connect-hero-ship.webp`) was mistakenly exported from the
   composited Figma pane, baking the "Pipeline" wordmark and the
   "Access real-world / yield on-chain" headline into the photo itself — resulting
   in duplicate text visible on screen.
2. The overlaid `<Logo>` wordmark rendered navy (`rgb(0,0,128)`) instead of white,
   because the `Logo` component applies `color` via an inline `style` attribute that
   beats the caller's `text-white` Tailwind class.

Both defects are fixed in this issue.

## Stories

### S1 — Single, text-free hero photo

**As** a visitor opening the Connect Wallet modal on a desktop viewport,
**I want** to see a clean, text-free aerial container-ship photograph filling the
right pane,
**so that** no "Pipeline" wordmark or headline text is baked into the background image.

**Acceptance criteria:**
- The hero `<img>` src resolves to the bare container-ship photo — no text or logo
  embedded in the image.
- The asset file (`packages/frontend/src/assets/connect-hero-ship.webp`) is under
  300 KB.
- The `<img>` retains `class="absolute inset-0 size-full object-cover"` so the
  photo covers the panel regardless of viewport height.

### S2 — White overlaid wordmark

**As** a visitor on desktop,
**I want** the "Pipeline" wordmark overlaid on the hero photo to render in white,
**so that** it is legible over the dark gradient scrim and the photo.

**Acceptance criteria:**
- The `<Logo>` inside `RightImagePanel` computes to pure white
  (`rgb(255, 255, 255)`) — not the brand-navy token.
- The default `<Logo>` color at all other call sites remains brand navy
  (`var(--color-pipeline-brand)` / `#000080`).

### S3 — Gradient scrim keeps text legible

**As** a visitor on desktop,
**I want** the dark gradient scrim in the upper-left of the right panel to ensure
both the white wordmark and the white headline stay legible over the photo,
**so that** no contrast issue appears with the replacement image.

**Acceptance criteria:**
- The existing scrim (`linear-gradient(160deg, rgba(0,0,0,0.45) …)`) is unchanged.
- On visual inspection, the white wordmark and the "Access real-world / yield
  on-chain" headline are clearly legible over the new photo at 1440×900.

## Test Mapping

| Story | Automated test | Location |
|-------|---------------|----------|
| S1 | `hero ?url import resolves to a non-empty string` | `ConnectWalletModal.test.tsx` |
| S1 | `renders the hero <img> with object-cover class` | `ConnectWalletModal.test.tsx` |
| S2 | `overlaid Logo SVG has explicit white color` | `ConnectWalletModal.test.tsx` |
| S2 | `caller style prop overrides the default navy — white wins` | `Logo.test.tsx` |
| S2 | `renders with default brand-navy CSS variable as inline style color` | `Logo.test.tsx` |
| S3 | Visual (ux-tester) | — |
