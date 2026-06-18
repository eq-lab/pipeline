# #573 Connect Wallet modal: content jumps vertically when switching EVM/Soroban tabs

Source: https://github.com/eq-lab/pipeline/issues/573  
Epic: #556 — Connect page

## Context

The left pane of the Connect Wallet modal previously used `justify-center` to vertically
center the content column (heading + tabs + wallet list). Because the EVM tab and the
Soroban tab render different numbers of wallet rows, the centered block re-centered on
every tab toggle, producing a ~60px vertical jump in the heading and tab bar.

The fix changes `justify-center` → `justify-start` on the left-pane wrapper, anchoring
the heading and tabs to the top. The horizontal centering (`items-center`) and the
existing padding (`py-10 lg:py-12`) are retained unchanged.

## User stories

### Story 1 — No vertical jump when switching tabs

**Given** the Connect Wallet modal is open  
**And** the EVM tab is active  
**When** the user clicks the Soroban tab  
**Then** the "Connect Wallet" heading and the tab bar remain at the same vertical position  
**And** only the wallet list below grows or shrinks

### Story 2 — No vertical jump when expanding "Show More"

**Given** the Connect Wallet modal is open  
**And** the Soroban tab is active (which shows a "Show More" button)  
**When** the user clicks "Show More"  
**Then** the "Connect Wallet" heading and the tab bar remain at the same vertical position  
**And** the additional wallet rows appear below

### Story 3 — Content scrollable on short viewports

**Given** the Connect Wallet modal is open on a viewport shorter than the content  
**When** the user scrolls inside the left pane  
**Then** the wallet rows below the fold become reachable

### Story 4 — Heading remains horizontally centered

**Given** the Connect Wallet modal is open  
**Then** the content column (max-width 400px) is horizontally centered within the left pane  
**And** the fix does not affect horizontal alignment
