---
title: Investor protection
order: 29
section: Security & Transparency
---

# Investor protection

Each Pipeline loan is drawn up to the advance ratio of its security value, and the Originator lends at least 5–20% of it on the same terms as the pool. Margin calls restore the cushion when prices fall. A loss that gets through stays with the investors who held the vault when the loan defaulted.

## Overcollateralization

The borrower pays its own equity, the part of the cargo the loan does not cover, into the collection account before the drawdown. The security registry holds one record per security instrument: bill of lading, warehouse pledge, collateral management agreement, assigned receivable, letter-of-credit proceeds, cash cover, prepayment or insurance. The Security Agent writes and attests each record. An independent inspector, appointed and paid by the borrower from Pipeline's panel, checks the goods and writes its reports into the security registry.

| Term | Value | Meaning |
|---|---|---|
| Advance ratio | 80 %, 75 % or 65 % by commodity class | The highest LTV at drawdown, and the LTV a margin call must restore |
| Margin call | Advance ratio + 5 points | The LTV that opens a margin call |
| Cure period | 3 business days | Time the borrower has to restore the advance ratio, in cash or by partial repayment |
| Default threshold | Advance ratio + 10 points | The LTV at which the Risk Council may declare a default |

LTV = (principal outstanding + accrued interest) ÷ security value. Goods count at the counted quantity times the market price. Cash cover, receivables, letter-of-credit proceeds and prepayments count at face. Insurance never counts. The platform feeds market prices. A stale price does not open a margin call. The Risk Council can set a manual price. An uncured margin call is an event of default, which the Risk Council declares.

The ratios are set per facility by the Risk Council, within the Credit Policy. For an open-account sale, the advance ratio is at least 10 points lower.

## Co-lending

Every facility has two kinds of lender, on the same terms:

| Lender | Share | Loss |
|---|---|---|
| The Originator | At least 5%, 10% or 20% by deal score | Pro rata to its share |
| The lending vehicle, for the pool | The rest | Pro rata to its share |

The loan registry records each lender's share. Because the Originator loses alongside the pool, it underwrites with its own money at stake.

## How loss absorption works

Take the [reference transaction](/start-here/reference-transaction/): $2.72M of gold concentrate, a $1.765M facility at a 65% advance ratio, $1.5M from the pool and $265K from the Originator.

#### Price fall within the cushion

The goods can lose about 35% of their value before the loan is uncovered. A margin call opens well before that, at 70% LTV, after a fall of about 7%. At 75% LTV, after a fall of about 13%, the Risk Council may declare a default.

#### Loss after enforcement

If the Security Agent sells the goods for less than the amount outstanding, the shortfall falls on the lenders by share: 15% on the Originator, 85% on the pool. A $300K shortfall costs the Originator $45K and the pool $255K.

## Default

When the Risk Council declares a loan in default, the pool's share of the loan in PLUSD moves out of the vault into a default pocket for that loan. The pocket belongs to the vault holders at the moment of default, pro rata to their shares. Recoveries on the loan go to the pocket, and those holders claim them. The Risk Council writes down what is not recovered, and that PLUSD is burned. Investors who joined the vault after the default do not share in the loss or the recoveries.

A cure returns the loan to the watch list. The pocket stays.

## Terminal mode

The Admin can set a recovery rate below 1 on the withdrawal queue. It can be set once and cannot be changed after. Every queued PLUSD then pays out USDC at that rate. See [Default management](/risks/default-management/).

## Concentration limits as protection

Concentration limits apply once the pool passes $30M. They are set in the [Credit policy overview](/risks/credit-policy/). The smart contracts do not enforce them.
