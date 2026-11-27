---
title: Capital layer
order: 10
section: How Pipeline works
---

# Capital layer

The Capital Layer is where Pipeline holds and moves real money. Trade finance is a fiat business. Sellers, offtakers and banks pay in USD. Pipeline holds dollars, pays drawdowns and receives repayments through this layer.

## Architecture

The Capital Layer meets five operational requirements:

- Hold lender USDC in custody accounts outside the smart contracts.
- Keep 10–15% of the pool in an on-chain liquidity buffer for instant withdrawals.
- Move money between USDC and USD through a bank account.
- Keep deposit cash and withdrawal cash in separate accounts.
- Record every bank movement that changes the pool on-chain.

The pool's assets are USDC in the custody accounts, cash in the bank account, cash in transit between them, and the pool's share of loan principal outstanding. The protocol tracks this total on-chain.

{% include diagram.html src="boss-capital-layer.png" caption="Capital Layer — deposit, capital and withdrawal accounts, plus the USD bank account." %}

No smart contract can spend from the deposit account, the capital wallet or the bank account. The withdrawal queue can pull from the withdrawal account up to the allowance that account has set.

## Custody accounts

Each custody account is a separate MPC wallet with a 3-of-5 quorum, in which the Independent Trustee holds a mandatory key.

### Deposit account

Lender USDC deposits go straight to this account. KYT screening runs after the USDC arrives. The lender receives PLUSD once the relayer signs a voucher for the deposit.

### Capital wallet

Receives Pipeline's performance fee, minted as PLUSD when loan interest is booked.

### Withdrawal Queue Wallet

Holds the liquidity buffer for lender withdrawals. It gives the withdrawal queue an allowance. When a withdrawal is paid, the queue pulls USDC from this account, never from another one. Retail withdrawals are paid at once while the buffer covers them. When it runs short, requests wait in order until it is topped up. Larger withdrawals are paid at the quarterly withdrawal windows.

## USD bank account

The Independent Trustee co-signs every payment out of this account. It receives lender wires, receipts from borrowers' collection accounts, monthly interest and bank interest. It pays drawdowns into borrowers' collection accounts and lender wires out.

The protocol keeps a cash book of this account:

| Bank event | Recorded by | On-chain effect |
|---|---|---|
| Lender wire in | Cash reporter | PLUSD minted 1:1 and staked in the vault for the lender |
| Drawdown | Trustee | The facility's principal outstanding rises |
| Interest received | Cash reporter | The pool's interest, net of fees, minted into the vault; Pipeline's fee minted to the capital wallet as vault shares |
| Repayment | Cash reporter | Principal outstanding falls |
| Lender wire out | Trustee | Lender's escrowed PLUSD burned |
| USDC to USD or USD to USDC conversion | Trustee | Cash moved between custody and bank; any shortfall booked as an expense |
| Bank interest | Cash reporter | Minted into the vault |
| Bank charges | Trustee | Burned from the vault |

Each bank record carries a reference that can be used only once. A wire unmatched to a lender is held in escrow until the Trustee assigns it or returns it.

## Emergency disconnect

The Pauser can stop each contract at once. The Admin can replace the custody account a contract points to and unpause. The withdrawal account can cut the withdrawal queue's allowance to zero. A hardware circuit breaker can cut the relayer's access to custody.

## How cash operations are signed

The Independent Trustee signs cash operations through the Trustee role:

- Drawdowns: paying a drawdown from the bank account into the borrower's collection account and recording it.
- Wire-outs: sending a lender's USD and recording the settlement.
- Wire assignment: assigning an unmatched incoming wire to its lender, or returning it.
- Conversion: moving funds between USDC and USD and recording each conversion.
- Bank charges: recording fees the bank takes.

Interest, repayments, incoming wires and bank interest are recorded by the cash reporter role. The cash reporter role is held by a 2-of-2 multisig.
