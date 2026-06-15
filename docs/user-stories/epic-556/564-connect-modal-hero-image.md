# User stories — #564: Connect Wallet modal: right pane uses real wordmark and hero photo

Issue: https://github.com/eq-lab/pipeline/issues/564
Epic: #556 (Connect page)
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

## Stories

### S1 — Desktop: right pane shows the real Pipeline wordmark

**Given** a desktop viewport (≥ 1024 px wide)
**When** the user opens the Connect Wallet modal
**Then** the right pane displays the real Pipeline wordmark (white paths on the photo background)
and does NOT display a text-based or font-rendered replica of the wordmark.

### S2 — Desktop: right pane shows the hero photo full-bleed

**Given** a desktop viewport (≥ 1024 px wide)
**When** the user opens the Connect Wallet modal
**Then** the right pane displays the aerial container-ship photograph covering the full pane
(`object-cover`, `absolute inset-0`), replacing the CSS gradient placeholder.

### S3 — Desktop: white headline remains legible over the photo

**Given** a desktop viewport with the hero photo displayed
**When** the user views the Connect Wallet modal
**Then** the "Access real-world / yield on-chain" headline in white is readable against the photo
(a dark gradient scrim is applied top-left to maintain contrast).

### S4 — Mobile: right pane is not visible

**Given** a mobile viewport (< 1024 px wide)
**When** the user opens the Connect Wallet modal
**Then** the right pane (photo + wordmark + headline) is not visible on screen
(hidden below the lg breakpoint, `aria-hidden`).
