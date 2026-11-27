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
| Approved | The facility is recorded. No money has been paid out |
| Performing | The first drawdown has been paid. Interest accrues |
| WatchList | The loan is under closer review |
| Default | The Risk Council has declared default |
| Closed | The loan is finished. The closure reason is recorded |

{% include diagram.html src="d6-loan-lifecycle.svg" caption="Loan states. The Risk Council adds a facility as Approved. The Trustee moves a loan between the normal states and closes it. Only the Risk Council declares default, cures it, or closes a defaulted loan." %}

The Trustee role moves a loan between Performing and WatchList. It cannot declare default. Only the Risk Council can, and the declaration runs without a delay. The Risk Council can cure a defaulted loan; it returns to WatchList.

A loan's LTV is the amount owed (outstanding principal plus accrued interest) divided by the value of its security. A margin call opens when LTV rises 5 points above the loan's advance ratio. The borrower must restore the advance ratio within 3 business days, in cash or by partial repayment. An uncured margin call, a payment 21 days past due, or another event of default in the Credit Policy can lead to default. Default is never automatic: the Risk Council declares it. The security registry runs the LTV checks on-chain.

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

The Risk Council may declare default when one of the Credit Policy's events of default occurs:

- A payment 21 days past due
- An uncured margin call
- Receipts left in the collection account for more than 2 business days, a change of its mandate, or a diverted payment
- Covenant breach, insolvency, material adverse change or cross-default
- A PRC payment route failing with no substitute within 10 business days
- A counterparty scored below 2.00 or knocked out, and not replaced within 10 business days

### Declaration

The Risk Council declares default on the loan registry. The declaration runs without a delay. The loan moves to Default. On the first default of a loan, the pool's share of its outstanding principal, in PLUSD, is moved out of the staking vault into a separate pocket for that loan. The pocket belongs to the sPLUSD holders at that moment, in proportion to their holdings. The sPLUSD share price falls by the amount moved. If the vault holds less PLUSD than that share, it moves what it holds.

### Workout

1. Notice goes to the borrower, and the facility is accelerated.
2. Releases stop. The Security Agent takes control of the documents of title and the stock.
3. The Security Agent collects the assigned receivables or steps in to complete the sale, and calls any guarantees.
4. Remaining goods are sold through the primary liquidator, or a back-up where the primary is conflicted or unavailable.
5. The supplier is pursued only after the borrower, or on the borrower's insolvency.

Recoveries are applied in this order: enforcement and recovery costs; principal, to all lenders pro rata; contract and default interest, pro rata; protocol fees accrued up to the default date; any surplus to the borrower. Protocol fees stop accruing at default. The pool's part of each recovery is booked on the facility and goes to its pocket.

## Loss waterfall

| Layer | Source | Mechanic |
|---|---|---|
| **1. Security** | The goods, receivables and insurance held by the Security Agent | Enforced and sold. The advance ratio leaves the borrower's equity in the cargo as a cushion. |
| **2. Lenders by share** | The Originator and the pool | A shortfall falls on each lender pro rata to its share of the facility. |
| **3. sPLUSD holders at default** | The loan's pocket | The pool's part falls on the holders in the vault when default is declared, in proportion to their holdings. Holders who left the vault before default do not share. Holders who join after default do not. |
| **4. Unabsorbed loss** | Recorded on the loan registry | If the vault could not cover the pool's share at default, the part written down beyond the pocket is recorded as unabsorbed. |

PLUSD outside the vault (in wallets, in the withdrawal queue, in wire-out escrow) is not moved into the pocket.

## Recovery mechanics

### Recoveries

The pool's share of repayments on a defaulted loan goes to its pocket, both principal and interest. Each holder at the moment of default claims a share of what has been recovered, in proportion to their sPLUSD balance at that moment. A holder can claim each time more is recovered.

### Write-down

When recovery ends, the Risk Council writes down the remaining amount (24-hour delay). The written-down PLUSD in the pocket is burned. The loan is then closed with reason Default or Other write-down.

### Cure

If the borrower cures, the Risk Council returns the loan to WatchList. The pocket stays open. Later repayments still go to the pocket holders.

### Withdrawal queue recovery rate

The Admin can set one recovery rate below 1 on the withdrawal queue. From then on, each withdrawal claim pays that fraction of its face value in USDC. The rate can be set only once. It cannot be raised later.
