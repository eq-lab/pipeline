# User Stories — #558 Connect page: network tabs (EVM / Soroban) with wallet lists

Epic: #556 (Connect page)
Issue: https://github.com/eq-lab/pipeline/issues/558
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=2858-57637

---

## Story 1 — Modal opens from TopBar Connect Wallet button

**Given** the user is not connected to any wallet
**When** the user clicks the "Connect Wallet" button in the TopBar
**Then** the Connect Wallet modal opens as an overlay with:
- Heading "Connect Wallet" in Besley font
- Two tabs: "EVM" (active) and "Soroban"
- A list of EVM wallets (MetaMask, Coinbase Wallet, WalletConnect, Trust Wallet)
- A close (×) button in the top-right corner

---

## Story 2 — EVM tab wallet list (no Phantom)

**Given** the Connect Wallet modal is open
**And** the EVM tab is active (default)
**Then** the wallet list shows exactly: MetaMask, Coinbase Wallet, WalletConnect, Trust Wallet
**And** Phantom is NOT shown
**And** there is no "Show More" button (EVM has ≤5 wallets)

---

## Story 3 — Soroban tab shows 5 wallets + Show More

**Given** the Connect Wallet modal is open
**When** the user clicks the "Soroban" tab
**Then** the wallet list shows 5 wallets (Freighter, LOBSTR, xBull, Hana, Albedo)
**And** a "Show More" button appears below the list

---

## Story 4 — Show More reveals remaining Soroban wallets

**Given** the Soroban tab is active and the list is collapsed (5 wallets + Show More)
**When** the user clicks "Show More"
**Then** all 6 Soroban wallets are shown (Freighter, LOBSTR, xBull, Hana, Albedo, Rabet)
**And** the "Show More" button disappears

---

## Story 5 — Tab switch resets Show More

**Given** the Soroban tab is expanded (all 6 wallets visible)
**When** the user switches to EVM and back to Soroban
**Then** the list collapses back to 5 wallets with the "Show More" button

---

## Story 6 — Connect to MetaMask directly

**Given** the Connect Wallet modal is open on the EVM tab
**And** MetaMask is installed
**When** the user clicks the MetaMask row
**Then** the modal closes
**And** wagmi triggers a connect request to the MetaMask (injected) connector
**And** (if terms not yet acknowledged) the terms gate opens first before connecting

---

## Story 7 — Connect to Coinbase Wallet

**Given** the Connect Wallet modal is open on the EVM tab
**And** Coinbase Wallet is available
**When** the user clicks the Coinbase Wallet row
**Then** the modal closes
**And** wagmi triggers a connect to the coinbaseWallet connector

---

## Story 8 — Connect to WalletConnect

**Given** the Connect Wallet modal is open on the EVM tab
**When** the user clicks the WalletConnect row
**Then** the modal closes
**And** wagmi triggers a connect to the walletConnect connector (QR code flow)

---

## Story 9 — Trust Wallet row opens website (no dedicated connector)

**Given** the Connect Wallet modal is open on the EVM tab
**When** the user clicks the Trust Wallet row
**Then** the modal closes
**And** the browser opens https://trustwallet.com in a new tab

---

## Story 10 — Connect to Freighter (Soroban)

**Given** the Connect Wallet modal is open on the Soroban tab
**And** Freighter is installed
**When** the user clicks the Freighter row
**Then** the modal closes
**And** StellarWalletsKit.setWallet("freighter") is called, then fetchAddress() retrieves the address

---

## Story 11 — Unavailable Soroban wallet opens website

**Given** the Connect Wallet modal is open on the Soroban tab
**And** the selected wallet (e.g. Albedo) is not installed
**When** the user clicks the Albedo row
**Then** the modal closes
**And** the browser opens https://albedo.link in a new tab

---

## Story 12 — Modal closes on Escape key

**Given** the Connect Wallet modal is open
**When** the user presses Escape
**Then** the modal closes

---

## Story 13 — Modal closes on scrim click

**Given** the Connect Wallet modal is open
**When** the user clicks the dark overlay (scrim) outside the modal panel
**Then** the modal closes

---

## Story 14 — Modal closes on × button

**Given** the Connect Wallet modal is open
**When** the user clicks the close (×) button
**Then** the modal closes

---

## Story 15 — Desktop layout: two columns

**Given** the user is on a desktop viewport (≥1024px)
**When** the Connect Wallet modal is open
**Then** the left column shows the connect content (heading, tabs, wallet list)
**And** the right column shows a dark background image panel with "Access real-world / yield on-chain" headline
**And** the Pipeline logo is visible in the right panel

---

## Story 16 — Mobile layout: no right picture section

**Given** the user is on a mobile viewport (<1024px)
**When** the Connect Wallet modal is open
**Then** only the left column (connect content) is visible
**And** the right picture panel is NOT rendered

---

## Story 17 — Terms gate integration

**Given** the user has not yet acknowledged the terms
**When** the user clicks any wallet row
**Then** the terms attestation modal opens first
**And** after accepting, the wallet connect flow proceeds
