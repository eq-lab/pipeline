---
title: Dashboard
order: 17
section: For Lenders
---

# Dashboard

The lender dashboard shows your on-chain position, which you can check against the contracts, and figures the app computes, such as APY and yield earned.

## Verifiable directly on-chain

Every item in this list can be read from the contracts. Without the app, you can rebuild all of it from public on-chain data.

- PLUSD balance of your address.
- sPLUSD balance and the PLUSD value of a share.
- Whether your address is authorised to hold PLUSD.
- Deposit requests: amount, time, and whether each was claimed.
- Withdrawal requests: amount, position in the queue, whether each is payable now, and whether it was claimed.
- Bank wire deposits and wire-out requests recorded for your address, with their status.
- After a default, your share of each loan pocket and what you can claim from it.
- Full history of deposits, claims, stakes, unstakes, withdrawals and PLUSD mints and burns, from the contracts' event logs.

## UI aggregates

The app computes these numbers from the on-chain data above. They are not on-chain state. To audit them, recompute them from the raw events.

- Verification status of your account.
- Total deposited, total withdrawn, net position.
- Yield earned, in PLUSD.
- APY, as the annualised change in the sPLUSD share price over the time you held shares. Shown after at least 7 days of holding.
- Transaction history with plain labels and links to a block explorer.

## What you can't see

You cannot see individual loans under your allocation. PLUSD and sPLUSD are fungible, so your exposure is pro rata across the whole active loan book. You can see the loan book itself on the Protocol Dashboard, but you cannot attribute a loan to your shares. The exception is a default: the loan's pocket belongs to the sPLUSD holders at that moment, and your share of it is on-chain.

## Protocol Dashboard

Protocol-wide figures live on the Protocol Dashboard: total value locked, PLUSD in circulation, amount outstanding in loans, the loan book and its yield, current APY net to sPLUSD, withdrawal queue depth and yield history. To be published.

## Verifying on your own

Every number on your dashboard can be rebuilt from on-chain reads and event logs. Contract addresses are on the [Audits & addresses](/technical/audits-and-addresses/) page. If a number in the app disagrees with what the contract returns, the contract is the source of truth.

## See also

- [Audits & addresses](/technical/audits-and-addresses/) — contract addresses and audit reports.
