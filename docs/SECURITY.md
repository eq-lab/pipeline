# SECURITY

## Authentication

| Actor | Method |
|-------|--------|
| LP | Wallet signature (WalletConnect v2 / RainbowKit) — the connected wallet IS the account |
| Trustee | Email + password + TOTP (Google Authenticator/Authy) or WebAuthn/FIDO2 hardware key |
| Loan Originator | Email + password + TOTP or WebAuthn/FIDO2 |
| Pipeline Team | Email + password + TOTP or WebAuthn/FIDO2 |
| Risk Council | Safe multisig (hardware wallet recommended) |
| Bridge Service | AWS KMS / GCP KMS (HSM-backed); 2-person operational access for key rotation |

## Authorization model

### Smart contract roles

| Role | Holder | Scope |
|------|--------|-------|
| MINTER | Bridge service | Mint PLUSD (bounded by rate limit) |
| PAUSER | Foundation multisig | Pause/unpause PLUSD, sPLUSD, WithdrawalQueue |
| WHITELIST_ADMIN | Bridge service | Set/revoke LP whitelist entries |
| DEFAULT_ADMIN | Foundation multisig | WhitelistRegistry admin, DeFi venue additions |
| FILLER | Bridge service | Fill WithdrawalQueue requests |
| loan_manager | Bridge service | Mint and update LoanRegistry entries |
| risk_council | Risk Council (3-of-5 Safe) | Loan default/close, protocol pause |

### MPC wallet policies

**Capital Wallet** — three participants: Trustee, Pipeline team, Bridge service.

Bridge service auto-signs only 4 categories:
1. USDC → USYC swaps within $5M per-tx / $20M daily bounds
2. LP payouts where destination == original deposit address AND amount within $5M per-tx / $10M 24h bounds
3. Loan disbursement transaction *preparation* (not signing — requires Trustee + Team co-signature)
4. Treasury redemption transaction *preparation* (not signing)

**Treasury Wallet** — two participants: Trustee, Pipeline team. No bridge auto-signing.

## Trust boundaries

```
Internet
  → Frontend (public, wallet-authenticated for LP actions)
  → API (authenticated, role-gated)
    → Worker/Bridge (internal, HSM-keyed)
      → Ethereum (public, role-gated by smart contract ACL)
      → MPC vendor (permissioned, policy-engine enforced)
      → KYC/Screening vendors (Sumsub, Chainalysis — authenticated API)
      → Price feed vendors (Platts/Argus — licensed authenticated API)
```

Smart contracts hold no USDC or USYC. A bug or exploit in on-chain code cannot drain investor capital without the MPC co-signatures that the policy engine enforces off-chain.

## PLUSD transfer restrictions (MVP)

PLUSD uses a whitelist-only transfer model: every `_update` call reverts if the recipient is not in the WhitelistRegistry (KYCed LPs or foundation-multisig-approved DeFi venues). This prevents a compromised LP wallet from moving funds to an attacker-controlled address that hasn't passed KYC.

sPLUSD has no transfer restriction — the vault is intentionally open for DeFi composability. The KYC chain re-enters on redemption (PLUSD transfer to receiver must pass whitelist check).

## Operator account security

- Two-person team consensus required to activate any new operator (Trustee, Originator, or Team member)
- Single team member can suspend immediately (offboarding, suspected compromise)
- Two-person consensus required for permanent removal
- Every operator action is recorded in the append-only audit log

## Data handling

- No LP PII stored on-chain — wallet addresses and KYC outcomes only
- Sumsub and Chainalysis raw reports retained per each vendor's data retention policy
- Audit log retained for lifetime of the protocol; stored append-only with no delete capability

## Operational endpoint protection

- API endpoints for fund-transfer actions (co-signing, treasury redemption) require active operator session + 2FA confirmation per action
- Compliance review queue accessible only to team members with the `compliance` sub-role
- Foundation multisig emergency pause button in team interface sends notification to all Risk Council members — it does not execute the pause itself (they must sign on Safe independently)
