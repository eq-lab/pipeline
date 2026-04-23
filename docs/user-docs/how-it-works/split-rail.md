---
title: Split-rail architecture
order: 3
section: How Pipeline works
---

# Split-rail architecture

Pipeline runs on two separate rails. The **cash rail** holds real USDC at a
regulated custodian. The **token rail** is a set of on-chain contracts that
issue receipts and track behaviour. Rules link the two rails, not shared
control. No contract can spend custodian funds. No custodian signer can mint
tokens alone.

{% include diagram.html src="d1-system-context.svg" caption="Pipeline system context — cash rail off-chain, token rail on-chain, governance by three Safes." %}

The diagram shows lenders on the left interacting with on-chain contracts (the
token rail). Those contracts coordinate with the Capital Wallet on the right,
which lives at a regulated custodian (the cash rail). Three Gnosis Safes —
ADMIN, RISK_COUNCIL, and GUARDIAN — govern the token rail from above. The
Bridge backend and the Trustee appear between the rails as operators, not as
custody points.

## The cash rail

The cash rail is where USDC actually lives. It is a single address called the
**Capital Wallet**, held by a regulated custodian. The custodian is a separate
legal entity with its own compliance program, its own insurance, and its own
auditors.

The Capital Wallet is an on-chain Ethereum address. USDC moves in and out of it
as on-chain ERC-20 transfers. These moves are visible on Etherscan like any
other token transfer.

Control of the Capital Wallet is split across three independent cosigners using
MPC (multi-party computation):

- **Trustee** — an independent third party.
- **Pipeline Team** — a Safe operated by Pipeline.
- **Bridge** — Pipeline's backend service.

Routine lender withdrawals are auto-signed by Bridge inside narrow policy
bounds the custodian enforces (for example, $5M per transaction and $10M per
rolling 24 hours). Anything outside those bounds needs a second cosigner.
Moving funds to a new destination needs Trustee plus Team.

The custodian enforces its own policy engine on top of the MPC signing. If a
cosigner set tries to send USDC to an address the custodian has not
whitelisted, the custodian refuses — even with valid signatures.

## The token rail

The token rail is a set of on-chain contracts. None of them custody USDC. They
track who is owed what, and they enforce the rules around issuance and
redemption.

- **PLUSD** — the ERC-20 receipt. One PLUSD represents one USDC of deposit
  that has been recorded on the cash rail. PLUSD is non-transferable between
  ordinary lender wallets — every transfer must touch a system address or an
  approved DeFi venue.
- **sPLUSD** — an ERC-4626 vault that wraps PLUSD. Holding sPLUSD earns yield
  from the 70/30 T-bill split and from commodity-loan interest. Share price
  moves only when yield actually mints.
- **DepositManager** — the contract lenders call to deposit. It pulls USDC
  from the lender, sends it to the Capital Wallet in the same transaction, and
  mints PLUSD 1:1. Minimum deposit is $1,000 USDC.
- **WithdrawalQueue** — the FIFO queue lenders enter to redeem PLUSD for USDC.
- **LoanRegistry** — an on-chain record of each commodity loan and its state.
  Informational only. It is not a price source and cannot move funds.
- **WhitelistRegistry** — the KYC allowlist. Entries carry a Chainalysis
  screening timestamp; mints require a screen under 90 days old.

None of these contracts hold USDC on behalf of lenders. PLUSD is a ledger
entry; sPLUSD is a wrapper on that ledger entry; LoanRegistry is a notebook.
The USDC sits at the custodian.

<div class="callout safety">
  <h4>Safety Property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

This property holds for two reasons. The contracts that could be exploited do
not hold the capital. The wallet that holds the capital will not release USDC
to an address the custodian's policy engine has not approved.

## Why this matters for a lender

The split-rail design bounds the worst case. A smart-contract bug can stop
deposits, stop withdrawals, or misreport state on the token rail. It cannot
send your USDC to an attacker's address, because the contract never controlled
that USDC in the first place. The inverse holds too. A custodian signer compromise cannot mint PLUSD out of
thin air. Mint paths enforce on-chain checks the custodian does not bypass. The [security pages](/security/)
walk through each failure mode in detail.

## Related

- [Custody model](/security/custody/) — how the Capital Wallet cosigner rules
  and custodian policy engine actually work.
- [Supply safeguards](/security/supply-safeguards/) — the on-chain checks that
  bound minting, including the reserve invariant and rate limits.
- [Yield engines](/how-it-works/yield-engines/) — where the 70/30 T-bill /
  commodity split comes from and how yield reaches sPLUSD holders.
