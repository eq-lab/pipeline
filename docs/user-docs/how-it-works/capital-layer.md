---
title: Capital layer
order: 10
section: How Pipeline works
---

# Capital layer

The Capital Layer is where Pipeline holds and moves real money. Trade finance is a fiat business. Sellers, offtakers and banks pay in USD. Pipeline holds dollars, disburses loans and receives offtaker payments through this layer.

## Architecture

The Capital Layer meets four operational requirements:

- Hold lender USDC in custody accounts outside the smart contracts.
- Move money between USDC and USD through a bank account.
- Keep deposit cash and withdrawal cash in separate accounts.
- Record every bank movement that changes the pool on-chain.

The pool's assets are USDC in the custody accounts, cash in the bank account, cash in transit between them, and loan principal outstanding. The protocol tracks this total on-chain.

{% include diagram.html src="boss-capital-layer.png" caption="Capital Layer — deposit, capital, withdrawal and treasury accounts, plus the USD bank account." %}

No smart contract can spend from the deposit account, the capital wallet, the treasury or the bank account. The withdrawal queue can pull from the withdrawal account up to the allowance that account has set.

## Custody accounts

Each custody account is a separate on-chain account controlled by a multisig.

### Deposit account

Lender USDC deposits go straight to this account. KYT screening runs after the USDC arrives. The lender receives PLUSD once the relayer signs a voucher for the deposit.

### Capital Wallet

Holds the loan records and the per-loan debt tokens. Each loan is a non-transferable record in the loan registry, held by this wallet. Each loan's debt tokens sit here frozen, one token per USD of principal outstanding.

### Withdrawal Queue Wallet

Holds USDC for lender withdrawals. It gives the withdrawal queue an allowance. When a lender claims, the queue pulls USDC from this account, never from another one. A claim waits until this account holds enough USDC to cover the queue up to that request. A fault in the withdrawal queue reaches only this account's balance, up to the allowance.

### Treasury Wallet

Receives protocol fees: management fee and performance fee. Fees are paid at each repayment as vault shares.

## USD bank account

Managed by the Trustee. The account receives lender wires, borrower and offtaker repayments, and bank interest. It sends loan disbursements and lender wires out.

The protocol keeps a cash book of this account:

| Bank event | Recorded by | On-chain effect |
|---|---|---|
| Lender wire in | Cash reporter | PLUSD minted 1:1 and staked in the vault for the lender |
| Loan disbursement | Trustee | Loan principal outstanding rises |
| Repayment | Cash reporter | Principal outstanding falls; interest minted into the vault; fees minted to the treasury |
| Lender wire out | Trustee | Lender's escrowed PLUSD burned |
| USDC to USD or USD to USDC conversion | Trustee | Cash moved between custody and bank; any shortfall booked as an expense |
| Bank interest | Cash reporter | Minted into the vault |
| Bank charges | Trustee | Burned from the vault |

Each bank record carries a reference that can be used only once. A wire unmatched to a lender is held in escrow until the Trustee assigns it or returns it.

## Emergency disconnect

The Pauser can stop each contract at once. The Admin can replace the custody account a contract points to and unpause. The withdrawal account can cut the withdrawal queue's allowance to zero.

## How the Trustee manages capital

The Trustee runs cash operations through the Trustee role. Its day-to-day operations include:

- Loan funding: wiring senior capital from the bank account to the borrower and recording the disbursement.
- Wire-outs: sending a lender's USD and recording the settlement.
- Wire assignment: assigning an unmatched incoming wire to its lender, or returning it.
- Conversion: moving funds between USDC and USD and recording each conversion.
- Bank charges: recording fees the bank takes.

Repayments, incoming wires and bank interest are recorded by the cash reporter role. The cash reporter role is held by a 2-of-2 multisig.
