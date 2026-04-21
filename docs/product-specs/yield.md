# Yield Distribution — Product Spec

## Overview

Protocol yield reaches LP stakers through two distinct paths: loan repayment yield
(discrete events triggered by borrower wires) and T-bill yield (weekly USYC NAV accrual).
Both paths deliver fresh PLUSD minted into the sPLUSD vault, accreting NAV for all stakers.
Fees flow simultaneously to the Treasury Wallet. Senior principal returned on repayment is
automatically swept into USYC to earn T-bill yield immediately.

---

## Behavior

### Repayment identification (manual)

Bank integration is excluded from the MVP. The trustee identifies each incoming USD wire in
the Trust Company's correspondent bank account, matches it to a `loan_id` (the LoanRegistry
`tokenId`) using wire details and the open loan ledger, and opens the repayment
reconciliation flow in the trustee tooling.

### Client-side waterfall computation

The trustee selects the loan from the LoanRegistry-backed loan picker, enters the repayment
amount received, and optionally adjusts the repayment date. The client-side application
computes the full waterfall breakdown automatically against LoanRegistry parameters — no
manual arithmetic is required from the trustee. The computation inputs are:

- Immutable loan parameters from the LoanRegistry NFT: `originalFacilitySize`,
  `originalSeniorTranche`, `originalEquityTranche`, `originationDate`,
  `originalMaturityDate`, `governingLaw`
- Mutable lifecycle state: `status`, `currentMaturityDate`
- Protocol-wide fee schedule: management fee rate, performance fee rate, OET allocation rate
- Actual tenor from origination to repayment date
- Repayment amount entered by trustee

The trustee may adjust individual waterfall components when the actual transaction deviates
from the computed baseline (e.g., negotiated fee waiver, partial repayment, early repayment
fee). Deviations from the computed baseline are highlighted by the tooling.

### Waterfall components

| Component | Formula |
|---|---|
| `senior_principal_returned` | `min(amount, outstanding_senior_principal)` |
| `senior_gross_interest` | `tenor × senior_rate × senior_deployed` |
| `management_fee` | `senior_deployed × mgmt_rate × (tenor / 365)` |
| `securitisation_agent_fee` | `0` (inactive in MVP) |
| `performance_fee` | `(senior_gross_interest − management_fee) × perf_rate` |
| `senior_coupon_net` | `senior_gross_interest − management_fee − performance_fee` |
| `oet_allocation` | `senior_deployed × oet_rate × (tenor / 365)` |
| `originator_residual` | `amount − senior_principal_returned − senior_coupon_net − fees − oet_allocation` |

Priority order: senior principal → management fee → senior coupon → performance fee →
OET allocation → originator residual (junior yield). The originator residual is settled
directly through the Trust Company's USD bank account and does not appear in any on-chain
event.

### RepaymentSettled event and on-chain delivery

Once the trustee confirms the waterfall breakdown, they sign a `RepaymentSettled` event
(an EIP-712 off-chain attestation, not an on-chain transaction). This event is the
trigger for on-chain yield delivery:

1. The trustee instructs the on-ramp provider to convert the senior portion
   (`senior_principal_returned + senior_coupon_net + protocol fees`) from USD to USDC,
   settling into the Capital Wallet.
2. The bridge service verifies that the USDC inflow matches the signed event amounts.
3. The bridge mints PLUSD via the yield-mint path:
   - `PLUSD.mint(sPLUSDvault, senior_coupon_net)` — increases vault `totalAssets`,
     accreting NAV for all stakers.
   - `PLUSD.mint(TreasuryWallet, management_fee + performance_fee + oet_allocation)` —
     protocol revenue.
4. The bridge automatically converts `senior_principal_returned` USDC into USYC,
   sweeping the returned principal back into T-bill yield immediately.

### Weekly USYC NAV yield distribution

USYC in the Capital Wallet accrues NAV continuously. Yield is recognised and distributed
weekly, on Thursday at the end of day (working reference: 17:00 America/New_York or the
USYC issuer's published NAV reference time, whichever is later).

Between weekly events, the bridge service tracks the running `accrued_yield` figure in
real time from the USYC issuer's NAV feed. This figure is displayed on the protocol
dashboard for informational purposes only; it does not affect sPLUSD NAV until the weekly
distribution fires.

At the weekly reference time:

1. The bridge computes `total_accrued_yield = USYC NAV appreciation since prior
   distribution × USYC holding amount`.
2. The bridge pre-builds a `TreasuryYieldDistributed` transaction and presents it to the
   trustee tooling, showing: total accrued yield, vault share (70%), treasury share (30%),
   reference USYC NAV, holding amount, and `week_ending` date.
3. The trustee reviews and signs (EIP-712 attestation).
4. On receipt of the trustee signature, the bridge mints:
   - `PLUSD.mint(sPLUSDvault, 0.70 × total_accrued_yield)` — 70% to stakers.
   - `PLUSD.mint(TreasuryWallet, 0.30 × total_accrued_yield)` — 30% to Treasury.
5. USYC is not redeemed during the yield event; it remains in the Capital Wallet and the
   new NAV becomes the baseline for the following week.

### Automated USDC/USYC rebalancing

After every repayment sweep or withdrawal that shifts the USDC/USYC composition, the bridge
enforces a target ratio:

| Parameter | Working value | Configurable by |
|---|---|---|
| Target USDC ratio | 15% of total reserves | Foundation multisig |
| Upper band | 20% — triggers USDC → USYC swap | Foundation multisig |
| Lower band | 10% — triggers USYC → USDC redemption | Foundation multisig |
| Per-swap cap | $5M | Foundation multisig |
| Daily aggregate cap | $20M | Foundation multisig |

Swaps above either cap require Trustee + team co-signature via the trustee tooling escape
path. The trustee retains a manual override UI as a backup path regardless of band state.

### Real-time accrued yield display

The protocol dashboard exposes the running accrued T-bill yield figure as a rolling counter
that resets to zero after each weekly mint. LPs see T-bill yield accumulating in real time
even though distribution is weekly.

---

## PLUSD Backing Invariant

PLUSD is backed 1:1 by USD-equivalent reserves:

```
PLUSD totalSupply
  == USDC in Capital Wallet
   + USYC NAV in Capital Wallet
   + USDC out on active loans (deployed senior principal not yet repaid)
   + USDC in transit (on-ramp leg in either direction)
```

Treasury Wallet PLUSD is part of `totalSupply` and is backed by the same Capital Wallet
contents as every other PLUSD holder.

### Reconciliation indicator

The bridge evaluates the invariant after every yield distribution, deposit, loan
disbursement, repayment, and LP withdrawal. The result is published to the protocol
dashboard with a three-state indicator:

| Status | Drift threshold | Action |
|---|---|---|
| Green | < 0.01% | None |
| Amber | 0.01% – 1% | Alert to on-call channel and trustee |
| Red | > 1% | Alert to on-call channel and trustee |

---

## Security Considerations

- The yield-mint path uses the same `PLUSD.mint()` function as deposit mints but is tracked
  separately in the bridge audit log. Both paths are subject to the on-chain rolling 24h
  rate limit ($10M) and per-transaction cap ($5M).
- The `RepaymentSettled` event is an EIP-712 attestation signed by the trustee; the bridge
  cannot trigger a yield mint without it. A compromised bridge alone cannot fabricate a
  yield event.
- The `TreasuryYieldDistributed` event follows the same pattern: pre-built by the bridge,
  signed by the trustee, then executed. No yield flows without a trustee signature.
- USYC is held exclusively in the Capital Wallet; the USYC issuer whitelists only that
  address as an authorised holder. Automated sweeps to USYC are bounded by the per-swap and
  daily aggregate caps enforced at the MPC policy engine level.
- The reconciliation invariant is continuously re-evaluated; amber and red states produce
  immediate alerts, enabling prompt detection of any backing discrepancy.
