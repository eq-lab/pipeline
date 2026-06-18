# User story: #638 — Connect Wallet modal opens from every entry point

**Epic:** #556 — Connect Wallet modal  
**Issue:** https://github.com/eq-lab/pipeline/issues/638  
**Status:** Initial

---

## Overview

Every "Connect Wallet" affordance in the app must open the same styled `ConnectWalletModal` (EVM/Soroban network tabs + per-wallet picker). Previously only the TopBar button opened it; all other CTAs triggered a chain-specific connect directly.

---

## Story 1 — Home page ConnectWalletPromoCard opens the modal

**Given** no wallet is connected, on the home page (`/`).

**When** the user clicks the "Connect" button on the `ConnectWalletPromoCard`.

**Then** the `ConnectWalletModal` appears with EVM and Soroban network tabs, and a wallet list — identical to the modal opened by the TopBar button. The EVM AppKit flow does NOT launch directly.

---

## Story 2 — Deposit page connect-wallet banner opens the modal

**Given** no wallet is connected, on the deposit page (`/deposit`).

**When** the user clicks the "Connect Wallet" button in the disconnected-state banner.

**Then** the `ConnectWalletModal` opens with network tabs and wallet picker.

---

## Story 3 — Stake page connect-wallet banner opens the modal

**Given** no wallet is connected, on the stake page (`/stake`).

**When** the user clicks the "Connect Wallet" button in the disconnected-state banner.

**Then** the `ConnectWalletModal` opens with network tabs and wallet picker.

---

## Story 4 — TopBar button continues to work (no regression)

**Given** no wallet is connected.

**When** the user clicks the TopBar "Connect Wallet" button.

**Then** the `ConnectWalletModal` opens exactly as before, with network tabs and wallet picker.

---

## Story 5 — Only one modal instance appears (no duplicates)

**Given** multiple "Connect Wallet" CTAs are visible on the same page.

**When** the user clicks any of them.

**Then** exactly one `ConnectWalletModal` appears in the DOM — not multiple stacked instances.
