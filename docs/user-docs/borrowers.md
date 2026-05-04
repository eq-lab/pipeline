---
title: For borrowers
order: 10
section: For Borrowers
---

# For borrowers

Pipeline finances physical commodity trade deals — typically one facility per offtake contract. Lenders (KYC'd, on-chain) fund the Senior tranche; the Originator funds the Equity tranche as first-loss; the offtaker (the end buyer of the commodity) pays into a USD account that the Trustee reconciles against the loan and on-ramps to the Capital Wallet.

Pipeline is **not a self-service platform for borrowers**. You can't sign up online, fill in a form, and take a loan. Every borrow facility comes to us through an **originator** — a commodity trading firm we already know and trust, that brings the deal, runs first-pass diligence on the borrower, and puts its own money in alongside ours as first-loss capital. At launch our only originator is Open Mineral. More will be onboarded over time.

The question is not "how do I apply." It is "is Pipeline the right route for this deal, and which originator should I go through?" The rest of this page is here to help you answer that.

---

## What working with Pipeline looks like

Borrowers work with the **same processes and documents they already know** — Pipeline does not invent novel paperwork or force you to learn a crypto stack. Funding simply moves faster, without the delays of bank credit committees, because the credit decision sits with the Originator and the diligence package is reviewed by Pipeline Trust Company on a rolling basis rather than against a quarterly cycle.

| Concretely | Detail |
|---|---|
| **Loan structure** | LMA-based facility documents under English law, LCIA arbitration |
| **Facility size** | $1M – $30M per facility — sized for mid-market players facing the sharpest financing gap |
| **Tenor** | Short duration, typically 30–180 days, matched to the underlying offtake cycle |
| **Advance rate** | Up to 80% LTV, scaled by commodity class and borrower track record |
| **Typical collateral** | Offtake contract cashflows, warehouse receipts, bills of lading |
| **Disbursement** | Standard USD bank-wire to the borrower's operating account — no crypto on the borrower side |
| **Repayment** | Offtaker wires USD into the Trustee's correspondent bank account; Trustee reconciles and closes the loan |
| **Repeat-deal approval** | 48 hours for revolving trades with a repeat structure under an existing relationship |

The borrower never touches USDC. The borrower never holds a wallet. Every borrower-facing leg of the facility runs through familiar bank rails. The on-chain plumbing is something you can verify if you want to, not something you have to operate.

---

## What we finance

Metals, fuels, refined products, and agricultural commodities — independently priced, physically verified, and sold in days. The collateral test is not "is this a real cargo" but "if the deal goes wrong, can a third party liquidate this collateral inside the loan tenor at a known price."

The five tests we apply to every commodity, corridor, and counterparty:

| Criterion | What it practically means |
|---|---|
| **High commoditisation** | Established secondary buyers for the commodity in the corridor financed |
| **Limited perishability** | Minimum 12 months shelf life on the physical good |
| **Deep secondary market liquidity** | Daily traded volume well in excess of the collateral to be liquidated |
| **Independent price assessment** | Available from observable, third-party benchmarks |
| **Secondary market access** | Pre-qualified offtakers in the corridor with willingness and balance sheet to absorb the cargo |

Each new corridor is added by Risk Council policy after the test set is documented — there are no implicit corridors. If you are bringing a deal in a corridor we do not currently cover, the originator can submit it for committee review.

---

## What we don't finance

- Non-physical commodity exposures. We do not fund paper trades, speculative futures positions, or hedging programs without an underlying physical cargo.
- Single-counterparty concentrations above the level set by Risk Council policy. We may decline an otherwise clean deal because of portfolio balance, not credit.
- Sanctioned counterparties, sanctioned corridors, or sanctioned commodities. No exceptions, no workarounds.
- Stand-alone working-capital lines, equipment finance, or balance-sheet revolvers. Pipeline funds **trade-specific** facilities — one offtake contract, one cargo, one repayment.

---

## How a deal moves from request to close

{% include diagram.html src="d6-loan-lifecycle.svg" caption="Loan lifecycle — origination through repayment and closure." %}

<ol class="steps">
  <li>Deal sourcing is fully off-chain: an approved originator (Open Mineral at MVP) brings the borrower, the term sheet, and the diligence package to Pipeline Trust Company (the Trustee).</li>
  <li>Risk Council reviews the deal against the corridor policy, sizing limits, CCR headroom, and the equity-tranche commitment from the Originator.</li>
  <li>On approval, the Trustee mints the loan NFT directly on LoanRegistry from the Trustee key — this is the first on-chain event in the life of the facility; the Relayer has no role on LoanRegistry.</li>
  <li>The Capital Wallet disbursement is queued; the Trustee and Pipeline team co-sign the institutional-custody outflow to the on-ramp provider; USDC is converted to USD and wired to the borrower's bank account.</li>
  <li>The borrower draws against the facility under the offtake contract — buys, ships, delivers the cargo as agreed.</li>
  <li>The offtaker pays for the cargo by wiring USD into the Trustee's correspondent bank account on the contracted settlement date.</li>
  <li>The Trustee identifies the wire, matches it to the loan, and on-ramps USD → USDC into the Capital Wallet (via Circle Mint, Zodia, or a similar regulated provider).</li>
  <li>The Trustee records the repayment split across Senior principal, Senior interest, and Equity residual on LoanRegistry — pure accounting, no PLUSD moves yet.</li>
  <li>The Relayer and Trustee co-sign a YieldAttestation; <code>YieldMinter.yieldMint</code> verifies both signatures and calls <code>PLUSD.mintForYield</code>, delivering the senior coupon into the sPLUSD vault.</li>
  <li>At scheduled maturity or on early repayment, the Trustee closes the loan on LoanRegistry. The borrower receives a closure confirmation through the Originator.</li>
</ol>

---

## Onboarding — what to bring to the Originator

Pipeline does not run KYB on the borrower directly. The Originator does, and forwards the diligence package to Pipeline Trust Company as part of the deal submission. To shorten the cycle, prepare the following before the first conversation:

- **Corporate identity** — incorporation documents, UBO declarations, sanctions screen for directors and beneficial owners.
- **Operating track record** — at least 12 months of comparable trades in the named corridor and commodity, with auditable invoices and bills of lading from prior cycles.
- **Offtake evidence** — a signed offtake contract or LOI from the named end buyer, with the commercial terms of the cargo (volume, price formula, settlement window).
- **Cargo-tracking commitment** — willingness to share vessel IMO and AIS feed in real time, CMA or equivalent independent inspection reports at load and discharge, warehouse or tank-farm identifiers where the cargo passes through storage.
- **Equity contribution** — the Originator posts the equity tranche; you do not. But the structure means the Originator will only bring deals where they are confident enough to put their own capital first-loss.
- **Bank coordinates** — the operating USD account that will receive disbursement and the offtaker's bank that will route the repayment.

Repeat borrowers under an existing relationship skip most of the above. The 48-hour approval window applies once the structure is on file and the new cargo fits the existing facility template.

---

## Risk lights you will see during the deal

Our visible risk framework is the **cargo-coverage ratio (CCR)**, with thresholds at **130 / 120 / 110**. A facility opens with headroom above 130; crossing 120 moves the loan to Watchlist; 110 triggers Risk Council escalation. Payment-delay flags run on the same lights: **amber over 7 days late**, **red over 21 days late**.

| State | What triggers it | What it means in practice |
|---|---|---|
| Performing | CCR > 130, no payment delay > 7 days | Normal facility, no escalation |
| Watchlist | CCR 120–130 OR payment delay 7–21 days | Originator notified, additional reporting cadence; no public flag |
| Default proposal | CCR < 110 OR payment delay > 21 days OR covenant breach | RISK_COUNCIL reviews; 24h timelock; GUARDIAN can cancel |
| Default | Executed by RISK_COUNCIL | Loss enters the waterfall; recorded on LoanRegistry as an irreversible state |

Borrowers who **communicate early** through the Originator keep facilities on green regardless of amber prints. The published CCR ladder is not a punishment schedule — it is the visible discipline that lets lenders stay informed, and the Originator's job is to surface stress before it crosses a threshold.

---

## Get in touch

Borrower origination at MVP is bespoke and runs through approved originators rather than a public application form. If you already work with Open Mineral, raise the facility through your existing relationship. If you do not, reach out to the Pipeline team directly and we will route you to the right originator for the corridor and the deal size.

<div class="callout info">
  <h4>Reach out</h4>
  <p>Borrower origination at MVP is bespoke through approved originators. To discuss a facility, contact the Pipeline team — <em>inquiry route to be published here pre-launch</em> — or work with an approved originator directly.</p>
</div>

---

See also: [How it works](/how-it-works/) · [Potential risks](/risks/) · [Glossary](/glossary/)
