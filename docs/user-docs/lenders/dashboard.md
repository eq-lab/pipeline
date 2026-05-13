---
title: Dashboard
order: 17
section: For Lenders
---

# Dashboard

The lender dashboard combines your on-chain position (verifiable directly from the contracts) with UI-side conveniences like APR and accumulated yield.

## Verifiable directly on-chain

Every item in this list can be read straight from the contracts. If the UI disappeared tomorrow, you could reconstruct all of it with a block explorer or an RPC call.

- **PLUSD balance** — via `PLUSD.balanceOf(yourAddress)`.
- **sPLUSD balance and share-to-PLUSD exchange rate** — via `sPLUSD.balanceOf(yourAddress)` and `sPLUSD.convertToAssets(shares)`.
- **Whitelist status and `approvedAt` timestamp** via `WhitelistRegistry.isAllowed(yourAddress)`. The view returns true only if your entry exists and the 90-day freshness window has not expired.
- **Deposit tickets** via `DepositManager.getTicket(yourAddress, depositId)`. Each ticket carries amount, status (`Pending`, `Claimable`, `UnderReview`, `Frozen`, `Claimed`, `Refunded`), and timestamps.
- **Withdrawal queue entries** via `WithdrawalQueue.getEntry(queueId)`. Status is one of `Pending`, `Claimed`, `AdminReleased`.
- **Full deposit history** via `DepositManager.DepositRequested`, `TicketMarkedClaimable`, and `Deposited` events filtered by your address.
- **Full mint/burn history** — `Transfer` and related events on PLUSD filtered by your address.

## UI aggregates

These numbers are computed client-side from the on-chain data above. They're convenient, but they themselves do not represent an on-chain state. If you want to audit these numbers, recompute them from the raw events.

- Total deposited, total withdrawn, net position.
- Yield earned, expressed as nominal PLUSD.
- Annualised rate (APR), computed as annualised 30-day sPLUSD share price return.
- Transaction history with friendly labels and links to block explorers.

## What you can't see

You cannot see individual loan details *under your allocation*. Every lender's PLUSD and sPLUSD is fungible, so your exposure is pro-rata across the entire active loan book — there's no "loan #42 is yours and loan #43 is someone else's" slicing. You can see the **loan book itself** on the Protocol Dashboard (per-loan originator, commodity, corridor, outstanding principal, tenor, status), but you cannot attribute a specific loan to your specific shares.

## Protocol Dashboard

Protocol-wide figures — total PLUSD supply, Capital Wallet reserves, the 15% USDC buffer status, the full loan book, withdrawal queue depth, yield history — live on the Protocol Dashboard: *[link placeholder — URL to be set at launch]*.

## Verifying on your own

Every number on your dashboard can be reconstructed from on-chain calls and event logs. Contract addresses, ABIs, and deployment blocks live in the [Audits & addresses](/technical/audits-and-addresses/) section. If a UI number disagrees with what the contract returns, the contract is the source of truth.

## See also

- [Audits & addresses](/technical/audits-and-addresses/) — contract addresses and audit reports.
