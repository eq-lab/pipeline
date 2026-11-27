---
title: Loan origination
order: 7
section: How Pipeline works
---

# Loan origination

## The Originator model

Loan Originators are private credit funds and other commodity trade finance lenders with their own borrower networks and underwriting teams. Pipeline qualifies each Originator, agrees programmatic terms, then takes its deal flow. Every Originator passes onboarding (KYB and KYT, audited financials, track record, sanctions, and AML) before submitting deals.

<div class="callout info">
Qualified Originators source and underwrite every loan, and lend their own money in it on the same terms as the pool.
</div>

### Originators have skin in the game

The Originator underwrites each facility it brings and lends in it pari passu with the lending vehicle: same rate, same security, losses shared by each lender's share. Its minimum share is set by the deal score, the lower of the borrower's and the offtaker's Risk Score:

| Deal score | Minimum Originator share |
|---|---|
| 4.00 or more | 5% |
| 3.00–3.99 | 10% |
| 2.00–2.99 | 20% |
| Below 2.00 | Not financed |

Where the Originator is the borrower or its affiliate, its group funds at least 20% of the facility and an unaffiliated co-lender at least a further 10%, so the lending vehicle funds at most 70%. The affiliation is disclosed to the Risk Council and all lenders before approval.

The Originator earns interest on its share, plus a servicing fee from the pool's interest where the facility terms provide one.

## How a deal moves through Pipeline

### Phase 1 — Sourcing

The Originator identifies a deal: a borrower with a contracted sale, a cargo to finance, a known corridor. It submits an indicative term sheet: commodity, corridor, facility size, duration, pricing, collateral, hedging.

Pipeline pre-screens it against the Credit Policy: eligible commodity; listed jurisdictions for every counterparty and every place the goods are loaded, stored or discharged; corridor; concentration headroom; tenor; price-risk cover. KYB, AML and sanctions checks start on every party and its beneficial owners.

### Phase 2 — Structuring

If the pre-screen clears, external counsel scopes the loan documentation, security package and enforcement. The Originator negotiates the structure with the borrower and the offtaker: the security, the payment route (an LC, cash against documents, or an open-account sale with credit insurance), the inspection plan and the hedge.

The borrower appoints and pays an independent inspector from Pipeline's panel, who checks the goods at loading, in transit where the route needs it, and at discharge. Stored goods sit under a collateral management agreement and are reported on at least weekly.

The Security Agent holds the security on trust for all lenders and co-signs the borrower's collection account. A local legal opinion confirms that the security ranks first. A primary liquidator and two independent back-ups are onboarded for the corridor before drawdown.

An independent price source is fixed for daily LTV monitoring: Platts, Argus or an exchange price, through the contract formula where the goods are formula-priced. Price risk is covered by a back-to-back sale, a financial hedge or a contracted pricing formula.

### Phase 3 — Risk Council approval

The Originator prepares the underwriting file: the term sheet and its credit memo with every Risk Score, the KYB, AML and sanctions checks, the borrower's audited accounts, the signed purchase and sale contracts, hedging evidence, the security documents, insurance and legal opinion, the inspection plan and the liquidators. The Risk Council screens it against the Credit Policy:

- Commodity class and advance ratio
- Jurisdictions and corridor, and the payment route for a PRC buyer
- Every counterparty's Risk Score and the approval route it sets
- Facility size, tenor and price-risk cover
- Concentration headroom
- The security package and the collection account

A facility needs 2 of 3 votes, or every member who is not recused where any Risk Score is 2.00–2.99. The Risk Council approves the facility and records it on-chain as Approved, and the lending vehicle's independent director approves it after the Council.

### Phase 4 — Funding

Before the drawdown, the Originator pays its share to the lending vehicle, where it is held on trust for the Originator. The borrower pays its equity into the collection account, the notices of assignment go out, and the Independent Trustee approves the drawdown.

The lending vehicle pays the whole drawdown, the Originator's share included, into the collection account, and interest starts. The Security Agent releases the funds to the seller only against the seller's documents of title or holding certificate, or as cash cover for an import LC.

## Counterparty Risk Score

Every counterparty is scored before funding on eight weighted axes, from 1.00 to 5.00. The lowest score among a facility's counterparties sets its approval route.

| Score | Route |
|---|---|
| 4.00 or more | Standard approval |
| 3.00–3.99 | Enhanced due diligence; the credit memo names the weak axes and their mitigants |
| 2.00–2.99 | Unanimous approval and at least one structural mitigant: smaller size, shorter tenor, extra insurance or extra collateral |
| Below 2.00 | Rejected |

A score of 1 on jurisdiction, financial strength or independence rejects the counterparty whatever the total.

## Originator qualification

Each candidate runs through:

- KYB and KYT, UBO disclosure, audited financial statements (minimum two-year horizon)
- Track record review: completed transactions, default history, recovery history
- Underwriting standards: credit policy, monitoring framework, default workout
- Sanctions, AML, and adverse media across principals and the firm
- Reference checks with prior bank lenders and counterparties
