# User story — #607 Add card shadow to connect-wallet banner

**Issue:** https://github.com/eq-lab/pipeline/issues/607
**Epic:** #498 — Deposit/withdraw page
**Figma:** https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1994-7226&m=dev

---

## Background

The "Connect your wallet first" banner on `/deposit` and `/stake` was missing the asymmetric
border elevation effect (1 px top/left, 3 px right/bottom) that Figma node 1994-7226 specifies.
The fix adds `!border-t !border-r-[3px] !border-b-[3px] !border-l` to the banner Card on both
pages, matching the treatment already used for `ConnectWalletPromoCard` and
`PortfolioPlaceholderCard`.

---

## Stories

### S1 — Deposit page: banner has asymmetric border

**Given** I navigate to `/deposit?direction=deposit` without a connected wallet  
**Then** the "Connect your wallet first" banner (`data-testid="connect-wallet-banner"`) is
visible  
**And** the banner's right and bottom borders are visually thicker than its top and left borders
(3 px vs 1 px)

### S2 — Stake page: banner has asymmetric border

**Given** I navigate to `/stake` without a connected wallet  
**Then** the "Connect your wallet first" banner (`data-testid="connect-wallet-banner"`) is
visible  
**And** the banner's right and bottom borders are visually thicker than its top and left borders
(3 px vs 1 px)

### S3 — Other yellow cards are unaffected

**Given** I navigate to `/` without a connected wallet  
**Then** `ConnectWalletPromoCard` and `PortfolioPlaceholderCard` render with their own
border treatment unchanged

### S4 — Banner content and CTA are unchanged

**Given** I view either the deposit or stake page without a wallet connected  
**Then** the banner still shows the text "Connect your wallet first"  
**And** a "Connect" button is visible and activates the wallet connection flow when clicked
