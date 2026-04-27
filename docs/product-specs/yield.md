# Yield Distribution — Product Spec

## Overview

Protocol yield reaches LP stakers through two distinct paths: loan repayment yield
(discrete events triggered by borrower wires) and T-bill yield (USYC NAV accrual distributed
lazily on each sPLUSD stake/unstake). Both paths deliver fresh PLUSD minted into the sPLUSD
vault via two-party attestation, accreting NAV for all stakers. Fees flow simultaneously to
the Treasury Wallet.

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

### Repayment on-chain delivery

Once the trustee confirms the waterfall breakdown, they submit final split amounts via the
Relayer API (`POST /v1/trustee/repayments/{id}/approve`). This triggers on-chain yield delivery:

1. The trustee instructs the on-ramp provider to convert the senior portion
   (`senior_principal_returned + senior_coupon_net + protocol fees`) from USD to USDC,
   settling into the Capital Wallet.
2. Relayer verifies the USDC inflow matches the Trustee-approved amounts.
3. Relayer constructs two `YieldAttestation` structs, signs each with `relayerYieldAttestor`,
   requests custodian EIP-1271 co-signatures, and calls `PLUSD.yieldMint` for each leg:
   - Vault leg: mints `senior_coupon_net` PLUSD to the sPLUSD vault — accretes NAV for all
     stakers.
   - Treasury leg: mints `management_fee + performance_fee + oet_allocation` PLUSD to the
     Treasury Wallet.
   Both signatures (Relayer ECDSA + custodian EIP-1271) are verified on-chain. Neither party
   alone can mint.

### USYC NAV yield distribution (lazy, stake/unstake-triggered)

USYC NAV accrues continuously. To keep sPLUSD share price current without a time-based cron,
yield is minted **lazily** on every sPLUSD `Deposit` or `Withdraw` event:

1. Relayer reads the current USYC NAV from the Hashnote API.
2. Computes `yield_delta = current_NAV - last_minted_NAV` (applied to Capital Wallet USYC
   holdings). If `delta <= 0`, no mint occurs.
3. If `delta > 0`: Relayer constructs two `YieldAttestation` structs (vault 70%, treasury 30%
   of `yield_delta`), gets Relayer sig + custodian co-sig, submits both `yieldMint` calls.
4. After both `yieldMint` transactions confirm on-chain, Relayer advances the
   `last_minted_NAV` baseline. Until both confirm, the baseline is unchanged — idempotent
   retry is safe.

USYC is not redeemed during yield distribution; it remains in the Capital Wallet. Between
mints, Relayer polls USYC NAV continuously and exposes accrued-but-undistributed yield via
`GET /v1/vault/stats` for dashboard display.

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

The relayer evaluates the invariant after every yield distribution, deposit, loan
disbursement, repayment, and LP withdrawal. The result is published to the protocol
dashboard with a three-state indicator:

| Status | Drift threshold | Action |
|---|---|---|
| Green | < 0.01% | None |
| Amber | 0.01% – 1% | Alert to on-call channel and trustee |
| Red | > 1% | Alert to on-call channel and trustee |

---

## Security Considerations

- **Two-party yield attestation.** Both repayment and USYC yield mints require Relayer ECDSA
  signature + custodian EIP-1271 signature + YIELD_MINTER caller role. A compromised Relayer
  alone cannot mint yield PLUSD.
- **Reserve invariant enforced on-chain.** Every `yieldMint` call checks the cumulative
  counter invariant at the PLUSD contract level, bounding yield issuance against the
  contract's own ledger.
- **Replay protection.** Each `YieldAttestation` is consumed exactly once via the
  `usedRepaymentRefs` mapping on PLUSD. Vault and treasury legs use distinct refs per event.
- USYC is held exclusively in the Capital Wallet. The USDC↔USYC ratio is managed by the
  custodian MPC policy engine and Trustee — not by Relayer.
- The reconciliation invariant is continuously re-evaluated; amber and red states produce
  immediate alerts enabling prompt detection of any backing discrepancy.
