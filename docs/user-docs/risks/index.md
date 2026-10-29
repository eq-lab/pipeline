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
- Each loan is secured by security instruments held by the Security Agent for the lenders: endorsed bills of lading, warehouse pledges, collateral management agreements, assigned receivables, letter of credit proceeds, cash cover.
- Each loan has an advance ratio (80 % by default). LTV is outstanding principal plus accrued interest, divided by the value of the security. A margin call opens when LTV rises above the margin-call ratio (85 % by default). The borrower must bring LTV back to the advance ratio within the cure period. The security registry runs these checks on-chain.
- The Originator funds an equity tranche on each loan. It is recorded on the loan.
- The Risk Council approves each loan against the [Credit Policy](/risks/credit-policy/).
- Each deal is reviewed by goods, corridor and counterparties, with a liquidation plan.
- First-ranking security only. A local legal opinion confirms it before funding.
- Concentration limits cap exposure to any single deal, borrower, offtaker, originator, commodity or corridor.

#### What remains

The security can be worth less than the debt when it is sold. The equity tranche is recorded on the loan; the smart contracts do not enforce that it absorbs loss first. A loss on a defaulted loan is borne by the holders of sPLUSD at the moment of default. See [Default management](/risks/default-management/).

## Liquidity risk

#### What it is

Withdrawal requests exceed the USDC available for withdrawals. Lenders wait.

#### What mitigates it

- Unstaking sPLUSD to PLUSD is instant.
- Withdrawals run through a first-in, first-out queue. A request is paid once the withdrawal custody account holds enough USDC to cover the queue up to that request.
- Loans are self-liquidating trade loans. Principal returns when the borrower's buyer pays.

#### What remains

USDC lent to borrowers is not available until loans are repaid. A withdrawal waits in the queue until enough USDC is moved to the withdrawal custody account. There is no fixed payout time.

## Custody risk

#### What it is

Loss or misuse of the keys that control the custody accounts holding lender USDC.

#### What mitigates it

- Deposited USDC goes straight to a deposit custody account. The smart contracts do not hold lender USDC.
- Each custody account signs under a multi-party signing policy.
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
- Risk Council actions run with a 24-hour delay, except a default declaration and a repayment reversal. Each delayed action is public while it waits.
- The Guardian can cancel a scheduled action during its delay. The Guardian cannot grant roles, pause, unpause, upgrade or move funds.
- The Risk Council is a multisig of several people. The Admin, Guardian, Pauser and Upgrader are multisigs. The Cash Reporter is a 2-of-2 multisig.

#### What remains

The Admin role runs with no delay. The Admin grants and revokes roles, sets limits, unpauses and changes custody accounts. A captured Admin multisig can do all of this at once.

## Regulatory risk

#### What it is

Regulatory classification, jurisdictional authority or sanctions rules change in a way that affects the protocol.

#### What mitigates it

- Secured lending under a master facility agreement and an agency deed. The Security Agent holds the security on trust for all lenders
- Permissioned access: every lender address is screened before it may hold PLUSD; no anonymous capital
- KYB and KYT for every counterparty: lenders, Originators, borrowers and every other party
- Jurisdictional eligibility list maintained on the [Legal](/references/legal/) page

#### What remains

Regulatory regimes can change. The eligibility list can be revised. A change in rules can restrict who may deposit or hold PLUSD.

## Operational risk

#### What it is

Key compromise, vendor incident, booking error or a missed action by an operator.

#### What mitigates it

- The backend cannot mint PLUSD alone. A deposit mint needs a real USDC deposit. Every other mint needs the Cash Reporter.
- Vouchers are single-use and expire.
- The Risk Council can reverse a disbursement or a repayment booking and correct the cash book.
- The Pauser can stop each contract.

#### What remains

A compromised voucher key can approve deposits that should have failed screening, and approve withdrawal claims in queue order. A compromised Cash Reporter can mint PLUSD up to the mint limits. A compromised Trustee signer can book wrong disbursements, wire-outs, ramps and expenses. Expenses booked by the Trustee have no cap. The Admin restores service by revoking and re-granting roles.

<div class="callout safety">
  <h4>The shape of the risk profile</h4>
  <p>Pipeline is not risk-free. Trade finance carries credit risk. Lenders can lose principal.</p>
</div>
