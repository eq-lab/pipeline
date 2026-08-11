# Collateral Valuation

> How Pipeline values commodity collateral and derives each loan's Collateral Coverage Ratio (CCR). Feed cadence, notification thresholds, and the on-chain CCR write are in [price-feed.md](./price-feed.md). The on-chain loan fields are in [loans-data.md](./loans-data.md).

## Overview

Every active loan carries a collateral value that the relayer computes off-chain from a headline commodity price and per-deal terms. Collateral value divided by outstanding senior principal gives the CCR, the single collateral-health number the protocol monitors. The full valuation math runs off-chain. The chain stores only the resulting `ccr`.

## Budget

Ongoing price-data feeds stay at or below US$1,000 per year in aggregate. The protocol uses no Bloomberg or Refinitiv terminals and no full price reporting agency subscriptions. Per-cargo assay and inspection are a separate transaction cost borne by the trade counterparties and are not part of the feed budget.

## Price sources

- **Metal prices.** Read off-chain by the relayer from a low-cost commodity data API (working assumption: a metals and commodities REST API in the US$50 to US$320 per year range). Each payable metal is priced independently by its own asset symbol (gold `XAU`, silver `XAG`), so a multi-metal concentrate is priced correctly per metal — both are served by the same API and by Chainlink. An optional free cross-check reads an on-chain oracle off-chain (Chainlink or Pyth over RPC or the Hermes API, billed only per request).
- **Concentrate commercial terms.** From the signed offtake for each deal. Payable percentages, treatment and refining charges, penalties, quotational period, and incoterm are not a market feed.
- **Grades and quality.** From the independent assay certificate for each cargo.
- **Collateral quantity.** From the trustee feed, original quantity minus any delivered portions.
- **Haircut.** From the commodity haircut schedule in the credit framework.

Prices are consumed off-chain and are not published to any on-chain oracle. Full price reporting agency subscriptions (Platts, Argus, Fastmarkets, CRU) are out of budget at this stage.

The protocol distinguishes market price providers (live external feeds, e.g. MetalpriceAPI) from non-market stubs used only in development (the deterministic `static` provider). A production deployment refuses to resolve a non-market provider for a live loan — at loan submission, at price-collection time, and via a worker startup check — unless an explicit dev/test escape hatch is set.

## Valuation modes

Each loan is valued in one of two modes, selected in the loan's valuation record.

### Standard goods

This mode covers refined metal, grain, refined product, and exchange-deliverable material. Collateral value is the reference price times the current quantity, with the commodity haircut applied.

```
collateral_value = reference_price * quantity * (1 - haircut)
```

### Metal concentrate

The first deal, gold-pyrite concentrate, uses this mode. A concentrate is not worth price times quantity. It is worth its Net Smelter Return (NSR), the amount the seller receives after the smelter's payable terms and charges. The relayer runs the waterfall per payable metal, then sums.

```
payable_metal    = max(0, grade * payable_pct - min_deduction) * quantity
gross_value      = Σ over metals of payable_metal * reference_price(metal)
nsr              = gross_value - treatment_charge - refining_charge - penalties
mine_gate_value  = nsr - realisation_costs
collateral_value = mine_gate_value * (1 - haircut)
```

**Payable metal floors at zero.** A metal whose grade is below its minimum deduction pays nothing, never a negative amount — the physical offtake never charges back a metal it does not pay for. The `max(0, …)` on each metal keeps a below-floor metal from subtracting value from the others, the same way the penalty `steps` floor at zero.

**Each payable metal is priced by its own reference price.** A gold-pyrite concentrate with a payable silver credit values the silver at the silver price and the gold at the gold price — never one metal's price applied to both. Each metal name resolves to its own price-feed asset symbol (gold → `XAU`, silver → `XAG`), and the price collector keeps a series for every payable metal's asset, not just the loan's headline asset. If any payable metal has no price yet, the loan reads *unpriced* rather than being valued against another metal's feed. `gross_value` then sums `payable_metal * reference_price(metal)` across the metals.

`payable_pct` and `haircut` are multiplicative and scale with price and quantity. `treatment_charge`, `refining_charge`, `penalties`, and `realisation_costs` are fixed dollar amounts that do not move with the metal price, so collateral value falls faster than the headline price when the metal price drops. `mine_gate_value` is the NSR after the seller's own costs of getting the cargo to the buyer (freight, insurance, superintendence, marketing). The haircut then absorbs residual risks such as quotational-period price drift, assay dispersion, a narrow buyer pool, smelter counterparty performance, and collateral perfection.

### Worked example

A lot of 100 dry metric tonnes at 50 g/t gold and 2% arsenic, with gold at US$4,000 per ounce. Offtake terms: payable 80%, minimum deduction 1 g/t, treatment charge US$220 per dry tonne, refining charge US$6 per payable ounce, and an arsenic penalty of US$5 per dry tonne for each 0.1% above 0.2%. Realisation costs and the haircut shown here are illustrative and are set per deal.

| Line | Calculation | US$ |
|---|---|---|
| Contained gold value | 100 t x 50 g/t / 31.1035 = 160.75 oz, x $4,000 | 643,000 |
| Payable gold | (50 x 0.80 - 1) x 100 / 31.1035 = 125.4 oz, x $4,000 | 501,600 |
| Treatment charge | 100 t x $220 | (22,000) |
| Refining charge | 125.4 oz x $6 | (752) |
| Arsenic penalty | (2.0 - 0.2) / 0.1 x $5 x 100 t | (9,000) |
| Net Smelter Return | | 469,848 |
| Realisation costs (illustrative) | freight, insurance, superintendence, marketing | (12,000) |
| Mine-gate value | | 457,848 |
| Collateral value | mine-gate x (1 - 0.40 haircut, illustrative) | 274,709 |

Against an outstanding senior principal of US$200,000, CCR = 274,709 / 200,000 = 137%, above the 130% watchlist threshold. A refractory gold-pyrite concentrate typically realises 55% to 75% of its contained-gold value before the haircut, which is why the payable percentage and the charges matter more than the headline gold price.

Penalty arithmetic compares three quantities — the assayed level, the schedule threshold, and the step — so all three must share a unit. The assay level and the schedule threshold/step each carry their own `unit` (`Pct` or `Ppm`) and are normalised to percent before the comparison, so a trace element scheduled in ppm (e.g. mercury at 10 ppm) is handled correctly whether the assay reports percent or ppm.

## On-chain and off-chain split

| Layer | Holds | Notes |
|---|---|---|
| On-chain, LoanRegistry | `ccr`, `last_reported_ccr_timestamp`, `metadata_uri`, and genesis economics including `original_offtaker_price` | One derived health number, not the valuation inputs. The registry is informational and is not a NAV input. |
| Off-chain, relayer Postgres (the loan mirror) | the valuation record below | Recomputed on every price tick. |
| Off-chain, IPFS (pointed to by `metadata_uri`) | the assay certificate and the offtake extract, or their hashes, plus governing law and the borrower hash | Descriptive evidence only. Nothing here drives on-chain money math. |

The assay is the independent laboratory Certificate of Analysis for a cargo, covering metal grades, deleterious elements, and moisture. The offtake extract is the set of commercial terms taken from the signed sale contract, covering payable percentages, charges, penalty schedule, quotational period, and incoterm. Both are per cargo.

## Per-loan valuation record

The relayer keeps one valuation record per active loan in its Postgres store, the loan mirror. It is the working state behind the valuation and is never written on-chain. The trustee feed supplies quantity and location. The signed offtake supplies commercial terms. The independent assay supplies grades. The price feed recomputes the cached outputs on every tick. Standard-goods loans leave the concentrate-only fields empty.

| Field | Source | Meaning |
|---|---|---|
| loan_id | mint | Matches the on-chain loan id |
| valuation_mode | onboarding | StandardGoods or MetalConcentrate |
| commodity | onboarding | For example gold_pyrite_concentrate |
| quantity_dmt | trustee feed | Current dry metric tonnes, original minus delivered |
| moisture_pct | assay | Wet-to-dry conversion and transportable-moisture-limit monitoring |
| assays | assay | Payable metal grades in g/t (gold, silver) |
| deleterious | assay | Penalty elements and levels (arsenic, antimony, mercury, and others) |
| assay_certificate_uri | assay | IPFS pointer or hash of the Certificate of Analysis |
| assay_status | assay | Provisional, Final, or UmpirePending |
| payable_terms | offtake | Per metal payable percentage and minimum deduction |
| treatment_charge_per_dmt | offtake | Treatment charge in US$ per dry tonne |
| refining_charges | offtake | Refining charge per payable ounce, per metal |
| penalty_schedule | offtake | Per element threshold, step, rate, and flat or escalating basis. Threshold and step carry a `unit` (`Pct` or `Ppm`, default `Pct`) and are normalised to percent for the waterfall, the same as the assay `deleterious` level — so a ppm-authored schedule is compared like-for-like against a ppm assay and never silently scores zero |
| realisation_costs | offtake and logistics | Freight, insurance, superintendence, marketing |
| quotational_period | offtake | For example 2 MAMA |
| pricing_reference | offtake | For example LBMA Gold PM averaged over the quotational period |
| incoterm | offtake | FOB, CFR, or CIF. Sets delivery and risk, not title |
| reference_price | price feed | Last price read, **per payable metal** — each metal keyed by its own price-feed asset symbol (gold → XAU, silver → XAG) under the loan's price provider |
| haircut_pct | credit framework | By commodity and grade |
| nsr, mine_gate_value, collateral_value | computed | Waterfall outputs |
| ccr_bps | computed | Live CCR, 14000 means 140% |
| last_onchain_ccr | computed | Last value written on-chain, used to batch writes |

Access to the record follows the same authority as the on-chain loan. The Team and Trustee enter and approve the human inputs (quantity, offtake terms, assay values) through the Operations Console. The relayer price-feed service writes the computed fields automatically. The commercial inputs are append-only and audit-logged, with no silent edit or hard delete, because document fraud is a primary loss driver in commodity finance. The exact record shape is defined in the relayer exec plan.

## How it feeds CCR

CCR = `collateral_value / outstanding_senior_principal`, in basis points, where 14000 means 140%. Outstanding senior principal is the genesis senior tranche less senior principal repaid, mirrored from LoanRegistry.

The relayer recomputes CCR on every price tick and asks the Trustee to write `ccr` on-chain only when a monitoring threshold is crossed. The thresholds (watchlist at 130%, maintenance margin call at 120%, margin call at 110%), the notification recipients, and the batched on-chain write are defined in [price-feed.md](./price-feed.md). CCR is informational. It does not gate mints and does not move sPLUSD share price. A hard on-chain CCR floor would require a contract change and is out of scope for the first deal.
