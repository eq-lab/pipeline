# Trustee Dashboard — Technical Assignment Spec

## Overview

The Trustee dashboard is the action surface the Pipeline Trust Company operates day to day.
This spec states what each layer must provide: the data the dashboard reads, the API
contracts it consumes, the data each flow presents and acts on, and the signing path each
action travels. Framework, component structure, and internal architecture are the
implementer's call.

**In scope.** Every business flow the Trustee participates in (origination, cash movement,
repayment to mint, lifecycle, default management, deposit refunds) plus the monitoring the
Trustee needs to decide and act.

**Out of scope.** LP-facing dashboards. Authentication, 2FA, and operator onboarding.

---

## Four types of Trustee flow

Every Trustee action is one of four types. The type sets the UX affordance, so the dashboard
is organised by type.

| Type | Mechanism | Who else signs | Timelock | UX affordance |
|---|---|---|---|---|
| 1. Direct Trustee-key write | The Trustee sends the transaction himself | Nobody | None | One click to send, after the dashboard shows the transaction in readable form |
| 2. Capital Wallet MPC co-signature | The Trustee is one of 3-of-5 cosigners on the custodian MPC | Team and counterparties, to reach 3-of-5 | Per custodian policy | Build the request, the Trustee co-signs in the MPC, the dashboard tracks who has signed |
| 3. RISK_COUNCIL proposal | The Trustee drafts a proposal for the 3-of-5 RISK_COUNCIL Safe | 3-of-5 Risk Council, GUARDIAN-cancelable | 24h | Draft the proposal and track the 24h timer. The Trustee cannot execute it |
| 4. Decision monitoring | No transaction | n/a | n/a | Display, alerting, and a retrigger control where a downstream service acts |

No dashboard action moves USDC from the Capital Wallet on the Trustee's signature alone.
Every cash movement is Type 2.

---

## Type 1 — Direct Trustee-key writes

Instant, no timelock. The Trustee holds the `TRUSTEE` role on LoanRegistry and
`TRUSTEE_REFUNDER` on DepositManager. The Relayer has no role on LoanRegistry.

| # | Flow | Trigger | Data presented | Trustee input | On-chain call and effect | Pre-broadcast checks |
|---|---|---|---|---|---|---|
| 1 | Origination approval | Originator submits an EIP-712 signed request, Relayer validates the signature and queues it | Full immutable economics, the validated Originator signature, submission timestamp, resolved descriptive material (borrower hash, commodity, corridor, governing law). See flow note B | Approve, Request changes (comment), or Reject (reason) | `mintLoan(originator, economics, metadataURI, initialLocation)`. Mints the loan NFT, seeds `epochs[0]`, emits `LoanMinted`, which triggers Relayer disbursement prep (Flow 7) | `senior + equity == facilitySize`, `offtakerPrice >= facilitySize`, `maturity > origination`. Show the failing invariant before enabling broadcast |
| 2 | Repayment intake | The dashboard flags loans at or past a scheduled coupon or maturity with no matching `recordPayment` yet (repayment-due worklist) and notifies the Trustee. Bank integration is excluded from MVP, so the Trustee reconciles the prompt against the correspondent bank wire manually, then opens intake against the loan | Loan picker of open loans. On loan select: outstanding senior principal, actual tenor, protocol fee schedule, the auto-computed waterfall split, deviations from baseline flagged. See flow note A | Confirm received amount and date. Adjust individual components for waivers, partials, or early-repayment fees | `recordPayment(loanId, offtakerAmount, seniorPrincipal, seniorInterest, mgmtFee, perfFee, oetAlloc, equityAmount)`. The registry entry lands first as pure accounting: increments the seven per-loan counters, emits `PaymentRecorded`, moves no USDC, mints no PLUSD. The Trustee then instructs the USD-to-USDC on-ramp into the Capital Wallet, and the Relayer matches that inflow to mint (Flow 13) | Loan in {Performing, Watchlist}, the six split components sum `<= offtakerAmount`. Deferred interest is allowed (zero components). Recording is not minting |
| 3 | Lifecycle update | Price-feed threshold crossing, manual review, cargo movement, document append, or maturity reached | Current status, `ccrBps` with age, current location, current `metadataURI`, current maturity. Only {Performing, Watchlist, Matured} are selectable | New status, new CCR (bps), new location (type, identifier, optional tracking URL), appended `metadataURI` | `updateMutable(loanId, status, newCCR, newLocation, metadataURI)`. Updates non-economic mutable fields, emits the matching status, location, or metadata event. No NAV or share-price impact | Target status not Default (that is Flow 10) and not Closed (that is Flow 5 or Flow 12) |
| 4 | Rollover | Loan reaches `currentMaturityDate` without full repayment and is re-termed | Current epoch schedule, prior maturity, days past maturity, proposed new rate and maturity, the resulting ceiling delta | New rate (bps), new maturity date | `rollover(loanId, newRateBps, newMaturityDate)`. Appends an epoch from the prior maturity, sets `currentMaturityDate`, returns status to Performing, emits `LoanRolledOver`. Raises the mint ceiling only, mints nothing | `now >= currentMaturityDate`, status not in {Default, Closed} |
| 5 | Benign close | Loan repaid at scheduled maturity or early | Final repayment ledger, realised senior coupon, realised residual, outstanding balances at zero | Confirm closure reason | `closeLoan(loanId, ScheduledMaturity \| EarlyRepayment)`. Sets status Closed and the closure reason, emits `LoanClosed` | Write-down closures (Default, OtherWriteDown) are Flow 12, not selectable here |
| 6 | Deposit refund (KYT soft-fail) | A deposit fails KYT screening and the depositor is owed a refund off the standard claim path | The held deposit (depositor, amount, intake reference), the KYT result, the off-chain transfer record from Trustee plus Team | Confirm the off-chain USDC transfer was made, then mark on-chain | `markRefunded(...)` on DepositManager. Marks the deposit refunded, closing the ticket | The USDC transfer itself is a Type 2 wallet movement. `markRefunded` only records that it happened |

### Flow note A — repayment waterfall

The dashboard computes the waterfall client-side from immutable loan parameters
(`originalSeniorTranche`, `originalFacilitySize`, dates), mutable lifecycle state, the
protocol fee schedule (management, performance, OET rates), and the actual tenor. The
Trustee never does the arithmetic. Computed components, in priority order:

1. `senior_principal_returned = min(amount, outstanding_senior_principal)`
2. `senior_gross_interest = tenor * senior_rate * senior_deployed`
3. `management_fee = senior_deployed * mgmt_rate * (tenor / 365)`
4. `performance_fee = (senior_gross_interest - management_fee) * perf_rate`
5. `senior_coupon_net = senior_gross_interest - management_fee - performance_fee`
6. `oet_allocation = senior_deployed * oet_rate * (tenor / 365)`
7. `originator_residual = amount - senior_principal_returned - senior_coupon_net - fees - oet_allocation`

`recordPayment` takes `seniorInterest` as the net senior coupon and the three fee carve-outs
separately. The originator residual settles off-chain through the Trust Company's USD
account and appears in no on-chain event. Any component the Trustee overrides is revalidated
against the `sum <= offtakerAmount` invariant before broadcast.

### Flow note B — origination review

The approval screen resolves the descriptive material behind `metadataURI` so the Trustee
reviews borrower hash, commodity, corridor, governing law, and attached documents alongside
the on-chain economics. The three mint invariants are evaluated client-side and the result
shown before the broadcast control is enabled. Approval broadcasts `mintLoan` from the
Trustee key. The resulting disbursement is a separate Type 2 action the Trustee co-signs
next.

---

## Type 2 — Capital Wallet MPC co-signature

The Trustee is one of five cosigners on the Capital Wallet (3-of-5, Team and Trustee
mandatory). The dashboard assembles each request and tracks signature collection. The
movement settles only when the MPC policy is met. The dashboard never holds the Trustee's
MPC key.

| # | Flow | Trigger | Data presented | Trustee input | Effect |
|---|---|---|---|---|---|
| 7 | Loan disbursement | `LoanMinted` from Flow 1, Relayer prepares the disbursement | Loan economics, the senior principal to disburse, destination, current Capital Wallet USDC, the resulting backing-invariant projection | Review and co-sign in the MPC | USDC leaves the Capital Wallet to the borrower leg. Moves the loan to deployed |
| 8 | T-Bill allocation swap | USDC/USYC ratio drifts off the target band, or a manual override is needed outside the band rules | Capital Wallet USDC and USYC, ratio versus target band (lower, target, upper), the forward strip (queued withdrawals, approved-not-disbursed loans, expected repayments in window), recent swaps | Choose swap direction and size, or accept the band-keeping suggestion, then co-sign | USDC converts to or from USYC inside the Capital Wallet. Manual overrides require Trustee plus Team co-signature regardless of amount and bypass the band limits |
| 9 | Withdrawal Queue Wallet top-up | Queue depth approaches available USDC in the Withdrawal Queue Wallet | Queue depth, current Withdrawal Queue Wallet USDC, coverage ratio, oldest pending request age | Choose top-up amount, then co-sign | Capital Wallet to Withdrawal Queue Wallet transfer. Keeps user-pulled claims covered. The queue contract settles claims itself via pre-approved allowance |

### Flow note C — T-Bill band-keeping

The dashboard presents the band decision, it does not automate the swap. The forward strip
is the decision input: queued withdrawals and approved-not-disbursed loans are near-term
USDC demand, expected repayments in the window are near-term USDC supply. The Trustee sizes
the swap against the strip and the target band, then co-signs. The USDC/USYC ratio is
managed by the custodian MPC policy engine and the Trustee, never by the Relayer.

---

## Type 3 — RISK_COUNCIL proposals

Default management. The Trustee identifies the condition and composes the proposal. The
3-of-5 RISK_COUNCIL Safe executes it under a 24h timelock, GUARDIAN-cancelable. The
dashboard is a proposal builder and a timelock tracker. It must make unmistakable that the
Trustee cannot execute these.

| # | Flow | Trigger | Data presented | Proposal composed | Guardrail |
|---|---|---|---|---|---|
| 10 | Escalate to Default | A Watchlist loan deteriorates past recovery on the performing path | The loan's full ledger and epoch history, CCR trend, the at-risk impact on portfolio aggregates | `setDefault(loanId)` into the RISK_COUNCIL Safe | Blocks all loan-tied mints once executed. GUARDIAN-cancelable during the 24h window |
| 11 | Off-cycle re-term | A default re-term or penalty rate is needed outside the post-maturity rollover fast-path | Current epoch schedule, proposed new rate and maturity, the ceiling delta the new epoch implies | `amendEconomics(loanId, newRateBps, newMaturityDate)` | Appends an epoch from now, mints nothing. Distinct from Trustee `rollover`, which is post-maturity and instant |
| 12 | Write-down close | A loan closes with a loss | Final ledger, realised loss, the closure reason | `closeLoan(loanId, Default \| OtherWriteDown)` | Benign closures (ScheduledMaturity, EarlyRepayment) are Flow 5 and must not be routed here |

---

## Type 4 — Decision monitoring

Read-only surfaces the Trustee needs to decide and act. The Mint Queue is read-only with a
retrigger control because the Relayer plus custodian execute the mint, not the Trustee.

| # | Surface | Data presented | Source | Decision it supports | Alert threshold |
|---|---|---|---|---|---|
| 13 | Mint Queue | Loans with non-zero unminted Vault or Treasury delta, aging clock per leg, custodian co-signature status, the PLUSD ledger invariant | YieldMinter `vaultMintedByLoan` / `treasuryMintedByLoan` versus LoanRegistry recorded counters, plus the Relayer co-sig feed | Whether a recorded repayment has minted, and whether to retrigger the Relayer | Aging delta beyond an SLA set with the Relayer team |
| 14 | Reserves and invariants | Backing invariant (PLUSD totalSupply versus USDC plus USYC NAV plus deployed plus in-transit), PLUSD ledger invariant, USYC NAV versus band | Relayer-published reconciliation, the PLUSD ledger-invariant view, Hashnote NAV | Whether reserves reconcile before any cash movement | Green < 0.01%, Amber 0.01–1%, Red > 1% drift |
| 15 | T-Bill band and forward strip | USDC/USYC ratio versus band, the forward strip, recent swaps | Capital Wallet balances on-chain, Relayer-projected strip | Whether and how much to swap (feeds Flow 8) | Ratio outside the lower or upper band |
| 16 | Portfolio aggregates | Deployed senior principal, at-risk (Watchlist plus Default), weighted tenor and rate, commodity / corridor / originator concentration, cumulative minted per leg | Sums and weighted aggregates over LoanRegistry views plus YieldMinter mint totals | Concentration and at-risk posture for origination and escalation | Concentration limits set with risk |
| 17 | Audit log | Append-only stream of every Trustee action across all types | The protocol audit log | After-the-fact review and reconciliation | n/a |

---

## Data layer responsibilities

The dashboard pulls data from three places. Every number on screen must show where it came
from, so a value read from the chain is never confused with one from the Relayer. When a
Relayer value is old, say so.

| Source | What the dashboard reads | Notes |
|---|---|---|
| LoanRegistry (on-chain) | For each loan: its fixed terms, its current state, its rate and maturity history, and the events it emits | The source of truth for loan terms, status, and what has been repaid. It does not move the token price. sPLUSD price only changes when yield is actually minted, not when the Trustee records a payment |
| YieldMinter and PLUSD (on-chain) | How much has already been minted per loan (vault and treasury legs), total PLUSD in circulation, and the backing check | Used to work out how much is still waiting to be minted, and to show reserves |
| Relayer backend | Incoming USDC the Relayer has not yet matched to a loan, whether the custodian has co-signed, the USYC price, the size and coverage of the withdrawal queue, the cash forecast, the queue of new loan requests, and the reserves health light | Off-chain inputs that help the Trustee decide. None of them can trigger a mint. They only inform |

Some numbers on screen are not stored on-chain, so the dashboard calculates them: senior
principal still owed (original senior tranche minus principal repaid), how much the offtaker
still owes (original price minus what has come in), interest earned so far (the
maturity-capped epoch sum), how much is still waiting to be minted per leg (recorded minus
already minted), and days left to maturity.

---

## API

| Endpoint | What it returns or takes | Serves |
|---|---|---|
| New loan requests | Loan requests waiting for the Trustee: the loan terms, the Originator's signature, a link to the documents, the status, and timestamps | Flow 1 |
| Incoming USDC matching | The USDC that arrives after a payment is recorded, matched by the Relayer to that recorded payment. Anything it cannot match is flagged as odd | Flow 13 |
| One loan's full view | Everything about a single loan: the terms we store on-chain, the numbers we calculate from them, and the loan documents | Flows 1-5, 10-12, monitoring |
| Payments due | Loans whose payment is due or overdue and not yet recorded, used to prompt the Trustee | Flow 2 |
| Mint queue | Per loan: how much is still waiting to be minted to the vault and treasury, how long it has waited, whether the custodian has signed, and the Relayer's last attempt | Flow 13 |
| Retry a mint | Asks the Relayer to try a stuck mint again, and reports where it got to | Flow 13 |
| Build a co-signed request | Takes a disbursement, swap, or top-up request, builds the MPC payload, and tracks how many of the 3-of-5 have signed | Flows 7, 8, 9 |
| Build a Risk Council proposal | Takes a `setDefault`, `amendEconomics`, or write-down close proposal, sends it to the Safe, and reports the Safe reference and where the 24h timer stands | Flows 10, 11, 12 |
| Reserves | The backing check and how far off it is, the USYC price and band, and the cash forecast | Surface 14, Flow 8 |
| Withdrawal queue | How big the queue is, how much USDC the Withdrawal Queue Wallet holds, the coverage ratio, and the oldest waiting request | Flow 9 |
| Audit log | The running list of everything the Trustee has done | Surface 17 |

The Type 1 actions are sent straight from the Trustee key. For `mintLoan`, `updateMutable`,
`recordPayment`, `rollover`, `closeLoan`, and `markRefunded`, the dashboard builds the
transaction, shows it in readable form for review, and sends it once confirmed. These do not
go through the Relayer.

---

## Security considerations

- No dashboard action moves USDC from the Capital Wallet on the Trustee's signature alone.
  Every cash movement is Type 2 MPC co-signature.
- A compromised Trustee key is bounded. It can record payments, roll over, and update
  lifecycle, but it cannot mint PLUSD. Minting needs the independent two-party attestation
  (Relayer ECDSA plus custodian EIP-1271) and is capped by the maturity-capped ceiling the
  YieldMinter computes itself. `recordPayment` and `rollover` only raise the ceiling.
- Default, off-cycle re-term, and write-down close are removed from the Trustee key. They
  are RISK_COUNCIL proposals under a 24h timelock, GUARDIAN-cancelable. The dashboard must
  not offer a Trustee-key path to any of them.
