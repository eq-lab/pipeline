---
title: Capital layer
order: 10
section: How Pipeline works
---

# Capital layer

The Capital Layer is where Pipeline holds and moves real money. Trade finance is a fiat business — sellers, offtakers, and banks wire in USD. Pipeline needs a layer that can hold dollars, disburse loan proceeds, and receive offtaker wires.

## Architecture

The Capital Layer answers four operational requirements:

- Hold lender USDC under institutional custody.
- Bridge USDC and USD via a dedicated bank account.
- Maintain a yield-bearing reserve — non-deployed capital sits in tokenised T-bills, accruing yield.
- Isolate new deposits under ongoing KYT checks and withdrawal cash from the rest.

For these purposes, Pipeline sets up the infrastructure of four wallets in the institutional custody (BitGo) and a USD bank account, all under fiduciary control.

{% include diagram.html src="boss-capital-layer.png" caption="Capital Layer — Intake, Capital, Withdrawal Queue, and Treasury wallets in institutional custody, plus the USD bank account. Trustee approves every movement." %}

No protocol contract can spend from this layer. Every movement requires the 3-of-5 cosigner quorum.

## Institutional custody

All on-chain capital is held with BitGo under multi-party computation custody. Four wallets sit under a single 5-share, 3-of-5 cosigner policy: the Trustee, two Pipeline Team shares, and two independent External Counterparties. No single party can move funds. A hard policy rule requires the Trustee to participate in every signing quorum.

### Intake Wallet

Every lender USDC deposit arrives here first and remains until KYT screening clears. Holding incoming funds in a separate wallet simplifies accounting — only cleared capital reaches the Capital Wallet, and PLUSD `totalSupply` matches cleared capital exactly. If a deposit fails KYT, the Trustee returns it to the source wallet under standard cosigner quorum.

### Capital Wallet

Holds lender USDC plus the USYC reserve. Funds enter from the Intake Wallet on KYT clearance, from offtaker repayments via the USD bank account, and from tokenised T-bills (USYC) redemptions. Funds exit to fund loans, replenish the Withdrawal Queue Wallet, and purchase USYC.

A target USDC buffer of 15% (band 10–20%) sits in the wallet against routine outflows. The remainder sits as USYC, accruing T-bill yield daily. NAV is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail. Realised proceeds feed a PLUSD yield mint.

### Withdrawal Queue Wallet

A separate institutional-custody address that holds USDC earmarked for lender withdrawals. The Trustee and Team periodically top it up from the Capital Wallet under the 3-of-5 cosigner quorum. The on-chain WithdrawalQueue contract pulls from this wallet (not from the Capital Wallet) when a lender claims, against an allowance the Queue Wallet has granted to the contract. Isolating settlement funds in their own wallet means a WithdrawalQueue contract bug or exploit can drain only the topped-up amount, not the full Capital Wallet.

### Treasury Wallet

Collects protocol fees — management, performance, and the OET allocation. Funds operating expenses and the Operational Expense Trust runway reserve.

## USD bank account

Held in the Trustee's name. The account receives offtaker wires when cargo is paid for, and originates outgoing instructions to fund loans and on-ramp dollar inflows. Conversion between USD and USDC runs through the Payment Agent (Circle Mint).

The account is subject to the same fiduciary discipline as the on-chain wallets — every disbursement is initiated by the Trustee against documented protocol instructions, and every inflow is reconciled to a specific loan repayment or capital movement.

## Emergency disconnect

Custody policy carries a **hardware circuit breaker** that disconnects the Capital Wallet and the Withdrawal Queue Wallet from the protocol contracts on alarm. Pre-approved allowances are revoked, all standing transfer authorisations are frozen. The breaker is a custody-side action. It does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever.

## How the Trustee manages capital

Every movement out of any custody wallet requires the 3-of-5 cosigner quorum. Initiated by Pipeline Operations, signed under the BitGo policy by the relevant cosigners (Trustee mandatory).

The Trustee's day-to-day operations include:

- **KYT-cleared releases** — moving cleared deposits from the Intake Wallet to the Capital Wallet.
- **Loan funding** — drawing senior tranche capital from the Capital Wallet against an approved loan and routing it via the Payment Agent to the seller account.
- **Withdrawal Queue replenishment** — topping up the Withdrawal Queue Wallet from the Capital Wallet against the queue's outstanding obligations.
- **T-bills management** — acquiring tokenised T-bills from unallocated USDC above the buffer, and selling them for USDC when buffer replenishment requires it.
- **Treasury sweeps** — allocating yield-mint fees to the Treasury Wallet under the published fee schedule.
- **Repayment on-ramping** — receiving offtaker wires into the USD bank account and instructing USD/USDC conversion via the Payment Agent.
- **KYT-failure returns** — returning Intake Wallet funds to the source wallet when a deposit fails screening.

Standing transfer authorisations exist only for the WithdrawalQueue contract pulling against the Withdrawal Queue Wallet, bounded by the queue's `totalClaimable` ledger ceiling.
