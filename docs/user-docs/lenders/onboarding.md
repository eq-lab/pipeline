---
title: Onboarding
order: 6
section: For Lenders
---

# Onboarding

Pipeline is permissioned — every lender wallet passes KYC and Chainalysis screening before it can mint PLUSD.

## What you need before starting

- A self-custodied Ethereum wallet that you control. Pipeline never holds your keys.
- Enough USDC in that wallet for your intended deposit. The minimum deposit is $1,000 USDC.
- An accredited-investor status declaration, depending on your jurisdiction. See [`/legal/`](/pipeline/legal/) for the current rules.

## The KYC flow

<ol class="steps">
  <li>Connect your wallet via WalletConnect or RainbowKit. The connected address becomes your Pipeline account identifier.</li>
  <li>Submit identity documents through Sumsub. Individuals upload ID and a selfie. Entities upload corporate documents and UBO disclosures.</li>
  <li>The system runs Chainalysis screening on your wallet address against sanctions lists and prohibited categories.</li>
  <li>If both vendors return clean results, Bridge writes your address to WhitelistRegistry with an <code>approvedAt</code> timestamp. This usually lands within minutes of the second vendor result.</li>
  <li>The deposit UI unblocks. You can now approve USDC and call <code>DepositManager.deposit</code>.</li>
</ol>

## Manual review path

If Sumsub flags the application or Chainalysis returns a non-clean result, your case moves to a compliance officer. The reviewer sees the full Sumsub output, the Chainalysis report, your accreditation declaration, and the specific flag that triggered review. Every decision is written to the audit log with the deciding officer and evidence reviewed. Complex cases — politically exposed persons, entities with deep UBO chains — escalate to a second officer before any write to WhitelistRegistry.

## Freshness gate

Your KYC screen is valid for 90 days. After that, the deposit UI blocks new deposits until you re-screen through Chainalysis. A clean re-screen refreshes your `approvedAt` timestamp and the UI unblocks again. Withdrawals are unaffected by freshness expiry — you can always exit even if your screen has lapsed.

This is Pipeline's second factor on the mint path. A compromised WhitelistRegistry alone cannot enable a mint, because the DepositManager also requires a fresh screening timestamp. Both conditions must hold for the same address in the same transaction.

## What we can't serve

<div class="callout risk">

- Wallets on OFAC or equivalent sanctions lists.
- Jurisdictions Pipeline cannot legally serve. See [`/legal/`](/pipeline/legal/) — the list is maintained there.
- Non-accredited retail investors where the offering requires accreditation.

</div>

## Next steps

- [Deposit and stake](/pipeline/lenders/deposit-and-stake/) — approve USDC, mint PLUSD, optionally stake to sPLUSD.
- [Risks](/pipeline/risks/) — read before committing capital.
- [Legal](/pipeline/legal/) — jurisdictional rules and accreditation requirements.
