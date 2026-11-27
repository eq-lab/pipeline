---
title: Independent Trustee
order: 25
section: Governance
---

# Independent Trustee

The Independent Trustee is a licensed trust company. It supervises every movement of funds out of Pipeline's accounts and signs Pipeline's facility and cash records on-chain through the Trustee role.

## Role

- Holds a mandatory key on every custody account, each an MPC wallet with a 3-of-5 quorum
- Co-signs every payment out of the lending vehicle's and the funding vehicle's accounts, Originator repayments included. Inflows and withdrawals paid automatically from the on-chain buffer are exempt.
- Approves every drawdown under the trust deed
- Can freeze payments and have either vehicle's board replaced on a trigger event

It holds no security over either vehicle and does not underwrite or verify trades. Enforcement against borrowers belongs to the Security Agent.

## On-chain operations

Through the Trustee role, the Independent Trustee:

- Records each drawdown paid from the bank account into the borrower's collection account
- Assigns or returns bank wires that arrive without a known lender
- Settles lender bank withdrawals when the wire is sent, or cancels them
- Books conversions between USDC and bank dollars, and bank expenses
- Updates the mutable facility fields during servicing: status between Performing and WatchList, rollover, closing
- Registers each loan's debt token

Interest, repayments, incoming wires and bank income are booked by a separate role, the Cash reporter.

## Independence

The Trustee role cannot approve a facility or add it to the loan registry, declare a default, write down a loan, reverse a repayment or change loan economics. Those actions belong to the Risk Council. It cannot grant roles, pause, unpause or upgrade contracts. It cannot mint PLUSD.

## Mapping to the legal stack

A charitable trust owns the lending vehicle, which wholly owns the funding vehicle. The funding vehicle borrows USDC from lenders, keeps the liquidity buffer and lends the rest to the lending vehicle. The lending vehicle lends in every facility under the master facility agreement (MFA), pari passu with the Originator. Other lenders join by accession or take over a share by transfer certificate. The Independent Trustee supervises payments out of both vehicles.

Pipeline acts as Facility Agent. The Security Agent is an independent security trustee appointed under the agency deed. It holds the security on trust for all lenders by the priority of payments and co-signs the collection account.

Lender decisions belong to the Majority Lenders. Changes to economics and releases of security outside their release condition need all lenders.

Full hierarchy on the [Legal structure](/how-it-works/legal-structure/) page.

## Why an independent trustee

Lenders need a regulated body that answers for every movement of their money, rather than individuals or code alone. The Independent Trustee is licensed and independent of Pipeline. No payment leaves the lending vehicle or the funding vehicle without its signature, except automatic withdrawals from the on-chain buffer. The smart contracts record each of its on-chain actions.
