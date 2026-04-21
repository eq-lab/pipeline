# Split-Rail Architecture

## Context

A commodity trade finance protocol needs to hold real fiat-equivalent capital (USDC, USYC) on behalf of LPs while also operating on-chain as a DeFi primitive. These two worlds have different security models: on-chain code is publicly auditable but exploitable, while off-chain MPC wallets are harder to audit but operationally controllable.

The core tension: how do you let LPs interact with an on-chain token while keeping their actual capital out of reach of a smart contract exploit?

## Decision

The MVP uses a strict two-rail architecture:

- **Cash rail:** USDC and USYC live exclusively in two MPC wallets (Capital Wallet and Treasury Wallet). These wallets are never the `owner` or `beneficiary` of on-chain smart contracts — they are external addresses that happen to interact with the contracts.
- **Token rail:** PLUSD and sPLUSD are on-chain ERC-20/ERC-4626 tokens. They track ownership and yield entitlement but hold no USDC or USYC.

On-chain events (LoanMinted, WithdrawalRequested, RepaymentSettled) serve as authorisation signals to the off-chain bridge service, which then prepares and co-signs MPC wallet transactions. The MPC policy engine enforces the authority — not the smart contract.

## Rationale

- **Alternative considered:** single-rail with smart contracts holding USDC (e.g., Compound-style). Rejected: a reentrancy bug, oracle manipulation, or access control error would directly drain LP capital. The attack surface of ~470 lines of custom Solidity would hold pilot-scale capital.
- **Alternative considered:** use a custodial model (no on-chain tokens). Rejected: removes LP verifiability, composability, and the DeFi yield-layer opportunity.
- The split-rail model bounds the blast radius of a smart contract exploit to the token rail (yield accounting drift) while keeping capital safe. Investors can verify PLUSD supply and backing on-chain without exposing capital to on-chain attack vectors.

## Consequences

**Enables:**
- Smart contract exploit cannot drain USDC/USYC unilaterally (MPC co-signature always required).
- On-chain composability for sPLUSD without LP capital exposure.
- Clear audit boundary: ~470 lines of custom Solidity + bridge service MPC policies.

**Constrains:**
- Loan disbursements and LP payouts require bridge service uptime + MPC co-signatures — not purely on-chain atomic.
- Bridge service infrastructure is a trust assumption; it must be operated with HSM-backed keys and 2-person access controls.
- USYC yield is recognised off-chain (NAV feed) and delivered via trustee-signed events — not an on-chain oracle.
