---
title: Home
order: 1
---

# Pipeline

> Yield for on-chain capital, backed by real commodity trade finance.

Pipeline is a credit facility that finances vetted commodity trade deals and pays the senior coupon, plus T-bill accrual on idle reserves, to KYC'd on-chain lenders. Every loan sits on-chain and can be audited; every USDC dollar sits with a regulated custodian, not inside a smart contract.

<div class="callout risk">
  <h4>Before you deposit</h4>
  <p>Yield on Pipeline comes from real commodity trade loans. Defaults will happen. Read the <a href="/pipeline/risks/">Risks page</a> and <a href="/pipeline/defaults-and-losses/">Defaults &amp; losses</a> before your first deposit.</p>
</div>

<div class="callout safety">
  <h4>Split-rail safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.svg" caption="Split-rail architecture — the cash rail holds USDC at a regulated custodian; the token rail holds PLUSD and sPLUSD on-chain. Bugs in one rail can't drain the other." %}

The cash rail is custodied: a regulated Custodian holds USDC in the Capital Wallet and the Treasury Wallet, with Trustee, Team, and Bridge as independent MPC cosigners. The token rail is on-chain: an AccessManager plus eight protocol contracts — DepositManager, PLUSD, sPLUSD, WhitelistRegistry, WithdrawalQueue, LoanRegistry, ShutdownController, RecoveryPool — that mint, stake, and account for every lender share. Governance is split across three Safes with distinct signer sets: **ADMIN** (3/5, 48h timelock) for role grants and upgrades; **RISK_COUNCIL** (3/5, 24h timelock) for default and shutdown decisions; **GUARDIAN** (2/5, instant) for pause and granular role revocation.

<div class="card-grid">
  <a class="card" href="/pipeline/how-it-works/">
    <h4>How Pipeline works</h4>
    <p>Split-rail architecture and the two yield engines — senior coupons and T-bill accrual.</p>
  </a>
  <a class="card" href="/pipeline/lenders/">
    <h4>For lenders</h4>
    <p>Onboarding, atomic deposits, staking, withdrawals, dashboards.</p>
  </a>
  <a class="card" href="/pipeline/security/">
    <h4>Security &amp; transparency</h4>
    <p>Custody, supply safeguards, incident response, audits.</p>
  </a>
</div>

## Where yield comes from

**Engine A — Senior coupons on commodity trade loans.** Every loan is split into a Senior tranche funded by Pipeline lenders and an Equity tranche funded by the originator, which takes first loss. When a borrower repays, the Senior coupon (net of fees) is delivered to the sPLUSD vault through a two-party yield mint: the Bridge signs, the custodian co-signs via EIP-1271, and both signatures are verified on-chain before any shares move. See [yield engines](/pipeline/how-it-works/yield-engines/).

**Engine B — T-bill accrual on USYC reserves.** Idle Capital Wallet USDC sits in USYC, Hashnote's tokenized Treasury-bill holding. T-bill yield accrues continuously and is split 70% to the sPLUSD vault, 30% to the Treasury Wallet. The target USDC buffer is 15% of reserves, rebalanced when the balance drifts outside a 10–20% band.

## What can go wrong

Lenders face loan defaults, liquidity delays on large withdrawals, custodian operational failure, smart-contract risk, governance risk, regulatory exposure, and operational-key compromise. Read [Risks](/pipeline/risks/) for the enumerated disclosure and [Defaults &amp; losses](/pipeline/defaults-and-losses/) for the loss waterfall.

## Starting out

Complete KYC and Chainalysis screening, connect a whitelisted wallet, and deposit at least $1,000 USDC through DepositManager. Minting caps are $5M per transaction and $10M per rolling 24 hours. Full steps are on [Onboarding](/pipeline/lenders/onboarding/).

## Not financial advice

Information on this site is not investment, legal, or tax advice. Yield figures are illustrative unless explicitly stated otherwise. Do your own diligence and speak to a qualified advisor before committing capital.

---

[Borrowers](/pipeline/borrowers/) · [Glossary](/pipeline/glossary/) · [Legal](/pipeline/legal/) · [GitHub](https://github.com/eq-lab/pipeline)
