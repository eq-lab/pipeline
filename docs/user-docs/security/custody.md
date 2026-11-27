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
| Capital wallet | Pipeline's fee shares in the vault | Minter | Nothing. It holds fee shares, not cash. |
| Withdrawal custody account | USDC for queued withdrawals and the liquidity buffer: 10–15% of the pool | Top-ups | Investor withdrawal claims, through the withdrawal queue's allowance |
| USD bank account | US dollars | Investor wires, receipts from borrowers' collection accounts, interest, conversions from USDC | Drawdowns into collection accounts, investor bank withdrawals, conversions to USDC, expenses |

The minter books every movement of bank dollars on-chain. The bank balance itself is held off-chain.

## Signing policy

Each custody account is an MPC wallet with a 3-of-5 quorum. The Independent Trustee, a licensed trust company, holds a mandatory key and co-signs every payment out of Pipeline's accounts. Withdrawals paid automatically from the buffer are exempt. No single person can move USDC from a custody account.

## Withdrawal allowance

The withdrawal queue pays claims from the withdrawal custody account through an allowance. The account owner sets the amount, and the allowance expires. A claim pays out only when the account holds enough USDC to cover all earlier requests in the queue and this one. The withdrawal queue has no access to the deposit custody account.

## Custody reporting

Custody balances are readable on-chain. The minter adds custody USDC, booked bank cash, cash in transit and the pool's share of loan principal outstanding into one pool total.
