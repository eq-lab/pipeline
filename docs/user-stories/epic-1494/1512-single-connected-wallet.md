# User story: #1512 — Single connected wallet

**Epic:** #1494
**Issue:** https://github.com/eq-lab/pipeline/issues/1512
**Status:** Initial

---

## Overview

The LP app holds at most one wallet connection at a time. The Account wallet card has no
`Ethereum` / `Stellar` tabs: it shows the connected wallet (or the `Connect Wallet` call to action),
and the active chain follows the connected wallet. Rules: [`wallet-flows.md#single-connected-wallet`](../../frontend/wallet-flows.md#single-connected-wallet),
card: [`account-page.md#wallet-card`](../../frontend/account-page.md#wallet-card).

---

## Story 1 — Connected EVM wallet

**Given** an LP connects an EVM wallet

**When** they open `/account`

**Then:**

- The wallet card shows, at the top, the former tabs' track block (same size and style) holding the Ethereum logo and the label `Ethereum`
- Below it: icon tile, `Wallet` row, `USDC balance` row, divider, `Disconnect`
- No `Ethereum` / `Stellar` tabs are rendered
- No `Connect Wallet` button is offered on Account, home, deposit, stake or transactions

---

## Story 2 — Disconnect, then connect the other chain

**Given** the EVM wallet is connected

**When** the LP clicks `Disconnect`, then `Connect Wallet`, and connects a Stellar wallet in the modal's Soroban tab

**Then:**

- After `Disconnect` the card shows the `Connect Wallet` button and no chain block
- After connecting, the card shows the Stellar wallet's block, with the Stellar logo and the label `Stellar` in the top block
- Home, deposit and stake follow Stellar (balances, steps and activity come from the Stellar chain)

---

## Story 3 — Refresh keeps the connection

**Given** a Stellar wallet is connected

**When** the LP reloads the page

**Then:**

- The restored wallet is still the only one connected and the active chain is Stellar

---

## Story 4 — Legacy both-connected state

**Given** both an EVM and a Stellar session come back on load (left over from before this change)

**When** both wallet kits finish restoring

**Then:**

- Both wallets are disconnected and the LP is left disconnected
- The LP connects exactly one wallet; the active chain is that wallet's chain
