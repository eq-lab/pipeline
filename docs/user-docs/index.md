---
title: Home
order: 1
---

# Pipeline

> Yield for on-chain capital, backed by real commodity trade finance.

Pipeline is a credit facility that finances secured commodity trade deals. Pipeline pays the senior coupon, and realised T-bill yield on idle reserves, to KYC'd on-chain lenders. Every loan has a full on-chain trail and registry and may be audited at any time. Lender USDC sits in self-custodied MPC wallets — no Pipeline contract holds it, and no single Pipeline party can move it.

<div class="callout risk">
  <h4>Before you deposit</h4>
  <p>Yield on Pipeline comes from real commodity trade loans. Make sure you understand <a href="/risks/">risks</a> thoroughly before your first deposit.</p>
</div>

<div class="card-grid">
  <a class="card" href="/how-it-works/">
    <h4>How Pipeline works</h4>
    <p>Split-rail architecture and the two yield engines — senior coupons and realised T-bill yield.</p>
  </a>
  <a class="card" href="/lenders/">
    <h4>For lenders</h4>
    <p>Onboarding, deposits, staking, withdrawals, dashboards.</p>
  </a>
  <a class="card" href="/security/">
    <h4>Security &amp; transparency</h4>
    <p>Custody, supply safeguards, incident response, audits.</p>
  </a>
</div>

## Where yield comes from

### Senior coupons on commodity trade loans

Every loan is split into a Senior tranche funded by Pipeline lenders and an Equity tranche funded by the originator, which takes first loss. When the offtaker pays for the cargo, USD lands in the Trustee's bank account; the Trustee on-ramps it to USDC into the Capital Wallet, then the senior coupon (net of fees) is co-signed by the Relayer and the Trustee and minted into the sPLUSD vault. See [yield engines](/how-it-works/yield-engines/) for details.

### Realised T-bill yield on USYC reserves

Idle Capital Wallet USDC is held as USYC, Hashnote's tokenised T-bill. USYC NAV drifts up daily as the underlying bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail. Only the realised gain — sale proceeds minus cost basis — is co-signed and minted as PLUSD. Cadence is at the Trustee's discretion. The target USDC buffer is 15% of reserves (band 10–20%) so routine withdrawals don't force a sale.

## What can go wrong

Lenders face loan defaults, liquidity delays on large withdrawals, custody-policy failure, smart-contract risk, governance risk, regulatory exposure, and operational-key compromise. Read [Risks](/risks/) for the enumerated disclosure and [Defaults &amp; losses](/defaults-and-losses/) for the loss waterfall.

## How to start

Proceed with the onboarding through the [website](https://pipeline.one/), complete KYC and Chainalysis screening, and deposit at least $1,000 USDC. Minting caps are $5M per transaction and $10M per rolling 24 hours. See here [Onboarding](/lenders/onboarding/) for the full onboarding procedure.

## Not financial advice

Information on this website is not investment, legal, or tax advice. Yield figures are illustrative unless explicitly stated otherwise. Do your own due diligence and talk to a qualified advisor before committing capital.

---

[Borrowers](./borrowers.md) · [Glossary](./glossary.md) · [Legal](./legal.md) · [Risks](./risks.md) · [Defaults & losses](./defaults-and-losses.md)

[How it works](./how-it-works/index.md) · [Yield engines](./how-it-works/yield-engines.md)

[Lenders](./lenders/index.md) · [Onboarding](./lenders/onboarding.md) · [Deposit & stake](./lenders/deposit-and-stake.md) · [Withdraw](./lenders/withdraw.md) · [Dashboard](./lenders/dashboard.md)

[Security](./security/index.md) · [Custody](./security/custody.md) · [Supply safeguards](./security/supply-safeguards.md) · [Emergency response](./security/emergency-response.md) · [Audits & addresses](./security/audits-and-addresses.md)
