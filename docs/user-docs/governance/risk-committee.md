---
title: Risk Council
order: 26
section: Governance
---

# Risk Council

The Risk Council approves every facility and takes the credit decisions on live loans. It acts on-chain through the Risk Council role. Approving a facility, declaring a default and reversing a repayment execute at once. Every other Risk Council action waits 24 hours before it executes.

## Composition

The Risk Council has three voting seats: a commodity trade finance practitioner, a commodity lawyer, and a representative of the lender with the largest share of the pool. It may grow to five or more seats. Each decision is minuted with its rationale and signed through the Risk Council Multisig.

## Voting

- A facility needs 2 of 3 votes. Where any Risk Score is 2.00–2.99, it needs every member who is not recused.
- A member does not vote on a facility in which they or their firm is the Originator, a lender, the borrower or the offtaker, or is affiliated with one. With one member recused, both others must approve.

## Mandate

- Approve every facility against the Credit Policy and add it to the loan registry on-chain
- Declare events of default and respond to sanctions events
- Cure a default and return the loan to the watch list
- Write down a defaulted loan and close it
- Amend loan economics, including extensions and the default rate
- Adjust accrued interest
- Reverse a drawdown or a repayment booked in error, and correct the vault's accounting
- Set each facility's security terms: advance ratio, margin-call ratio, cure period and price limits
- Resolve inspection flags, keep the list of approved inspectors and set a manual price when needed
- Keep the jurisdiction and commodity lists, approve exceptions the Credit Policy allows, and approve every change to the policy
- Review concentration weekly

## On-chain expression

Approving a facility, declaring a default or reversing a repayment executes at once. Any other Risk Council decision is scheduled on-chain, waits 24 hours, then executes. The Guardian or the Admin can cancel it during the wait. The Risk Council cannot grant roles, pause, upgrade or move custody funds.
