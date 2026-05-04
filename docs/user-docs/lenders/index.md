---
title: For lenders
order: 5
section: For Lenders
---

# For lenders

Pipeline is a credit facility that finances vetted commodity trade deals. Pipeline pays the senior coupon and realised T-bill yield on USYC reserves to KYC'd on-chain lenders. Lending is permissioned — every lender passes KYC/KYB and Chainalysis screening before depositing.

<div class="callout info">
  <h4>Minimum deposit</h4>
  <p>The minimum deposit is <strong>$1,000 USDC</strong>. There is no maximum at the protocol level, though individual allocations may be capped during subscription windows. Per-transaction and 24-hour caps apply on the deposit path — see <a href="/lenders/deposit/">Deposit</a>.</p>
</div>

## Start here

<div class="card-grid">
  <a class="card" href="/lenders/onboarding/">
    <h4>Onboarding</h4>
    <p>KYC/KYB, whitelist, 90-day Chainalysis freshness, and what we cannot serve.</p>
  </a>
  <a class="card" href="/lenders/deposit/">
    <h4>Deposit</h4>
    <p>Approve USDC, call DepositManager, receive PLUSD 1:1 in a single atomic transaction.</p>
  </a>
  <a class="card" href="/lenders/stake/">
    <h4>Stake PLUSD</h4>
    <p>Stake PLUSD into sPLUSD to earn yield. Unstake at any time — no lock-up.</p>
  </a>
  <a class="card" href="/lenders/withdraw/">
    <h4>Withdraw</h4>
    <p>Unstake, queue, claim USDC from the WithdrawalQueue.</p>
  </a>
  <a class="card" href="/lenders/dashboard/">
    <h4>Dashboard</h4>
    <p>What you can see on-chain, and what you can verify independently.</p>
  </a>
</div>

## How yield reaches you

Yield arrives as fresh PLUSD minted directly into the sPLUSD vault. Your share count stays constant; what each share is worth grows. There is no claim step, no restake, no compounding action. The full mechanics — senior coupons on trade loans plus realised T-bill yield on USYC — are documented in [How it works · Yield engines](/how-it-works/yield-engines/).

## Risks before you deposit

Your capital is exposed to credit, liquidity, custody, smart-contract, governance, regulatory, and operational risks. Each is enumerated with its mitigation and residual on the [Potential risks](/risks/) page. Default mechanics and the loss waterfall live on [Default management](/defaults-and-losses/). **Read both before your first deposit.**

---

See also: [How it works](/how-it-works/) · [Security](/security/) · [Glossary](/glossary/)
