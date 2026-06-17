# User story: #598 — Stellar deposit minimum is 1 USDC

**Epic:** #498 — Deposit/withdraw page
**Issue:** https://github.com/eq-lab/pipeline/issues/598
**Status:** Initial

---

## Overview

The Stellar deposit flow uses a frontend constant for the minimum deposit
amount because the deployed Stellar DepositManager contract does not expose a
`min_deposit` getter. The product-approved temporary minimum is **1 USDC**
(previously 1,000 USDC). These stories verify the updated minimum is enforced
correctly in the UI.

---

## Stories

### S1 — Stellar deposit: amount above minimum shows normal state

**Given** the user has a Stellar wallet connected with a USDC balance of 10 USDC  
**And** the user navigates to `/deposit`  
**When** the deposit input shows the chain as Stellar  
**Then** the UI does not show a "below minimum" banner or chip  
**And** the deposit button / step 1 is enabled

### S2 — Stellar deposit: amount exactly at minimum (1 USDC) is accepted

**Given** the user has a Stellar wallet connected with a USDC balance ≥ 1 USDC  
**When** the user enters `1` USDC in the deposit input  
**Then** the deposit button / step 1 is enabled  
**And** no "below minimum" warning is shown

### S3 — Stellar deposit: amount below minimum (e.g. 0.50 USDC) shows below-min state

**Given** the user has a Stellar wallet connected with a USDC balance ≥ 0.50 USDC  
**When** the user enters `0.50` USDC in the deposit input  
**Then** the below-minimum banner is shown  
**And** the deposit button / step 1 is disabled

### S4 — EVM minimum deposit is unaffected

**Given** the user has an EVM wallet connected  
**When** the user navigates to `/deposit`  
**Then** the minimum deposit shown is sourced from the EVM DepositManager contract  
**And** the Stellar minimum constant does not affect the EVM flow
