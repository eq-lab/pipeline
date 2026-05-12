---
title: Reference transaction
order: 4
section: Start here
---

# Reference transaction

The below represents a trade that Pipeline's architecture has been stress-tested against. This reference transaction illustrates the type of deal the protocol is designed to finance.

## Deal summary

| Parameter | Detail |
|---|---|
| **Commodity** | Jet fuel — aviation kerosene, JET A-1 |
| **Trade corridor** | South Korea (sourcing) → Chinese bonded storage (tank farm) → Mongolia (end buyer) |
| **Originator / Servicer** | Open Mineral AG |
| **Sourcing counterparty** | Vitol / Korean refiners (FOB South Korea) |
| **Storage** | Chinese bonded tank farm under CMA (SGS or Intertek) |
| **Offtaker** | An aviation fuel distributor |
| **Facility size** | $20M (indicative) |
| **Senior tranche** | $17M (85%) — funded by Pipeline lenders |
| **Equity tranche** | $3M (15%) — funded by Open Mineral, first-loss |
| **Duration** | 90 days |
| **Senior coupon** | 14.0% gross annualised |
| **Collateral structure** | CMA over stored product + assignment of offtake receivable |
| **Price reference** | MOPS (Mean of Platts Singapore) jet fuel benchmark |
| **Payment mechanism** | LC at sight or documentary collection |
| **Hedging** | Back-to-back sale with confirmed offtaker at market-linked price |

## Lifecycle flow

{% include diagram.html src="d6-loan-lifecycle.svg" caption="Reference transaction lifecycle — origination through repayment and closure." %}

### Step-by-step

#### Sourcing

Open Mineral identifies the deal — an aviation fuel distributor needs JET A-1, sourced from Korean refiners via Vitol's supply chain.

#### KYC and pre-screening

Open Mineral submits KYC packs for borrower, offtaker, and CMA provider. Protocol Operations runs sanctions, AML, and credit screens.

#### Term sheet and underwriting

Open Mineral prepares the indicative term sheet — facility size, duration, pricing, collateral, hedging. Underwriting goes deep on price assumptions, corridor risk, and offtaker payment record.

#### Risk committee approval

Committee reviews against the Credit Policy: commodity, corridor, borrower tier, concentration, LTV ladder, hedging adequacy. On approval, the loan gets recorded to the LoanRegistry smart contract.

#### Equity tranche commitment

Open Mineral funds the $3M equity tranche before senior tranche draws. First-loss capital sits in escrow.

#### Senior tranche funding

$17M drawn from the Capital Wallet under 3-of-5 cosigner quorum, routed via the Payment Agent to the Originator's control account, funding the seller.

#### Cargo loading and sailing

Cargo loads at Korean refinery FOB. Vessel tracking via CTRM. Independent inspectors verify quantity and quality at load port.

#### Bonded storage

Cargo arrives at the Chinese bonded tank farm. CMA (SGS or Intertek) takes possession, issues warehouse receipts pledged to the Collateral Trust.

#### Daily monitoring

Cargo value marked against MOPS. LTV calculated against outstanding senior + equity. Margin breach triggers Originator top-up.

#### Offtake to Mongolia

The jet fuel distributor takes delivery. Payment falls due per LC or documentary collection terms.

#### Repayment

The jet fuel distributor wires USD to the Trustee's correspondent account. Trustee instructs USD → USDC on-ramping via Circle Mint. USDC settles into the Capital Wallet.

#### Yield mint

Trustee and Relayer co-sign a YieldAttestation for the senior coupon net of fees. YieldMinter verifies both signatures and mints into the sPLUSD vault. Share price moves up.

#### Collateral release and equity distribution

LoanRegistry burns collateral tokens. Collateral Trust releases security. Equity tranche principal plus residual swept to Open Mineral. Loan archived.

## Illustrative investor yield

Applying Pipeline's fee structure to this transaction:

| Component | Value |
|---|---|
| **Senior debt deployed (85% of $20M)** | $17,000,000 |
| **Gross senior interest rate (annualised)** | 14.0% |
| **Duration** | 90 days |
| **Gross interest earned** | $586,850 ($17M × 14% × 90/365) |
| **Less: Management fee (1.0% p.a. on $17M × 90d)** | ($41,920) |
| **Net interest before performance fee** | $544,930 |
| **Less: Performance fee (15% of net interest)** | ($81,740) |
| **Net interest to sPLUSD holders from this deal** | $463,190 |
| **Effective net yield (annualised, on deployed capital)** | ~11.0% p.a. |

Uninvested capital earns base yield from US Treasury bill positions held as USYC. At a 4.5% T-bill rate and a 30% protocol share on Engine B, lenders receive ~3.2% annualised on unallocated capital. With a $100M pool, $85M deployed across concurrent 90-day facilities and $15M in T-bills, blended return is ~9.0–10.0% net of all fees — consistent with Pipeline's 8–12% target.

90-day duration means deployed capital recycles four times per year.
