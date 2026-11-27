---
title: Reference transaction
order: 4
section: Start here
---

# Reference transaction

Pipeline's architecture has been stress-tested against the trade below. It shows the type of deal the protocol finances. The parties and numbers are illustrative.

## Deal summary

| Parameter | Detail |
|---|---|
| **Commodity** | Gold pyrite concentrate |
| **Trade corridor** | Greece (FOB) → China, shipped around the Cape of Good Hope |
| **Originator / Servicer** | A metals concentrates Originator |
| **Offtaker** | A buyer in China |
| **Cargo value** | $2.72M |
| **Facility** | $1.765M (65% of cargo value, the cap for gold concentrate) |
| **Pool share** | $1.5M (85% of the facility, 55% of cargo value), funded by Pipeline lenders |
| **Originator share** | $265K (15% of the facility, 10% of cargo value), lent alongside the pool on the same terms |
| **Borrower equity** | $955K (35% of cargo value), paid into the collection account before drawdown |
| **Duration** | 20 days, from drawdown to LC payment |
| **Interest rate** | 14.4% gross annualised |
| **Collateral structure** | Pledge of the full set of bills of lading; assignment of the sale proceeds |
| **Price reference** | Contract formula on the LBMA Gold Price, adjusted for grade |
| **Payment mechanism** | LC at sight, confirmed outside China by a Tier-1 bank |
| **Hedging** | Back-to-back sale on the same price formula, with pricing periods matched |
| **Insurance** | ICC (A) cargo cover at CIF value plus 10%, with the Security Agent as loss payee |

## Lifecycle flow

{% include diagram.html src="boss-loan-lifecycle.jpeg" caption="Reference transaction lifecycle — origination through repayment and closure." %}

### Step-by-step

#### Sourcing

The Originator identifies the deal. A trader buys gold pyrite concentrate FOB Greece and has sold it to a buyer in China.

#### KYB and pre-screening

The Originator submits KYB packs for the borrower, the buyer and the inspector. Pipeline runs AML and sanctions checks on every party and its owners, and a conflict-minerals check on the origin of the concentrate.

#### Term sheet and underwriting

The Originator prepares the term sheet and credit memo: facility size, duration, pricing, collateral, hedging and a risk score for every counterparty. Underwriting covers the assay and price formula, the corridor and the buyer's payment route.

#### Risk Council approval

Pipeline screens the file against the Credit Policy: commodity class and advance ratio, jurisdictions, risk scores, concentration and the payment route for a Chinese buyer. The Risk Council approves the facility and records it on-chain as Approved.

#### Originator's share

The Originator pays its $265K share, 15% of the facility and 10% of the cargo value, to the lending vehicle before the drawdown, where it is held on trust for the Originator.

#### Collection account and notices

The borrower opens a collection account at an investment-grade bank that gives it no credit facility and waives set-off. The account is charged to the Security Agent, which co-signs every payment out of it, and a standing instruction sends receipts to the lending vehicle. The seller acknowledges Pipeline as financier, and the buyer is notified that the sale proceeds are assigned to the lenders.

#### Loading

The concentrate loads at the Greek port, and the inspector certifies its quantity and quality. The full set of bills of lading is endorsed to the Security Agent by way of pledge.

#### Drawdown

Before the drawdown, the borrower pays its $955K equity into the collection account, a local legal opinion confirms the security ranks first, and the buyer's LC is issued. The Independent Trustee approves the drawdown, and the lending vehicle pays the $1.765M facility into the collection account. Interest starts to accrue and the loan becomes Performing.

#### Payment to the seller

The Security Agent checks the bills of lading and approves paying the seller the full $2.72M price from the collection account.

#### Daily monitoring

The platform marks the concentrate daily on its contract formula: payable gold at the LBMA price on the latest assay, less treatment charges and penalties. If LTV rises above 70%, a margin call opens, and the borrower restores 65% within 3 business days, in cash or by partial repayment. At 75%, the Risk Council may declare a default.

#### LC payment

On day 20, the Security Agent releases the shipping documents for presentation under the LC, and the confirming bank pays at sight into the collection account while the cargo is still at sea. A standing instruction sends the receipts to the lending vehicle by the next business day.

#### Repayment and yield

The receipts are applied to the lenders by share: $1.5M of principal with its interest to the lending vehicle, and $265K with its interest to the Originator. Paying the Originator needs the Independent Trustee's co-signature. The pool's interest, net of fees, is minted as PLUSD into the staking vault, and the sPLUSD price rises.

#### Release and closing

The Security Agent releases its remaining security, the surplus goes to the borrower within one business day, and the facility is closed.

## Illustrative investor yield

The illustrative fee rates below, the Originator's servicing fee of 1.5% a year and a Pipeline performance fee of 2% a year, both on deployed capital, apply to the pool's share. Interest accrues on a 365.25-day year.

| Component | Value |
|---|---|
| **Pool capital deployed (85% of the $1.765M facility)** | $1,500,000 |
| **Gross interest rate (annualised)** | 14.4% |
| **Duration** | 20 days |
| **Gross interest earned** | $11,828 ($1.5M × 14.4% × 20/365.25) |
| **Less: Originator's servicing fee (1.5% a year)** | ($1,232) |
| **Less: Pipeline performance fee (2% a year)** | ($1,643) |
| **Net interest to sPLUSD holders from this deal** | $8,953 |
| **Effective net yield (annualised, on deployed capital)** | ~10.9% |

A 20-day duration means deployed capital recycles about 18 times a year.
