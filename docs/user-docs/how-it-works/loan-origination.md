---
title: Loan origination and underwriting
order: 7
section: How Pipeline works
---

# Loan origination and underwriting

## The Originator model

Originators are private credit funds in commodity trade finance and other experts in this domain with their own borrower networks and underwriting teams. Pipeline qualifies the Originator, agrees programmatic terms, then takes deal flow. Every Originator passes onboarding (KYC, audited financials, track record, sanctions, and AML) before submitting deals.

On every deal, the Originator commits the equity tranche — up to 30% of facility size — as first-loss capital. An Originator who underwrites carelessly loses their own money first.

<div class="callout info">
Qualified Originators source, underwrite, and stand behind every loan.
</div>

## Inaugural Originator: Open Mineral AG

Swiss metals merchant founded by ex-Glencore principals, backed by Mubadala. The team has financed and traded billions of dollars of base-metal and concentrate flows across Asia, Europe, and Latin America.

## How a deal moves through Pipeline

### Phase 1 — Sourcing

The Originator identifies a deal — a borrower with a contracted offtake, a cargo to finance, a known corridor. They submit an indicative term sheet: commodity, corridor, facility size, duration, pricing, collateral, hedging.

Pipeline pre-screens against eligibility: whitelist commodity, whitelist corridor, concentration headroom, duration bounds, hedging adequacy. Counterparty KYC is initiated on borrower, offtaker, and CMA.

### Phase 2 — Structuring

If pre-screen clears, external counsel scopes loan documentation, security package, and enforcement. The Originator negotiates structure with borrower and offtaker — collateral pledge, payment mechanism (LC at sight, documentary collection, escrow), inspection schedule, hedging.

The Originator appoints an independent CMA (SGS, Cotecna, Intertek). The CMA agreement aligns with the Collateral Trust security package. Independent cargo inspectors handle load, transit, and discharge checkpoints. Liquidators are pre-onboarded so collateral can be moved within hours of a default.

Benchmark price source locked for daily LTV margining — Platts or Argus. Hedging strategy documented per the Credit Policy.

### Phase 3 — Risk committee approval

The Originator presents the underwriting package. The committee reviews against the Credit Policy:

- Borrower tier and the pricing/turnaround envelope
- Commodity tier and concentration headroom
- Corridor tier and corridor-specific modifiers
- LTV ladder with corridor, commodity, and counterparty modifiers stacked
- Duration within product bounds
- Hedging adequacy and benchmark price linkage
- Single-counterparty exposure across borrower, offtaker, CMA

On approval, the loan is recorded in the LoanRegistry smart contract. Origination data is immutable; lifecycle state is mutable.

### Phase 4 — Funding

Equity committed first. Senior drawn from the Capital Wallet under the 3-of-5 cosigner quorum, routed via the Payment Agent to fund the seller.

## Borrower tiers

| Tier | Profile | Turnaround |
|---|---|---|
| **Tier 1** | Investment-grade or top-tier merchant with audited financials and prior trade history | 48 hours |
| **Tier 2** | Mid-market with verified financials and recurring trade flow | 5 days |
| **Tier 3** | Smaller or newer merchant with collateral-driven approval | 10 days |

## Originator qualification

Each candidate runs through:

- Corporate KYC, UBO disclosure, audited financial statements (minimum two-year horizon)
- Track record review — completed transactions, default history, recovery history
- Underwriting standards — credit policy, monitoring framework, default workout
- Sanctions, AML, and adverse media across principals and the firm
- Reference checks with prior bank lenders and counterparties
