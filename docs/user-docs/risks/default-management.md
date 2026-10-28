---
title: Default management
order: 35
section: Risk management
---

# Default management

This page describes what happens to a loan, and to lenders, when a borrower does not pay.

## Loan states

Every loan has one of five states: Approved, Performing, WatchList, Default, Closed.

| State | Meaning |
|---|---|
| Approved | The loan is recorded. No money has been paid out |
| Performing | The first disbursement has been paid. Interest accrues |
| WatchList | The loan is under closer review |
| Default | The Risk Council has declared default |
| Closed | The loan is finished. The closure reason is recorded |

The Trustee moves a loan between Performing and WatchList. The Trustee cannot declare default. Only the Risk Council can, and the declaration runs without a delay. The Risk Council can cure a defaulted loan; it returns to WatchList.

A loan's LTV is the amount owed (outstanding principal plus accrued interest) divided by the value of its security. A margin call opens when LTV rises above the loan's margin-call ratio (85 % by default). The borrower must bring LTV back to the advance ratio (80 % by default) within the cure period. A margin call left uncured, or a payment missed past the grace period, is the typical route to default. Default is never automatic. The security registry runs these checks on-chain.

Closure authority by reason:

| Closure reason | Who can close | Delay |
|---|---|---|
| Scheduled maturity | Trustee | 0 |
| Early repayment | Trustee | 0 |
| Cancelled | Trustee | 0 |
| Default | Risk Council only | 24 hours |
| Other write-down | Risk Council only | 24 hours |

A defaulted loan can be closed only after its outstanding principal is zero, by recovery or write-down. A write-down is final.

## Single-facility default

### Triggers

The Risk Council may declare default when one of the following occurs:

- Missed payment beyond the grace period
- Margin call not cured within the cure period
- Material covenant breach uncured within the contractual window
- Collateral seizure, fraud discovery, or collateral management breach
- Force majeure beyond the covered insurance window
- Sanctions hit on a counterparty

### Declaration

The Risk Council declares default on the loan registry. The declaration runs without a delay. The loan moves to Default. On the first default of a loan, its outstanding principal is moved out of the staking vault into a separate pocket for that loan. The pocket belongs to the sPLUSD holders at that moment, in proportion to their holdings. The sPLUSD share price falls by the amount moved. If the vault holds less PLUSD than the outstanding, it moves what it holds.

### Workout

1. Counsel issues default notices and reservation-of-rights letters.
2. The Security Agent enforces the security on the Risk Council's instruction: bills of lading, warehouse pledges, collateral management agreements, assigned receivables.
3. The goods are sold under the loan's liquidation plan.
4. Recovered proceeds are booked as repayments on the loan and go to its pocket.

## Loss waterfall

| Layer | Source | Mechanic |
|---|---|---|
| **1. Equity tranche** | The Originator's capital on the loan | Recorded on the loan. The smart contracts do not enforce it. |
| **2. sPLUSD holders at default** | The loan's pocket | Holders in the vault when default is declared bear the loss in proportion to their holdings. Holders who left the vault before default do not. Holders who join after default do not. |
| **3. Unabsorbed loss** | Recorded on the loan registry | If the vault could not cover the full outstanding at default, the part written down beyond the pocket is recorded as unabsorbed. |

PLUSD outside the vault (in wallets, in the withdrawal queue, in wire-out escrow) is not moved into the pocket.

## Recovery mechanics

### Recoveries

Repayments on a defaulted loan go to its pocket, both principal and interest. Each holder at the moment of default claims a share of what has been recovered, in proportion to their sPLUSD balance at that moment. A holder can claim each time more is recovered.

### Write-down

When recovery ends, the Risk Council writes down the remaining amount (24-hour delay). The written-down PLUSD in the pocket is burned. The loan is then closed with reason Default or Other write-down.

### Cure

If the borrower cures, the Risk Council returns the loan to WatchList. The pocket stays open. Later repayments still go to the pocket holders.

### Withdrawal queue recovery rate

The Admin can set one recovery rate below 1 on the withdrawal queue. From then on, each withdrawal claim pays that fraction of its face value in USDC. The rate can be set only once. It cannot be raised later.
