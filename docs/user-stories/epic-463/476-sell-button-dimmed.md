# #476 — StartHereCard Sell button dimmed style

**Epic:** #463 Mobile home page  
**Issue:** https://github.com/eq-lab/pipeline/issues/476  
**Figma:** https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1989-8292 (node 1989:9022)

## Background

On mobile, the Sell button in `StartHereCard` should be visually de-emphasized (32% opacity)
when the user has no PLUSD to sell — both when the wallet is disconnected and when it is
connected but has a zero balance. Only when the wallet is connected and holds a positive
PLUSD or sPLUSD balance should Sell render at full opacity and be interactive.

The `secondary` Button variant already applies `disabled:opacity-[0.32]` via Tailwind.
The fix ensures the `disabled` prop is set correctly in both the disconnected and
empty-balance states on mobile.

## User stories

### Story 1 — Wallet disconnected (mobile, < 768px)

**Given** the user opens the home page on a mobile viewport (< 768 px) without a connected wallet  
**Then** the StartHereCard is visible with a "Start here / Get PLUSD" heading  
**And** the Buy button is fully opaque and interactive  
**And** the Sell button is rendered at ~32% opacity (visually dimmed) and is not clickable

### Story 2 — Wallet connected, zero balances (mobile, < 768px)

**Given** the user is on a mobile viewport with a connected wallet but holds 0 PLUSD and 0 sPLUSD  
**Then** the StartHereCard shows the "Start here / Get PLUSD" heading  
**And** the Sell button is rendered at ~32% opacity and is not clickable

### Story 3 — Wallet connected, has PLUSD (mobile, < 768px)

**Given** the user is on a mobile viewport with a connected wallet and a positive PLUSD balance  
**Then** the StartHereCard shows the "PLUSD Balance" heading with the formatted balance  
**And** the Buy button is fully opaque and interactive  
**And** the Sell button is fully opaque and interactive

### Story 4 — Wallet connected, has sPLUSD (mobile, < 768px)

**Given** the user is on a mobile viewport with a connected wallet and a positive sPLUSD balance  
**Then** the StartHereCard shows the "PLUSD Balance" heading  
**And** both Buy and Sell buttons are fully opaque and interactive

### Story 5 — Desktop viewport (≥ 768px)

**Given** the user opens the home page on a desktop viewport (≥ 768 px)  
**Then** the StartHereCard in the desktop grid does not apply any opacity dimming to Sell  
**And** the Sell button is interactive regardless of wallet state

## Test notes

- Opacity check: inspect the Sell `<button>` element and confirm `opacity` resolves to approximately 0.32 in Stories 1 and 2.
- Confirm `disabled` attribute is present on the button element in Stories 1 and 2.
- Confirm `disabled` attribute is absent in Stories 3, 4, and 5.
