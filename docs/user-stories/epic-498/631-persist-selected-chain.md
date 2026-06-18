# #631 — Persist selected chain (EVM/Stellar) globally across page reloads

Epic: #498 Deposit/withdraw page  
Issue: https://github.com/eq-lab/pipeline/issues/631

---

## Story 1 — Chain selection survives a page reload

**Given** the user is on any page and switches the wallet view to **Stellar**  
**When** they reload the page  
**Then** the wallet view still shows **Stellar** (not the default EVM)

---

## Story 2 — Default to EVM on first visit

**Given** `localStorage` has no `pipeline.wallet.view.kind` entry  
**When** the app loads  
**Then** the wallet view defaults to **EVM**

---

## Story 3 — Invalid stored value falls back to default

**Given** `localStorage` contains an unknown value for `pipeline.wallet.view.kind` (e.g. `"bitcoin"`)  
**When** the app loads  
**Then** the wallet view defaults to **EVM** without throwing an error

---

## Story 4 — Chain persists regardless of the starting route

**Given** the user switches to **Stellar** on the `/deposit` page  
**When** they navigate to `/` and then reload  
**Then** the wallet view still shows **Stellar**
