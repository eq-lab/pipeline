---
title: Credit policy overview
order: 34
section: Risk management
---

# Credit policy overview

The Credit Policy is the underwriting and monitoring rulebook for every Pipeline loan. Every facility is underwritten against it by the Originator and re-tested by the Risk committee before origination. This page summarises the live document, which sits with the Risk committee and is reviewed quarterly under the Risk Mandate.

## Borrower tier framework

Three tiers, assigned by the Originator and confirmed by the Risk committee:

| Tier | Borrower profile |
|---|---|
| **Tier 1** | Investment-grade or top-tier merchant; audited financials; multi-year prior trade history |
| **Tier 2** | Mid-market with verified financials and recurring trade flow |
| **Tier 3** | Smaller or newer merchant; collateral-driven approval |

## Eligible commodities

- Base metals — copper, zinc, aluminium, nickel, lead
- Oil and refined products — crude, jet fuel, diesel, naphtha, fuel oil
- Agricultural softs — coffee, cocoa, sugar, cotton
- Grains and oilseeds — wheat, corn, soybeans, rapeseed
- Biofuels and edible oils — palm oil, ethanol, biodiesel

Specific exclusions (e.g. exotic chemicals, controlled substances, sanctioned commodity origins) are maintained in the full Credit Policy.

## Eligible corridors

Pre-approved corridor list maintained by the Risk committee. New corridors added by ADMIN governance with the standard 3-day timelock. Corridor risk modifiers feed into the LTV ladder — challenging corridors carry tighter LTV thresholds.

## LTV framework

Base LTV per commodity class, with stacking modifiers for corridor risk, counterparty tier, and duration. Daily mark-to-market against Platts or Argus assessments. Margin events trigger at defined thresholds:

- **Initial threshold** — Originator notified; advisory level
- **Margin call** — Originator must top up collateral within the cure window
- **Default threshold** — Risk committee may declare default; `setDefault` on LoanRegistry

## Concentration limits

Hard ceilings, scaling with pool size:

- Single-facility — capped percentage of pool
- Single-borrower — capped percentage of pool, aggregating across facilities
- Single-offtaker — capped percentage of pool
- Single-Originator — capped percentage of pool
- Single-commodity — capped percentage of pool
- Single-corridor — capped percentage of pool

The Risk committee reviews concentration weekly and may pause new approvals to a tier if a ceiling tightens.

## Affiliated-party lending

Pipeline permits affiliated-party lending under structural protections. Where the Originator and Borrower are affiliated, the equity tranche commitment must be public and documented, and Risk committee scrutiny is heightened. Economic alignment via the equity tranche is stronger than third-party-only lending in this asset class.

## Hedging requirements

Where commodity price volatility could affect collateral coverage, the loan must include a hedging plan signed off at structuring. Hedge counterparties documented; positions marked daily; loss of cover triggers Risk committee review.
