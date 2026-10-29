---
title: Fiduciary trustee
order: 25
section: Governance
---

# Fiduciary trustee

The Trustee is the legal entity that runs the lending vehicle and its operations: loans and cash for the pool. It works from the Trustee console and acts on-chain through the Trustee role.

## Role

The Trustee opens loans in the loan registry and records disbursements. It books cash moving between the bank account and USDC custody. It settles and cancels bank withdrawals. It rolls over matured loans and closes loans that are repaid or cancelled. It registers the per-loan debt token.

## Operational responsibilities

- Opens each loan in the loan registry with its fixed terms
- Records each disbursement to the borrower from the bank account
- Assigns or returns bank wires that arrive without a known investor
- Settles investor bank withdrawals when the wire is sent, or cancels them
- Books conversions between USDC and bank dollars, and bank expenses
- Updates the mutable loan fields during servicing

Repayments, incoming wires and bank income are booked by a separate role, the Cash reporter.

## Independence

The Trustee role cannot declare a default, write down a loan, reverse a repayment or change loan economics. Those actions belong to the Risk Council. The Trustee cannot grant roles, pause, unpause or upgrade contracts. It cannot mint PLUSD.

## Mapping to the legal stack

The Trustee runs the lending vehicle. The lending vehicle is bankruptcy remote. It is the initial lender under the master facility agreement (MFA) with each borrower. Other lenders, including the Originator, join by accession or take over a share by transfer certificate.

The facility agent and the Security Agent are appointed under the agency deed. The Security Agent is an independent security trustee. It holds the security on trust for all lenders by the priority of payments and co-signs the collection account.

Lender decisions belong to the Majority Lenders. Changes to economics and releases of security outside their release condition need all lenders. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.

Full hierarchy on the [Legal structure](/how-it-works/legal-structure/) page.

## Why a fiduciary trustee, not a contract

Trade finance needs a legal entity that signs loan documents, holds the bank account, receives wires and acts in court. The Trustee does this off-chain. The smart contracts record each of its actions.
