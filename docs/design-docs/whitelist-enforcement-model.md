# Whitelist Enforcement Model

## Context

PLUSD is an ERC-20 token with a KYC requirement on the minting side. The question is: how far should KYC enforcement extend into the token's transfer lifecycle? Options range from mint-only enforcement to per-transfer enforcement.

## Decision

The MVP uses a **strict allowlist model** on every PLUSD transfer:

- The PLUSD `_update` hook calls `WhitelistRegistry.isAllowed(to)` on every `transfer` and `transferFrom`.
- `isAllowed` returns `true` only if the recipient is either (a) a KYCed LP with a fresh Chainalysis screen (within the 90-day freshness window) or (b) a DeFi venue explicitly approved by the foundation multisig.
- If neither condition is met, the transfer reverts.

sPLUSD has **no transfer restriction** — the vault is open to any PLUSD holder.

## Rationale

- **Alternative considered:** mint-only enforcement (check only when PLUSD is minted, not on every transfer). Rejected: once PLUSD is in circulation it can move freely, including to attacker-controlled addresses if an LP wallet is compromised. The protocol's capital-protection story depends on funds not reaching unapproved addresses.
- **Alternative considered:** denylist model (block only sanctioned addresses). Rejected for MVP: the pilot LP set is small and controlled; an allowlist with a defined DeFi venue expansion path is appropriate for the restricted-interaction launch posture. The foundation multisig can lift to a denylist model in Phase 2 via a configuration change at the WhitelistRegistry level — no contract upgrade required.
- sPLUSD has no restriction because it is intentionally the DeFi composability layer. Any holder who already holds PLUSD (which required KYC to mint or acquire via an approved venue) can stake into sPLUSD. KYC re-enters when sPLUSD is redeemed for PLUSD and that PLUSD is transferred to the recipient.

## Consequences

**Enables:**
- A compromised LP wallet cannot move PLUSD to an unapproved attacker address.
- The approved DeFi venue list creates a controlled composability expansion path.
- Passive compliance: every on-chain PLUSD transfer is a screened interaction, not just the mint.

**Constrains:**
- Third parties can only hold or receive PLUSD if they are whitelisted LPs or approved DeFi venues.
- PLUSD cannot be used as a general-purpose stablecoin in the MVP — it is restricted to the allowlisted set.
- 90-day re-screening means PLUSD holders may find transfers reverting if their screen has expired. The LP dashboard surfaces the days-remaining indicator.
- Adding new DeFi venues to the allowlist requires a foundation multisig transaction — legal and technical review is gated by governance.
