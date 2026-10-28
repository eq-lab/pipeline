---
title: Introduction to Pipeline
order: 3
section: Start here
---

# Introduction to Pipeline

On-chain yield from global commodity trade.

## What Pipeline does

Pipeline is a permissioned commodity trade finance protocol. It funds the senior tranche of short-duration loans secured by physical commodities and repaid from the sale of the goods.

Lenders deposit USDC or wire USD and receive PLUSD. 1 PLUSD is a claim on 1 USD of the pool. Lenders stake PLUSD in the staking vault and receive sPLUSD. Loan Originators source and underwrite the deals, for example copper from Chile or wheat from Australia, and fund the equity tranche of each one. When a borrower repays, the senior interest net of fees is minted as PLUSD into the staking vault. The sPLUSD price rises.

Every loan is recorded in the on-chain loan registry. Its terms, status, disbursements and repayments are public.

## How it differs from what exists today

|   | **Traditional trade finance fund** | **Pipeline** |
|---|---|---|
| **Access** | Quarterly subscription windows; accreditation gates | Permissioned; approved addresses deposit at any time |
| **Liquidity** | Quarterly redemptions, often gated | No lock-up; withdrawals are paid in queue order as cash is available |
| **Transparency** | Quarterly investor letter; limited deal disclosure | Every loan on a public on-chain registry |
| **Counterparty risk** | Manager discretion on selection | Every deal is assessed against the published Credit Policy |

## How it differs from on-chain credit protocols

Existing on-chain credit pools lend USDC against borrower-pledged collateral, often with thin underwriting and weak recovery rights. They have suffered losses from undercollateralised lending and poor workouts. Pipeline differs on these points:

- A professional Loan Originator underwrites every loan and puts its own equity in the deal.
- Loans are secured by physical goods and the rights to them: bills of lading, warehouse pledges, collateral management agreements, assigned receivables. An independent Security Agent holds the security on trust for all lenders.
- Deposited USDC goes straight to a custody account. No smart contract holds lender USDC.
