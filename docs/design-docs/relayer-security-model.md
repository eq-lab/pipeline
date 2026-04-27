# Relayer Security Model

## Context

The relayer service needs broad operational authority: it listens to on-chain events, holds the MINTER and FILLER roles on PLUSD and WithdrawalQueue, holds the loan_manager role on LoanRegistry, and participates as an MPC signer on the Capital Wallet. If the relayer is compromised, what is the worst-case loss?

## Decision

The relayer's authority is bounded by three structural properties that operate at the MPC policy engine level — not in the relayer's own code:

1. **Narrow MPC permissions.** The relayer auto-signs only four transaction categories on the Capital Wallet, each with predefined counterparty addresses and envelope bounds. The MPC vendor's policy engine enforces this — the relayer cannot sign anything else even if its software is fully compromised.

2. **Pinned counterparty addresses.** For each auto-signed category:
   - USDC↔USYC swaps: destination is always the USYC issuer's whitelisted address.
   - LP payouts: destination must match the relayer's stored `original_deposit_address` mapping for the LP.
   - Loan disbursements: destination is always the pre-configured on-ramp provider address.
   - Treasury redemptions: destination is always the pre-approved Treasury withdrawal endpoint.
   A compromised relayer cannot redirect funds to an attacker-controlled address.

3. **Bounded envelopes.** Every auto-signed category has per-transaction and rolling-aggregate caps ($5M/$10M for LP payouts; $5M/$20M for USYC swaps) enforced by the MPC policy engine. Even worst-case compromise is bounded to a recoverable fraction of the pilot pool within any detection window.

On the token-rail side: the MINTER role is bounded by the on-chain rate limit ($10M/24h, $5M per-tx). The FILLER role can only burn PLUSD already in queue escrow. The loan_manager role requires a trustee-verified off-chain signed request before calling mintLoan.

## Rationale

- **Alternative considered:** Relayer holds no MPC key; all cash-rail transactions require trustee + team every time. Rejected: LP withdrawals would require human intervention on every withdrawal — operationally unscalable even at pilot scale.
- **Alternative considered:** Relayer has full Capital Wallet signing authority. Rejected: single point of failure for LP capital; exploiting the relayer (hot infrastructure) would drain the pool.
- The bounded auto-signing model achieves automation for the happy-path flows while keeping the maximum exploitable amount within a recoverable threshold. The $10M/24h cap on LP payouts means that in the worst case (relayer fully compromised), exposure is bounded — and the foundation multisig pause can stop further damage within minutes of detection.

## Consequences

**Enables:**
- LP withdrawals and USYC rebalancing are fully automated without human signatures in the happy path.
- Loan disbursements and Treasury redemptions still require Trustee + Team co-signatures (relayer only prepares the transaction).
- Compromise of relayer software is survivable at reasonable pilot pool sizes.

**Constrains:**
- LP payout above $5M per-tx or $10M/24h requires Trustee + Team manual co-signature.
- USYC rebalancing above $5M per-tx or $20M daily requires Trustee + Team co-signature.
- LP address changes (withdrawal to a different address) are not automatable — require manual trustee review.
- Relayer hot keys must be stored in HSM-backed KMS with 2-person operational access for rotation.
