# Price Feed & Notifications

## Overview

The relayer service runs a continuous price feed and notification subsystem that monitors every active loan in the LoanRegistry in real time. It computes per-loan collateral coverage ratios (CCR) against external commodity reference prices and dispatches notifications to relevant parties on threshold crossings and operational events.

## Price Feed

**Sources.** The headline reference price for each financed commodity is read off-chain by the relayer from a low-cost commodity data API (working assumption: a metals and commodities REST API in the US$50 to US$320 per year range), with an optional free cross-check by reading an on-chain oracle off-chain (Chainlink or Pyth over RPC or the Hermes API, billed only per request). Prices are consumed off-chain. They are not published to any on-chain oracle.

Full price reporting agency subscriptions (Platts, Argus, Fastmarkets, CRU) are out of budget at this stage and are not needed for the headline price. They stay on the roadmap as an upgrade once volume justifies the cost. The concentrate-specific value of a cargo does not come from a price feed at all. It comes from the per-deal offtake terms and the independent assay, described under Per-loan collateral valuation.

**Budget ceiling.** Ongoing price-data feeds stay at or below US$1,000 per year in aggregate at this stage. Per-cargo assay and inspection are a separate transaction cost borne by the trade counterparties and are not part of the feed budget.

**Polling cadence.** Every 15 minutes during market hours; less frequently overnight. The cadence is a configurable parameter.

**Per-loan collateral valuation.** For each active loan the relayer computes current collateral value off-chain, then derives CCR. The valuation mode is selected per loan from the loan's valuation record. Two modes exist.

*Standard goods* (refined metal, grain, refined product, exchange-deliverable material). Collateral value is the reference price times the current quantity, with the commodity haircut applied.

```
collateral_value = reference_price * quantity * (1 - haircut)
```

*Metal concentrate* (for example gold-pyrite concentrate). A concentrate is not worth price times quantity. It is worth its Net Smelter Return, the amount the seller receives after the smelter's payable terms and charges. The relayer computes the waterfall per payable metal, then sums.

```
payable_metal    = (grade * payable_pct - min_deduction) * quantity
gross_value      = payable_metal * reference_price
nsr              = gross_value - treatment_charge - refining_charge - penalties
mine_gate_value  = nsr - realisation_costs
collateral_value = mine_gate_value * (1 - haircut)
```

Payable_pct and haircut are multiplicative and scale with price and quantity. Treatment_charge, refining_charge, penalties and realisation_costs are fixed dollar amounts that do not move with the metal price, so collateral value falls faster than the headline price when the metal price drops. The haircut from the credit framework is applied on top of the NSR to absorb residual risks such as quotational-period price drift, assay dispersion, a narrow buyer pool, smelter counterparty performance, and collateral perfection.

Inputs for both modes:
- The commodity reference price, read off-chain per Sources above.
- The current collateral quantity from the trustee feed (original quantity minus any delivered portions tracked off-chain).
- For concentrates, the per-deal payable terms, charges and penalty schedule from the signed offtake, plus the grades from the independent assay certificate, both held in the valuation record.
- The commodity haircut schedule defined in the credit framework.
- The loan's current outstanding senior principal.

## Per-loan valuation record (off-chain)

The relayer keeps one valuation record per active loan in its Postgres store (the loan mirror). The record is the working state behind the CCR computation above. It is never written on-chain. The on-chain contract holds only the derived `ccr` and `last_reported_ccr_timestamp` plus the `metadata_uri` pointer. The assay certificate and the offtake extract are pinned to IPFS and referenced from the document that `metadata_uri` points to, so their hashes are auditable without putting commercial terms on-chain.

The record is populated from three off-chain sources. The trustee feed supplies quantity and location. The signed offtake supplies the commercial terms. The independent assay supplies the grades. The price feed recomputes the cached outputs on every tick.

```rust
// Off-chain, relayer Postgres. One row per active loan. Never on-chain.
struct LoanValuationRecord {
    loan_id: u64,                          // matches the on-chain loan id
    valuation_mode: ValuationMode,         // StandardGoods or MetalConcentrate
    commodity: String,                     // e.g. "gold_pyrite_concentrate"

    // Quantity and quality (trustee feed + assay)
    quantity_dmt: Decimal,                 // current dry metric tonnes, original minus delivered
    moisture_pct: Decimal,                 // wmt to dmt conversion and TML monitoring
    assays: Vec<MetalAssay>,               // payable metals: Au, Ag, ...
    deleterious: Vec<ElementLevel>,        // As, Sb, Hg, Bi, Pb, Zn, ... drive penalties
    assay_certificate_uri: String,         // IPFS pointer or hash of the certificate of analysis
    assay_status: AssayStatus,             // Provisional, Final, UmpirePending

    // Commercial terms from the signed offtake (used in MetalConcentrate mode)
    payable_terms: Vec<PayableTerm>,       // per metal: payable_pct, min_deduction
    treatment_charge_per_dmt: Decimal,     // TC
    refining_charges: Vec<RefiningCharge>, // per metal: RC per payable ounce
    penalty_schedule: Vec<PenaltyTier>,    // per element: threshold, rate, flat or escalating
    realisation_costs: Decimal,            // freight, insurance, superintendence, marketing
    quotational_period: String,            // e.g. "2 MAMA"
    pricing_reference: String,             // e.g. "LBMA Gold PM averaged over the QP"
    incoterm: String,                      // FOB, CFR, CIF. Sets delivery and risk, not title

    // Pricing and policy
    reference_price: Decimal,              // last headline price read
    reference_price_source: String,        // API name or oracle id
    reference_price_ts: u64,
    haircut_pct: Decimal,                  // from the credit framework, by commodity and grade

    // Cached computed outputs (monitoring and audit)
    nsr: Decimal,                          // net smelter return
    mine_gate_value: Decimal,              // nsr minus realisation costs
    collateral_value: Decimal,             // mine_gate_value after haircut
    outstanding_senior_principal: Decimal, // mirror of accrual base less senior principal repaid
    ccr_bps: u32,                          // live CCR, 14000 = 140%
    last_onchain_ccr_bps: u32,             // last value the Trustee wrote on-chain
    last_onchain_ccr_ts: u64,

    computed_at: u64,
    updated_at: u64,
}

struct MetalAssay     { metal: String, grade_g_per_t: Decimal }
struct ElementLevel   { element: String, level: Decimal, unit: ImpurityUnit } // Pct or Ppm
struct PayableTerm    { metal: String, payable_pct: Decimal, min_deduction_g_per_t: Decimal }
struct RefiningCharge { metal: String, rc_per_oz: Decimal }
struct PenaltyTier    { element: String, threshold: Decimal, rate_per_unit: Decimal, unit: ImpurityUnit, escalating: bool }

enum ValuationMode { StandardGoods, MetalConcentrate }
enum AssayStatus   { Provisional, Final, UmpirePending }
enum ImpurityUnit  { Pct, Ppm }
```

Standard-goods loans leave the concentrate-only fields (payable_terms, refining_charges, penalty_schedule, realisation_costs, quotational_period) empty and use only quantity, reference_price and haircut_pct.

Each recompute writes ccr_bps. The relayer writes on-chain only when a threshold is crossed, by asking the Trustee to call `update_mutable`, which sets `ccr` and `last_reported_ccr_timestamp`. The fields last_onchain_ccr_bps and last_onchain_ccr_ts track what is actually on-chain, so the relayer can batch writes and skip redundant ones.

## CCR Computation

CCR = `collateral_value / outstanding_senior_principal`, expressed in basis points (e.g., 14000 = 140%).

CCR is recomputed on every price feed tick. LoanRegistry `ccr` updates are batched and written only on threshold crossings, not on every tick, to avoid on-chain spam.

## Notification Events

| Event | Trigger | Recipients |
|---|---|---|
| Watchlist | CCR < 130% (amber) | Team, Originator, Trustee |
| Maintenance margin call | CCR < 120% | Team, Originator, Borrower (via Originator), Trustee |
| Margin call | CCR < 110% (red) | Team, Originator, Borrower (via Originator), Trustee |
| Payment delay (amber) | Scheduled repayment > 7 days late | Team, Originator, Trustee |
| Payment delay (red) | Scheduled repayment > 21 days late | Team, Originator, Trustee |
| AIS blackout | Vessel tracking loss > 12 hours | Team, Originator, Trustee |
| CMA discrepancy | Reported collateral quantity differs from CMA by > 3% | Team, Originator, Trustee |
| Status transition | Any change to LoanRegistry mutable status field | Team, Originator, Trustee |

Borrower notifications for margin-call events are delivered through the Originator as the commercial intermediary; the protocol does not contact the borrower directly.

## Delivery Channels

Each recipient receives notifications via:
- **In-app banner** — inside the Operations Console (Trustee / Team) or Originator UI.
- **Email** — to the address bound to the operator account.
- **Optional webhook** — Telegram or Slack webhook, configurable per recipient.

The notification feed in the Originator UI is a chronological log filterable by event type. Marking a notification as read or acknowledged does not change any on-chain state.

## LoanRegistry Updates on Threshold Crossings

When a CCR computation crosses a defined threshold, the relayer service notifies the trustee
via the Operations Console. The trustee writes the updated `ccr` and
`last_reported_ccr_timestamp` on LoanRegistry directly from the Trustee key (holder of the
`TRUSTEE` role); Relayer has no write access to LoanRegistry. Updates are batched per
threshold crossing event; the LoanRegistry is not updated on every price tick. Because
LoanRegistry is informational — not a NAV input — these writes do not move sPLUSD share
price.

## Threshold Configuration

CCR thresholds and notification rules are configurable at two levels:

- **Protocol-wide defaults** — set by the foundation multisig and apply to all loans unless overridden.
- **Per-loan overrides** — set by the Trustee (holder of the `TRUSTEE` role on LoanRegistry) for loan-specific adjustments.

## Event History

All notification events are appended to the real-time event log visible in Protocol Dashboard Panel B. This log provides a full chronological audit trail of loan lifecycle events — watchlist triggers, margin calls, payment delays, AIS blackouts, CMA discrepancies, and status transitions — per loan.
