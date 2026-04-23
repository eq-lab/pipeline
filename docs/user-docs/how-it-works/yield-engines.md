---
title: Where yield comes from
order: 4
section: How Pipeline works
---

# Where yield comes from

Pipeline pays yield from two real, ongoing flows — repayments on commodity
trade loans and Treasury-bill accrual on idle reserves — and the sPLUSD share
token captures both.

{% include diagram.html src="d4-yield-accretion.svg" caption="Two engines — senior coupons and T-bill accrual — both deliver yield to the sPLUSD vault through the same two-party attested yieldMint." %}

<ol class="steps">
<li>Offtaker wires USDC to the Capital Wallet when the cargo is sold.</li>
<li>Trustee records the repayment split on LoanRegistry (informational only — no tokens move).</li>
<li>Bridge and Custodian co-sign a <code>YieldAttestation</code> after verifying the USDC inflow.</li>
<li><code>PLUSD.yieldMint</code> delivers the senior coupon leg to the sPLUSD vault.</li>
<li>USYC NAV drifts up continuously as T-bills accrue at the custodian.</li>
<li>A stake or unstake on sPLUSD triggers the lazy NAV reconciliation.</li>
<li>Bridge and Custodian co-sign a fresh <code>YieldAttestation</code> with a new salt.</li>
<li><code>PLUSD.yieldMint</code> splits the NAV delta — 70% to the sPLUSD vault, 30% to the Treasury Wallet.</li>
</ol>

## Engine A — Senior-tranche coupons on trade loans

Every Pipeline loan is cut into two tranches. The **senior tranche** is funded
by Pipeline lenders through the vault. The **equity tranche** is funded by the
loan originator and absorbs first losses. When the **offtaker** — the end
buyer of the commodity — pays for the cargo, that USDC arrives at the Capital
Wallet. The trustee splits it into senior principal, senior interest (net of
fees), and an equity residual returned to the originator.

Fees come out before the senior coupon reaches the vault:

- **Management fee** — 0.5–1.5% per annum on deployed senior principal.
- **Performance fee** — 10–20% of senior net interest.
- **OET allocation** — 0.05–0.10% per annum, funding the on-chain operations
  endowment.

All three route to the Treasury Wallet, not to the vault. The senior coupon
net — gross senior interest minus management fee minus performance fee — is
the amount lenders actually receive.

The moment yield lands in the vault is the yield-mint event. Bridge and the
custodian co-sign a `YieldAttestation`, and `PLUSD.yieldMint` delivers new
PLUSD to the sPLUSD vault. That new PLUSD is what moves the share price
upward. Neither Bridge nor the custodian can mint alone; both signatures are
verified on-chain.

## Engine B — T-bill accrual on USYC reserves

The Capital Wallet holds roughly 15% of reserves in USDC so lenders can
withdraw instantly — the band runs 10–20% and is rebalanced by the custodian
and trustee. The rest sits in **USYC**, Hashnote's tokenized Treasury-bill
vehicle. USYC's NAV drifts up as the underlying bills accrue, and the Capital
Wallet's USYC balance earns that drift directly.

Distribution on each reconciliation:

- **70%** of the NAV delta is minted to the sPLUSD vault.
- **30%** is minted to the Treasury Wallet.

The same two-party attestation applies: Bridge signs, the custodian co-signs,
and PLUSD checks both on-chain before minting.

T-bill yield is minted **lazily** — when someone stakes or unstakes sPLUSD,
not on a clock. Between mints, the accrued-but-undistributed amount shows on
the dashboard. If nobody interacts with the vault for a while, the accrual
still lands the next time anyone does.

## Where yield does NOT come from

- **No perpetual-futures funding rates.** Pipeline does not run a basis trade.
- **No leverage on the deposit side.** You are not borrowing against your
  sPLUSD position to amplify returns.
- **No rehypothecation of the USDC reserve.** The reserve does not get lent
  into third-party DeFi venues.
- **No token emissions.** There is no governance token dripping value.
  sPLUSD share price is the return.

## Where the money sits between repayments

Idle USDC and USYC sit at the custodian — both are on-chain ERC-20 holdings
at the Capital Wallet address, controlled by MPC cosigners. USYC earns the
T-bill yield every day, whether or not a loan repaid that week. See
[custody](/pipeline/security/custody/) and [split-rail architecture](/pipeline/how-it-works/split-rail/)
for how the cash rail is structured.

## Share price mechanics

sPLUSD share price moves only when a new yield mint lands in the vault — not
on a clock, and not when the trustee writes a repayment entry to the
LoanRegistry. The yield mint is the event. LoanRegistry writes are
informational; they confirm that a repayment happened, but they do not change
share price. Only `PLUSD.yieldMint`, gated by the two-party attestation and
the on-chain reserve invariant, moves NAV.

{% include chart.html src="c2-yield-attribution.svg" caption="Illustrative attribution for a representative senior-tranche loan plus the T-bill engine. Not live returns." %}

Both engines stack into the same share price. A quarter with heavy repayments
shows most of the lift from Engine A. A quiet quarter with few repayments
shows Engine B carrying more of the accrual. Over a full year, both
contribute — and both arrive through the same co-signed mint path, against
the same 1:1 backing invariant PLUSD enforces on every call.
