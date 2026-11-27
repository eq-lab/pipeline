---
title: Risk management
order: 33
section: Risk management
---

# Risk management

Yield on Pipeline comes from interest paid on commodity trade loans. Lenders can lose money. Read this page before depositing.

Pipeline's risks fall into seven categories. For each, this page states the exposure, the mitigation, and the residual you accept by participating.

## Credit risk

#### What it is

A borrower does not repay. The goods cannot be sold, or the sale is late or brings less than the debt.

#### What mitigates it

- Pipeline lends only where, on every day the money is out, it holds the goods or a bank's promise to pay. Advances secured only by a supply contract and the trader's promise are not taken.
- Each loan is secured by security instruments held by the Security Agent for the lenders: endorsed bills of lading, warehouse pledges, collateral management agreements, assigned receivables, letter of credit proceeds, cash cover, insurance proceeds.
- Each loan has an advance ratio of 80 %, 75 % or 65 % by commodity class. LTV is outstanding principal plus accrued interest, divided by the value of the security. A margin call opens when LTV rises 5 points above the advance ratio. The borrower must restore the advance ratio within 3 business days. The security registry runs these checks on-chain.
- The borrower pays its own equity into the trade before drawdown. The Originator lends at least 5–20 % of each loan on the same terms as the pool, so it shares any loss.
- The Risk Council approves each loan against the [Credit Policy](/risks/credit-policy/).
- Each deal is reviewed by goods, corridor and counterparties, with a primary liquidator and two back-ups onboarded before drawdown.
- First-ranking security only. A local legal opinion confirms it before funding.
- Once the pool passes $30M, concentration limits cap exposure to a single borrower, to Tier 3 jurisdictions, to a single country and to a single commodity.

#### What remains

The security can be worth less than the debt when it is sold. A shortfall falls on the lenders by share: the Originator's part on the Originator, the pool's part on the holders of sPLUSD at the moment of default. Below $30M the pool has no concentration limits, so one default can be a large share of it. See [Default management](/risks/default-management/).

## Liquidity risk

#### What it is

Withdrawal requests exceed the USDC available for withdrawals. Lenders wait.

#### What mitigates it

- Unstaking sPLUSD to PLUSD is instant.
- Pipeline keeps 10–15 % of the pool in an on-chain liquidity buffer. Retail withdrawals are paid from it once screened. If it runs short, requests are paid in order as it is topped up.
- Larger withdrawals are paid at the quarterly withdrawal windows.
- Loans are self-liquidating trade loans of up to 180 days. Principal returns when the borrower's buyer pays.

#### What remains

USDC lent to borrowers is not available until loans are repaid. If withdrawals exceed the buffer, retail requests wait in the queue until it is topped up, and larger withdrawals wait for the next quarterly window.

## Custody risk

#### What it is

Loss or misuse of the keys that control the custody accounts holding lender USDC.

#### What mitigates it

- Deposited USDC goes straight to a deposit custody account. The smart contracts do not hold lender USDC.
- Each custody account is an MPC wallet with a 3-of-5 quorum. The Independent Trustee, a licensed trust company, holds a mandatory key and co-signs every payment out of Pipeline's accounts, except withdrawals paid automatically from the buffer.
- Withdrawals are paid from a separate withdrawal custody account. The withdrawal queue can draw only up to the allowance that account grants it.

#### What remains

Whoever controls the signers of a custody account controls the USDC in that account.

## Smart-contract risk

#### What it is

A bug in the protocol's smart contracts. Unintended state changes. Exploitable code paths.

#### What mitigates it

- Lender USDC sits in custody accounts outside the smart contracts.
- PLUSD for a USDC deposit is minted only after the backend screens the deposit and signs a single-use voucher.
- Mint limits: 5,000,000 PLUSD per deposit and 10,000,000 per 24 hours for USDC deposits; 1,000,000 per transaction and 10,000,000 per 24 hours for bank wires, interest, fees and bank income.
- Each bank reference can be booked once.
- Each contract can be paused on its own.
- An independent security audit is in progress. The report will be published when it is complete. See [Audits & addresses](/technical/audits-and-addresses/).

#### What remains

A bug in the vault or the loan registry can misstate balances. Contract upgrades run without a delay. A bug in the withdrawal queue can move USDC up to the allowance granted by the withdrawal custody account.

## Governance risk

#### What it is

A captured role holder pushes through a hostile change.

#### What mitigates it

- Every privileged action is mapped to one role in the access manager.
- Risk Council actions run with a 24-hour delay, except facility approval, a default declaration and a repayment reversal. Each delayed action is public while it waits.
- The Guardian can cancel a scheduled action during its delay. The Guardian cannot grant roles, pause, unpause, upgrade or move funds.
- The Risk Council signs through a multisig of its three voting members. The Admin, Guardian, Pauser and Upgrader are multisigs. The Cash Reporter is a 2-of-2 multisig. The Trustee role is held by the Independent Trustee.

#### What remains

The Admin role runs with no delay. The Admin grants and revokes roles, sets limits, unpauses and changes custody accounts. A captured Admin multisig can do all of this at once.

## Regulatory risk

#### What it is

Regulatory classification, jurisdictional authority or sanctions rules change in a way that affects the protocol.

#### What mitigates it

- Secured lending under a master facility agreement and an agency deed. The Security Agent holds the security on trust for all lenders
- Permissioned access: every lender address and deposit is screened (KYT) before the address may hold PLUSD; lenders who wire USD pass KYC or KYB
- KYB, AML and sanctions checks on Originators, borrowers and every other party to a deal
- Jurisdictional eligibility list maintained on the [Legal](/references/legal/) page

#### What remains

Regulatory regimes can change. The eligibility list can be revised. USDC lenders are identified only by KYT screening of their address. A change in rules can require identity checks for every lender, or restrict who may deposit or hold PLUSD.

## Operational risk

#### What it is

Key compromise, vendor incident, booking error or a missed action by an operator.

#### What mitigates it

- The backend cannot mint PLUSD alone. A deposit mint needs a real USDC deposit. Every other mint needs the Cash Reporter.
- Vouchers are single-use and expire.
- The Risk Council can reverse a drawdown or a repayment booking and correct the cash book.
- The Pauser can stop each contract.

#### What remains

A compromised voucher key can approve deposits that should have failed screening, and approve withdrawal claims in queue order. A compromised Cash Reporter can mint PLUSD up to the mint limits. A compromised Trustee signer can book wrong drawdowns, wire-outs, ramps and expenses. Expenses booked by the Trustee role have no cap. The Admin restores service by revoking and re-granting roles.

<div class="callout safety">
  <h4>The shape of the risk profile</h4>
  <p>Pipeline is not risk-free. Trade finance carries credit risk. Lenders can lose principal.</p>
</div>
