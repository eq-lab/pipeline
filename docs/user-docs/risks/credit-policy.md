---
title: Credit policy
order: 34
section: Risk management
---

# Credit policy

The Credit Policy is the rulebook for every Pipeline loan. Part A, the Risk Mandate, sets what Pipeline may finance and the hard limits. Part B sets how facilities are approved, secured, monitored and enforced. The Risk Council approves the policy and every change to it, and reviews it every quarter. Changes apply to new facilities; live facilities keep their terms. This page summarises the current version, v2.3. The full policy is in the lender data room.

## Secured lending

Every facility is a full-recourse loan to the borrower, secured on the trade it finances. The Security Agent holds, for all lenders, a pledge of the documents of title, an assignment of the sale proceeds, the insurance proceeds and control of the collection account. Security must rank first.

- Every drawdown is paid into the borrower's collection account. The Security Agent releases it to the seller only against documents of title or holding certificates issued to its order, or as cash cover for an import LC.
- Pipeline is named as financier in the purchase contract, by an addendum the seller acknowledges. The offtaker receives notice that the sale proceeds are assigned.
- Not financed: pre-shipment advances of any kind, sea waybills as title, production or transformation finance, and legs where the sale proceeds arrive before the purchase payment.

## Eligible commodities

A commodity qualifies when it has a standard grade or an assayed specification, a shelf life of at least 12 months, daily traded volume well above the collateral, an independent price source such as Platts, Argus or an exchange price, and established secondary buyers in the corridor.

| Class | Commodities | Maximum advance ratio |
|---|---|---|
| A | Copper, zinc, aluminium, nickel, lead, tin; crude, jet fuel, diesel, naphtha, fuel oil; coffee, cocoa, sugar, cotton; wheat, corn, soybeans, rapeseed; palm oil | 80% |
| B | Copper and zinc concentrates; ethanol, biodiesel, biofuel feedstock; steam coal | 75% |
| C | Gold concentrate; tungsten, rare earths, scrap; cement clinker | 65% |

Tin, tungsten and gold concentrate need a conflict-minerals check on origin. Excluded: exotic chemicals, controlled substances and goods of sanctioned origin.

## Jurisdictions and corridors

Every counterparty, and every place the goods are loaded, stored or discharged, must be in a jurisdiction on the Risk Council's list, tiered by how reliably a creditor can enforce. Excluded outright: sanctioned jurisdictions, jurisdictions without functioning warehouse-receipt law, and jurisdictions in active armed conflict.

- No borrowers in Mainland PRC or other jurisdictions with capital controls, Türkiye and Vietnam included.
- No financing through the Red Sea and the Gulf of Aden or the Black Sea, or where war cover is unavailable.
- PRC buyers pay through one of four approved routes, such as an LC confirmed outside the PRC by an unaffiliated Tier-1 bank.

## Facility limits

| Limit | Rule |
|---|---|
| Size | Up to 2× the borrower's adjusted tangible net worth, net of related-party assets, where that covers at least one full cargo |
| Tenor | Up to 180 days |
| Advance ratio | Up to the class cap for sales by LC or cash against documents; at least 10 points lower for open-account sales, which need credit insurance on the offtaker |
| Valuation | The lower of the purchase and the sale value |
| Price risk | Covered by a back-to-back sale, a financial hedge or a contracted pricing formula |

## Concentration limits

There are no concentration limits while the pool is under $30M. Limits apply from $30M and tighten from $100M, each as a share of the pool's outstanding principal.

| Limit | Type | From $30M | From $100M |
|---|---|---|---|
| Single borrower | Hard | 30% | 30% |
| Tier 3 jurisdictions, combined | Hard | 50% | 20% |
| Single country | Soft | 60% | 35% |
| Single commodity | Soft | 70% | 50% |

A hard limit blocks new origination in that category until exposure falls below it. Crossing a soft limit triggers a Risk Council review.

## Co-lending

The Originator lends in every facility it originates, pari passu with the lending vehicle: same rate, same security, losses shared by each lender's share. It pays its share before each drawdown.

| Deal score | Minimum Originator share |
|---|---|
| 4.00 or more | 5% |
| 3.00–3.99 | 10% |
| 2.00–2.99 | 20% |
| Below 2.00 | Not financed |

Where the Originator is the borrower or its affiliate, its group funds at least 20% of the facility and an unaffiliated co-lender at least a further 10%. The affiliation is disclosed to the Risk Council and all lenders before approval.

## Approval

The Risk Council has three voting seats: a commodity trade finance practitioner, a commodity lawyer, and a representative of the lender with the largest share of the pool. A facility needs 2 of 3 votes, or every member who is not recused where any Risk Score is 2.00–2.99. A member does not vote on a facility in which they or their firm has a part.

Every counterparty is scored before funding on eight weighted axes, from 1.00 to 5.00. The lowest score sets the approval route: standard at 4.00 or more; enhanced due diligence at 3.00–3.99; unanimous approval and a structural mitigant at 2.00–2.99; rejection below 2.00. A score of 1 on jurisdiction, financial strength or independence rejects the counterparty. Counterparties are re-scored every six months, quarterly or monthly by band, and within 5 business days of a material event.

## Drawdown conditions

Each drawdown needs, among other conditions: signed purchase and sale contracts; the seller's acknowledgement of the financier addendum and notice of assignment to the offtaker; the documents of title held and checked by the Security Agent; the inspector's certificate; insurance; current sanctions screening; the local legal opinion; the collection account open and charged; the borrower's equity paid in; the Originator's share funded; the liquidators onboarded; and the Independent Trustee's approval.

## Monitoring and margin calls

Collateral is marked to market daily against the facility's price source. LTV is the amount outstanding divided by collateral value.

| LTV reaches | Action |
|---|---|
| Advance ratio + 5 points | Margin call: LTV restored to the advance ratio within 3 business days, in cash or by partial repayment |
| Advance ratio + 10 points | An event of default may be declared |

Ongoing checks: monthly management accounts from the borrower, AIS tracking of every vessel with draft-survey checks, every invoice price tested against the market, red flags for round-tripping, mis-invoicing and phantom cargo, and an annual site visit.

## Insurance

ICC (A) cover on every cargo at CIF value plus 10%, with the Security Agent as loss payee. All-risks cover for goods in storage. War and strikes cover placed separately; corridors without war cover are not financed.

## Interest, default and enforcement

Interest is simple interest on outstanding principal, on a 365.25-day year, invoiced monthly in arrears. A payment up to 7 days late runs at the contract rate. From day 8, default interest at the contract rate + 5 points applies. From day 21, an event of default may be declared.

Events of default include a payment default, an uncured margin call, receipts left in the collection account for more than 2 business days, a change of its mandate or a diverted payment, covenant breach, insolvency, material adverse change, cross-default, and a failed PRC payment route or counterparty not replaced within 10 business days. The Risk Council declares the default, and it is recorded on-chain.

On enforcement, the Security Agent takes control of the documents of title and the stock, collects the assigned receivables or completes the sale, and sells remaining goods through the primary liquidator or a back-up. Recoveries are applied to costs, then principal to all lenders pro rata, then contract and default interest, then protocol fees accrued up to the default date, then any surplus to the borrower. Losses fall on the lenders by share. See [Default management](/risks/default-management/).

## Reporting

A public daily dashboard shows PLUSD and sPLUSD supply, the sPLUSD price, the loan book by facility and the withdrawal queue. A monthly lender report covers yield, defaults, concentration, utilisation, counterparty changes, interest invoiced and collected, overdue amounts by facility, and reverse stress tests.
