---
title: Home
order: 1
---

# Pipeline

> Yield for on-chain capital, backed by real commodity trade finance.

Pipeline is a credit facility that finances vetted commodity trade deals. Pipeline pays the senior coupon, and T-bill accrual on idle reserves, to KYC'd on-chain lenders. Every loan has full on-chain trail and registry and may beaudited at any time. Every USDC dollar supplied by Lenders sits safe with a regulated custodian.

<div class="callout risk">
  <h4>Before you deposit</h4>
  <p>Yield on Pipeline comes from real commodity trade loans. Make sure you understand <a href="/risks/">risks</a> thoroughly before your first deposit.</p>
</div>

<div class="callout safety">
  <h4>Split-rail safety</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

<div class="card-grid">
  <a class="card" href="/how-it-works/">
    <h4>How Pipeline works</h4>
    <p>Split-rail architecture and the two yield engines — senior coupons and T-bill accrual.</p>
  </a>
  <a class="card" href="/lenders/">
    <h4>For lenders</h4>
    <p>Onboarding, atomic deposits, staking, withdrawals, dashboards.</p>
  </a>
  <a class="card" href="/security/">
    <h4>Security &amp; transparency</h4>
    <p>Custody, supply safeguards, incident response, audits.</p>
  </a>
</div>

## Where yield comes from

**Engine A — Senior coupons on commodity trade loans.** Every loan is split into a Senior tranche funded by Pipeline lenders and an Equity tranche funded by the originator, which takes first loss. When a borrower repays, the Senior coupon (net of fees) is delivered to the sPLUSD vault through a two-party yield mint: the Capital Wallet signs, the Bridge co-signs, and both signatures are verified on-chain before any tokens move. See [yield engines](/how-it-works/yield-engines/).

**Engine B — T-bill accrual on USYC reserves.** Idle Capital Wallet USDC is converted into USYC, Hashnote's tokenized Treasury-bill holding. T-bill yield accrues continuously and is split 70% to the sPLUSD vault, 30% to the Pipeline's Treasury Wallet. The target USDC buffer is 15% of reserves, rebalanced when the balance drifts outside a 10–20% band.

## What can go wrong

Lenders face loan defaults, liquidity delays on large withdrawals, custodian operational failure, smart-contract risk, governance risk, regulatory exposure, and operational-key compromise. Read [Risks](/risks/) for the enumerated disclosure and [Defaults &amp; losses](/defaults-and-losses/) for the loss waterfall.

## Starting out

Proceed with the onboarding through the website, complete KYC and Chainalysis screening, and deposit at least $1,000 USDC. Minting caps are $5M per transaction and $10M per rolling 24 hours. Full steps are on [Onboarding](/lenders/onboarding/).

## Not financial advice

Information on this site is not investment, legal, or tax advice. Yield figures are illustrative unless explicitly stated otherwise. Do your own diligence and speak to a qualified advisor before committing capital.

---

[Borrowers](/borrowers/) · [Glossary](/glossary/) · [Legal](/legal/) · [GitHub](https://github.com/eq-lab/pipeline)
