---
title: Protocol layer
order: 11
section: How Pipeline works
---

# Protocol layer

The Protocol Layer is a set of on-chain smart contracts. Token architecture sits at the top: PLUSD as the dollar receipt and sPLUSD as the yield-bearing share of the PLUSD staking vault. LoanRegistry sits as the second-priority surface, the public audit trail of every loan facility. The remaining contracts run the deposit, mint, withdraw, and access flows.

## Token architecture

### PLUSD

ERC-20 dollar receipt. Minted 1:1 against USDC entering the Capital Wallet via DepositManager. Freely transferable between whitelisted addresses. Two mint paths: deposit-side (DepositManager) and yield-side (YieldMinter, two-party). Reserve invariant asserted on every mint.

### sPLUSD

ERC-4626 yield-bearing share with PLUSD as an underlying asset. Any PLUSD holder can stake. The sPLUSD share price rises when a yield mint lands — senior coupons and realised T-bill yield.

## LoanRegistry

Every originated loan is one NFT carrying immutable origination data — borrower, commodity, corridor, facility size, tranche split, offtaker price, coupon rate. Plus mutable lifecycle state. LoanRegistry is the public audit trail of the loan book.

## Core operational contracts

| Contract | Purpose |
|---|---|
| **DepositManager** | Two-step screened deposit. `deposit` moves USDC into the Intake Wallet and creates a ticket; the Relayer signs an EIP-712 ClaimAttestation off-chain after KYT clears; the lender submits the attestation via `claim`, which moves USDC to the Capital Wallet and mints PLUSD 1:1. |
| **YieldMinter** | Gates yield mints. Requires signatures from both the Trustee attestor (EIP-1271) and the Relayer attestor. Mint destinations hard-constrained to sPLUSD vault or Treasury Wallet. |
| **WithdrawalQueue** | User-pulled FIFO exit. Lenders escrow PLUSD, receive a queue ID, claim USDC themselves. The queue contract (not the Relayer) pulls from the Withdrawal Queue Wallet via the wallet's standing allowance. |
| **WhitelistRegistry** | On-chain allowlist of compliance-screened addresses. Every PLUSD transfer requires both endpoints to be whitelisted or a system address (deposit/yield/queue contracts and the sPLUSD vault). Maintains the 90-day KYT freshness window. |
| **AccessManager** | Role hub. Every privileged call routes through — instant for GUARDIAN, 3-day timelock for RISK_COUNCIL, 3-day timelock for ADMIN (7-day for upgrades), 14-day meta-timelock on the delay parameter itself. |

## Recovery in MVP

If the loss waterfall exhausts the equity tranche, RISK_COUNCIL sets a recovery rate (an exchange coefficient less than 1.0) on the WithdrawalQueue under the 3-day timelock. From that block on, every claim pays out `face_value × coefficient`. The coefficient ratchets up only as recoveries land. There is no separate ShutdownController contract in MVP — the WithdrawalQueue's exchange coefficient is the entire mechanism. See [Default management](/risks/default-management/).

ShutdownController and RecoveryPool contracts remain in the codebase as dormant primitives for post-MVP scenarios, but are not engaged in MVP loss handling.

## ERC primitives

PLUSD is ERC-20. sPLUSD is ERC-4626. Trustee attestation is EIP-1271. Role hub is OpenZeppelin AccessManager (v5). Governance MPCs are Gnosis Safe contracts behind BitGo MPC custody. Chain is EVM.
