---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline is a credit facility that finances vetted commodity trade deals and
pays the senior coupon, plus T-bill accrual on idle reserves, to on-chain
lenders. Every loan is on-chain and auditable; every USDC dollar sits with a
regulated custodian, not inside a smart contract.

{% include diagram.html src="d1-system-context.svg" caption="Split-rail architecture — off-chain cash rail on the left, on-chain token rail on the right, governance by three Safes." %}

The above picture cleanly shows two distinct system components: USDC lives at the 
custodian on the cash rail, and moves only when MPC cosigners agree. PLUSD 
and sPLUSD live on the token rail — PLUSD is the 1:1 to USDC stablecoin, and sPLUSD 
is the ERC-4626 vault share that accrues yield. Three Gnosis Safes 
(ADMIN, RISK_COUNCIL, GUARDIAN) govern the token rail. The two rails are linked 
by rules, not shared control.

## How your money flows

You deposit USDC through **DepositManager** smart contract, PLUSD mints 1:1 into your wallet
in the same transaction. You stake PLUSD into **sPLUSD** to earn yield. You
redeem through the FIFO **WithdrawalQueue** when you want out. Minimum
deposit is $1,000 USDC. For the lender walkthrough, see
[lenders](/lenders/); for the rail architecture, see
[split rail architecture](/how-it-works/split-rail/).

## Where the yield comes from

Two engines, one share price. **Engine A** is the senior coupon on commodity
trade loans — when the offtaker pays for a cargo, the senior interest leg
lands in the sPLUSD vault through a co-signed yield mint. **Engine B** is
T-bill accrual on the USDC reserve — roughly 15% stays liquid (the band runs
10–20%) and the rest sits in USYC, Hashnote's tokenized Treasury-bill
vehicle. USYC's NAV drift is split **70% to the sPLUSD vault, 30% to the
Treasury Wallet**. Both engines deliver yield through the same two-party
attested `yieldMint`. See
[yield engines](/how-it-works/yield-engines/)
for the full mechanics.

## What gets financed

Pipeline finances physical commodity trade facilities — one loan per offtake
contract, senior funded by lenders, equity funded by the originator as
first-loss. The visible risk dial is the cargo-coverage ratio, with
thresholds at **130 / 120 / 110**: above 130 is performing headroom, crossing
120 moves to Watchlist, 110 triggers Risk Council escalation.

{% include diagram.html src="d6-loan-lifecycle.svg" caption="Loan lifecycle — origination through repayment and closure; LoanRegistry writes are informational (capital flows are separate)." %}

<ol class="steps">
  <li>Originator submits an EIP-712-signed origination request through the Originator UI.</li>
  <li>Pipeline Trust Company (the Trustee) reviews, and may approve, request changes, or reject.</li>
  <li>On approval the Trustee mints the loan directly on LoanRegistry — Bridge has no role on LoanRegistry.</li>
  <li>Bridge prepares the Capital Wallet disbursement and Trustee + Team co-sign via MPC; USDC reaches the borrower through the on-ramp provider.</li>
  <li>As the offtaker pays, USDC arrives in the Capital Wallet.</li>
  <li>The Trustee records the split (Senior principal, Senior interest, Equity residual) on LoanRegistry — pure accounting, no capital movement.</li>
  <li>Bridge + Custodian co-sign a YieldAttestation; PLUSD is minted into the sPLUSD vault (share price rises).</li>
  <li>At scheduled maturity or early repayment, the Trustee closes the loan.</li>
</ol>

## Dig in

<div class="card-grid">
  <a class="card" href="/how-it-works/split-rail/">
    <h4>Split-rail architecture</h4>
    <p>Why USDC never sits inside a smart contract.</p>
  </a>
  <a class="card" href="/how-it-works/yield-engines/">
    <h4>Where yield comes from</h4>
    <p>Senior coupons + T-bill accrual, both landing in the sPLUSD vault.</p>
  </a>
  <a class="card" href="/borrowers/">
    <h4>For borrowers</h4>
    <p>What Pipeline finances and who qualifies.</p>
  </a>
</div>

## Related

- [For lenders](/lenders/) — deposit, stake, withdraw, dashboard.
- [Security](/security/) — custody model, supply safeguards, audits.
- [Risks](/risks/) — what can go wrong and how the system bounds it.
