---
title: Onboarding
order: 6
section: For Lenders
---

# Onboarding

Pipeline does not collect ID documents, corporate paperwork, or accreditation declarations from lenders. Compliance is enforced by KYT (Know Your Transaction) screening at the moment you deposit, and again at the moment you withdraw. The legal framework that governs this approach is `[Framework: TBD]`.

The transfer whitelist still exists. PLUSD can only move between whitelisted addresses. The way you get on the whitelist is by depositing successfully, by submitting your address for a standalone screen, or by being added as an approved DeFi venue.

## What you need before starting

- A self-custodied Ethereum wallet you control. Pipeline never holds your keys.
- Enough USDC in that wallet for your intended deposit. The minimum deposit is $1,000 USDC.

## The flow

Most lenders enter the protocol through their first deposit. There is no separate "apply for access" step.

<ol class="steps">
  <li>Connect your wallet via WalletConnect or RainbowKit. The connected address is your Pipeline account identifier.</li>
  <li>Approve USDC and call <code>DepositManager.deposit(amount)</code>. Your USDC moves into the Intake Wallet, an MPC custody address held under the same cosigner quorum as the Capital Wallet. A deposit ticket is created in <code>Pending</code> state.</li>
  <li>KYT screens your address and the inbound transfer off-chain. Typically seconds, sometimes minutes.</li>
  <li>On a clean result, the Relayer signs a claim attestation and serves it to the frontend via API. Your frontend fetches it once available.</li>
  <li>Call <code>DepositManager.claim(depositId, attestation, signature)</code>. The contract verifies the signature, writes your address to the transfer whitelist, pulls USDC from the Intake Wallet to the Capital Wallet, and mints PLUSD 1:1 to your address. From there, you can stake into sPLUSD or transfer to other whitelisted addresses.</li>
</ol>

The Relayer never writes to DepositManager directly. Its role is to sign the off-chain attestation that you submit at claim time. This is the same pattern the protocol uses for yield mints.

The full deposit flow with failure modes is on the [Deposit](/lenders/deposit/) page.

## Hold PLUSD without depositing

Counterparties who need to receive PLUSD without making their own deposit (a CEX hot wallet, an OTC settlement address, a treasury operator) can enrol via address-only screening. Submit the address through the standalone enrolment endpoint. The Relayer runs KYT and, on a clean result, signs an enrol attestation and returns it via API. The address holder calls <code>WhitelistRegistry.enrol(addr, attestation, signature)</code> themselves to land the entry on-chain. No funds move on this path.

## Re-screening

Whitelist entries are valid for **90 days** from the last clean screen. You stay fresh automatically each time you deposit. If you do not deposit for 90 days, you re-enrol through the standalone endpoint (no funds required) before transferring or withdrawing again. Pipeline also runs scheduled passive re-screening against sanctions lists. A sanctions hit revokes your entry immediately and blocks transfers from your address until the situation is resolved.

## When KYT does not return clean

KYT can return three classes of result on a deposit.

- **Clean.** Your address is whitelisted automatically and your ticket is marked claimable.
- **Soft fail.** Indirect mixer exposure beyond the configured hop count, low-confidence flag, or any other non-binary result. A compliance officer reviews. The default outcome is auto-refund within 72 hours, with USDC returned to your wallet from the Intake Wallet under Trustee and Team co-signature. Compliance can override and approve.
- **Hard fail.** OFAC, sanctioned address, or confirmed criminal proceeds. Funds are held pending Trustee disposition. There is no automatic refund. We follow legal direction.

Severity classification rules are governed by `[Framework: TBD]`.

## What we cannot serve

<div class="callout risk">

- Addresses on OFAC or equivalent sanctions lists.
- Jurisdictions Pipeline cannot legally serve under `[Framework: TBD]`. The list is maintained on the [Legal](/legal/) page.

</div>

## Next steps

- [Deposit](/lenders/deposit/). Approve USDC, call DepositManager, mint PLUSD.
- [Risks](/risks/). Read before committing capital.
- [Legal](/legal/). Jurisdictional rules.
