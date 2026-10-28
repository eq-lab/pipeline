---
title: Custody
order: 30
section: Security & Transparency
---

# Custody

Investor USDC sits in custody accounts, never inside a smart contract. The smart contracts move USDC only into the deposit custody account and, within an approved allowance, out of the withdrawal custody account.

## Custody accounts

| Account | Holds | Funded by | Drawn for |
|---|---|---|---|
| Deposit custody account | USDC from investor deposits | Investor deposits, sent straight from the deposit manager | Conversion to bank dollars for loans, top-ups of the withdrawal custody account |
| Capital wallet | Loan records and per-loan debt tokens; fee shares in the vault | Loan registry and minter | Nothing. It holds records, not cash. |
| Withdrawal custody account | USDC for queued withdrawals | Top-ups | Investor withdrawal claims, through the withdrawal queue's allowance |
| Trustee bank account | US dollars | Investor wires, borrower and offtaker repayments, conversions from USDC | Loan disbursements, investor bank withdrawals, conversions to USDC, expenses |

The minter books every movement of bank dollars on-chain. The bank balance itself is held off-chain.

## Signing policy

Each custody account signs under a multi-party signing policy. No single person can move USDC from a custody account.

## Withdrawal allowance

The withdrawal queue pays claims from the withdrawal custody account through an allowance. The account owner sets the amount, and the allowance expires. A claim pays out only when the account holds enough USDC to cover all earlier requests in the queue and this one. The withdrawal queue has no access to the deposit custody account.

## Custody reporting

Custody balances are readable on-chain. The minter adds custody USDC, booked bank cash, cash in transit and loan principal outstanding into one pool total.
