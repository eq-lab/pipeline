# User story: #1497 — EVM chain registry, wrong-network switch, EVM identity in the network pill

**Epic:** #1494
**Issue:** https://github.com/eq-lab/pipeline/issues/1497
**Status:** Initial

---

## Overview

The EVM chain is selected by `VITE_EVM_CHAIN_ID` through a chain registry (`1` = Ethereum, `560048` =
Hoodi). When a connected EVM wallet is on another chain, the app prompts the wallet to switch, and
falls back to a disabled steps card with a "Switch your wallet to {chain}" row. The network pill and
the mainnet gate follow the active view. Rules:
[`wallet-flows.md#chain-registry`](../../frontend/wallet-flows.md#chain-registry) and
[`wallet-flows.md#wrong-network`](../../frontend/wallet-flows.md#wrong-network). No Figma applies.

Real-wallet stories need MetaMask (or another EVM wallet) and a deployment whose
`VITE_EVM_CHAIN_ID` is `560048`. The mock stories use the `pipeline.mock.wallet.*` localStorage keys.

---

## Story 1 — Wallet on the wrong chain is prompted to switch on connect

**Given** an EVM wallet is on Ethereum mainnet and the deployment uses Hoodi

**When** the LP connects the wallet

**Then:**

- The wallet immediately asks to switch to Hoodi (MetaMask first asks to add Hoodi if it does not know it)
- After approving, the pill shows `Testnet` and `/deposit` shows the normal steps card with no switch row
- Refreshing the page with the wallet still connected on the right chain does not prompt again

---

## Story 2 — Rejecting the prompt leaves a disabled steps card with a switch row

**Given** the wallet is connected on the wrong chain and the LP rejected the switch prompt

**When** the LP opens `/deposit`, `/deposit?direction=withdraw`, `/stake` and `/stake?tab=unstake`

**Then:**

- Each page keeps its steps card, but every step button is disabled
- A one-line row reads `Switch your wallet to Hoodi` with a `Switch` button, above the steps
- Clicking `Switch` asks the wallet to switch again; once the wallet is on Hoodi the row disappears and the buttons re-enable
- A failed switch shows a danger toast; a transaction cannot be sent on the wrong chain

---

## Story 3 — Switching chains in the wallet later

**Given** the wallet is connected on Hoodi and `/deposit` shows the normal steps card

**When** the LP switches the wallet to Ethereum mainnet from the wallet itself

**Then:**

- The steps buttons disable and the switch row appears without a page reload
- The network pill turns to a danger dot labelled `Wrong network`; opening it shows `Switch to Hoodi`, which asks the wallet to switch
- Switching back to Hoodi restores the steps card and the pill

---

## Story 4 — Pill and nav follow the active view

**Given** a Stellar testnet deployment with EVM chain `1` configured (mixed local setup)

**When** the LP connects an EVM wallet, then disconnects it and connects a Stellar wallet

**Then:**

- In the EVM view the pill reads `Mainnet`, and the Dashboard nav link, the TVL / APY home cells and `/dashboard` are hidden or redirect to `/`
- In the Stellar view the pill reads `Testnet`, and Dashboard, TVL and APY are available
- With no wallet connected the Stellar rules apply

---

## Story 5 — Mock wallet

**Given** `pipeline.mock.wallet.address` is set and `pipeline.mock.wallet.chainId` is `"1"` on a Hoodi deployment

**When** the LP opens `/deposit`

**Then:**

- The wrong-network row and pill state appear, and no wallet prompt fires on load
- Clicking `Switch` only writes a console warning naming `pipeline.mock.wallet.chainId`; setting it to `"560048"` clears the state
