---
title: Risk management
order: 8
section: How Pipeline works
---

# Risk management

Pipeline's risk management rests on one document, the Credit Policy. It consists of two parts—Part A, the Risk Mandate, and Part B, which sets operational rules.

The Risk Council approves the policy and every change to it, and reviews it every quarter. Changes apply to new facilities; live facilities keep their terms.

## Risk Mandate

The Risk Mandate, Part A of the Credit Policy, sets what Pipeline may finance and the hard limits. Here's what the Mandate defines:

- Secured lending: full-recourse loans with first-ranking security; no pre-shipment advances, sea waybills as title, or production finance
- Eligible commodities in three classes, with advance ratio caps of 80%, 75% and 65%
- Jurisdiction tiers and exclusions
- Payment routes for PRC buyers
- Facility limits: size, tenor up to 180 days, valuation and price-risk cover
- Concentration limits, applied once the pool passes $30M
- Co-lending: the Originator's minimum share and the affiliated-party rules

## Part B: Credit Policy

Part B of the Credit Policy puts the Risk Mandate into practice. It sets the operational and monitoring rulebook for every loan. It defines:

- The Risk Council and its voting and recusal rules
- The counterparty Risk Score and approval routes
- The underwriting file
- The security package, the Security Agent and the collection account
- Drawdown conditions
- Monitoring and margin calls
- Interest, grace, default and enforcement
- Reporting

Every loan is underwritten against the Credit Policy by the Originator, screened by Pipeline and approved by the Risk Council. The full policy is in the lender data room. A summary is published in [Credit policy overview](/risks/credit-policy/).

## Risk Council

The Risk Council has three voting seats: a commodity trade finance practitioner, a commodity lawyer, and a representative of the lender with the largest share of the pool. The Risk Council:

- Approves every facility: 2 of 3 votes, or every member who is not recused where any Risk Score is 2.00–2.99
- Reviews concentration weekly
- Monitors live loans and escalates material events
- Declares events of default and responds to sanctions events
- Writes down losses, cures defaults and closes defaulted loans
- Amends loan terms and extends loans
- Reverses wrong drawdown and repayment entries
- Resolves inspection flags and may set a manual collateral price
- Keeps the jurisdiction and commodity lists

Its on-chain actions run through the Risk Council role. Default declaration and repayment reversals run without delay. Its other actions run with a 24-hour delay. Each decision is minuted with its rationale and signed through the Risk Council Multisig. See [Risk Council](/governance/risk-committee/).

## Continuous monitoring

Every live loan is monitored daily.

*Cargo and security.* An independent inspector checks the goods at loading, in transit where the route needs it, and at discharge. Stored goods are reported on at least weekly. Reports go to the Security Agent. Pipeline reviews every report, escalates quality or quantity deviations to the Risk Council, and may reinspect at any time.

*LTV and price.* The platform feeds market prices into the security registry daily and on any move above 2%. LTV is the loan's principal outstanding plus accrued interest, divided by the value of its active security. Goods count at counted quantity times market price, or by the contract formula for formula-priced goods. Cash cover, prepayments, receivables and LC proceeds count at face value. Insurance never counts. There is no haircut.

| Threshold | Rule |
|---|---|
| Advance ratio | The highest LTV at drawdown: 80%, 75% or 65% by commodity class, at least 10 points lower for open-account sales |
| Margin call | Opens at the advance ratio + 5 points. LTV must be restored to the advance ratio within 3 business days, in cash or by partial repayment |
| Default | At the advance ratio + 10 points, the Risk Council may declare an event of default |

{% include diagram.html src="boss-ccr-thresholds.png" caption="LTV thresholds for an 80% facility. A margin call opens at 85% and must bring LTV back to 80% within 3 business days. At 90%, the Risk Council may declare a default." %}

A stale price does not open a margin call; it alerts the Risk Council. An uncured margin call is an event of default, which the Risk Council declares.

*Interest.* Interest is simple interest on principal outstanding, on a 365.25-day year. It is invoiced monthly in arrears and paid separately from principal. Up to 7 days late, it runs at the contract rate. From day 8, default interest at the contract rate + 5 points applies. From day 21, an event of default may be declared.

*Counterparty.* Every counterparty is scored before funding and re-scored on a schedule and on material events. Borrower, offtaker, collateral manager and inspector are under continuous sanctions and adverse-media screening. Every vessel is tracked by AIS, and every invoice price is tested against the market.

## Default declaration

A loan is declared in default when one of the Credit Policy's events of default occurs:

- A payment 21 days past due
- An uncured margin call
- Receipts left in the collection account for more than 2 business days, a change of its mandate, or a diverted payment
- Covenant breach, insolvency, material adverse change or cross-default
- A PRC payment route failing with no substitute within 10 business days
- A counterparty scored below 2.00 or knocked out, and not replaced within 10 business days

The Risk Council declares the default, and it is recorded on-chain. The pool's share of the principal outstanding then moves from the vault into a pocket owned by the sPLUSD vault holders at that moment. Recoveries go to that pocket. Write-downs burn from it. From there, [Default management](/risks/default-management/) governs the workout: enforcement by the Security Agent and sale through pre-onboarded liquidators.
