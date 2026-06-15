# User stories — #563: Connect Wallet modal: full-viewport two-pane layout

Issue: https://github.com/eq-lab/pipeline/issues/563
Epic: #556 (Connect page)
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

## Stories

### S1 — Desktop: modal fills the full viewport

**Given** a desktop viewport (≥ 1024 px wide)
**When** the user opens the Connect Wallet modal (e.g. by clicking "Connect Wallet" in the top bar)
**Then** the modal overlay covers the entire viewport with no visible scrim/backdrop margin,
and the left pane (connect content) and right pane (image) form two equal full-height columns.

### S2 — Desktop: no rounded card

**Given** a desktop viewport
**When** the Connect Wallet modal is open
**Then** the modal panel has no rounded corners (no card-style border radius).

### S3 — Desktop: close button dismisses the modal

**Given** the modal is open
**When** the user clicks the × (Close) button at the top right
**Then** the modal closes.

### S4 — Escape key dismisses the modal

**Given** the modal is open
**When** the user presses the Escape key
**Then** the modal closes.

### S5 — No click-outside dismissal

**Given** the modal is open in full-viewport mode
**When** the user clicks anywhere outside the left-pane content (e.g. on the right image pane)
**Then** the modal does NOT close (dismissal is via × and Escape only).

### S6 — Mobile: single-column full-viewport layout

**Given** a mobile viewport (< 1024 px wide)
**When** the Connect Wallet modal is open
**Then** the modal fills the full viewport as a single column (left/connect pane only);
the right image pane is not visible.

### S7 — Left pane is scrollable on short viewports

**Given** the modal is open on a viewport shorter than the left-pane content
**When** the user scrolls within the left pane
**Then** all wallet rows and controls are reachable.

### S8 — Tab switching and wallet list still work

**Given** the modal is open
**When** the user switches between EVM and Soroban tabs
**Then** the correct wallet list appears and "Show More" resets as before.
