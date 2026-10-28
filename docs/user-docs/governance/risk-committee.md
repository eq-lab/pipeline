---
title: Risk Council
order: 26
section: Governance
---

# Risk Council

The Risk Council takes the credit decisions on live loans. It acts on-chain through the Risk Council role. Declaring a default and reversing a repayment execute at once. Every other Risk Council action waits 24 hours before it executes.

## Composition

The Risk Council is a multisig of several people. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders under the master facility agreement.

## Mandate

- Declare a loan in default
- Cure a default and return the loan to the watch list
- Write down a defaulted loan and close it
- Amend loan economics, including extensions and the default rate
- Adjust accrued interest
- Reverse a disbursement or a repayment booked in error, and correct the vault's accounting
- Set each loan's security terms: advance ratio, margin-call ratio, cure period and price limits
- Resolve inspection flags, keep the list of approved inspectors and set a manual price when needed

## On-chain expression

A default declaration or a repayment reversal executes at once. Any other Risk Council decision is scheduled on-chain, waits 24 hours, then executes. The Guardian or the Admin can cancel it during the wait. The Risk Council cannot grant roles, pause, upgrade or move custody funds.
