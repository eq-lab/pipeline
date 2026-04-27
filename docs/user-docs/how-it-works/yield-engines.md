---
title: Where yield comes from
order: 4
section: How Pipeline works
---

# Where yield comes from

Pipeline pays yield from two sources: senior-tranche repayments on commodity trade loans, and realised T-bill yield on USYC held in the Capital Wallet. Both arrive in the sPLUSD vault through the same two-party `YieldMinter.yieldMint` call.

{% include diagram.html src="d4-yield-accretion.svg" caption="Both engines deliver realised yield to the sPLUSD vault through the same two-party YieldMinter call." %}

<ol class="steps">
<li>Offtaker wires USD into the Trustee's correspondent bank account when the cargo is paid.</li>
<li>Trustee identifies the wire, matches it to a loan, and on-ramps USD → USDC into the Capital Wallet.</li>
<li>Trustee records the repayment split on LoanRegistry — accounting only, no PLUSD moves.</li>
<li>Relayer and Trustee co-sign a <code>YieldAttestation</code> for the senior coupon (net of fees).</li>
<li><code>YieldMinter.yieldMint</code> verifies both signatures and calls <code>PLUSD.mintForYield</code>, sending the senior coupon into the sPLUSD vault.</li>
<li>USYC NAV drifts up daily as the underlying T-bills accrue. This gain is <strong>unrealised</strong>.</li>
<li>At the Trustee's discretion, the Capital Wallet sells some USYC for USDC against the Hashnote redemption rail. USDC settles in the wallet.</li>
<li>Realised gain (USDC received minus cost basis of units sold) is co-signed and minted via <code>YieldMinter.yieldMint</code> — 70% to the sPLUSD vault, 30% to the Treasury Wallet.</li>
</ol>

## Engine A — senior coupons on trade loans

Each loan is cut into two tranches. The **senior tranche** is funded by Pipeline lenders through the vault. The **equity tranche** is funded by the originator and absorbs first losses.

The **offtaker** is the end buyer of the commodity. When the cargo is paid for, the offtaker wires USD into the **Trustee's correspondent bank account** — the Trustee here being Pipeline Trust Company. The offtaker never touches USDC and never touches the chain.

Once the wire lands, the Trustee identifies it, matches it to a loan, and instructs the on-ramp provider (Circle Mint / Zodia or similar) to convert USD → USDC. The USDC settles into the Capital Wallet. From this point the flow is on-chain.

The Trustee records the split on LoanRegistry: senior principal, senior interest (gross), management fee, performance fee, OET allocation, and equity residual. This write is accounting only — no PLUSD moves until the yield mint.

Fees come out before the senior coupon reaches the vault:

- **Management fee** — 0.5–1.5% per year on deployed senior principal.
- **Performance fee** — 10–20% of senior net interest.
- **OET allocation** — 0.05–0.10% per year, funding the on-chain operations endowment.

All three go to the Treasury Wallet. The senior coupon net — gross senior interest minus management and performance fees — is what lenders actually receive.

The yield-mint event is when this net coupon lands in the vault. The Relayer signs a `YieldAttestation` with `relayerYieldAttestor`. The Trustee co-signs with `trusteeYieldAttestor` (an EIP-1271 contract gated by the Trustee's signing facility). The call goes through `YieldMinter.yieldMint`, both signatures are verified on-chain, and `PLUSD.mintForYield` delivers the new PLUSD into the sPLUSD vault. Neither party can mint alone — YieldMinter rejects the call unless both signatures verify against the configured attestor addresses.

## Engine B — realised yield on USYC reserves

This is the engine people most often misread. **T-bill yield does not accrue automatically into PLUSD.** USYC NAV drifts up at Hashnote, but until USYC is sold for USDC, the gain is paper.

### Where the position sits

The Capital Wallet keeps roughly 15% of reserves in USDC so lenders can withdraw without forcing a sale (band 10–20%). The rest is held as **USYC**, Hashnote's tokenised T-bill. USYC NAV drifts up daily as the underlying bills accrue. The Capital Wallet's mark-to-market value rises with NAV, but PLUSD totalSupply does not — yet.

### Cost basis and realisation

The Trustee tracks the **cost basis** of the USYC position: the USDC originally spent buying it (FIFO or weighted-average — Trustee policy). At any moment the **unrealised gain** is `USYC NAV × units − cost basis`. This number is informational; it does not enter `PLUSD.totalSupply`.

To realise the gain, the Trustee instructs the Capital Wallet to **sell N units of USYC** through the Hashnote redemption rail. This is manual and takes time — Hashnote's redemption flow is not instant, and large redemptions can take longer. When Hashnote completes the redemption, USDC proceeds settle into the Capital Wallet.

Realised gain on that batch:

```
realised_gain = USDC_received − cost_basis_of_units_sold
```

The remaining position's cost basis is reduced by the cost basis of units sold.

### Minting realised yield as PLUSD

Once the proceeds USDC is in the Capital Wallet, Relayer and Trustee co-sign a `YieldAttestation` for `realised_gain`. `YieldMinter.yieldMint` mints that PLUSD: 70% to the sPLUSD vault, 30% to the Treasury Wallet. From a backing standpoint, the new PLUSD is matched 1:1 by the new USDC sitting in the Capital Wallet.

**Cadence is the Trustee's call.** Daily, weekly, monthly — there is no on-chain schedule. If the Trustee never realises, share price never moves on Engine B, regardless of how high USYC NAV climbs.

### Why we don't mint on unrealised gain

Because the gain isn't permanent yet. T-bill prices have low volatility but they are not constant. If we minted PLUSD against a $100K paper gain that then evaporated, we'd be over-minted relative to reserves and lenders would carry the gap. Realisation moves the gain from "paper" into "USDC in the wallet" — only then is the mint safe.

### Residual price risk after realisation

Realisation does not eliminate price risk on the **remaining** USYC. If the Trustee realises a partial gain at a high NAV and USYC then drops, the remaining position is worth less than its post-realisation cost basis. The protocol's mark-to-market backing falls below PLUSD totalSupply.

The on-chain reserve invariant (`totalSupply ≤ cumulativeLPDeposits + cumulativeYieldMinted − cumulativeLPBurns`) does **not** catch this — that invariant is an accounting check on the contract's own counters, not a price check on USYC. The check that catches it is the off-chain **reconciliation indicator** published on the Protocol Dashboard:

| Drift between PLUSD totalSupply and reserve mark-to-market | Status | Action |
|---|---|---|
| < 0.01% | Green | Normal |
| 0.01% – 1% | Amber | Alert on-call + Trustee |
| > 1% | Red | Page on-call + Trustee; consider pausing DepositManager |

Mitigations against this scenario:

- USYC is a tokenised T-bill — historic NAV volatility is very low.
- The Trustee's realisation policy is conservative — only realise gains that are well above cost basis, leaving a buffer.
- If drift goes Amber or Red, RISK_COUNCIL can pause `DepositManager` (no new mints) and, if severe, `proposeShutdown` at a recovery rate that reflects the actual recoverable USDC.

There is no automatic clawback of already-minted PLUSD. Once yield has been minted into the vault and stakers have effectively received it, the protocol owns the residual position risk.

## Where yield does NOT come from

- **No perp funding rates.** Pipeline doesn't run a basis trade.
- **No leverage on deposits.** You aren't borrowing against your sPLUSD to amplify returns.
- **No rehypothecation of reserves.** Reserves don't get lent into third-party DeFi venues.
- **No token emissions.** No governance token dripping value. sPLUSD share price is the return.

## Share price mechanics

sPLUSD share price moves only when a `YieldMinter.yieldMint` call lands a new mint in the vault. Not on a clock. Not on USYC NAV drift. Not on a LoanRegistry write. The mint is the event. LoanRegistry writes confirm a repayment happened on paper; USYC NAV drift confirms an unrealised gain on paper; only `PLUSD.mintForYield`, gated by the two-party attestation, moves NAV.

{% include chart.html src="c2-yield-attribution.svg" caption="Illustrative attribution for a representative senior-tranche loan plus realised T-bill yield. Not live returns." %}

Both engines stack into the same share price. A quarter with heavy repayments shows most of the lift from Engine A. A quarter with no Trustee realisations shows zero from Engine B — even if USYC was accruing the whole time. Over a full year, both contribute — and both arrive through the same co-signed mint path, against the same internal counter invariant PLUSD enforces on every call.
