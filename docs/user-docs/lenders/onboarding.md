---
title: Onboarding
order: 13
section: For Lenders
---

# Onboarding

Connect a wallet, deposit USDC. Pipeline runs KYT screening on every deposit transaction; cleared funds settle into the Capital Wallet automatically.

## What you need

- A self-custodied Ethereum wallet you control (Pipeline never holds your keys)
- USDC in that wallet for your intended deposit (min $1,000)
- A small ETH balance for gas (two transactions: USDC approval + deposit)

## The flow

Most lenders enter the protocol through their first deposit. There is no separate "apply for access" step.

1. Connect your wallet via WalletConnect or RainbowKit. The connected address is your Pipeline account identifier.
2. Approve USDC and call `DepositManager.deposit(amount)`. Your USDC moves into the Intake Wallet, an MPC custody address held under the same cosigner quorum as the Capital Wallet. A deposit ticket is created in `Pending` state.
3. KYT screens your address and the inbound transfer off-chain. Typically seconds, sometimes minutes.
4. On a clean result, the Relayer signs a claim attestation and serves it to the frontend via API. Your frontend fetches it once available.
5. Call `DepositManager.claim(depositId, attestation, signature)`. The contract verifies the signature, writes your address to the transfer whitelist, pulls USDC from the Intake Wallet to the Capital Wallet, and mints PLUSD 1:1 to your address. From there, you can stake into sPLUSD or transfer to other whitelisted addresses.

## Re-screening

Whitelist entries are valid for 90 days from the last clean screen. You stay fresh automatically each time you deposit. If you do not deposit for 90 days, you re-enrol through the standalone endpoint (no funds required) before transferring or withdrawing again. Pipeline also runs scheduled passive re-screening against sanctions lists. A sanctions hit revokes your entry immediately and blocks transfers from your address until the situation is resolved.

## What we cannot serve

- Wallets on OFAC or equivalent sanctions lists
- Jurisdictions Pipeline cannot legally serve (sanctioned jurisdictions, US)

## Next steps

- [Deposit](/lenders/deposit/). Approve USDC, call DepositManager, mint PLUSD.
- [Risks](/risks/). Read before committing capital.
- [Legal](/references/legal/). Jurisdictional rules.
