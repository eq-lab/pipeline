---
title: Credit policy overview
order: 34
section: Risk management
---

# Credit policy overview

The Credit Policy is the underwriting and monitoring rulebook for every Pipeline loan. The Originator underwrites each facility against it. The Risk Council reviews it before origination. This page summarises the live document, which sits with the Risk Council.

Pipeline lends only where, on every day the money is out, it holds the goods or a bank's promise to pay. Advances secured only by a supply contract and the trader's promise stay with the Originator.

## Borrower tier framework

Three tiers, assigned by the Originator and confirmed by the Risk Council:

| Tier | Borrower profile |
|---|---|
| **Tier 1** | Investment-grade or top-tier merchant; audited financials; multi-year prior trade history |
| **Tier 2** | Mid-market with verified financials and recurring trade flow |
| **Tier 3** | Smaller or newer merchant; collateral-driven approval |

## Eligible commodities

- Base metals: copper, zinc, aluminium, nickel, lead
- Oil and refined products: crude, jet fuel, diesel, naphtha, fuel oil
- Agricultural softs: coffee, cocoa, sugar, cotton
- Grains and oilseeds: wheat, corn, soybeans, rapeseed
- Biofuels and edible oils: palm oil, ethanol, biodiesel

Specific exclusions (e.g. exotic chemicals, controlled substances, sanctioned commodity origins) are maintained in the full Credit Policy.

## Eligible corridors

The Risk Council maintains a pre-approved corridor list. Each deal is reviewed by goods, corridor and counterparties, with a liquidation plan. Every counterparty passes KYB and KYT: lenders, Originators, borrowers, offtakers and every other party to the deal.

## LTV framework

LTV is the amount owed divided by the value of the security. The amount owed is outstanding principal plus accrued interest. No haircut is applied to the value.

| Security | Value |
|---|---|
| Goods (endorsed bill of lading, warehouse pledge, collateral management) | Counted quantity × market price. Counted quantity is the smaller of the document quantity and the latest approved inspection |
| Assigned receivable, letter of credit proceeds, cash cover, prepayment | Face amount |
| Insurance with the Security Agent as loss payee | Not counted |

Each loan carries its own terms:

| Term | Default |
|---|---|
| Advance ratio: highest LTV at drawdown, and the LTV a margin call must restore | 80 % |
| Margin-call ratio: LTV that opens a margin call | 85 % |
| Cure period | Per loan |
| Grace period after maturity | Per loan |

| Event | When |
|---|---|
| Margin call | LTV rises above the margin-call ratio. The borrower must bring LTV back to the advance ratio within the cure period, with cash or goods |
| Cure | LTV is back at or below the advance ratio |
| Default | The Risk Council declares it. Default is never automatic |

The platform feeds market prices on-chain. A margin call does not open on a stale price. The Risk Council can set a price by hand. These checks run in the security registry.

## Concentration limits

Hard ceilings, scaling with pool size:

- Single-facility: capped percentage of pool
- Single-borrower: capped percentage of pool, aggregating across facilities
- Single-offtaker: capped percentage of pool
- Single-Originator: capped percentage of pool
- Single-commodity: capped percentage of pool
- Single-corridor: capped percentage of pool

## Affiliated-party lending

Pipeline permits affiliated-party lending. Where the Originator and Borrower are affiliated, the equity tranche commitment must be documented, and the Risk Council review is heightened.

## Hedging requirements

Where commodity price moves could affect LTV, the loan must include a hedging plan signed off at structuring. Hedge counterparties are documented. Loss of cover triggers Risk Council review.
