---
title: Investor protection
order: 29
section: Security & Transparency
---

# Investor protection

Each Pipeline loan is drawn up to the advance ratio of its security value, and the Originator funds an equity tranche. Margin calls restore the cushion when prices fall. A loss that gets through stays with the investors who held the vault when the loan defaulted.

## Overcollateralization

The security registry holds one record per security instrument: bill of lading, warehouse pledge, collateral management agreement, assigned receivable, letter-of-credit proceeds, cash cover, prepayment or insurance. The Security Agent writes and attests each record. Inspection companies are appointed by the lending vehicle. Their results are entered by one operator and approved by a second.

| Term | Default | Meaning |
|---|---|---|
| Advance ratio | 80 % | The highest LTV at drawdown, and the LTV a margin call must restore |
| Margin-call ratio | 85 % | The LTV that opens a margin call |
| Cure period | Per loan | Time the borrower has to restore the advance ratio with money or goods |

LTV = (principal outstanding + accrued interest) ÷ security value. Goods count at the counted quantity times the market price. Cash cover, receivables, letter-of-credit proceeds and prepayments count at face. Insurance never counts. The platform feeds market prices. A stale price does not open a margin call. The Risk Council can set a manual price. A missed cure date does not trigger default automatically; the Risk Council decides.

The ratios are set per loan by the Risk Council.

## The equity tranche

Every loan is split into two tranches:

| Tranche | Funded by | Loss order |
|---|---|---|
| Equity | The Originator | First |
| Senior | The pool, through PLUSD | Second |

The loan registry records both tranches for each loan. The smart contracts do not enforce the loss order.

## How loss absorption works

#### Loss within equity tranche

On a $20M facility with $3M equity ($17M senior), a loss up to $3M falls on the Originator. Senior lenders are repaid in full.

#### Loss exceeding equity tranche

Same facility, $4M loss: the equity tranche is gone and $1M falls on the senior tranche. The Risk Council declares default and the default process below applies.

## Beyond the equity tranche

When the Risk Council declares a loan in default, the loan's outstanding PLUSD moves out of the vault into a default pocket for that loan. The pocket belongs to the vault holders at the moment of default, pro rata to their shares. Recoveries on the loan go to the pocket, and those holders claim them. The Risk Council writes down what is not recovered, and that PLUSD is burned. Investors who joined the vault after the default do not share in the loss or the recoveries.

A cure returns the loan to the watch list. The pocket stays.

## Terminal mode

The Admin can set a recovery rate below 1 on the withdrawal queue. It can be set once and cannot be changed after. Every queued PLUSD then pays out USDC at that rate. See [Default management](/risks/default-management/).

## Concentration limits as protection

Concentration limits are set in the [Credit policy overview](/risks/credit-policy/). The smart contracts do not enforce them.
