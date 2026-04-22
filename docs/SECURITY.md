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
| DEPOSITOR | DepositManager contract | Call `mintForDeposit` on PLUSD (deposit leg only) |
| YIELD_MINTER | Bridge service | Call `yieldMint` on PLUSD (requires custodian co-sig) |
| BURNER | WithdrawalQueue | Burn escrowed PLUSD on LP `claim` |
| WHITELIST_ADMIN | Bridge service | Set/revoke LP whitelist entries, refresh screening |
| FUNDER | Bridge service | Fund WithdrawalQueue head; skip sanctioned heads |
| TRUSTEE | Trustee key (Pipeline Trust Company) | Mint and update LoanRegistry NFTs |
| PAUSER | GUARDIAN 2/5 Safe | Pause/unpause all pausable contracts |
| RISK_COUNCIL | RISK_COUNCIL 3/5 Safe | Propose loan default; propose shutdown |
| ADMIN | ADMIN 3/5 Safe | Role management, upgrades, parameter changes (48h timelock) |

### MPC wallet policies

**Capital Wallet** — three participants: Trustee, Pipeline team, Bridge service.

Bridge service auto-signs only 1 category on the Capital Wallet:
- LP payouts where destination == original deposit address AND amount within $5M per-tx / $10M 24h bounds

Loan disbursements require Trustee + Team co-signature directly; Bridge is not in the disbursement path.
USDC↔USYC rebalancing is managed by the custodian MPC policy engine and Trustee; Bridge only requests a USYC redemption when Capital Wallet USDC is insufficient at withdrawal funding time.

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

PLUSD uses a non-transferable model: the `_update` hook requires exactly one of (from, to) to be a system address or whitelisted LP. LP↔LP and system↔system transfers both revert. DeFi venues may be added to the allowlist by the ADMIN 3/5 Safe. This prevents a compromised LP wallet from moving funds to an attacker-controlled address that hasn't passed KYC.

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
- GUARDIAN 2/5 Safe emergency pause covers all pausable contracts (PLUSD, DepositManager, sPLUSD, WithdrawalQueue, WhitelistRegistry, LoanRegistry) and can be executed immediately without a timelock
