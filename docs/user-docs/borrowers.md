---
title: For borrowers
order: 10
section: For Borrowers
---

# For borrowers

Pipeline finances physical commodity trade deals — typically one facility per offtake contract. Lenders (KYC'd, on-chain) fund the Senior tranche; the Originator funds the Equity tranche as first-loss, with the offtaker (the end buyer of the commodity) paying into a Capital Wallet that the protocol reconciles against the loan on-chain.

Pipeline is not a self-service platform for borrowers. You can't sign up online, fill in a form, and take a loan. Every borrow facility comes to us through an originator — a commodity trading firm we already know and trust, that brings the deal, runs first-pass diligence on the borrower, and puts its own money in alongside ours as first-loss capital. At launch our only originator is Open Mineral. More will be onboarded over time.                                                   

So the question is not "how do I apply." It is "is Pipeline the right route for this deal, and which originator should I go through?" The rest of this page is there to help you answer that.    

## What we finance

- Physical commodity trade-finance — for example jet fuel, base and precious metals, and refined products moving through a defined corridor with a named offtaker.
- One loan NFT per facility on the LoanRegistry. The NFT carries immutable origination data (commodity, corridor, facility size, tranche split, offtaker price, senior coupon rate) and mutable lifecycle state (status, CCR, current location) that the Trustee updates as the deal runs.
- Senior-tranche capital provided by Pipeline lenders; Equity-tranche capital posted by the Originator as first-loss and held off-chain. You see one facility, one coupon, one maturity — the tranche split sits behind us.

{% include diagram.html src="d6-loan-lifecycle.svg" caption="Loan lifecycle — origination through repayment and closure." %}

## How a deal moves from request to close

<ol class="steps">
  <li>Deal sourcing is fully off-chain: an approved originator (Open Mineral at MVP) brings the borrower, the term sheet, and the diligence package to Pipeline Trust Company (the Trustee).</li>
  <li>On approval, the Trustee mints the loan NFT directly on LoanRegistry from the Trustee key — this is the first on-chain event in the life of the facility; Relayer has no role on LoanRegistry.</li>
  <li>Relayer prepares the Capital Wallet disbursement; the Trustee and Pipeline team co-sign the MPC outflow to the on-ramp provider; USDC reaches the borrower.</li>
  <li>The offtaker pays for the cargo by wiring USD into the Trustee's correspondent bank account.</li>
  <li>The Trustee identifies the wire, matches it to the loan, and on-ramps USD → USDC into the Capital Wallet (via Circle Mint / Zodia or a similar provider).</li>
  <li>The Trustee records the repayment split across Senior principal, Senior interest, and Equity residual — pure accounting on LoanRegistry, no PLUSD moves yet.</li>
  <li>Relayer and the custodian co-sign a YieldAttestation; <code>YieldMinter.yieldMint</code> verifies both signatures and calls <code>PLUSD.mintForYield</code>, delivering the senior coupon into the sPLUSD vault.</li>
  <li>At scheduled maturity or on early repayment, the Trustee closes the loan on LoanRegistry.</li>
</ol>

## Who qualifies

- KYB'd firms with a verifiable operating history in the named corridor and commodity.
- An approved originator relationship — Open Mineral at launch, with additional originators onboarded over time.
- Must demonstrate ability / wilingness to post cargo-tracking evidence — vessel IMO plus AIS feed, CMA inspection reports, warehouse or tank-farm identifiers — and to report on payment timing as the deal runs.

Our visible risk framework is the cargo-coverage ratio (CCR), with thresholds at **130 / 120 / 110**. A facility opens with headroom above 130; crossing 120 moves the loan to Watchlist; 110 triggers Risk Council escalation. Payment-delay flags run on the same lights: **amber over 7 days**, **red over 21 days**. Borrowers who communicate early through the Originator keep facilities on green regardless of amber prints.

## What we don't finance

- Non-physical commodity exposures. We do not fund paper trades, speculative futures positions, or hedging programs without an underlying physical cargo.
- Single-counterparty concentrations above the level set by Risk Council policy. We may decline an otherwise clean deal because of portfolio balance, not credit.
- Sanctioned counterparties, sanctioned corridors, or sanctioned commodities. No exceptions, no workarounds.

## Get in touch

Borrower origination at MVP is bespoke and runs through approved originators rather than a public application form. If you already work with Open Mineral, raise the facility through your existing relationship. If you do not, reach out to the Pipeline team directly and we will route you.

<div class="callout info">
  <h4>Reach out</h4>
  <p>Borrower origination at MVP is bespoke through approved originators. To discuss a facility, contact the Pipeline team — <em>inquiry route to be published here pre-launch</em> — or work with an approved originator directly.</p>
</div>

---

See also: [How it works](/how-it-works/) · [Risks](/risks/) · [Glossary](/glossary/)
