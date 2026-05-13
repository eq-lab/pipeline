---
title: Relayer security model
order: 22
section: Technical overview
---

# Relayer security model

The Relayer is Pipeline's off-chain backend that indexes the chain, co-signs yield mints, maintains the WhitelistRegistry, and cuts custody in an emergency. To minimise trust assumptions, it holds no custody share, cannot mint PLUSD alone, and cannot move USDC out of any Capital Layer wallet. Every privileged action requires either a second on-chain signature or a pre-authorised contract allowance.

## What the Relayer can do

- Index on-chain events and serve off-chain attestations to the frontend via API
- Co-sign YieldAttestations alongside the Trustee — both signatures verified on-chain at `YieldMinter.yieldMint`, neither can mint alone
- Sign ClaimAttestations and EnrolAttestations off-chain under the `kytAttestor` key; the lender or address holder submits them on-chain at `DepositManager.claim`, `WithdrawalQueue.claim`, or `WhitelistRegistry.enrol`
- Call `WhitelistRegistry.revokeAccess` directly under the `WHITELIST_REVOKER` role for fast sanctions response — the only on-chain write the Relayer performs
- Raise an alarm that triggers the hardware circuit breaker (a custody-side action carried out by the Trustee and Team under the BitGo cosigner policy, not by the Relayer itself)

## What the Relayer cannot do

- Mint PLUSD alone. Mint paths require the lender's own `DepositManager.claim` call (against USDC the lender already deposited) or YieldMinter's two-party call.
- Move USDC out of the Capital Wallet, Treasury Wallet, or Intake Wallet. No allowances exist to any Relayer-controlled contract.
- Move USDC out of the Withdrawal Queue Wallet. The WithdrawalQueue contract pulls via the wallet's standing allowance when a lender calls `claim`; the Relayer is not in the claim critical path.
- Grant or re-grant roles. ADMIN only (under 3-day timelock, 7-day for upgrades).
- Enrol addresses on the whitelist directly. Enrolments land via `DepositManager.claim` (auto-enrol on deposit) or holder-submitted `WhitelistRegistry.enrol` with an attestation.
- Pause contracts. GUARDIAN only.
- Declare default. RISK_COUNCIL only (3-day timelock).

## Compromised Relayer scenario

If the Relayer is compromised, the attacker cannot drain capital. PLUSD is only minted when the lender calls `claim` against their own deposited USDC; a compromised `kytAttestor` key can sign attestations but cannot mint PLUSD on its own. The risk is AML (illicit USDC entering the Capital Wallet via a bypassed KYT on a real deposit), not direct theft. Worst case beyond that: denial of service on yield mints (refusing to co-sign) and on whitelist enrolment (refusing fresh attestations).

GUARDIAN revokes the Relayer's `WHITELIST_REVOKER` instantly via `AccessManager.revokeRole`, and pauses DepositManager, YieldMinter, and WithdrawalQueue as defence in depth. ADMIN rotates `kytAttestor` and `relayerYieldAttestor` under the 48-hour attestor-rotation timelock and re-grants `WHITELIST_REVOKER` to a new Relayer key under the 3-day standard timelock.

## Operational hardening

- Hardware-backed key custody for the attestation key
- Rate-limited signing with anomaly detection
- Independent reconciliation oracle separate from the Relayer, publishing the Capital Wallet vs. PLUSD `totalSupply` drift indicator
- On-call rotation with SLA-bounded response to red drift
