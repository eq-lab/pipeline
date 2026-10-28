---
title: Loan origination and underwriting
order: 7
section: How Pipeline works
---

# Loan origination and underwriting

## The Originator model

Originators are private credit funds in commodity trade finance and other experts in this domain with their own borrower networks and underwriting teams. Pipeline qualifies the Originator, agrees programmatic terms, then takes deal flow. Every Originator passes onboarding (KYB and KYT, audited financials, track record, sanctions, and AML) before submitting deals.

On every deal, the Originator commits the equity tranche, up to 30% of facility size, as first-loss capital.

<div class="callout info">
Qualified Originators source, underwrite, and stand behind every loan.
</div>

## How a deal moves through Pipeline

### Phase 1 — Sourcing

The Originator identifies a deal: a borrower with a contracted offtake, a cargo to finance, a known corridor. They submit an indicative term sheet: commodity, corridor, facility size, duration, pricing, collateral, hedging.

Pipeline pre-screens against eligibility: whitelist commodity, whitelist corridor, concentration headroom, duration bounds, hedging adequacy. KYB and KYT are initiated on borrower, offtaker, CMA and every other counterparty.

### Phase 2 — Structuring

If pre-screen clears, external counsel scopes loan documentation, security package, and enforcement. The Originator negotiates structure with borrower and offtaker: collateral pledge, payment mechanism (LC at sight, documentary collection, escrow), inspection schedule, hedging.

The Originator appoints an independent CMA (SGS, Cotecna, Intertek). Independent inspectors, appointed by the lending vehicle, handle load, transit, and discharge checkpoints. The Security Agent holds the security on trust for all lenders and co-signs the collection account. A local legal opinion confirms that the security ranks first. Liquidators are pre-onboarded so collateral can be moved quickly after a default.

A benchmark price source is fixed for LTV monitoring. Hedging strategy is documented per the Credit Policy.

### Phase 3 — Risk Council approval

The Originator presents the underwriting package. The Risk Council reviews it against the Credit Policy:

- Borrower tier and the pricing/turnaround envelope
- Commodity tier and concentration headroom
- Corridor tier and corridor-specific modifiers
- LTV ladder with corridor, commodity, and counterparty modifiers stacked
- Duration within product bounds
- Hedging adequacy and benchmark price linkage
- Single-counterparty exposure across borrower, offtaker, CMA

On approval, the Trustee records the loan in the loan registry with status Approved. The data fixed at origination cannot change: borrower reference, facility size, senior and equity tranches, offtaker price, interest rate, origination and maturity dates. Lifecycle state changes over the loan's life. In the security registry, the Risk Council sets the loan's security terms: advance ratio, margin-call ratio and cure period.

### Phase 4 — Funding

The Originator commits the equity tranche. The loan record holds the senior and equity amounts. The protocol does not check the equity payment.

The Trustee wires the senior tranche from the USD bank account to the borrower and records the disbursement. The first disbursement moves the loan to Performing and starts interest. A per-loan debt token is issued for principal outstanding.

## Borrower tiers

| Tier | Profile | Turnaround |
|---|---|---|
| **Tier 1** | Investment-grade or top-tier merchant with audited financials and prior trade history | 48 hours |
| **Tier 2** | Mid-market with verified financials and recurring trade flow | 5 days |
| **Tier 3** | Smaller or newer merchant with collateral-driven approval | 10 days |

## Originator qualification

Each candidate runs through:

- KYB and KYT, UBO disclosure, audited financial statements (minimum two-year horizon)
- Track record review: completed transactions, default history, recovery history
- Underwriting standards: credit policy, monitoring framework, default workout
- Sanctions, AML, and adverse media across principals and the firm
- Reference checks with prior bank lenders and counterparties
