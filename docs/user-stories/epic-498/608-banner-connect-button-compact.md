# User story — #608: Match connect-wallet-banner Connect button to Figma (compact size)

**Issue:** https://github.com/eq-lab/pipeline/issues/608
**Epic:** #498 — Deposit/withdraw page
**Figma:** https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1994-7226&m=dev

## Context

The yellow "Connect your wallet first" banner on `/deposit` and `/stake` contains a dark
"Connect" button. Figma node 1994-7226 shows this button at 32px tall (compact), while
the app was rendering the default 48px primary-dark button. The fix introduces a `compact`
size variant on the shared `Button` primitive and applies it on both pages.

## Stories

### S1 — Deposit page — banner button renders at compact height

**Given** the user navigates to `/deposit?direction=deposit` without a connected wallet.
**When** the wallet-not-connected banner appears.
**Then** the "Connect" button inside the banner is visually compact (approximately 32px tall,
noticeably shorter than the 48px standard button) and has the same dark fill as described
by Figma node 1994-7226.

### S2 — Stake page — banner button renders at compact height

**Given** the user navigates to `/stake` without a connected wallet.
**When** the wallet-not-connected banner appears.
**Then** the "Connect" button inside the banner is visually compact (approximately 32px tall)
with the same dark fill.

### S3 — Compact button does not affect the header "Connect Wallet" button

**Given** the user views any page without a connected wallet.
**When** observing the `TopBar` "Connect Wallet" button.
**Then** the header button retains its full 48px height and is unaffected by the compact
size change (it uses `variant="primary-dark"` without `size="compact"`).

### S4 — Compact button triggers wallet connection

**Given** the user is on `/deposit` or `/stake` without a connected wallet and the banner
is visible.
**When** the user clicks the "Connect" button in the banner.
**Then** the wallet connection flow is initiated (AppKit modal opens), identical to clicking
the header "Connect Wallet" button.

### S5 — Banner button retains correct border radius

**Given** the compact banner button is rendered.
**Then** its corner radius remains 4px (matching `--radius-pipeline-button` and the
resolved Figma token `radius/radius-s = 4`). The radius is not changed to 8px.
