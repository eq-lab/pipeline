---
title: For lenders
order: 5
section: For Lenders
---

# For lenders — overview

Pipeline is a credit facility that finances vetted commodity trade deals and pays the senior coupon, plus T-bill accrual on idle reserves, to on-chain lenders. Entry is permissioned — every lender wallet passes KYC and Chainalysis screening before it can deposit.

<div class="callout info">
  <h4>Minimum deposit</h4>
  <p>The minimum deposit is <strong>$1,000 USDC</strong>. There is no maximum at the protocol level, though individual allocations may be capped during subscription windows.</p>
</div>

<div class="callout safety">
  <h4>Safety property</h4>
  <p>No off-chain signer gates your deposit. The on-chain USDC movement to the Capital Wallet is itself the attestation — a compromise of any single operator mints zero PLUSD.</p>
</div>

## Start here

<div class="card-grid">
  <a class="card" href="/pipeline/lenders/onboarding/">
    <h4>Onboarding</h4>
    <p>KYC, whitelist, 90-day Chainalysis freshness, and what we cannot serve.</p>
  </a>
  <a class="card" href="/pipeline/lenders/deposit-and-stake/">
    <h4>Deposit &amp; stake</h4>
    <p>USDC → PLUSD in one atomic transaction; stake into sPLUSD to earn.</p>
  </a>
  <a class="card" href="/pipeline/lenders/withdraw/">
    <h4>Withdraw</h4>
    <p>Unstake, queue, and claim USDC atomically from the withdrawal queue.</p>
  </a>
  <a class="card" href="/pipeline/lenders/dashboard/">
    <h4>Dashboard</h4>
    <p>What you can see on-chain, and what you can verify independently.</p>
  </a>
</div>

## Where your yield comes from

Two engines feed the sPLUSD vault. The first is the senior coupon paid by borrowers on drawn trade-finance loans. The second is T-bill accrual on the USYC reserves that back undrawn PLUSD. Both engines route through a two-party-attested yield mint, so no single operator can inflate the share price.

Read the full mechanics at [How it works — yield engines](/pipeline/how-it-works/yield-engines/).

## What can go wrong

Your capital is exposed to loan defaults, liquidity delays at the withdrawal queue, custodian operational failure, smart-contract risk, governance failure, regulatory action, and operator error. Each of these has a dedicated page explaining the mitigation and the residual risk you carry.

Read the full breakdown at [Risks](/pipeline/risks/) and [Defaults and losses](/pipeline/defaults-and-losses/).

---

See also: [How it works](/pipeline/how-it-works/) · [Security](/pipeline/security/) · [Glossary](/pipeline/glossary/)
