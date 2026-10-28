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
| **Commodity** | Jet fuel — aviation kerosene, JET A-1 |
| **Trade corridor** | South Korea (sourcing) → Chinese bonded storage (tank farm) → Mongolia (end buyer) |
| **Originator / Servicer** | A commodity trade finance Originator |
| **Sourcing counterparty** | Vitol / Korean refiners (FOB South Korea) |
| **Storage** | Chinese bonded tank farm under CMA (SGS or Intertek) |
| **Offtaker** | An aviation fuel distributor |
| **Facility size** | $20M (indicative) |
| **Senior tranche** | $17M (85%) — funded by Pipeline lenders |
| **Equity tranche** | $3M (15%) — funded by the Originator, first-loss |
| **Duration** | 90 days |
| **Senior coupon** | 14.0% gross annualised |
| **Collateral structure** | CMA over stored product + assignment of offtake receivable |
| **Price reference** | MOPS (Mean of Platts Singapore) jet fuel benchmark |
| **Payment mechanism** | LC at sight or documentary collection |
| **Hedging** | Back-to-back sale with confirmed offtaker at market-linked price |

## Lifecycle flow

{% include diagram.html src="boss-loan-lifecycle.jpeg" caption="Reference transaction lifecycle — origination through repayment and closure." %}

### Step-by-step

#### Sourcing

The Originator identifies the deal. An aviation fuel distributor needs JET A-1, sourced from Korean refiners via Vitol's supply chain.

#### KYB, KYT and pre-screening

The Originator submits KYB packs for the borrower, the offtaker and the CMA provider. Protocol Operations runs KYB, KYT, sanctions, AML and credit screens on every party.

#### Term sheet and underwriting

The Originator prepares the indicative term sheet: facility size, duration, pricing, collateral, hedging. Underwriting covers price assumptions, corridor risk and the offtaker's payment record.

#### Risk Council approval

The deal is reviewed against the Credit Policy: commodity, corridor, borrower tier, concentration, advance ratio, hedging. On approval, the Trustee records the loan in the loan registry: facility size, senior and equity tranches, rate, origination and maturity dates, offtaker price. The loan starts as Approved.

#### Equity tranche commitment

The Originator joins the facility by accession and funds the $3M equity tranche before the senior tranche is drawn.

#### Senior tranche funding

A local legal opinion confirms the security ranks first. The lending vehicle, the initial lender under the master facility agreement, wires $17M to fund the seller. The Trustee records the disbursement in the loan registry. Interest starts to accrue and the loan becomes Performing. A per-loan debt token mirrors the outstanding principal.

#### Cargo loading and sailing

Cargo loads at the Korean refinery FOB. The bill of lading is endorsed to the Security Agent by way of pledge. The Security Agent records it in the security registry. Inspectors appointed by the lending vehicle verify quantity and quality at the load port.

#### Bonded storage

Cargo arrives at the Chinese bonded tank farm. The CMA provider (SGS or Intertek) takes possession and issues warehouse receipts pledged to the Security Agent. The Security Agent hands the security over from the bill of lading to the warehouse pledge in one step.

#### Daily monitoring

The platform marks the stored product against MOPS. LTV is the outstanding amount plus accrued interest, divided by the value of the goods. When LTV rises above 85%, a margin call opens. The borrower brings LTV back to 80% with cash or goods within the cure period. A stale price blocks a margin call.

#### Offtake to Mongolia

The jet fuel distributor takes delivery. Payment falls due per LC or documentary collection terms.

#### Repayment

The jet fuel distributor wires USD to the collection account, co-signed by the Security Agent. The repayment is applied by the priority of payments, booked on-chain and split into senior principal, senior interest, fees and the equity distribution.

#### Yield mint

The senior interest net of fees is minted as PLUSD into the staking vault. The sPLUSD price moves up. Fees go to the treasury.

#### Collateral release and equity distribution

The Security Agent releases the security. The equity tranche principal and the residual go to the Originator. With nothing outstanding, the Trustee closes the loan.

## Illustrative investor yield

Applying illustrative fee rates (management fee 1.0% a year, performance fee 15% of net interest) to this transaction. Interest accrues on a 365.25-day year.

| Component | Value |
|---|---|
| **Senior debt deployed (85% of $20M)** | $17,000,000 |
| **Gross senior interest rate (annualised)** | 14.0% |
| **Duration** | 90 days |
| **Gross interest earned** | $586,448 ($17M × 14% × 90/365.25) |
| **Less: Management fee (1.0% p.a. on $17M × 90d)** | ($41,889) |
| **Net interest before performance fee** | $544,559 |
| **Less: Performance fee (15% of net interest)** | ($81,684) |
| **Net interest to sPLUSD holders from this deal** | $462,875 |
| **Effective net yield (annualised, on deployed capital)** | ~11.0% p.a. |

90-day duration means deployed capital recycles four times per year.
