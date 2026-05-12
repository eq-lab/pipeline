---
title: Home
order: 1
---

# Pipeline

> On-chain yield from global commodity trade.

Pipeline is a decentralised commodity trade finance protocol. Lenders deposit USDC and receive PLUSD, a 1:1 dollar receipt. PLUSD stakes into sPLUSD to earn yield. Pipeline deploys deposited USDC into senior tranches of short-duration commodity trade loans — copper from Chile, jet fuel from South Korea, wheat from Australia — sourced and underwritten by qualified Loan Originators who contribute the equity tranche on every deal. Senior coupons net of fees accrete into the PLUSD staking vault, lifting the sPLUSD share price.

<div class="callout risk">
  <h4>Before you deposit</h4>
  <p>Yield on Pipeline comes from real commodity trade loans. Read <a href="/risks/">Potential risks</a> thoroughly before your first deposit.</p>
</div>

<div class="card-grid">
  <a class="card" href="/start-here/introduction/">
    <h4>Start here</h4>
    <p>Introduction, FAQs, quick start, and the reference transaction Pipeline's architecture is built around.</p>
  </a>
  <a class="card" href="/how-it-works/">
    <h4>How Pipeline works</h4>
    <p>Origination, capital, and protocol layers; the Trustee; legal structure; risk management.</p>
  </a>
  <a class="card" href="/lenders/">
    <h4>For lenders</h4>
    <p>Onboarding, deposits, staking, withdrawals, dashboards.</p>
  </a>
  <a class="card" href="/security/">
    <h4>Security &amp; transparency</h4>
    <p>Custody, capital safeguards, investor protection, emergency response.</p>
  </a>
  <a class="card" href="/governance/">
    <h4>Governance</h4>
    <p>Fiduciary trustee, Risk committee, the three on-chain MPCs.</p>
  </a>
  <a class="card" href="/risks/">
    <h4>Risks</h4>
    <p>Seven-category risk register, credit policy overview, default management.</p>
  </a>
  <a class="card" href="/technical/architecture/">
    <h4>Technical overview</h4>
    <p>Architecture, smart contracts, Relayer security model, audits and addresses.</p>
  </a>
  <a class="card" href="/references/glossary/">
    <h4>Reference</h4>
    <p>Glossary and legal.</p>
  </a>
</div>

## Where yield comes from

Two engines feed the sPLUSD vault through the same two-party YieldMinter call.

### Senior coupons on commodity trade loans

Every loan is split into a senior tranche funded by Pipeline lenders and an equity tranche funded by the Originator, which takes first loss (up to 30% of facility). When the offtaker pays for the cargo, USD lands in the Trustee's bank account; the Trustee on-ramps it to USDC into the Capital Wallet, then the senior coupon net of fees is co-signed by the Relayer and the Trustee and minted into the sPLUSD vault. See [Where yield comes from](/how-it-works/capital-layer/).

### Realised T-bill yield on USYC reserves

Idle Capital Wallet USDC is held as USYC, Hashnote's tokenised T-bill. USYC NAV drifts up daily, but that gain is unrealised until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail. Only the realised gain — sale proceeds minus cost basis — is co-signed and minted as PLUSD: 70% to the sPLUSD vault, 30% to the Treasury Wallet. The target USDC buffer is 15% of reserves (band 10–20%) so routine withdrawals don't force a sale.

## What can go wrong

Lenders face loan defaults, liquidity delays on large withdrawals, custody-policy failure, smart-contract risk, governance risk, regulatory exposure, and operational-key compromise. Read [Potential risks](/risks/) for the enumerated disclosure and [Default management](/risks/default-management/) for the loss waterfall.

## How to start

Connect your wallet at [pipeline.one](https://pipeline.one/), call `DepositManager.deposit` with at least $1,000 USDC (Intake Wallet parks your funds), wait for KYT screening, then call `claim` with the Relayer's attestation. The claim enrols you on the transfer whitelist, moves USDC from the Intake Wallet to the Capital Wallet, and mints PLUSD 1:1 — all in a single transaction. No upfront identity documents, no accreditation declarations. Per-lender 24h cap is $10M. Full procedure in [Onboarding](/lenders/onboarding/).

## Not financial advice

Information on this website is not investment, legal, or tax advice. Yield figures are illustrative unless explicitly stated otherwise. Do your own due diligence and talk to a qualified advisor before committing capital.

---

## All pages

Start here: [FAQs](./start-here/faqs.md) · [Why commodity trade finance](./start-here/why-commodity-trade-finance.md) · [Introduction](./start-here/introduction.md) · [Reference transaction](./start-here/reference-transaction.md) · [Quick start manual](./start-here/quick-start.md)

How Pipeline works: [Overview](./how-it-works/index.md) · [Loan origination](./how-it-works/loan-origination.md) · [Risk management](./how-it-works/risk-management.md) · [Legal structure](./how-it-works/legal-structure.md) · [Capital layer](./how-it-works/capital-layer.md) · [Protocol layer](./how-it-works/protocol-layer.md) · [Where yield comes from](./how-it-works/yield-engines.md)

For lenders: [Overview](./lenders/index.md) · [Onboarding](./lenders/onboarding.md) · [Deposit](./lenders/deposit.md) · [Stake PLUSD](./lenders/stake.md) · [Withdraw](./lenders/withdraw.md) · [Dashboard](./lenders/dashboard.md)

For originators: [Overview](./originators/index.md)

For borrowers: [Overview](./borrowers/index.md)

Technical overview: [Architecture](./technical/architecture.md) · [Smart contracts](./technical/smart-contracts.md) · [Relayer security](./technical/relayer-security.md) · [Audits & addresses](./technical/audits-and-addresses.md)

Governance: [Overview](./governance/index.md) · [Fiduciary trustee](./governance/fiduciary-trustee.md) · [Risk committee](./governance/risk-committee.md) · [Operators & multisigs](./governance/multisig-roles.md)

Security & transparency: [Overview](./security/index.md) · [Investor protection](./security/investor-protection.md) · [Custody](./security/custody.md) · [Capital safeguards](./security/capital-safeguards.md) · [Emergency response](./security/emergency-response.md)

Potential risks: [Overview](./risks/index.md) · [Credit policy](./risks/credit-policy.md) · [Default management](./risks/default-management.md)

Reference: [Glossary](./references/glossary.md) · [Legal](./references/legal.md)
