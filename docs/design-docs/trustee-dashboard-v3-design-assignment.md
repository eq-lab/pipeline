# Trustee Dashboard. Design Assignment v3

## 1\. What you deliver

1. One Figma file, one page per flow (section 7), screens laid left to right in flow order.

2. Every screen from section 4 has a named frame using the IDs in this document.

3. Every button wired: a connector arrow or prototype link from the button to its destination frame. A button with no arrow does not ship.

4. The loan detail screen in all six status variants, matching the action matrix in section 5\.

5. The components of section 6 as a library page. Screens place library instances, never redrawn copies.

6. A clickable prototype of the Helios Metals happy path in presentation mode: S2, S3, M1, S5, S6, M1, S5, S7, M1, S8, S5, S11, M1, S5 Closed.

7. Any screen not in this document is flagged as a proposal, not silently added.

## 2\. Sections

The sidebar is present on every screen.

| Menu item | Opens | What lives there |
| :---- | :---- | :---- |
| Overview | S1 | Allocation buckets, active deal journeys, Needs Attention worklist, reserves health |
| Origination | S2 | Queue of loan requests awaiting Trustee decision |
| Loans | S4 | The loan register and the per-loan hub. All loan actions start here |
| Cash Management | S12, default tab, with in-page tabs to S13 and S14 | On/Off-ramp (movements, mint queue, refund tickets), T-Bills, Withdrawal Queue |
| Risk Council | S15 | Proposals the Trustee drafts but cannot execute, with their timelock tracker |
| Audit Log | S17 | Append-only record of every Trustee action |

## 3\. Statuses

Five status families. 

| Family | Question it answers | Lives on |
| :---- | :---- | :---- |
| Origination status | Where is this loan application | Origination rows |
| Loan status chip | Where is this loan in its life | Loan rows and loan detail |
| Movement status | Where is this cash right now | Movement rows |
| Proposal status | Where is this council action | Risk Council rows |
| Badges | What needs doing | Computed, never stored |

Terms changes (rollover, council re-term) are none of these. They append a row to the epoch table. Repayments are events too: a loan with four coupons stays Performing through all four.

### 3.1 Origination statuses (before a loan exists)

| Status | Meaning | Trustee actions | Exit |
| :---- | :---- | :---- | :---- |
| In Review | Submitted and validated, awaiting Trustee | Approve and mint, Request changes, Reject | Approved, Changes Requested, Rejected |
| Changes Requested | Returned with comment | none, waiting on Originator | terminal for this request. Resubmission arrives as a new In Review request, linked to this one |
| Rejected | Closed with reason | none | terminal |
| Approved | mintLoan confirmed. Archives with loanId and tx hash | none | terminal. The loan appears in Loans as Disbursing |

While the mint transaction is in flight, In Review shows a spinner. There is no separate status.

### 3.2 Loan status chip 

Every loan row in the Loans list, and the loan detail header shows one of these chips identifying where the loan is in its lifecycle. 

| Chip | On-chain status | Raw value | Divergence rule |
| :---- | :---- | :---- | :---- |
| Disbursing | Performing | 0 | outbound movement not yet at Wired |
| Performing | Performing | 0 | outbound movement complete |
| Watchlist | Watchlist | 1 | none |
| Past Due | Matured | 2 | display rename only |
| Default | Default | 3 | none |
| Closed | Closed | 4 | none |

Disbursing and Past Due have a tooltip with the on-chain status. Loan detail always prints the raw on-chain status next to the explorer link. 

| Chip | Meaning | Entry | Trustee's job  | Exits |
| :---- | :---- | :---- | :---- | :---- |
| Disbursing | Minted, senior principal not yet with borrower | mintLoan confirms | Drive the outbound movement: co-sign MPC, confirm conversion legs, wire to borrower, mark sent | Performing (wire marked sent). Closed (council write-down, deal cancelled before funding). Default (council) |
| Performing | Deployed and current | Disbursement completes, rollover lands, Watchlist restored, or Past Due restored (two-step restore and record) | Log and record repayments as wires land, keep CCR and location fresh, watch the mint queue | Watchlist. Past Due. Performing with new term (rollover, past maturity). Closed benign (checklist green). Closed write-down (council). Default (council) |
| Watchlist | Elevated risk, fully operable. Mints still allowed | Trustee flags deterioration | Same as Performing plus tighter monitoring and escalation prep | Performing (restored). Past Due. Performing with new term (rollover). Closed benign or write-down. Default (council) |
| Past Due | Declared overdue, unpaid. Recording and mints are locked | Trustee flags after maturity with payment unsettled | Pick the exit: record the late payment, roll over, escalate, or close | Performing (late payment: two-step restore and record, or rollover). Closed benign (checklist green) or write-down (council). Default (council) |
| Default | Council declared. All loan mints blocked, ledger frozen | setDefault executes after its 24h timelock | Compose the write-down close or a penalty re-term, track recovery off dashboard. Recording is never offered here | Closed (council write-down). Council re-term appends an epoch without changing status |
| Closed | Terminal. Reason: Repaid at maturity, Repaid early, Default, Write-down | closeLoan | none | none |

A write-down close of a loan that never disbursed displays as Cancelled before funding under the Write-down reason.

Transitions, callers, how fast:

| Transition | Who | Speed |
| :---- | :---- | :---- |
| Disbursing to Performing | Trustee marks wire sent | instant, off-chain confirm |
| Performing to or from Watchlist | Trustee | instant |
| Performing or Watchlist to Past Due | Trustee, gated (see S10) | instant |
| Past Due to Performing | Trustee, by rollover, or by a lifecycle restore to Performing then recording the late payment (two transactions, two M1 steps) | instant |
| Rollover (past maturity, from Performing, Watchlist or Past Due) | Trustee | instant |
| Disbursing, Performing, Watchlist or Past Due to Default | Risk Council | 24h timelock, GUARDIAN can cancel |
| Performing, Watchlist or Past Due to Closed benign | Trustee | instant, checklist green |
| Any state except Closed to Closed write-down | Risk Council | 24h timelock |

Benign close checklist, all three green before the Close button enables:

1. Senior principal outstanding is zero.

2. Nothing left to mint on either leg. Hard gate, no manual override.

3. Remaining offtaker balance acknowledged. Auto-green when received covers the contracted price **and the final settlement did not exceed it** — i.e. the waterfall reports `offtaker_fully_received` **and not** `offtaker_overpaid` (issue #963). On early payoff or waiver, **or when a quotational-period settlement came in above the genesis price** (`offtaker_overpaid` is set, legitimate for a concentrate deal), the Trustee ticks it manually rather than auto-greening — so a QP overage is a deliberate acknowledgement, not silently green.

![Loan status diagram][image1]

### 3.3 Movement statuses (one row per cash movement)

Every movement row carries: purpose tag (Disbursement, Repayment, Refund, Top-up, Swap), loanId where one exists, state, progress bar, amount, provider fee, time in state, and a waiting-on cell naming who moves it next.

**Outbound (Loan Disbursement):** 

1. Pending.   
2. Wallet to provider (chain).   
3. At provider, converting (provider feed).   
4. In Trust account (Trustee confirm).   
5. Wired to borrower (Trustee confirm).

**Inbound (Loan Repayment):** 

1. Received in Trust account (Trustee logs it).   
2. Recorded on ledger (chain).   
3. Trust to provider, converting (provider feed).   
4. In Capital Wallet (chain).   
5. Minted (chain)

### 3.4 Proposal statuses (Risk Council)

Draft. Signatures (k of 3). Timelock (ends at T, GUARDIAN can cancel). Executable. Executed. Cancelled.

Cancelled rows stay visible for re-proposal. The loan's Timelock badge derives from any proposal in Signatures through Executable.

### 3.5 Refund tickets (not loan-scoped)

Owed (KYT soft-fail) to Transfer pending (the internal movement above) to Refunded (markRefunded confirmed). Tickets live in the On/Off-ramp tab and feed the Needs Attention worklist.

### 3.6 Badges

Payment due. Payment overdue Nd. Wire received. Maturity in Nd. Mint pending Nh. Mint blocked. CCR stale. CCR breach. Timelock pending. Cash in transit (n). Needs my co-sign. Ready to close.

Rules: a badge never changes a chip. Wire received fires while an inbound movement sits at step 1\. Mint blocked fires on Past Due, Default or Closed with an unminted amount. Cash in transit is suppressed while the chip is Disbursing. Ready to close means the benign close checklist is green. Badges render on S4 rows, the S5 header and worklist rows. Non-loan badges render on their rows in S12, S13, S14. Overflow past three: a \+N chip opening a popover.

## 4\. Screens and navigation

| ID | Name | Section |
| :---- | :---- | :---- |
| S1 | Overview | Overview |
| S2 | Origination queue | Origination |
| S3 | Request detail | Origination |
| S4 | Loans list | Loans |
| S5 | Loan detail, six variants | Loans |
| S6 | Disbursement | Loans, per loan |
| S7 | Record repayment | Loans, per loan |
| S8 | Inbound and mint | Loans, per repayment |
| S9 | Roll over | Loans, per loan |
| S10 | Lifecycle update | Loans, per loan |
| S11 | Close loan | Loans, per loan |
| S12 | On/Off-ramp tab | Cash Management |
| S13 | T-Bills tab | Cash Management |
| S14 | Withdrawal Queue tab | Cash Management |
| S15 | Council proposals | Risk Council |
| S16 | Proposal builder | Risk Council |
| S17 | Audit log | Audit Log |
| S18 | Refund ticket | Cash Management, from S12 or S1 |
| M1 | Broadcast confirm | every Trustee-key write |
| M2 | Request changes | on S3 |
| M3 | Reject request | on S3 |

Every Trustee-key write (mint, record, update, roll over, close, mark refunded) opens M1, the T1 pattern. On success M1 closes and lands on the destination named in the button row, refreshed, with a toast linking the transaction. Cancel or dismiss returns to the origin screen unchanged. The same cancel rule applies to M2 and M3. Two M1 variants:

* Chained: the Past Due record flow runs two writes (lifecycle restore, then the payment record), each step with its own preview and Send. Abandoning after step one lands on S5 with the guidance line naming the completed restore and the missing record.

* Off-chain confirm (Mark wire sent): the tx preview is replaced by the wire summary (amount, beneficiary, value date) and one acknowledgment line. Button label Confirm sent. Writes to the audit log, no transaction.

Back affordances, wired in the prototype: S6 to S11 return to S5, S16 to its opener (S5 or S15), S18 to S12.

### S1 Overview

Shows: five allocation buckets (Capital Wallet, Cash in transit, Trust account, Deployed, T-Bills), active deal journeys, Needs Attention worklist, at-risk tile, reserves health panel, queue coverage tile.

| Element | Leads to |
| :---- | :---- |
| Any bucket tile | S12 |
| Deal journey node | per the stepper node map in section 6 |
| Needs Attention row | per the worklist table below |
| At-risk tile | S4 filtered to Watchlist and Default |
| Queue coverage tile | S14 |
| Reserves panel | expands in place |

Worklist events, one row per loan per event type:

| Event | Leads to |
| :---- | :---- |
| Request awaiting review | S3 |
| Payment due, Payment overdue | S5 |
| Wire received, unrecorded | S7 |
| Disbursement waiting (co-sign or wire leg) | S6 |
| Mint pending past SLA | S8 |
| Mint blocked | S5, Ledger tab |
| CCR stale, CCR breach | S5 |
| Timelock pending | S15 |
| Needs my co-sign: disbursement | S6 |
| Needs my co-sign: swap | S13 |
| Needs my co-sign: top-up | S14 |
| Refund owed | S18 |
| Queue coverage low | S14 |
| Ready to close | S11 |

### S2 Origination queue

Shows: request rows (originator, facility, commodity, corridor, submitted date, status), tabs In Review, Changes Requested, Rejected, Approved.

| Element | Leads to |
| :---- | :---- |
| Request row | S3 |
| Approved row's loan link | S5 |

### S3 Request detail

Shows: loan terms card, deal details card with documents, the three mint invariants as checks (senior plus equity equals facility, offtaker price covers facility, maturity after origination), Originator signature status, prior submissions of this deal.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Approve and mint | tx preview, invariants must be green | M1, then S5 Disbursing |
| Request changes | comment form, returns to Originator | M2, then S2 |
| Reject | reason form, terminal | M3, then S2 |

### S4 Loans list

Shows: one row per loan (borrower label, chip, badges, senior outstanding, next due, maturity, CCR). Status tabs: All, Disbursing, Performing, Watchlist, Past Due, Default, Closed, plus an At risk tab (Watchlist and Default). No Create button. Loans enter only through Origination.

| Element | Leads to |
| :---- | :---- |
| Loan row | S5 in the matching variant |

### S5 Loan detail, the hub

Shows: header (borrower label, chip, badges, on-chain status with explorer link), deal journey stepper, key numbers (facility vs disbursed, senior outstanding, recorded vs minted per leg, next due, maturity, CCR with age), the action card (primary action and guidance line per section 5), tabs: Ledger (payment rows and the seven counters: offtaker received total, senior principal repaid, senior interest recorded, management fee recorded, performance fee recorded, OET allocation recorded, equity distributed), Terms (genesis economics, epoch table with source column: Genesis, Rollover, Council amend, plus pending proposals greyed with countdown), Movements (this loan's rows), Documents, Location, Activity.

| Button | Visible when | Leads to |
| :---- | :---- | :---- |
| Track disbursement | Disbursing | S6 |
| Log inbound wire | Performing, Watchlist, Past Due | creates the inbound movement at step 1, stays on S5 |
| Record repayment | Performing, Watchlist, Past Due | S7 |
| Roll over | past maturity, from Performing, Watchlist or Past Due | S9 |
| Update lifecycle | Disbursing, Performing, Watchlist, Past Due | S10 |
| Close loan | Performing, Watchlist, Past Due, checklist green | S11 |
| Escalate to council | any state except Closed | S16, loan preselected |
| Movement row in Movements tab | always | S6 for Disbursement rows, S8 for Repayment rows |
| Stepper node | always | per the stepper node map in section 6 |

### S6 Disbursement

Shows: outbound movement bar, loan economics summary, backing projection, MPC signature tracker (five signers, 3-of-5 policy, Team and Trustee mandatory, who has signed), off-ramp fee breakdown, wire panel with borrower banking reference, cancelled state if the MPC request was revoked.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Co-sign in MPC | hands off to the custodian app, tracker polls | stays on S6 |
| Mark wire sent | confirms the fiat wire left the Trust account | M1 off-chain confirm, then S5 Performing |

### S7 Record repayment

Shows: loan summary, amount received and value date inputs (pre-filled from the logged inbound wire where one exists), the auto-computed waterfall (senior principal, net senior coupon, management fee, performance fee, OET, originator residual greyed as off-chain), deviation warnings, per-component override with the sum check, overpay excess shown on the residual line. On a Past Due loan the screen states the flow first restores the loan to Performing, a separate transaction, then records.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Confirm split | single M1, or the chained M1 on Past Due | M1, then S8 for this repayment |

### S8 Inbound and mint

Shows: inbound movement bar, senior portion vs residual split, on-ramp instruction panel, mint monitor per leg (vault, treasury): amount, aging clock, Relayer signature, custodian co-signature, last attempt time. For a nothing-to-mint repayment the monitor is replaced by a Settled tick. While the loan's on-chain status refuses mints the monitor shows Blocked with the status name and Retry is disabled.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Instruct on-ramp | starts USD to USDC for the senior portion | stays on S8, bar advances |
| Retry mint | asks the Relayer to retry | stays on S8 |
| Done |  | S5 |

### S9 Roll over

Shows: epoch table, days past maturity, new rate and maturity inputs, resulting ceiling delta, a line that rolling mints nothing.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Confirm roll over | tx preview | M1, then S5 Performing with the new epoch visible |

### S10 Lifecycle update

Shows: status selector, CCR input with last reported age, location update (type, identifier, tracking URL), document append. On a Disbursing loan the selector is disabled. Elsewhere it offers only the legal targets: from Performing, Watchlist or Past Due. From Watchlist, Performing or Past Due. From Past Due, Performing only, provisional per the open contract question in 3.2. Choosing Past Due opens the confirm gate: it warns that recording and mints lock, lists this loan's inbound movements, and states the criterion: flip only when no repayment wire has been received, if funds have arrived record the payment instead. Default and Closed are never selectable. Escalation goes through S16.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Confirm update | tx preview | M1, then S5 |

### S11 Close loan

Shows: the three-line benign close checklist from 3.2, final ledger summary, realised coupon, reason picker limited to Repaid at maturity or Repaid early. Write-down closes live in S16 only.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Close loan | enabled when the checklist is green | M1, then S5 Closed |

### S12 On/Off-ramp tab

Shows: the five buckets with a reconcile line to PLUSD backing, movement rows of all five purposes (completed muted), grouped Outbound, Inbound and Internal, a Log inbound wire button, Mint queue (rows with an unminted delta: per-leg amounts, aging, Relayer and custodian status, retry, Blocked with Retry disabled where the loan status refuses mints), Refund tickets (Owed, Transfer pending, Refunded).

| Element | Leads to |
| :---- | :---- |
| Outbound row | S6 for that loan |
| Inbound row | S8 for that repayment |
| Internal row | S13 for Swap, S14 for Top-up, S18 for Refund |
| Log inbound wire | creates the inbound movement at step 1, stays on S12 |
| Mint queue row | S8, or S5 Ledger tab for Blocked rows |
| Refund ticket row | S18 |

### S13 T-Bills tab

Shows: USDC and USYC balances, ratio vs band (lower, target, upper), forward strip (queued withdrawals, approved undisbursed loans, expected repayments), recent swaps, swap builder with band suggestion, internal movement rows for pending swaps.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Build swap | creates the MPC request, tracker appears | stays on S13 |
| Co-sign in MPC | hands off to the custodian app | stays on S13 |

### S14 Withdrawal Queue tab

Shows: queue depth, Withdrawal Queue Wallet balance, coverage ratio, oldest pending request age, top-up builder, internal movement rows for pending top-ups.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Build top-up | creates the MPC request | stays on S14 |
| Co-sign in MPC | hands off to the custodian app | stays on S14 |

### S15 Council proposals

Shows: one row per proposal (kind, loan, Safe reference, status from 3.4 with countdown where live, composed and resolved timestamps). Draft, Cancelled and Executed rows stay listed. No execute button appears anywhere on this screen.

| Element | Leads to |
| :---- | :---- |
| New proposal | S16 |
| Proposal row | S16, read-only view |

### S16 Proposal builder

Shows: kind picker (Escalate to default, Off-cycle re-term, Write-down close), loan picker or preselected, context panel per kind (full ledger and CCR trend for default, epoch table and ceiling delta for re-term, final ledger and realised loss including any frozen unminted amount for write-down), the composed call in readable form. Entry from a Disbursing loan preselects Write-down close with the Cancelled before funding display. Entry from a Default loan limits the picker to Write-down close and Off-cycle re-term. Other entries leave the picker free.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Save draft | stores the proposal as Draft | S15 |
| Send to council Safe | submits, proposal enters Signatures | S15 |

### S17 Audit log

Shows: append-only stream, one row per Trustee action, filters by loan, type, date.

| Row type | Leads to |
| :---- | :---- |
| mintLoan | S5 |
| recordPayment | S8 |
| updateMutable, rollover, closeLoan | S5 |
| markRefunded | S18 |
| Mark wire sent | S6 |
| Log inbound wire | S5 |
| Request changes, Reject | S3 |
| MPC movement | S6, S13, S14 or S18 by purpose |
| Proposal composed or sent | S15 |

### S18 Refund ticket

Shows: held deposit (depositor, amount, intake reference), KYT result, ticket status, the internal movement tracker for the transfer, confirmation input.

| Button | What happens | Leads to |
| :---- | :---- | :---- |
| Build refund transfer | creates the MPC request | stays on S18 |
| Mark refunded | tx preview, enabled once the transfer settled | M1, then S12 |

## 5\. Loan detail action matrix

Cells say when the button shows on S5.

| Action | Disbursing | Performing | Watchlist | Past Due | Default | Closed |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| Track disbursement | yes | hidden | hidden | hidden | hidden | hidden |
| Log inbound wire | hidden | yes | yes | yes | hidden | hidden |
| Record repayment | hidden | yes | yes | yes, two-step restore and record | hidden | hidden |
| Roll over | hidden | past maturity | past maturity | yes | hidden | hidden |
| Update lifecycle | yes | yes | yes | yes | hidden | hidden |
| Close loan | hidden | checklist green | checklist green | checklist green | hidden | hidden |
| Escalate to council | yes, cancel deal | yes | yes | yes | write-down or re-term | hidden |

Primary action and guidance line per state:

| State | Primary | Guidance line |
| :---- | :---- | :---- |
| Disbursing | Track disbursement | Co-sign, track the conversion, wire and mark sent |
| Performing | Record repayment when due, otherwise none | Record when due, keep CCR and location fresh |
| Watchlist | Record repayment when due, otherwise Update lifecycle | Tighten monitoring, escalate if it worsens |
| Past Due | Roll over | Record the late payment, roll over, or escalate |
| Default | Escalate to council | Compose the write-down close or a re-term |
| Closed | none | Read only |

## 6\. Components

| Component | Spec |
| :---- | :---- |
| Status chips | 4 request, 6 loan. Closed ships four reason sub-variants plus the Cancelled before funding label on Write-down. On-chain tooltip per 3.2 |
| Badges | the twelve of 3.6, with the render and suppression rules |
| Movement bar | 5-segment rail variant, 3-segment internal variant, dashed Trustee-confirmed segments, Settled and Cancelled end states |
| Waiting-on cell | names the next mover: Trustee, co-signers k of 5, provider, Relayer, custodian, council, Originator |
| Deal journey stepper | six nodes with links: Origination S3, Off-ramp S6, Distribution S6, Repayment S7, On-ramp S8, Mint S8. Done, current, upcoming states. Repayment, On-ramp and Mint track the current coupon cycle and reset when the next period opens. Completed cycles show as a count on the Mint node |
| T1 pattern | readable tx preview, pre-checks as green or red lines, one Send button, cancel returns to origin (M1) |
| T2 pattern | request summary, 3-of-5 tracker with mandatory signers marked, co-sign handoff, revoke state |
| T3 pattern | proposal summary, Safe reference, the 3.4 status strip with countdown, no execute button, cancelled and executed end states |
| T4 pattern | monitor card: value, source tag, alert state, optional retry with disabled state |
| Source tag | every number carries one: chain or Relayer, with age when stale. The two must differ at a glance |

CCR is the collateral coverage ratio. OET keeps its label, it is one of the three fee carve-outs.

## 7\. Figma file organization

| Page | Contents |
| :---- | :---- |
| 0 Cover | the status diagram, chip and badge legend, the chip-to-chain mapping table |
| 1 Flow map | every screen as a thumbnail, connector arrows for every navigation in section 4 |
| 2 Origination | S2, S3, M1, M2, M3, end state S5 Disbursing |
| 3 Funding | S5 Disbursing, S6, M1, end state S5 Performing |
| 4 Repayment and mint | S5 Performing, S7, M1, S8, back to S5 Performing |
| 5 Maturity and rollover | S5 Past Due, S9, M1, S5 Performing. Late payment branch through S7 with the chained M1 |
| 6 Watchlist and council | S5 Watchlist, S10, M1, S16, S15, S5 Default, write-down branch back through S16 |
| 7 Close | S11, M1, S5 Closed (Repaid at maturity) |
| 8 Cash and treasury | S12, S13, S14, S18, M1 |
| 9 Overview and monitors | S1, S4, S17 |
| 10 Library | every component of section 6 with variants |

Frame naming: S5 Loan detail / Past Due, M1 Broadcast confirm / recordPayment, M1 Broadcast confirm / restore \+ recordPayment.

## 8\. Prototype data: Helios Metals

Lithium carbonate, Chile to Korea. Placeholder fee rates for the prototype: management 1.0% per year, performance 10% of gross interest after management fee, OET 0.5% per year.

| Field | Value |
| :---- | :---- |
| Facility | 6,000,000 USDC |
| Senior tranche | 4,800,000 USDC |
| Equity tranche | 1,200,000 USDC |
| Offtaker price | 6,600,000 USDC |
| Senior rate | 12.00% (1200 bps) |
| Origination | 2026-07-15 |
| Maturity | 2027-01-15 (184 days, one bullet repayment) |

Bullet repayment waterfall at maturity, offtaker pays 6,600,000:

| Component | Amount |
| :---- | :---- |
| Senior principal | 4,800,000 |
| Gross senior interest (12%, 184/365) | 290,367 |
| Management fee | 24,197 |
| Performance fee | 26,617 |
| Net senior coupon (to vault) | 239,553 |
| OET allocation | 12,099 |
| Originator residual (off-chain, greyed) | 1,497,534 |

Sum of on-chain components plus residual equals 6,600,000. Mint queue after recording: vault leg 239,553, treasury leg 62,913.

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAjAAAALRCAIAAADKiw4fAACAAElEQVR4Xuy9iXsU15X3//4nTJL3nflNEk8mmUkyMxnHdmJsvBvHjm0W24DYV7Pv+ypA7PsOAoQAiVWAEEIgsUhICO0SaN93tEsgd/w73QeuizpSq1WqblV3f+v5PPWcOvfW7epq6X76VlVX/Z+O1qcAAABAv/N/ZAoAAADwPBASAAAASwAhAQAAsAQQEgAAAEsAIQEAALAEEBIAAABLACEBAACwBBASAAAASwAhAQAAsAQQEgAAAEsAIQEAALAEEBIAAABLACEBAACwBKYJqbAgd8Av35Z5AAAAwBW8VUj0Wk5eznkpAAAACwIhAeAqh4NDZNI/Sdu3TSYB6CNuFxK7gZkyczllRo6bq03KarIdbdGRY6dysrO0NbWl4ecjdO1oW1Oxtk5CfIIu86vff0SZcVMW6ZoCfs7r73xJfPD5KFlE1NVWKGRpr2htqpVJS5G0cfW5QW8QrfWVsrTj5d5oa67jWFvU3Fijq3wjOqa5QZ90TtPT6qanPa9SWlwgk84/oMb6apkkntZ1/U6vXouqrizhuL2lnub8rrU01FfRi6qWtX8kqrLaLVRZF7gJ2ocy2b+4V0j/9KuBKllTVcYxOaO4MJ+TWkNwkJmZIduhzJKVm3UZrva0rooa5L8DldQqRNsax61NdRRs3n5Q12Bbs70RjqlBmv/s1wPj4u5qqwF/hoWk6LK/OB12gQPVSTF11WX1r/ZoqgPqstNkKsvtjdBfY6uj2xoycnqHowsrLszjClTUXUfpVpSQmMtf2L/DaeFNJVYF7lDJ2uoymkdcva6tuXPvUQ72HjxO87zcx9pShrpOljS93/z8J5w8EhyqrcOvyHPabxwETJxfWPCiPrejXUW7qL4EBG3bR/PMjHRVlJlpj6fPXaVdlwmYMI8Dfjl+gznZmZwcO3XRiPFzKFiz/sVOYP3E3I6l+b179+lPKD/vxeZRC08eZ1OwcNlGbm3xyiAu6rBv6ou/lpqqUpWsqnjlbywl5REH2r8o9faTkx9qK3e83OGWwr1Coswv//ND7WJVZWlWZjoLo0tt1FaXd9mOoq6mXGW49N//9JmuwS5b1sba+uQnXYaIv5+wadsBbUa7PcBn0DnGADotsZC0neO2XYe4iL82EWHnL1FS6xjqN7WN3Ll7b+L0JdRFsniibtyk/y9VWXUxvHjx0lXtun1BCUa32GVGknl8v2qKtq2kKJ86QepAX3avm7iIhDRtzkr56sSUWfaDKOOnLVKZzdsPhJ+/TMG6jTtpB8YnPOhw7NI9B4J1QmL4tUhy2o+AdiaXsoEoSS9BrW3ecYC+N3AdKtq9P/hs+CUSEu/2tJQUmm/Yspfm346ZTUKaOW+17uX4G4Ma8eiENGnG0m/GzOpwCIn2BkmO3zgLiQgM2s1Coo1RW0JC4lIlJPoGT+7ZvvswL85asIb2KguShdeheacbHRusfftbdxw8eNR+tPm7cXPIiMnJyTk5WRT4nZBohKGStE85Vg7gWBdIISUmJm11/EvzqEU1wgEfWFON6Eq1LV+Pusnx1Ws3uEHil//5kVqFMwqqo93O+tp++B4KLIVzFTFSSGs22L8d01+v6mi4syYo3nvguIoVLCRtZtKMZdQCN3jI0bkQW3YcoHl5aaG2pmdwfYR0JvySipeuth/nIDPNWbRO1WTXEivWbuOaJGBVqoRESWpK5aWQHjxI5GEENaJg06sN0Aqpw360xt4yl/KnQJCQlji2k6ipLFXtk5PGT1usFplTp89xwI3wuOru3Xs0P3jkJH3zII4Gn1YjpCdPcjpeComUQOpiIdHq/DWl46WQaAuVkJav2cpBh+Nvgwad9KGzkNRbGzl+LgckdVIp5zds3sMNqmpHgk/z26Txuu8LSUtmZkbHSzd88LcxAxxHwDjzvwOHxt6+oz2gpwIpJC79n7e/XrdxF7emmv36u+n0SVMwdOTMtz8coSv9fPgUFf/zb99TpXzw8L3Bo/fsP65bhf58dZm5iwM3bNrDGeDnKBU5ubpBJ6Qb0TEz5tk7jgsXrxIUhISG05cz+uK8LmgX14m8foNHOTdjbnMjOiHNmr9m9/5jXLm0uID6Zeq7aaygFZK2s/YASkhSRYzqAalP5Jje8tVrUR2OEdKxE2fUeHF4wMzjJ89yndCzF2gncLxs9RYaCmiF1OHobclDNFyQQqK1Vq7bTqhmO14OPdXGEI8eJQ/pSkjU4NBRM6ibJiHZh2LxCWMmLaD8sICZVyOjaJtZABnpaVRNtUbtXIu8MWH6ku/GzeamIq5cV58+16FACYmh90Xbye2wkMgTXESq1n5xUavQ3uBFGt9Mnb3i0uVrOiHRHwz9SdAibXZaamrAhHkkPCUk6p8TEh7wK86cv5rN6o9CUhZRfXr8/QRe5GsT6BtiR09CGjF2Dq9CAxrOsFS45q//8DEF9LVryIgZnHmck/Xz197huLK8WNVULX/85XhOal+Lx3PajKozY94alQR+y+vdX9FgCrWOw9FeAQtJ5v2B9LRUmQSmYJqQAAAAgL4AIQEAALAEEBIAAABLACEBAACwBBASAK4Sdz9RJv2TzRH2X48CYC4QEgCuErjtBNHcqL8xjB+y5Oym3yz6ZO+NYFkEgGEgJABchYXEyFItQ0ZOr60uO37yrC7Pv4vUMWfhWplULFm1SSb7HRYS06WWtL+hkTgvVahbHrjCynXbZ823/77n4JGTslTRqxu48d00uoN/59vx8u1or9p38Q0CHRAS8GsuR764iYsrgVZIzJEQ+y8rmaKCvEPHTs1bsp5vqRB5PTr4xE9C2n/4xKgJ80hIGzbvGTl+7v34+LFTF0XduDl97moW0vdzV54OuxhzK47rUwtUSsmJ05eEX7hMi5evRE6asZSK5i0OVL+dNJfFZza5yMebxykhMb9f+rm2Kdrgi5euzl64NjMjPeLqdb7n28x5q7fvPpyZmc799ZhJCxYut78RWjyruaFDWmrqkeDQoaNmsJDGTV18LfLGqnXbFyzbQPuHq9F+W/3qr02J6Ju3OFixdtvyNVu5Js33HTrOv7fNy3vMP6c9deY8l5LD6KX5d8cKKuIPZcqs5VRz6w77fS+PBp/mH9sOcdxV4eSpcBIS32JDCWn0xPnnLkZw5nFOFrc2ZvJCvsEPbdL4aYtOnT5HHyV9rM0NNdQC37SC/hjohejvR7sZfgiEBPwaaR0ngXMhqf6UOlkVz1+ynoiNu8OLPEIqLS7gu8JQH6f6Ph4Jkc9Ua3wfAc5TL0adMnXNXOompHi6o0chDXvZdxO05cTt2Lgde450OO4GxJJQlZU5tIsdL0dI6pYW5DO+OQXBbaoWGCUkHiSpZrfuPKDu8UojJNKMWn3SjGUUqFdk1MCI715KpZu27edVtPctnTZnxdTZK9QLkZAo4M9aNahuHUvQZnARtTN+2mK1Z9Zv3vPtmBc3elCV/RMICQBXcX7IjvumlsZa6kZ1PQvf45lGPFohDR9tv+3mkJdC4m5XCWntxp1cykLi/lQ12+/Pp3DxkB3N+Z461ZUltGd4BMBCor1UX1vBNxBSlXldGlLwIgtJlXJAoxPtC6WnpalYCen4yTNyxUePkjscz3TgGzXREFZbR91EnDh4NKSyvIRGMOoGuPwq2Y7tuRQR2eG4/Q+Nb/iT5UZISFlZ9tvTVJQVq/dCKz513I6IYnX/J54HBu3ucNzk8P59+3BZFfkzEBIArsIqcnJRw4PERO3tOLWkp6Wqu7cx/FAJ3RMEtKVqBMAnJ9Qwi77jqxuS9heuXNRA/SwHN2Nud/nsIt0O0ZLquNO24u69+xyQRUhsHY6nVOTl2R9U4fzopfo46NsAP/6D7+R989aLUS8R73gimg55qiku7i7rhza7y2dkdDieDRF9M4Zj9aAjCnTvlAaLHNBfBdlLtuO3QEgAuMq9eP0TZfyWLVdeHDrrC2rsYgWcX7/QF+g98mgY9AiEBAAAwBJASAAAACwBhAQAAMASQEhWp6mh2+upiouLZBIAALwUCMnq1FRVyKTiQVKqTFoQJ1oFAAAGQupn9h09X1hYsHGn/ZHYT+sq+Qcu6pcuNCchhV2Mrq+1X7FKizQq2nPkXGVFaXND7dWoOK2QjoRERMfYL7Q9fOLSsVD7z8WZh8mpLY6frWw/YL9xwJnz9sdIExXlpdWVZW3NLy5IXb/9ZEqq/WcWW/faf8Ox+3A4NUhBfW3VqbDrrU32a5BoAzIys6kmxx3235eUh4ZfpyA+4REn9x89T8Hm3aeKigraW+ojIu1XuEJIAIAegZD6mX2O7psNROJ5lJJOQVZWjlZIXLOhvnr7frtRGh2/kCCNaYVUVFTIjeTn2+9lomXP4XPc2rHQKxTw6sSWPac37T7VUF/Fizk59h8GNjfWcTsE64QEw6t3vJSQqlBT9dPNu5SQFLx42uE/CAkA0CMQUj+jhJSXm0cCoIBGLTSnUQ6NRRydfsWuQ+F3Hb+A2eEY4miFlJaeRUOc2HtJlNl5MOzAsQtcbfNu+w27mEepGUdPRZA8SD9VFWWHjl/kfF5e3rZ9Z9PSX9y/8vHjF0IigRXk51+4Yv/RO42TaACkftbHmgnaFUKjH44fPkqjRiigQV7s3URKBodeyc3NpXlhQQFJjtuJunlPbQ8AAHQJhAQAAMASQEgAAAAsAYQEAADAEpgvpLLCzOzUOAAAAD4MdfWy/+8jJgspJ+2O7YdnAAAAfB7q8KUF+oKZQiJnyi0GXkpHR1tWTh4FyalZmdm59kx76+PcAgrKKyqfPn0qVwEA+BvU7UsXGMY0IcFG1qe5uSlw2wkK2ttaOOh83r7zYBgFP3R2FBaXyVV6hNqk+e17yTfjEikoKikLDr1GAbV/6PhlCpoaGysqq+SKAADfwEQnmSak9tZGuaGgXyDfcMDWIfYcOSereYbWluasnHybZmOe5BUakx8AwIK0tTZIIxjDNCHJrQSeISUtmwPV43sLp89Hc0Bbnl9YIisAALwCaQRjQEjeyvrtJzm4l5AqS70Ur3MqAMAGIfkt1GVXVdfIvI+hdJubXyRLAQCWQhrBGBCS1amvt+/buHuP7j3wnZGQ60RE3ePgbnyKLAUAWAFpBGNASFakvb11065TFBQWl8pSfybpUaYvHdbLSEm4FH6Mgg0rZ3ImcPn01paGirIClVF5m/1ylSYOtPm2lgYKoiPDVebkke0U1NVUEEUF2TSnxfraSq6wfsUMmrc01XNTqQ/vRl4O5aKayp/+3nhLCK6W/ySdG+TWnnW07N22koKj+4LKSx0XrbzcMBVo6xMXzh6h+b4dq7noZuQ5VcqrXAw7Rm+QK0ue1lUVF+ZQsGvz0pbmel5L277u5Rhu+UnWI3o5Ck4c3qbN6+ITh7Y9TLilzfBid2xeO4/myQ9ieXHHxsWOoGP3luXaarqP7E7MFV2yy/jEwa3atehdcyl9Its3LD66N0gV/dDZzgFvT21VmXZXcHDjWphuz5iLNIIxICQLUVRS6ku9rVvZdShcHdbzXrQ9UdDqOdqMrhfrDqrGNZWQKNCuqzzEgeq8iPux120OIe3bvoozOiFxQN2fzSEkVaQtVbHzLW+or857nKbN3LsdqWvBOU5e0QmkMe2iFNLjzGQSKotQCWnbhkVnTu6z9SQkKu1ob1ZCCt6/mYNNa+Zqq2m3c8PKWbpGCNoAthRBe4m90p2QumyH8p3P2+7F2ncpCUlbxKj23YQ0gjEgJEsADxmGdt2N2w9k3ivospMtyM149CD28J4Nsn5WWmLEhVc0zGtRnoVEfRn1SrejL6neXyekkuInat38Jxk2h5BUOzoh0ZYQXNRHITE08lOlWiE56Di0OzApPkZlLpw9qq3g5BUlVBRxvov/KSkkCmiP8aJWSLXV5WWlea8KqaOmSn/EggZ8SkjqHdGoUVtHbrmuVG2AzSEkeiEa0DgX0uHd63XtbFu/iAMIyY7cRNAj9B0/9PwNmQcG8Eapq/6lqDCHOmttRtdzPbh3kwM+4KZrgTzEQlLfzdXqOiHZHMdwtHVYSMSRvRu7HCGtX2E/eKgTUmjw7s7n7W0tDbnZqWGnDjiqvdgw2ecS1MPqSrVC4mOMxP4da+S6zM5NSzig0Yw86tUdavDH/bVOSM+ftfFuP318j71UIySb4x05HyExZ0P2c9DdZ6ddTLjz4v89/k4UB+dOH6J5cWFOm+OnnPxN4uCudU6E1NL84nCrlv07X+w6CMmO3ETghLo6+0HwHzo7ZBHoI5civemGitRRUufy6OW37O46NfoaThlHp//K34yqxkIiSfDinq0rOJBCunH1bODLA302jZAo36WQqJu2OYTEa6l8yNEdFF84e0R1+oHLZ2g3W1d/R9ASitVZIq2QsjMeUhEftHQCtxZ5+bRalHV00Lumauqkjk5IuhN1OiHZejpkx2gP0Gnfry6p8kGrZwfaR5+ZFF+9GKKqsdHV0LY7IRGJL7+daNEKSfeKNggJOOHZszaZBGaR9Mj+r97RgZ0MgIeQRjAGhORR/PPSbQCAbyONYAwIyRN44+mNvpCXXzjgl29bBNr5//P2cJnvL4K22c8ZAOBLSCMYA0JyI8Gh16JuJci8b0N9bkfHsx8xdT/9y+8+oL0kdx0AXoo0gjEgJLfAz2LwQ6if1fe+mLqaKqtqV2/YLXcgAN6INIIxICTzaWhouH4rXuZ9nrz8wt+/8Xd914upmwmDJOAzSCMYA0IykwPHL8mk//Dz197Rd7qYup/+8sEIuQ8B8EakEYwBIZlDabkb7xPlLbhyvK66pu5xbqE+65fT8VC//voCfAlpBGNASCaQmJx5NMS9vzvzCnoUkvZiM1pcs3Hf9j0n9JVMnXRXuOmL+zZNmrnKeZvOSyEk4DNIIxgDQuoTx0/r7sfl1zjvf6m0sLiM45/9emDImQgWEquita2d8v/3N4O05lAi4cv2om/FU/zm+99xBZvtH1x6I+a+tjI3pVoYOX6hilVA7Nhrd2H24wJefGPQN/QqkdF33/kkgPI7953k+lz67qdjtOv+4rV3VfyXD0bUP23kOL+wlPI//GDjRfWKXU4QEvAZpBGMASH5GlHRL25C43mc97+ylIREGqDgf94eSqXpmU/WbtzHNUdPXsLBjy8vklaLKhjw0j1qkRRFQezdJK7GScXv/vdzztxPSOGgpbWN5uQPXpRCungl5sMvxnPpwhVbBw0ew6/FL6FGSDxXgW6xuwlCAj6DNIIxICSDWOS3rkNG6m+cJTMew3n/K0tJSJu2H6Hg6xEzufS7cfMHOOShFdLr79h/1qoWVcA1Ge0ia0nV/PUfPyGpyGoDHEMr1SbpSgpp6uw1qvJbH4y4l/CI40+/nvzjq0JS8KJ6dQ66nCAk4DNIIxgDQjJIe1uLTPaF69G3bQ6dDAuw3/Bx5oI146Yt2rrryOIV9oesVFba74xJReybiTOWUgWur1oYPnrW7AXrKPPNmFnXrttvCvntmNlDR9nv2Lhj7zGuWVRS/O3Y2RxTfS6l+qZozHn/S6V7D51WcUtLqzqHxEIaFjBHdeguCokX1VRVXTdx+gptfoA4ZDfg5ZBIm+SAhHTnfvL/vjOMFqfPW0eZtUH7N249rCrzdPzURV5LjpB40m1ndxOEBHwGaQRjQEi9gwZGbvqNUUlJaXBIOImBIBUlJCZTUiukouJiLk1+lKYEo0SiC3g+cvy8gEkLbA4h0fzGzThVevlKNLf2/Hn7wuVBhHZjjOG8//3R0UEzfA5GJ6TU9MeqAh/K4waVkGbMD6Tg56+9w4vnLt3gyr/8/cfaxj8fNk37ijohqZNG//SrgbT43mdjefFffvcBn6nixcDNB7i+apbisvIq7eKZc5EDHOeQ5i/bzMmBHwdQ/uz569pq3U0QEvAZpBGMASFZBRISzddt2nPh8vW6ujpSRUZWNgkp4trNmNt3p862P01gwvdL5i62P5iLSqurq2pqaniIY3MYi0ZFI8bP1SonK+cxCYkGc7v2H7c5hLRi7XZqjeuQ88ZMXkjBqInzr1zr4ob2vcV5/9v3idtPSEpzxwv9fy+F5LEJQgI+gzSCMSAkV6GxkXrYjMcgIclkX1i1fqfNbeeZ3OEJ7ZTz5MXgRl9gxgQhAWAYaQRjQEigd7z90fDX3/lSEXvnvipykyp8dYKQgM8gjWAMCKlnLHJBnUVIz8zUConJfvzYBiH1coKQgM8gjWAMCKkLNuw4KZNAobPRynUvHgsNIfVqgpCAzyCNYAwIqQtoSMSjIpq3t7fKCv5JwIS5cmx0595PD3xyq5Da2zs4aGlte7WkF1NkdFxhUak+208ThAR8BmkEY0BIXcBCIs5F2H/N47fcuBnL1nlj0Ne79h1VeWWjttZmbX13CKmmtl7FTc0tmpIfGxqbONApKi0jR8XNLa0qHjl+HgdDRk7n4Nmz5xxUVNZwwFPRy1scNTY1cxATG/+j/Z5AP5SUVXCm72KDkIDPII1gDAipC5SQGOp6ZB1fpbOzY9GKjeybdz75VlYgxk1ZSKUyb5aQWBjfjJm1+8BJCoaOmkHzZWu2sZCodNTE+TabjZWwMnDnj/YbKxzndecu2cB1WEUPHqZxnlzytKGR4+OnLtB8z8EQXlQvp11U0pq9KPBHh5Bq656ynzo7f1ClfZkgJOAzSCMYA0LqAqWiqzd+uoTMh8nMzlaDnnMXr8oKLmKKkMIvRlLXP2PemoPHzsxasC4j6wmrQickrvyPf/yDzPSjRkhKJ9qxEU8nQi9ywIZTU9C2gzS/GBHNi9wUt5OQlLpm454fHUJaG2QPaLp95wGEBIAWaQRjQEhdwDb6obNDFvkS2nNCTU0NskJvMUVI3NcPH22X0ITvl2Q/zh87ZdHzzk4SErknOydPJyRaPHv+mhJS5I243PyikDOXpZDmLF5/8Ur0/KUbSXLaPL1WZHTc5JnLeVErpPTMJ9PmrHra0LRgWdCPjtFYVMxdVdrHCUICPoM0gjEgJD3Pn7UHn74m875BSUnp+5+NZAkdOxkmK/QFU4TU2ym/sORHx1BGX+DydODoGZovXLFJX+DmCUICPoM0gjEgJL+A3GPKQTnn9JeQjpwI12d7M/1gs+05GMKH/jw5HQoOl/sQAG9EGsEYFhXSP/1qIN8kxuehdyrfft9JSHz453e/YgMFbtotK7iDj7+YUFpWqe93MXUz0acv96FfkVGa/ZtFn/gtcod4L9IIxrCikAa8fEKoP0z0Tk3smNSF2m++N4ScJCu4mwH9MUjy0snEz90b+eu6b3+//PPq5lq/hZz0uCJX7hlvRBrBGJYTkn/2aP/82/flrnARdU5o4EffdPb3hRg1NdV/ePNL/dvD9OqUnvnEz2302yWDEwpSZB/tb/x+2eeltWVy/3gd0gjGsJaQgrYd5Afk+NvU2+4pMzv7rfeHuPuckDFWb9hNb2f6vHXHQy8BHZt3HhvgeBxUh3/fAYQGB7J39k9849idNIIxrCUk/xwe/eh4PmlKWobcIToCN+1mCb0x6Ot+OSLnOo9SM4JDzgEdEWY8d8oHmHUqUHbN/gmEpAVCssRE352pt5I7xOa4UHvQ4BHsoWmzl8sKAHgdh+LCZNfsn0BIWiAkS0w6IamrtD/6YnRpqR/duAj4CRCSAkLS4oNCct7IgFevutYXi4nqZOXk6bNmTySkQ8fOqAu1v/x2ktw5APgMpguJ/51l3h3QC/3hzS9l3hgQkhZfFtL//c0gaR1a3LD1kIqjb8X/4x//4GoXI25yUpXynIXEdZ49e/4oNUsVDR4yRbuK4YmEFLhpj9whAPgk5grp0yGT+N+TF//1Pz783eufazMUvPbHT2g+8NNRvBh68QqXvvXBd6qmCu6nJP/s1wNV5j/+/OLydF4cACEJpBGM4ctC4kDXJi3+9cORE75f/ts//U1VmDZnzdOGJrXY4rgNmlokIdG8prbeZrOrS1tEbNx6uO+b7eQcEgC+h7lC4v/EafNWfzp0UrVDSAMcXpm5OJADmidmpGUW5KpF8s2ZK5HhV6M4M2T0zD+89eWy9Tt48Rf/NqigsuSvH4+asdh+8QUl123bz2uV1VUOgJAE0gjG8AshaZ+XQ4u/f+PvH34xfsDLwRMHTEVlTVFJ+Z8GDl24Yuv9hBQuZSEpOHn2/HVqhzNrN+5T7RubICTgV5gopMrGGvof3Lz3SLXDHNUOIf3f3wziUs7wvMtFWTR3RZCKdaTl5nAeQtIhjWAMfxSS9pCdmmsn/uNTMQtJW2H05CX0HYqMpa3ZlwlCAn6FiUL61R8+5n9DpqqpRo2QqrsykHbxLx+N0BUdPhXO7WirqQohFy5zACHpkEYwhr8Lqb29IyrmHv8J/vNv31d5bSMkpMqqF1+XaOSk8j86RGLKNkNIwPfgn83JvM1UIdE/YHJOpooJFhLzpKxQ5Rle1K6u8iqz+0iILI1Pe/EFdACEJJBGMIYPCskbJwgJ+B7qd9zyQScmCkmiHSExukVLASFpgZAsMUFIwPdQQlK0tjZxEYSkgJC0QEiWmEhIYyYvWBe0GwCfYdio73VC+uuHw/g/3a1C8i4gJC0QkiUmjJCA76EbIanhkQ1C0gAhaYGQLDFBSMD36K9zSN4FhKTFj4T07NmLh/794x//eLXklYmqtbS2Mfoyt00QEvA9SEhSRYz7hFRUUyaTrnAnKbGsrkLmu8T1mj0CIWnxKSE9ySvUpxxTQ2OTipOS01VcXFLOQX19g0ryFHLmEgdNzS3afF5+MQfT5qz60W6v56qooLBExb2dICTgV5grpNyyIprzr1aZ8qdV5fVVFOw+clIlE9IecfCk1H4tOJNXbl+3SwqqSrR6y68o5iA9//HN+/dlfWNASFp8R0iTZy6n+ZlzV4ePnkVjoIBJCzi/Yt0Omt+5//DA0TM/OoT0tMHup2/Hzqb5kJHT5y5ez8HLluwTC2lYwEyaHzp2litUVtVQsGBZ0I8OIUXeiPvBZlsbtEet/t24uZo2ejFBSFbmB/Ec3qLiYl0mMemRXFFy4GioTPohJgoppzifBjf0D1jVVEOLU2avoJiCHfuPVWuE9M2YWTTffiB4jyMTuHUfzbkmF6nK346bU+0YaYVfu05BwMT5NB85YR7Nl6zdyqtw0hQgJC2+IyT6i+ns/OHE6YurN+weM2URZYJPXfjxpahiYuN1Qrp2I/ZHh0jYJTv2BmsaeyGk2LuJP2qERPPCotKho2b86BCS/X+gupagxZ37jqvYwAQhuYOjJ89ejIiiICo6NmjbAQ5CzlzIzM6h+PmzttaWpoNHT5+7GEmLDxKTaX7+UmRLc+PlK9GqEfqUad75vH33gRPtbc30QdPik9y8Gzfj9hw8WVtTE3snntYaN22RWuXchWtP8vIouBYVc/j4GQpux93fdzikqqpK1fFzTBQSUVRdOmvxOo6VkGIfJFRrhMRJFRRWl6pYFXHluKQkXkzMSKP5vKUbaH4x6kZWYS4xd+l6Wrx2+zbX6TsQkhbfEdL4aUvIMavW7/zx5fE0VsjMBWsnfL9k1/6TLKTla7frhBQZHRdy5vKkGcu0rWmFVFBYcisugWq2trVnP86nL0c/OgZPdfUNJ0Iv8quQpdIzn4RfjNQ24vpEQnr9nS+HB9j7PmA6LBX+8kHB/YQkmucVFKgKd+7ZP18KqquryS5qFeJ0+GWal5eX0zwzK5uTp85eUm1yRgnpXnwizR/n5vIicffeg6WrtqjKT5/WqSK/xWNCmjhjKee37Dly9dZtKnqYmR589rxWRTyvdiokqnM87MKDjNRvxs6iCqrZvgMhafEdIRme9h8Jpbk6xNcvE4+QDhwJ4auSAibMlTsH9JbjoedoZGMTQuIk0dj44u/20LHT6RlZy9duo/jmrTskFfYKERl1S7ZMQhozeaFq2aYRUuDmvapa4KY99BJkO62QaHQlG/Q3zBWSVwMhaYGQ7NPRE+H6lGcn3SG7zTv2s5nq62rlXgIuQmOgkRPmZeU8JhOkpGUsW7ONgqTkVGUR4sbN2A1b93M8c8EamtNgd++hk2uDdnNy/pINsmWdkG7F3iUh0eic+KGzY9/hkG/HzLY5xkYLlm48FhKuFRKwQUgaICQtEJIlpkPB4afD7IeGdMTeuc9mGvjRN7IUuIgygQElmHviJ+z8VZn0Q/bdOiW7Zv8EQtJiLSH9/LV39F21f0xvfTCiqalB7hBFxLUbbCZSlCwFwLv4ePN42TX7JxCSFmsJyeavgyR613JXdElZebm6F4ssBcAroF5Yds1+yMarB6efWC33j9chjWAMywnpb0OmVFYZvHjaS6f3Phvb0d4qd4VzcvPzWUsHjoTIUgCsTHtHC5yUVZHrG8Mjmw8LyeYYJP3mvwfru21fnIpLKn73v59/MWya3Amu8/GXo9lMoWcuylIArElNYw11xxuvHZQ9tT9Ab9xnbGTzbSERBYVFAzQPefRVPv1qUmGh/jf/xuhob3n3k+9IS7MX2i8VA8Ar2HXjOPXL/cJ/Df38j8M+l3nPsCf6hNwb3os0gjEsKiTQF8hJuAICAOfMmLfy8DHcyckcpBGMASH5LJWVlX9+9yvS0t+Gjpd3YwPAzxkeMP3yFfudpUDfkUYwBoTkF6h7QOAKCACY1/HDc/OQRjAGhORHdHZ2fPrVGPo/fOPdr2pqqmUFAPwH/HDCRKQRjAEh+SPJKak8YMIVEMBvgZBMRBrBGBCSbxIVHSuTkhVrt+LyB+CfQEgmIo1gDAjJy1C3rKb57IXrVHLq7BWhYZcaGuq/n7vqwuXrvb1p29P62jccV0B8NmQcroAA/gCEZCLSCMaAkLwMNk3AxPlNTQ38ZDmCYmKq40kwvNhbISlCz1zkMdOufUdlKQC+waGjoaMnzpN5YAxpBGNASF4Gm2bnvmCaL16xiZPtbS1cxE89GDpqhmEhafny20mvd/VwJhpCUf7hoxS5is3xhDp69QuXrqalpfowd+/dnzBtsSn7GXgeDI/MRRrBGBAS6JnATbt52BRx7YbN8c/MvPfZSF3NPQdPNtRXNT6t9h927MVQ0vuAkMxFGsEYEJJ348lv6OoKCC26OrQ9ssv2eWbMx8WKXob80wV9QRrBGBAS6B0NDfXdOelhcmp8fILsr30eT34tAH2n83l76NlLMg8MI41gDAgJ9I7YuBcPsZVO8s/hEXHn7j1zHywL3AqGR6YjjWAMCAn0DiWh4QHTz1185YHcJgpJa7uKsqIuK8ikjlWBW2VScfT4KVcacYW0tNTc/Hy5r4A1gZBMRxrBGBASMA1zhfTkcTYF0TG3DGvD+YoQkn/y8d8Ddh+wX6QKTEQawRgQEjANdwgpLT2FtUHzNwZ9zb/e5UWa7z14jIIlKzaoJDH463E0P3jkJM15kETBlh37uc69+/ZDjt+Mns6V5UsbAELyIl7H8MgNSCMYA0ICpmGukBR1NRWcuXU7llDu0SVrqsppTr6hfE52lqqzdsN2rrZ5+95xU+ZT/Nb7Q+z5jfa8fGkDQEjeQk1N9ZHgMzIP+og0gjEgJGAa5gqJR0h37t5V7jl1OpzhRV3yyZMcWszPf6JthObzl65T1c5fvEzxx1+MbsQhO7/kdQyP3IM0gjEgJGAa7hASxzzfsmNf2PlLapHmnw+bMGfhKm2dN98bkpr601E+mldWFHPwlw+G0uor1mymxdoa+3AKQvIrysrtH7rMg74jjWAMCAmYholC6pLExMTI6zc4Vi7JyEg7fCxE1SEbhZ6xD6GIupqKpKREjvcdDC4rLeT4aV3lsROn1Sp9B0LyCmAj9yGNYAwICZiGu4WkMHFwYwoQkvX54POAeUsCZR6YgjSCMSAkYBoeE5LVgJAsTvDJMAyP3Io0gjEgJGAaEBKwJrCRu5FGMAaEBEwDQgIW5Ez4ZRohyTwwEWkEY0BIwDQgJGBBMDzyANIIxoCQgGm4W0iJSUkyqWPoqBkySYyfukgmzQJCsiywkWeQRjAGhARMw61Cosa5fZpnZWVSEBMTO2byghs3YyhzOuzipBlLKTl68oKY23E0HzFuLi3OW7KeSstLiyAkP2TKrKW34+7JPDAdaQRjQEjANNwqpEbHCIle4nJE5KwFa2jx9NmLND977hKXbtt1qNExQiIhcWWalxQX7D90gtaCkPyNr0dM+euHw2QeuANpBGNASMA0PCMkCq45fh57/tIVRxzNpVJIVRUlT+sqGx2DKgjJrzgeEo6DdZ5EGsEYEBIwDXcLidqvq6mg+b178Y0uCIlXmTZnBYTkV5SWlsJGHkYawRgQEjANdwvJskBIlgI28jzSCMaAkIBpDB89S3bW/kD4hYjnz9vlDgGeBzbqF6QRjAEhAdNIfpQWH58g+2ufh4aGcm8Az0M2ysjKlnngbqQRjAEhATPxw6N29XWVCYnJclcAD4OxUT8ijWAMCAmYjF85iUaEGB5ZgbfeH3Ir9q7MA88gjWAMCAmYz8QZS4c4fsfq81yKiJJvH3gYGhsNGjxC5oHHkEYwBoQEAPBiyEalpaUyDzyJNIIxICQAgLeC80YWQRrBGBASAMD76OhohY2sgzSCMSAkAICXERV9GzayFNIIxoCQAADeBKlowrRFMg/6EWkEY0BIAACvgWz05ntDZB70L9IIxoCQAADeAdlo4fINMg/6HWkEY0BIAACrs3nHfpw0sjLSCMYwTUjtrQ1yKwEAoI+Qik6Gnpd5YBHaWhukEYxhmpCyU+PkhgIAgGH4yUZ7D52QRcA6UOcvjWAM04TUAScBAMyDVDR05DSZN4WcJ09kUnIvPlGXiYqOldX8GRNt1GGukIictDtyiwEAwHWedbSRjYqLi2WRWWzZeVgmXWEI7qWrITvtjrRAXzBZSERZYQY5EwAADJBwJ5JslHTvuiwykVVrg2g+Ydoimifdjxo3ZQEFGcm3iVnzV86Ys5yrkX5Sk2LSHt46euSwymSlxH43bjbFsTev3LpxmYJvx8yKibrERZOm29v0B8qKMmT/30fMFxIAABjjsyHjyEYybzqbtx9Q8bLVW/Lzn5BOqipKWxprKfMgMZGLKMnzZWu2aDOV5SXa1tZu3KmtrC0CvQJCAgD0PwETZpOKqqtKZZE7YCF9O2Z2ZmZ6h8MiFy9djbkVJ4VUXVly+3bcqdPnVOb+/Xi2zumwiwcOn+yAkMwDQgIA9DMDPxo+6NPvZB74GxASAKDfOBt+gQZG7S31sgj4IRASAKB/IBV55owR8BYgJACApzkcHEIqouGRLAL+DIQEAPAoX303GQMj0CUQEgDAQ/AZo4a6KlkEQAeEBADwDENGTMHACDgHQgIAuBe+eOFpbaUsAkALhAQAcCOkoiePs2UeAAmEBABwC8tWBeEYHegVEBIAwHz+8sGwt94fIvMAOMFkIWWn3akqy5V3KQcA+Al8xkjmgY9RWfYkx8qPn3icflduNADAT2hrbSYVHTgSIouAr0LdvnSBYUwTUjYezQeAH0Mq+vLbSTIPfB4Tx0mmCQlH6gDwT2hIRDbqfN4ui4A/UFn2RBrBGKYJSW4lAMDnwRkjQEgjGANCAgAYobCwiFSUkZUti4C/IY1gDAgJANBrSEUz5q2UeeCfSCMYA0ICAPSCXfuO4hgd0CGNYAwPCenwng0qLszL2rtt5YnD2wKXT1dJbbw1cAEHxUWPde1ooVW0jajg+pUz2motzfX7d6zZvWX5xbBjtHhk70bOP7gbrW1KF6tMWMh+bWs6KsoKVNze2rhl3fwDO9dmpj5QSdkycfWi/bpYWmRuXj9Hi5vXzVcZVf/gznWb1szVrk6vuG3DInoXuzYv0zaiNlvXgi4AwDDbdh8iFcUnJMki4OdIIxijH4R05sReFZcW26/NS314lyz1/FkbJzuft9+6cdHmVEjaHlbbF9uEkAKXz9AuSiGlJd+n+fNnrS/rv9Ka60Jav+LFC519uUp7W5Pth46czGRefFpXtW/7KttLIWWkxHOeX4iEpJpSSZmR+esRp+VacTcjOAjev1muAkCveNbRRiqKuY0fGoKukUYwRj8IKTvjoYoT7920vexGN66arfJ7tq6wvSqkx1mPVKxW0cYqw0JqqK+pq6mg4OSR7doVSUjkAyL4wBbt6urVVWs/dNovY9UJ6e7ta9pFrZDOnNzHQUrSi59ksQvVhpGQoiPDbWKEVFlRZHMIibaNCA89qNbiCrzHtLKheMvLcaROSIzKRJw/0dbaqBYB6C1l5eVko6qqKlkEACONYIx+ENK1S6Eqrq0qs3XVjTK9HSHRfMfGxSykU8d27d1mP+katHoOV7t144KtqxGS7tW1rZ04vM31EdLmtfM4oJfmQNcyCYnmzU11vR0haYXU2tLASbVLuxwh8dATgL5DNqqsrJR5ABTSCMbwkJA2rppFemBDRF09e/Xiqdibl190+ge3cp3Gp7WlJT91o0GrZzsRku2HDlpdNWJ72Rf/0NmhO2RXXJhz4exRepVbUV0LiWlqqC0pfqLa4TnJQysGya7NS9X7KszPIntFXj792HGM7tGDWF1lFhKN2LoTEjfFrdFLb1g56+b1c4d3r9cK6VJ4cPipA4n3Y9SGdSkkPi8FgGHoXwm/MQIuIo1gDA8JCQDgRYybsuDN94bIPABdIo1gDAgJAPAK34ye8dcPh8k8AN0hjWAMCAkA8BOvv/NlcXGxzAPgBGkEY0BIAAA7ickpOGMEjCGNYAwICQDwbFjA97ARMIw0gjEgJAD8HVIRThqBviCNYAwICQC/xv4oo84OmQfAdaQRjAEhAeC/kI3KystlHoBeIY1gDAgJAFfZe+zy/uNXSkorqmpqGM7rFmXG+aLM9LaCi/UXrghSi+cvRX769QTn9btblJneVrBafZlxvigzzhdlxvmizHRXobf1u6sg62dk56m4R6QRjAEhAeAv0HjoLx/YzxUtWbUJlzAA56Rn5qVm2G9e4wrSCMaAkADomaamJpn0LlLT0/lWQAM//gY2Aq5wIuyGTHaJNIIxICQAeiD4zHWZ9Do++mI0Cwl3qAOmI41gDAgJgB7Yf/yKTHodWhsxl69EyWoAGEAawRgQEgB+gVZF7302UlYAoEuedbx4dKoTpBGMASEB4Pts23WYVfT0aZ0sBcAJ2kvvukMawRgQEgDOqKurJ2Teu3gdvzcCRmls7PmR09IIxoCQAHCG7scZAACJNIIxICQAnGFASJevRgeHnAM6klPT5b4CvoE0gjEgJACc8ayjzZWTusQ7H48a8Mu30x6XVzd0gi753et//3zoVLnrgJVx5QuZNIIxICQATKC1pem9z8bLLhjoeOfTsXCSdwEhAeBl0NhIdr6gS/7tvwbLHQgsC4QEgFVw5RxScmr6xJlrZc8LuiMlLUPuRuC9SCMYA0ICwBmuCCn07OXt+8Nktwu643TYZbkbgfcijWAMCAkAZ7gipOCQc7uPXJDdLugO2mNyNwJr0traLJM6pBGMASEB0FcgpN4CIXkRPX4hs0FIAFgH9wlpwC/f/uLbWQM/GUPB7sPnKUOLXVaTSVfosjUPACF5ERASAFahfw/ZKdO8+f4IjlWGAuL1Qd9y/MlXU2ketOuUKlKVT4ZHU/DL339M8fzlO7k0I7dSVaD5g5QCtZZqQZsxFwjJx5BGMAaEBIAzLCKkMxdvax1D88MnrxaWN166nqCtpkq1lVlIqkJZTXtWXpV2RZpPX7iJg/vJecPHLvpm3GJtO6YDIfkY0gjGgJAAcIZFhPTFt7O0jiEVsS20SQ6y86t1ea2QAiYv59I/v/edqkDzyNuPKPjX//jobtJjWkxMLeS8WtFcICQvAhc1AOBNeEBIFHw6ZJrKvPbHT2leWNFEizTWoXll/XNV+vPX3ulOSLxianaptoJOSN8vCPr1H+zVICRgwzkkALwLtwqJ4TNAnKH5yo2HVZG22h/e/JoWM3OrtKW6Q3bMf789VLU24FUhaaupFc0FQvIiICQArIIrz0Nyn5D6haXr9v3Lbz+oxggJOMDzkACwCv17Dqm/+H+/fZ9UtGDlLllkChCSjyGNYAwICQBn+KeQ3A2E5GNIIxgDQgLAGa48DwlC6i0QkhfR4xcyG4QEgHWAkHoLhORFQEgAeBMeE1JWXpVMFlU2yyRRXtNeWNFUUt0ii5i7STkyqaWi/llpdavM9x0IyYuAkACwCp48hxSXkMlBWU1bRV2Htig1p4zmQ0ZOV4bIK6nXVqisf6Zzz6nz0RzQWto88SirZPGq7RzfSczWlZLGiFfqZxZzkJ3fhRENACH5GNIIxoCQAHCGx4Q0edZKms9YEHj6wk0K1mw6qIrYKEE7jnGgBEOrlNW0jpu25N5D+4+Hgk9fpfm5K3e4lIREXnmYUTQsYCYtXolOyM6vpuEUr85C2rDtKM13Hz4btDM4PjmXYhJeSHgUBd+Nm/sgNX/91iPqRcdOXULB4ZOX6EX5JQwDIfkY0gjGgJAAcIbHhMSDD+r3WUgRUfHVL4/RHTz+onGtkKLjHi1YsaWgvFEJKTXbPopSqBESx9QUQfVXb9xf/VJIDBmLhKQW4x7Yx0z0KjohKRFCSH5Fj3//NggJAOtgipCou094lJucUaQVkirad/Tck+I6rZDuJuVMmrmCxkM6ISltaIVETJy+YsrsVRRohUQqonZIMK4I6UDwhaOnIoaPngUh+RUQEgDehClCsj7b94XQPLe4Thb1FgjJi4CQALAKfnjrICfsPnQmNbtU5nsLhORF4NZBAFgFj51D8isgJB9DGsEYEBIAzoCQ3AGE5GNIIxgDQgKgr0BIvQVC8iJ6/EJmg5AAsA6hZy9v3x8mu13QHafDLsvdCKwJhASAN9HU1PDWByNltwu6g/aY3I3AmkBIAFgFV84hEW56kJ1P8u9/+lzuQODVSCMYA0ICwBkuCqm9reWdT8fKzhfoGPjJmC+GTZM7EHg10gjGgJAAcIaLQiI+HzqVxkkpWSb8TMdXobERbOR1uPL3L41gDAgJAJOJuHYzOOScFQjcdkIm+4uUtAy5r4D1gZAAAABYAggJAKvg+iE7APwWaQRjQEgAOMOrhRS47YRMAmA60gjGgJAAcIZXCwmAvtPa2iyTOqQRjAEhAQAA6BZXvpBJIxgDQgLAZ8EhO9B3ICQArAIO2QHQI9IIxoCQAHAGhARAj0gjGANCAsAZXi0kHLIDnkEawRgQEgDOeNbRRsg8AH6CK1/IpBGMASEBAADoFggJAGACOGQH+g6EBIBV8OpzSAB4BmkEY0BIADgDQgKgR6QRjAEhAeAMrxYSDtmBvuPK3780gjEgJAAAAN0CIQEAALAEEBIAVgGH7ADoEWkEY0BIADjDq4UEgGeQRjAGhASAMyAk4OfgeUgAABPAITvQd1z5QiaNYAwICQAAQLdASABYhbq6ekLmAfATGhsbZVKHNIIxICQAnOHV55BwyA54BmkEY0BIADjDq4UEgGeQRjAGhASAM/A8JODnuPKFTBrBGBASAD4LDtmBvgMhAQAAsAQQEgBWAeeQAOgRaQRjQEgAOMOrhdTjIbvNOw7JZF/Ye+ikTAKfRxrBGBASAM7waiF1x5CR03nOQfiFa53P22/cjM0vKOAKYeevUIZKI6Nu0fzI8TNqrRHj5z6tt/8wa1jATJqfCY+oqKjIynlMpbSKEhItNjc3FhYVfTt2dlZOTsDE+dXVVXV1tdwI8CJc+fuXRjAGhASAf3HsZFhxScnuAyfu3n+g9LA2aPe9+ESCF0lINo23lq/ddiUyhhdra2tpnpyStnHr/gNHQ3mtxIePUtIybK+OkKbPW5Xw4OH16Ntch4Sk2gReBIQEADCBLg/ZKc2oOfFDZ8e+wyHBIeG8qBMSjW9orKMVEnHw6GmaB207EHb+amPjUypNz8zSjpAys3NIVENHzSBvrQzcrhVSUnIqVwPWB0ICwCr4z62DKioqSsvKZJ5JepjS2tok8+SngqIijlMdgyRFWnoWB5WVlbq1mpsadBlgWXDrIACsgk+eQwLAXKQRjAEhAeAMrxZSl4fsAOgVeB4SAAAAS+DKFzJpBGNASAAAALoFQgLAKnj1RQ04ZAf6Di5qAMAqePU5JAA8gzSCMSAkAJwBIQHQI9IIxoCQAHCGVz8PCYfsQN9x5QuZNIIxICQAAADdAiEBAACwBBASAFbBq88h4ZAd8AzSCMaAkABwhlcLCQDPII1gDAgJAGdASMDPwa2DAAAmgEN2oO+48oVMGsEYEBIAAIBugZAAsAo4ZAdAj0gjGANCAsAZXi0kHLIDnkEawRgQEgDO8GohAeAZpBGMASEB4AyvvnUQAH3HlS9k0gjGgJAA8FlwyA70HQgJAACAJYCQALAKOIcEQI9IIxgDQgLAGV4tJByyA55BGsEYEBIAzvBGIZGHJLIaAK7gyt+/NIIxICQAfI1nz9p0Ntpx4KysBoArQEgAgD6x82AYhkfAFCAkAKyCNx6yY5SNOvA7KuBmpBGMASEB4AwfEJIsAsBcpBGMASEBM0lNy7gXnyjzHsbEbfBeIdlwlR0wA1f+/qURjAEhATNZuCxoyMjpMm+Y/IICmdQSuHmvTAJm58EwmQSgV0BIwGs4Ex7R1NRAwfdzV9peCqm5uZHi6fNW0Tw07FJtbS0Fx0PPLVwelJKWMXvhuse5uaoFFtjQUTPmLl7PwdOndR0dreEXrtk0QuJqU2evqKyspGDC94tpPnL8PBYSjcy4WvyDh8mP0pQUZy1YS/Pho2fxIgCgt0BIwJuYt2SDillINFcZWiTHcECMm7aIhKRdPSo6luajJs4n03AdrrwycLtNI6TRkxbQ/Gl9PS8GbTvAlaWQeHVe/G7cXJq3t/X8DObuqKurJ2TeCZevRgeHnAM6klPT5b7qd/zww+rtB9HYaP9+6RxpBGNASKCvtLe1kDbYOiwkGt/kvcz80NlRUVFBwbpNe0aMn1tXV8dCKikp5dWHB8xMz8iioQytWFBYSPPq6qr7CUk0oqLSnfuCudrYKYtsGiHRC126coMq79x3nEZdYyYvZPdohZSXn69iw7h+Dumdj0cN+OXbKblZFc3VoEt+9/rnnw+dKned5+EPq/jJg87GXD/kP1//G719uVsMI41gDAgJ9DNXr8fIpIk8SEyWSddxUUitLU2D/jZGdsFAx8DBAf3uJPqwPvxslOym/YqyvCQTPwhpBGNASACYAH3flJ0v6JLX/utTuQM9CX1YsoP2Q37zX58UFBbJ/aPDlS9k0gjGgJAA6CtNjU/f+vA72fOC7uALYfoF+rDe/vAb2Tv7J7947V25i3RASAB4E6FnL289GCy7XdAdp8Muy93oGejDOnhgv+ya/RNXziRBSABYBVfOIQWHnNt17KTsdkF30B6Tu9FcXn/nyw+/CJB5euljRw/Jrtk/cUVIriCNYAwICQBneIuQHpcXyKRl8YyQFNo8hKQFQgLAmyAbPUrLHDt5vraDU3wTMP3suctuEhJ1FoovR82QFRRvfzLS2FUVtNbv3/xS5t2Nh4WkHS2ZLiR1iQQFK1cHcnD29Inuqmn55O+jtfn2+se8+IvX3inO1V+Sfv3KuS4b6QuuCKnHL2Q2CAkAt/JDZ8df3h9KHdmUWUvLy8tlBS3zl210n5BUTPPdwadUsqi27K8fjxw4OOC1//pUJQf9bQzHIycv4LUu34qh+aMnmZwndhw+QfN/+tVArkBCinv0kIJf/eETmp+KuEL5UVMWUrxqy25u1nTGTF6wLmi3W5HfHkZPnm9zj5Bmz13KwQCHMHgecvwoZy6dP612PuW//maSillIalEKSVvKQdK963IbDDMAQgLA4nD/dfFypCzqEreOkBJz0ml4NMAhBpqThz4bPpUDmr/14XehV65yKVegeUlDhapPUAUWEmfIVeVNVWpRCSm/poRQeZp/OmyyatlcPDxCOnbyp3v6mS6kv7w/jPYS6efN9+xB50sh0bymJCU05Lg2qS0tzU1SI6QBjk9KJ6RTJ459P2sRl86ZvxwjpF4gNxEAb4T6LxoeqcV+PIfEnRRDi+ejbmgzLCRVs8tALWqFpCoU15UP0AipyxVVYC4eE5K8rsF0IbVUZ9Fe+tffvR8fd42C2JuX+cDd/Vj7ItMphMQoIZGBBgghtdZk8+p/eONvnf13yM4VpBGMASEB8BOvv3oC3GYBIanFe2nJ2sW+C6nkaQ9CUgMp0/GMkFpbm2TedCF1vnqw7p9/+55KPm94EhN1URWpPM2DNm1JfxjjXEhc/8qlMEr+7NcDIaReIDcRAO9C2shmJSERv/mfwZzcHXyqOyEx6hQR57sUEvumSyH95k/2Fxo4OEC3AWbhASF1hzuE9C+/e3+AQxUXz4dy0PnSUrPmLeEML6qAY+dCIp+pymV5SXVlqQP64xxSa2vP9yaWRjAGhASAnZjbd5NTUmXeFdwkpH4k+NxFmvMQSpb2HR8TkvfiipB6/EJmg5AAMJcuh0cu4ntC4ivxfvHau8fCzsvSvgMhWQQICQAr0p2QXHkeku8Jyd1ASBbBFSHheUgAeJruhNSP55B8GAjJIrgiJFeQRjAGhASAHQjJk0BIFgFCAsCKdCekZx1thMxrcZ+Q0gsfyyRRWFcqk16EVwupoTJDJl2huTpLJrvD8Kv0CleE1OMXMhuEBIC5tLU2T5uzXOZdwX1CGjJyukwSq4J2yaQX4dVCog9FJnWU5CbKZHTkRZnsXyAkACzKG+9+9fGXo2W+R0wXUnlT1bXY2AqHkEZNnM8BzQMcd6jbduAYCelRbiZXnjp3FZdu2XeUgxHj5tI8r7KooKZE22xxXXlCesrxcxco5svnTkdc2bjrAAUbdhy4l5bM1Qpr7cOvnYeOV3RvxD7SnZAGfz1WJs3FsJCelqdzQPvkecOTxHs3CnMS2upyLpw7Q8k1gZv27ttPwbCAmZ0OIRG1pamXzofRYnDwsZy0O0pIrLRZ81fSfM++fTt37aVg9bpNNA/cuJXmYybNV9pbsmI9zVtr7aMrlbwZdTkl8dbuvfsovn3zSlzM1ezUO1zUKyAkAKxLZFSM7tidOoeUkpb+0Reja2qq5VqmC+nQqbMcUAdEpBc+5mN3ccmJNB86agYJad6y9apOfMYjHjORq1RlyY5DwSqWQqL5rQfxutXZbaajE1JHe4u675zcveZiWEjl+Q+JjqdPaIefCjnBi42VGfRxHDhwkCrMXriqqSpz5Lg5nQ4hzVm4muu01z3mFpSQFixZS/NHD252OjzEmqkoSFavxZ+7ilV+ykz7XVw7HUKiOUnxVnQEZ9wnJFeQRjAGhATAKySnpHLP2NHRanv1ogbVaapSxnQhERNmLCNnUGe0df/RizeihwfMpOQ3Y2ZdvxP3pKKQ9EOjqOj790IvXyEbUdHwMbMqHHKKffiAhzXrt+9fvn47J1Wz0+evHup4kgUlj5wO0wmJCA47v2DFRlWfhRSTEK8ypqAVknavWllImzbvoIFO50tDfD9n2eTpizsdZ4aGB8ygYNL3i+7ejhw3dQFXplHU+o1bvxljHzCRpSZOX9SdkNIfxmalxGnFo4QUfjb0ZtSlqGsXlq60j5OkkLhxGpZBSK8gNxEALyX8QgR3jvOXBnYnJGbb7kM29wgpuzQ/qziX48g7cRzQCOZanP1QHhNxK+ZuykOOyUMcXIq+ycG91IelTysoyNccuFNxSX3Fk/JClVdQOzJfXFcma/YFFpJ2YKSQD5IwEf6wjAmpLO9hbsY9tUiDIT6MpqUgK/5l5SSalxc8JC11unA5Q3enl+hFOx3iqX95wLA7qotSZLJHXBESbh0EgFU4ePTUR1+Mlv0m0/m83eYeIXVJdkmeTBInHHf68SLUCOncxau6XSo/AnMxLCTLQqMlGmPJvCu4IiScQwLAikyesUT1mzduxqq8x4TkM3jjOSSfBEICwJvQHrJ7kpvLnabu2X0QUm/RCYnh0ZLMmwuEpMUVIbmCNIIxICQAnKG7U0OXPSaE1Fu6FJJngJC0QEgAeBM6IXVJ6NnLWw/+dEU16JHTYZflbvQM9GEdPLBfds3+iStCwkUNAHgTTU0Nb37wnex2QXfQHpO70TPQS//1g+Gya/ZPfvHau3IX6ejxC5kNQgLAUgxwz4PsfJJ//9Nncgd6kgFmPwjcS/ndnwYXFhbL/aMDQgLAKrjyPCSiva1l4OAA2fkCHW9/OuqLYdPkDvQk9GG99+kI2UH7FaW5SS5+EHgeEgBWwZVzSMznQ6fSV++Hj1/cYg5IaGzkYifobvjDKsh+8TtWf4PGRq6cPXIdaQRjQEgAOMN1ISkirt0MDjnnJg4Hn/nrh8Nk3vqkpGXIfdXvuPXDUrz+zpcy2V+444OQRjAGhASAM1x5HpKHod4tIfGhzANr0uVPBbwIV76QSSMYA0ICwKKQCNX9C7TwfQ1kfWBBxk9d+OZ7Q2Tei4CQAAB2pI3+/O5XlI+OiVuzcaesD6yGD3x1gJAAsAoGziGZi9ZG737ynTYvKwNL4T+fkTSCMSAkAJzRv0Jqa23WCklXSpkfOjvkWsAK0Kdz8OgpmfdJpBGMASEB4Iz+EhKZhnq0vw0dH7hpd5c2sjkO3HWZB/0OfS7nLlyReW/Elb9/aQRjQEgAWI6IazeoRysqevEreifWyc3Lc1IK+oW/fzNJe3DV24GQAPBf0jIydY45e87ZrUgHfz22xoUuA3gMH/uKACEBYBVcvHWQWSxdvdlAd2ZgFeAmfO+zwK2DALAKnjyH9MWwCQuXb5D5HmltaRo0eITMAw9DNoq4GiXzPo80gjEgJACc4TEhDf56bF++XL+O2zf0NzU1NR/8bZTM+wPSCMaAkADof0gnx06GyXyv6IvPQB8pKir21f3vyhcyaQRjQEgA9DPUkc1bEijzBvDVPtH6+PCeh5AA8BcysrI++XKMzBuDusU9B4NlHrgV2u03b8XJvG8AIQFgFdx9Dsn0b9av4/YNnuXDLwI+/nK0zPsV0gjGgJAAcIZbhWS6jRg3NQskuXl5X4+YIvP+hjSCMSAkAJzhPiENGTm1tLRU5vsObt/gMfxhP7vy9y+NYAwICYD+4Q3HgyTcRFLyo5nzV8k8MBF/sJENQgLAt8nIyvJAX0YvgWcmuQ8PfIIWAUICwCq445Ad9WWzF66RedPxn07Tw/jY7VP7jjSCMSAkAJxhupAmfr/4syHjZN4d1NfV4gIw03mQmAzT65BGMAaEBIAzTBeSh/syernsnMcyDwzj4U+w32ltbZZJHdIIxoCQAPAcO/YeqayslHm3Qh2omy7n80P8zUY2nEMCwFfpl+6MHz4r86C3DP56rB+qHUICwCqYeMius7Nj+dqtMu8Bnj9rg5P6yKDBIz4fNkHmgQ1CAsAzmCikP7vzh0c9smbDzsioGJkHLgKjO0EawRgQEgDOMFFI/d6j9fsGeC/Ydc6RRjAGhASAM551tBEy31s2bts7ZORUmfckScmP0LEawM9vn+rKFzJpBGNASAB4AouYIDomDrdv6BUDP/7Gz2+fCiEB4GtYREg2x5aYMubzB46HhFvng3NCe1uLiu/cS5AV+gKEBIBVMOUc0s1bcU1NDTLfX7yOZya5hrTR3fsPqMe/fCXaZj8Emrr30EkK2lqbAzftsdnv4D69pMR+XXhxcUltTc3J0+ePHD9TXl5OmaBtB1gbS1dtPX8pkgKe2yuXlPC6KtPQUM/Bw+RUDoi6urrNOw5RUF9fd/j4GV5ry87DFLS32X+7Sp/p/sOnps1ZqVbxGNIIxoCQAHCGKUKS/Vr/UlFRYbVNsiBd7qKZC+w3Iex83k56oN3IyaGjZtD8ROh5kgpn4u7G0zwlNd3mMM2lKzc4oPmRE2c54Hnc3RcDGlpMz8yiYNP2g5whdu0/ruLdB07YHNZhLZ09d6WurpaClYE7amvtwehJC2gOIdmRmwiAD+CTQiKGBXw/aPAImQfMXz4Y9u2YmTLPQrI5xi6zFq5V993Yc/DkyPHzdELKefLE5jDNzn3Bj1LSuxSSghe37znKemNYSHyIlUdLLc2NmVnZNse4qqCwkIZrq9bvZCHRgMzmBiG58vcvjWAMCAkAt2NBIdmsulUWobudQ0K6FBE1cfoSik+dvbhj77GCoiJySXV1FQmJXMKK0glp6uwVSQ9TKCgtK6MWAjfvvZ+Q1KWQhgXMbG1punv/ASdJY9eiYkZNnG/TCGl4wMy09Cyqfz369pO8vAnfL2EhUSbnSS6EZEduIgCAmLN47frNe2XeCnTX7fo5TnaLGiG5A9IVaynx4SNZquAjgR4DQgLAKvT9kB31bp3P22XeCqzZsNNJ5+ufDAv4Pvsx7o/eO6QRjAEhAW8iPdN+9JzIKyiQpe7AFCHJpHWgAVxC4kOZ908Gfz32g7+NknngHGkEY0BIwJtQFx0dOnZalroDnxeSzRu20DP8+d2vsCskeB4S8BeGjJyekpZx4fL1pqYGPnre0d46e+E6m0M5wSHhFHw3bk5tTQ2V/tDZoRXSydMXuAXO8LVJ0+etUi3TfOyURc1NDXV1tdQI5/nMMJWeu3Bt845DXO37uav4qBovmvsbHev3cdExcdbfSA+AndAlrnwhk0YwBoQE+hMWAM2Z23H3Oa+C+wlJGY6LXFPTMmyvjpDa25p5LdWUblHNvxs3l69TuhV7jzP7DofwbwnHTF7Y2PiUV6R+mUvV70v6zt17Ce9/NlLmrcbbHw0fPXGezPsPsFF3QEjAX2AB3Iq9e/f+g2/GzKI4/sFDTs5fupGHOyykIY6fDWqFRKOfQscVt7QYc/suBVk5j4ePtjfC9ZMepuzYeyzs/NWcJ7kTvl/c0dH67ZjZT5/WUenBo3af2RxConnApAV8XZNWSPxjxrq6eoLbNMC8JYF7DgbLvAV5Y9DXM+e/GF/6Gx9+EVBVVSXzgGhsbJRJHdIIxoCQgG+ihkpaps5eIZPO6eM5pA8+D1C/KbE+/jlKiIyK8c83biLSCMaAkABwRh+FRD3d03r7jxa9BT/smv3wLZuONIIxICQA3IjXdXb+9swkv3qzxnDlC5k0gjEgJOBHpGdm53vqB0yMN/Z33rjNxhg0eMTnwybIPNACIQHgFpav3Xb4+BmZdx9e2rl76Wb3irDzEf7wNvsOhASAQbRXfhPXo2/bXl4vd+xkmFZI46Ytsjmu5bM5HnLz3PE7JL7/P7fDQd/PIdX0YfX+wudv33DgSAhsZCLSCMaAkIBPoRMSw5dx7z5wQiskrrbO8Vy1oaNm8OLzZy8epWqWkL4YPvHGTbsUvQ7qr7NzfPaWbrCRuUgjGANCAj4Cq0jd8UHLwmVBnNQdshvi+DGszfHET75L3qwFa78dM5uLuE4fhbRszZbNO/bLvFdAvXZkVIzMezuwUa9w5e9fGsEYEBIAbiQjK/vP734l817BD50dvtd30zsqLbU/ZRy4CIQEgO/g7X26t2+/lti4+9NmL5d54AQICQCr0MdDdjbv79C9ffu1+NJ7sRTSCMaAkABwBoRk84m3YHO8i4KCQpkHfUcawRgQEgDO6LuQ3hj0dXJKqsx7ET5w+wbaftw+1Rh4HhIAvkNU9O13P/lO5r2L9z8b2dzcIPNeAdlo7mL7Q7aAAVz5QiaNYAwICQC34+3DC4bexbOOF7/T8iKOh4Rv3LpP5oGLQEgAWIU+Pg+J8Q0h1dfVet0bef6szeu22WrgeUgAWIW+n0Miduw9IpPeyPipC//ywTC12NHRKutYCrIReVTmgblIIxgDQgLAGaYIifjy20ky6Y28/vL2DYO/HnvgSIis0O/QFnY67kwYdj5i6erNsgIwHWkEY0BIADjjWUebKSdOfOnAEb0XhSztdyy+eV6HK1/IpBGMASEB4Am+HjFlZeB2mfc6Zi9cY+Uen69Qt+zmeSMQEgA+iLf3j5WVldq+3po9/huDvtZt4ZxFa2U14DoQEgBWwaxzSMSCZRs62ltk3rsI3LTbykLS2Sj2zn1ZB5iONIIxICQAnGGikGzeP0hSqB7/xs1YWdqPqA2bvXCNLAVuQhrBGBASAM6AkLqj0/Fwir+8P1QW9Rdtrc20Sd77ACprglsHAeCz+JKTgD/gyhcyaQRjQEgAeBQSkjV/vgNAl0BIAFgFcw/ZMXySQ+bdzeKVWwb88u3p388/um8v0BEUuJF2DtHRbvXbT1gQaQRjQEgAOMMdQrL1x4G7/ILCN98d8rw8DTiHnCT3HnCONIIxICQAnOEmIdk87iTqZ2XnC7rkn3/7vtyBwAnSCMaAkABwhlm3DpKs37x3zcadMu8OgrYd3LJhk+x5QZdgkKTFlS9k0gjGgJAA6Dc+/WrMn9/9SuZNB8OjXhEUuFHuQ78FQgLAXxj48Tdnz12WeXOBkHrF0X175T70WyAkAKyC+84hKT4fNsHd55M8IKS/fz2Or1JjZAUdujradadNmyfrexIIqbdIIxgDQgLAGR4QEkNOct/De1wxRB9hIXFMQVJMxI5N9qvMVfLKmZNqUXpLxjQvTo3VFvEq//aHj1RNNwEh9RZpBGNASAA4w30XNUjISSvWbpX5vuMxIeUlxSxfslIZpang4fZNm8eOm8mLPP/jG5+rRYVOSKVpd3RCGjp84rjxM3hx0fxl2nVNB0LS4soXMmkEY0BIAFgIctKufUdlvo94TEgKTj5+EP3z1wYO/3byc4dIfvHaOw35SVzkXEj1Tx7ohETzm5fOEtr23QSEpAVCAsB/iYyKIS3V1tbKIsO4uwd//uohO4YXTx0+yEIi2oofKZ10WVkb0/xxQrR2UVvfrUBIWiAkAKyCx84h6VixdquJz1DwQG/epZCI2TMX/fHP9mN0P/v1QM5cPxeqSnWVtcn/fuvvuoxu0X1ASL1FGsEYEBIAzugvITGfDRlHWkpNz5BFvcIDnbgvASH1FmkEY0BIADijf4XEJCQ+5PuxtrY0yVJXgJB6BYSkxZW/f2kEY0BIAHgHCQ9eaOnQ0VBZ6hwIqVdASFogJABAt/BxPOJBYrIs7RIIqVdASFogJACsQl1dPSHz/U5ra9Ob7w1hMxHRMXGyjgJC6hUQkpbGxkaZ1CGNYAwICQBnWOEckoucDruk/KR46/0hARPm/u5Pn8pu1/PU5yXKJDNk5HQOZs5Zriu6ffW8rO9WIKTeIo1gDAgJAGd4kZC6JDU949zFq7/5749lt9sXyB8rV62n4HFiDMVZ8fYfDKmiuQtWUXDyyGHWzMy5yyk4tHffU8evYmMizin9xF27wMHD21c5GDd5Ps2pQapTlR1Pc4ZbpvmlMyEUnDt1ghfT70ZRcPbkcbUBfQdC6i3SCMaAkADomntL5p4b9AYhi7wOcw/ZjZ4wV8XxNy4/d6hi/sJVhDKNFvLKhdCTVMQjpJCjR2l+9MABbZ3qnISACXNIbypDFbg1GiFphURiozkJKfL82TET5+3ZuVvbjilASFpc+UImjWAMCAmArklYtVgmvRRzhTRrnv2oWnVOPM1T71x/rjngxkFu0k9eUQwdNYOFdD705POuhDR7/grVzndjZ6nWdEI6cfgQzTPjb9A8+lL44iVrte2YAoSkBUICwNPUpD3k8VBdVqos9XbMFdJzzXE5nZCelaVSvHrVBl1lIuzkcSmk6xfOch0SkkoS8xaumvT9InIYr16ZdZ/mwwPsiyyktWuC+EUjwkMp2LV9l/YV+wiEpAVCAsBDdDS+uIKuu0Nz3n4OiTFdSL4NhNRbpBGMASEBf6Qo8hKPhxryH8tSLRCSHwIh9RZpBGNASMCPqMtO56Czo0WWdgmE5IdASFpc+fuXRjAGhAT8Ah8+P+QKFhGSOtXUHXxGShIabL8wr0uCgrbKZB+BkLRASAAAM3GTkIY5rjIY8vJnQGdOBEeePzt+yoL63Ae7tu9i/Sxdtu654xK7MyeO8dUNtDhqwty1a4Ia85OSbl0NDT42efpibpCFNHz0zKvhp5+VpV4JC6W1aF0W0sLFa+ylATOOHTxIwcqV648fOgQhuRsICYA+0VJRykOi3LBTsrRX4JCdc7Lio0lCxJ6de9QAiIOWokfPHZfPnTxymK+sU0Jizjt+nESBuipPO0Ii/ajKJCSOyXz8crHXzvM1eBCSFZBGMAaEBHwQUlH9474+Q4iBkJxTlR1PQ5nnjh8GsTOmzlzCqrgbeZHmNAyigQ5flt2dkEa9/KWtVkjqh7HkPB4hkYRuXg7n0uoc+00cnkNI1kAawRgQEvAFiqMieEjUWl0hS/sChNQj7SUpCTevcJx+N4qDR7GRump3r1+U6xK1jx/MW2j/SZOiuTCZbwBBPIy9pqvfkP/wUdyLxlNeBuYydepcuQ/9ltbWZpnUIY1gDAgJ+ALn33tLJoEiaNuhzeuDZM/b7yTdujpuyvzD+1+5a0O/Q/6W+9BvceULmTSCMSAk4JVUJd73mRvNeQa3DpJ8idK0uBXrdsgd6LdASAA4w36K6EmmzLsD3zhkx5CTfvNHk2/77UtsXLeRdtEXw6bJXQecI41gDAgJeA31OS9+1upJfElIxM9+PZD6XNAdY6cskTsN9Ig0gjEgJOAFpO7Z2l8H6HxMSAC4A2kEY0BIwAt43trzQ5TdxLOONkLmAfATXPlCJo1gDAgJWJE786fTeChl12ZZBADwJBAS8GtIRTfGfCPzAADPAyEBf6RfThH1CM4hAdAj0gjGgJBA/xPx94/JRs3lJbKo34GQAOgRaQRjQEig/4lfuUgmLQKEBPwcV/7+pRGMASGBHmitKuegywuvZcZ5XlEcdaXHOgCAfgdCAv1GVVL8zfEjI/7+kc1xg7j7y+brPMSxSvI88rsvObg0eBDNH+3YyBW6Uw7l6YVkHgBgNSAk0G9cHzWk5OY1m8MZHQ21JKTqh6+Y48pXn5x//y0qImrSHt5fOo+SHY11NycG2F4VkmzcG8EhOwD+//bu/CuKa9/7+J+SdZ+77v3h3OesJPe559znOc9JTIyJQ5wyaByiJs7zhBpxngec53nCGRUZBARBRUBEUAIiCCLIDIK0ggKCrHW/3Rs2ZX+hqN4FbVP9Weu1au3evbvoEKy3hd3VneJFUIMgwQdESNL276Ay0SDs54HaIL2rqb4zd1r8YvvFvhrrat6/q6MgFUSF0c2YSWPEw9831vMgva0opRlbbpZ2skcwE6T9xwNpG3XL0Lng+6YG7c2G+rd8DYBn4kVQgyCBs4Koa++b6mlQnnxXzLwpK3ZaU5Ga3Pim7eoJZUnxtH1X+8p+U3NgrSl+TtuQgX167gmTTpBqXr9uaL2Ig83Wzh8BESQnpeUV2psVL1p2Xl1t30P5ixfiZmik/VvazEIF4Gb4PCQAT3c3KY22je/s5fbbc462R8+E3k54QIPnhSVijTxD2nPkili269AluZ4cPHlV3qQgvXplL/qNWPsZlQgSfRU6HFS9fCnWA7hfR38h0+JFUIMgQbd4V1NNZ0Whg7/jd1lDbW0NheRqWCydwRw4Ye/K1n3naZt4P132xulXdoXFJXSX8LzQftJJj6WxaJs4Q6Kb5wNvNDuClJH5VCwOj245VQVwPwQJejZKkfh3Jgt49ep1u38gT50PLygq3rb/wuOsXHGiI4K0/cBF+Vs4bZBEpSgt+QXFYiW5HHor73mRuCso/E5KaiaF6rB/MN3ce9R+UkWnVv4XIrRfF8DNXr/u/NLGvAhqECSATiSmuPA5TEdOh/BJAGvjRVCDIEHXiJs/g06MCqKu8bt6usOn7S8jBPBCBl/tyYugBkGCLkApihg5hM9bQ9XLaj4J4A0M/m2MF0ENggRdoLGuhk8CQI9msEbNCBJ4ghvjR/JJq6I/nMWl5XweAHgR1CBIoOLGhFFB/Xq9q/W6/+9pGU/FgPokBF6Lc5pp92ZFZaX2Jl/Q0fpO9y8WdLre1SfgtH+dBU77Dxrwjf4Cp5ud7r/TBe3uny/oaL2R/a8M3NXpelefgLzZ0Q6dbrq6/06fsLzptOD6zfvySxjEi6AGQQIV10f/yCcBmg1c6L0nmnl6NZ8EiRdBDYIELggZ1Kep4S2fBxCaGt5YMkjD9szmkyDxIqhBkMAoOtDcmTedzwNI1TmPLRmkbzaP45Mg8SKoQZDAkPsbVqbu9OPzAN7g85U/8EmQeBHUIEgAAJ34dLll32bXJXgR1CBIoCeoX6+6yg8+LgFAR/yCWc+u2q9objEIkj5eBDUIErTvfVM91ehNecsnKQAYET58cHlSAp/v6RAkfbwIahAkAOgy9JeYhtcWvNISgqSPF0ENggQfeFf7ypKvkgL3iBg5lE9aAIKkjxdBDYIEH6Aa3Z45kc8DeDMESR8vghoECdpQjSpS7vF5AC+HIOnjRVCDIAFAl7Hq73sRJH28CGoQJHgXMvjb5qYGPg/gKgTJO/EiqEGQvB0dQcKHD+LzAAoQJO/Ei6AGQfJqYT8NeN9Uz+cB1Fz7cQCftAAESR8vghoECQCgEwiSPl4ENQiSN7LqZwQAdBMESR8vghoEyRs5Puz1FZ8HMMmqn2qPIOnjRVCDIHkdnBtB93l0eA+ftAAESR8vghoECQC6TMmdGD5pAQiSPl4ENQiSt7g9c1JxbDSfB+gqtcUFTQ1v+HxPV9dQiyDp40VQgyB5hfeN9s+S4PMA0Knc8jwESR8vghoEySugRgDK4p4kfbVpDJ8HiRdBDYLkFV7n5/JJgK4VNW44n7SAC4mhow748HmQeBHUIEgA0DWseiK+IfTAsis7+DxIvAhqECQrC+r/VczksXweoDtYNUjTT608dPMcnweJF0ENgmRZdHTIC73C5wG6Sdz8GXzSAr7ZPO52ZiKfB4kXQQ2CZE01BXnXR//I5wHAVZ8uH/KsPJ/Pg8SLoAZBAgDQQ0FqbKzj8yDxIqhBkCyoqa6WTwJ0N6v+GxLehNQpXgQ1CJLV0EHBlpvF5wG6G4LktXgR1CBIllJT9Nyql1sGD/emtAhB8lq8CGoQJEtpfPuaTwK4QcWDpJQt6/m8BSBIneJFUIMgAQDoQZA6xYugBkGyiIbX1dU5j/k8AJiEIHWKF0ENgmQFTfX2jyRvrKvhdwG4h1X/AakZQTKAF0ENgmQFdCzIDbzI5wHcBkHyZrwIahCknor+/Kft3yHGqbu28AUA7oQgeTNeBDUIUk8V8csQOgQI/F4AN0vetJpPWgOC1CleBDUIUk8Vv3iuDJIQOqQvXwYAZjwte4YgdYoXQQ2C1FOl7vTT1ih54yq+BgBMikyP7bdtAp8HLV4ENQhST5V56oisUendWL4AwJ2s+qvj0/FXxx3+g8+DFi+CGgSppyqOjcY/IIHnSFq3nE9awKKLflsjjvB50OJFUIMg9VQ1BXlB/b/i8wAfRUWyNT/Crv+2iZHpt/n8d1t+55Pt+nT5kI7+FaqjeamuoWdcuZ8XQQ2C1FO9b6znkwAfRV1VRXNTA5+3AGpGTlluu/M1b1/V1duDserq7tPxV2nwpPTpwgubs0pytl8/JlemFdgvofKPdSNom5SbmpKXRoOmxvpLSWF7o/0dD99TW2e/CmXFqwraNrx763tp6/W02/5xgU2OP+bHbgf4hR8We1sTvLfdQH5cvAhqECQAgA51dBJD86XVZTT4bMVQMXPizuX9MWfEuKiqWK6kFH2xYbR4iK32JaHx4+IntM2reP654+FXkiPkeqqa3KE4QxLPgXby+cof5E2PwougBkFqxyd/6QM6+HcMwKo6OvrLIImikFuZdy/fDxdjbZDEGZJ4iJwUj6Ug/efKH2mw8doBederN9Vi4BSkf64f9X9W2Rd39JQ+Il4ENQjSBx5nPaEDbn1BAeigb1FWdg7/7oHXsvCLazo6+ssgifHfVw+jgX6Qmu1nSyP7+P3WrAmSePiBmLNyjU6QxNgDs8SLoAZB+gBqZBDOk0DLC4P0UeyN9qdc3c1JpnFuWR5f8LHwIqhBkNqgRi5Bk0BCkLwcL4IaBKkNguQSBAmknIC23zhZDIJkBC+CGgSpDYLkEgQJvEFHQfrW8T4kce//Xz+SLxD6bm257NC0Uytp63N+k7yroz1Lkem3r6ZcF/86xcmH04BWipeVfyy8CGoQpDYIkksQJPAGHWWD5pta33plHzfWf7lh9NebxuyLPv2p4/UOvTeP/XzFUAoS3Ry4Y7IIEo0DkyO+8RtX9bpSu+dvNo8TNy/eC9W+wEE8hLb/ufJHMfhy46/D985pePdWGyQ5OBV3hQajD/qImx09+S7Hi6AGQWrj5iD9s/dIYdGCdfxeUvRnupGnRHvgk26AIIFQfPtG5Jif+bw1dHRMXxey7/cji8V4m+NtsDwSNCPOkOimDBKdTtU4DphysfaNrvefpcrxFxtGU+TEe2ab7Sdb42m79PIOcVM/SPTlxHue5DtquxUvghoEqY2Ro38Xoi83cvRsQoPP/t8P7S64ERjG5/ky2lZmZbv/+fPvIbhT+qHdL9If6FxaN27hLD6pLy/EfkRzSfLGVWkHdvJ5C3jf1NBRkJpbS7A2eB9tv2x966v2roi0WzxIiTkpzZozHnLj0R25z6dlz+RYEplZdNFP3KRzL+0Tk4MdkcfFBSP+vmbYzNMtH09VWFnEd9jleBHUIEht3H9Adxp/0vrO03/9a9+hP00VY+28/6Ezfut2yQfKe+9H3RILDuw4zL9QN/kEQXIv8Uo2+Xq2m1N+E0GS89qXut2eOZFuUpDurV5C4ztzpxVEhcmHN9W/SVq7LHzYIHm9n6D+X4X9NOBdrY2CVFP0/NY0+1/GC2OuX/txQNTYYe/f1QV/3zt1Z8sB0Qntkx7C5y0gJS/tv1b9xOfbFZMRL670U1xVQtvEpw/4GuHm43jaNjbWaR+rvcndyrxL2/qGN3FPksQMnX7xZSS9sOVtT9S2kpf2Z+IGvAhqEKQ22kK4gfbLybTwm7V5eetWbhM3SbtBqscZkhdI2bKetk8vnZPX1RZBivOZ1dTwpuFVFaHJ7Av+75vqH5881Ow4QxKPSm89gymJv5VxdL/9rvkz7Hu7fL7ZcV1EeggN3tVUU5BEtEIGfhM+fPC9Vb7NjuTQzqlqYidOXqTZ3xZjSefuBv96cAGfBye8CGoQpDbuP6A7jWl78qC/ICfLMzJpsGXDHgQJoifYfy8kTl+aNUESN5sa2v7KbD/7cQQpZJD9f1PwgK/lw8Vd99YsbXbkTaynkyHaZvoflUGipImB/VxquP0hIQO97v+4z/lN2sukQkd4EdQgSG3cf0Bf5LOW0GD4iJli5lnyw7TYu9rSbFizQ94kd0KjaEv5+WfvkQgSSC/SUuj8RjvzrrblT2VhdMv1bHTQGVJNYb68WXQzUgwqUu6JQdm9OP4oyxu0c2pYagyfBye8CGoQpDbuP6AL06YvFTOptxPETEb8PbFAu3LG9KVi5rN//ECDwtSW1+Bpl+HfkMD9rH2ZhnY/ewKc8CKoQZDauDlIPR2CBIK1g/Teop/z1LV4EdQgSG0QJJcgSECqszMs/MnFOq/5Bi1eBDUIUhsEySUIEpCmutoXD+/zeWtAkAziRVCDILVBkFyCIIHlIUgG8SKoQZDaIEguQZCARIyw8iEbQTKIF0ENgtSmC4Pkf+zsnp0tL3grSE3jC4wYNX6+9ubL7By+pu75czGYMqvlpXpOnHaiJR+rBkGCZku/oqEZQTKMF0ENgtTGfJDyH/4pjvLtBintzl0xKEp7pH2Idg/ZSSlyK+WmPKxvTcuLzCzb06fyLvpyZRmZ9a1B0kYr5/4D+SjtDHmbn08QJDAPQYJmBKk7mA8SeXg7oZ4F6U1+vkgF5eFu5E0xeJaSKpKwes12sTL8ciht//DdQNuyR49pzUX/AHFX6KUQkZaXOfYayZbIxsgzJMoVfbnavHwab9ywix41YbovjcdMXEDbuIhosUy7EzUIEjQjSODAi6AGQWpjMkihF4NoK3rjFKSqrCcUiXpHh0RXRJDEgqXL/cQg+14ybXdsO1jvOIvSBunquUDtuU50cIQY8CCVpGfUt8aG2kaPOn7wFI3HT11M22LHvQKCBKAPQTKIF0ENgtTGZJDqHZmpzHpSz4JE2+lzltO9dH5zP+aOiISrQVr4x3rKj0yakBqbMHqCT31rkOgu36WbaDBt9jJZPrHNSrxP2107Domb4yYtRJAA9H22YiifBI4XQQ2C1MZ8kLwKggSpu7Zk+R/l85Yx4dgSPgkcL4IaBKkNguSSv33aJ6hfr9szJ8rP1AFvE/bzwLKkeD5vGVsjjvBJ4HgR1CBIbRAkl4gzpIyj+639z9qgw/L/63Gpb4N4EdQgSG0QJJfwX9kF9/+ajlCJKxbx7y1YkrWDVFv3Orc8j88Dx4ugBkFqgyC5hAdJEh8zSopuRfF7AXoE8UHjYAQvghoEqQ2C5BKdIEkhA7+hv0SLDyoF6Fn2x5zhk9AuXgQ1CFIbBMklRoIkvX9XR9tnIZedPtUUejTxyehW9duRP/gktIsXQQ2C1ObR46x//6w/P/ICR9+ozCc5/HuoL3nTGjphIt75edjWY+1/Q/rvNcP5JLSLF0ENgvSBL7779W9f/MyPv6D1f3sN/0efUfy7Z5yFP9LNq8QtmsMnLQOXaTCOF0ENguRsw9aDn/ylz5zZK04e9Acn9G2hb87azfv4900N/RU7+4I/n4ce4VnwJT5pGQiScbwIahAk+MjqXlZQluJ8ZvG7AD4iBMk4XgQ1CBIAQDsQJON4EdQgSOBZIscOoxOm++tX8LvAowR/35tPWgmCZBwvghoECTxR1NhhfBI8irVfYteMILmCF0ENggQezfJHvZ7L8v9rECTjeBHUIEjg0WpLi+jAF794Lr8LPi4ECSReBDUIEvQAjW9e80mAboUgGceLoAZBgp6E/lZue/aEzwN0rQpbBYJkHC+CGgQJepi0AzspS++b6vld4Dav8nKs/Su70Ic3Bu+cyuehXbwIahAk6HlqCvP5JLhTlv/RhKU+fN4ytoQfWXTRj89Du3gR1CBI0IPFzp7CJ8ENbk75LT/sKp+3jPHHfE/EWvnCSF2LF0ENggQ92Lua6qB+vV7n5/K7oFvRt73hVRWft4x/rBuZ+PQBn4d28SKoQZCgx4tbiOvgQRf7dPmQpkb8O6VRvAhqECQAAGd4iZ1LeBHUIEhgHeLT//g8dDnLf58RJJfwIqhBkMBqLH+s9ASW/yYjSC7hRVCDIAGAyxAk0OJFUIMgAYDLQgb24ZNWgiC5hBdBDYIElkV/i298i4vggQoEySW8CGoQJLAyalLUb7/weQB9CJJLeBHUIEgA4JrC6Ag+aTEIkkt4EdQgSOAVLP+P8O4Ut2gOn7QYBMklvAhqECTwCnELZ6FJXcUbvpN/W/0zn4SO8CKoQZDAW9Df6xN85/N5cJU3BGn0QStfy7zL8SKoQZAAAJyturqbT0JHeBHUIEhgCP2luPRuLJ8XFC5vmhdyhU+6R0VqMp8E0Ap+EMUnoSO8CGoQJHBWHBtN2+wL/rRtqn/zrtb+PzfvWqB4/XRNQV7RrUi5uKnhzZ97t4kgJW9aUxAZWpFyTz6ctiR585qmulr5kPjFc+07dARJjEn6od3i4wxob5UZqXJxdwj7aUDI4G/5PBhk+V/ZNTbWZZZk83noCC+CGgQJ2lFbWvT00jntDB2D4nxmUX4oG6Q8KUHE5vHJQ83sJQMvHt4vib9FgzflJWJebN831ocPG9Ts+BwjCpKYpM41vn19b5UvjSuSE8X+u/sTyjOO7Y9bNJvPgxGWD9LD/HQ+CTp4EdQgSNCO6AmjaZsTcFbOtAbpbXNTA91seF0t5v/ct62ZBSl0SF/aPo8IEQ+UW8oMnZ3Q4NHhPTJIIQO/of7RIGby2BcPk+ROuluK31o+CUZYPkiBydZ/o1XX4kVQgyBBOyJ//an5w+MOjcuT79Lgxu8jQgd/J+fTD+6yt8rxKzsahP08kAZxPjPlw7VbUvnooRhTkN7VvqLxq7wcsSB2zlQxEF8dPNPLJxlB/b/i81ay/foxPgk6eBHUIEjg1Sz/l31QMPvMOj4JOngR1CBI4NXkbw4BpG+3/M4nQQcvghoECbxdxIgh4qUWYAT1+01ZMZ+3Elw3yFW8CGoQJABwgTecUCJIruJFUIMgAYALECTgeBHUIEgALbzhUKuMvjlOYmdP4ct6NOoQx5cBx4ugBkECaHHtxwE3p4zj80BK4m46BSnedx5f1qP13jzWqUYva+xXD4FO8SKoQZAA2gQP+JpPguAUJL7AAj5bMRSnRwp4EdQgSABgiOVr1Gy/mEiDrFFxVQlfAO3iRVCDIAE4K4y5ziehubVJwd/35ndZxt9XD6MaDd01nd8FHeFFUIMgATijY+7DHZv4PFj79EjCL+tcxYugBkECcCYvuAdO7q3yjZk0ls9bDILkKl4ENQgSQDsqUpPRJK/V1Ni9n35iPbwIahAkgC5WXl6em5cHINDPA/8hsRheBDUIEkCXGTV+/rR5KxMSEtPS0wAE+nmgH4yk5If8B8YyeBHUIEgAHarKTHt0eA+fb9fBo6dtL8sB2vWyspSyxH9srIEXQQ2CBKAnqF+vtxWlfN4JHWv4MQjAiVWbxIugBkEC0NPU8MbI22527TvOjz4ATnbuteZn0fIiqEGQAMwqLy9PSEjkRx8AJ/Hxd/nPjwXwIqhBkADMys3LS0tP40cfACf0c8J/fiyAF0ENggTQubiFsyJGdPhmSQQJDEKQ9CFIAIbY3yfb1MDnmxEkMAxB0ocgARjV0bUbvC1I//ZZv0/+0kcQM3KgwMxjexwESR+CBGCWVwUpPT1N2yExljO/jJ3bq9+Y/LxccXPbrsMDf54iH+uzZOPCZZvkzeFj5tyIuYUgWQAvghoECcAsrwrSf3/9C0+ImPn3zwf8x98Hz5y/mm5mZT6mMtFg/2F/ce/E6Uv+11+/+5f//a1sGN38t8/6871ZGIKkD0ECcEF1dsbjEwedJr0qSP/61748IU7nSeLMSbRn2ertcjIiMprQ4GpwmHax094sDEHShyABuCaoX6+mutqCqGs0qC0tavayIIWFR2pbQn0SA7kVAzleu2kPjYNDI7ThuXw1FEGyEl4ENQgSgGvqKivkJ3nnh11t9rIg2Vp7o62OGHzVfywNxG/hKiuKxWDyzKX2my9KVm3YpX0U34k3QJD0IUgALsg4ul/WiMT5zGr2viCBMgRJH4IEYFTa/h3aGgnNCBIYhiDpQ5AAXIMggTIESR+CBOCyO/OmI0igAEHShyABKAod2hdBApcgSPoQJAB1jW9eNyNIYBiCpA9BAjALQVIwdc5yPml5CJI+BAnALO8M0snTF0nkjZjjpy6MmbiAZtZs3E1bH98Np89d9l3pt27z3uqqshnzV40aP3/MpIU79h6le8dNWRR6LcKGIFkLL4IaBAnALO8MkkCxCQ2LJDQOuBxic1yFgbZzFq6lbVxcggiSXF9Q8OzI8bMUKgTJSngR1CBIAGZ5eZDkOCg0nLbXo6JpO993va29IL2sLKUtgmQxvAhqECQAs7w2SHS6Q9ubt+6IzBjx4EEK1Sgj4xG/yxsgSPoQJACzvDZI4CoESR+CBGAWggQGIUj6ECQAsxAkMAhB0ocgAZiFIIFBCJI+BAnALAQJDEKQ9CFIAGYhSGAQgqQPQQIwC0ECgxAkfQgSgFkIEhiEIOlDkADMQpDAIARJH4IEYJbbglRUmE/4vBnG91lRViTHWZmP+QJl+k/A+DPULnuen8sX6Kx3DwRJH4IEYJbbghQfn0DbXfuOVleV8XvVjJ9qv1D3s9xs/7MB/N6OfPHdL3xyy44DfNLJ+YuX+SSJjr7JJ4Vr4fYrt548fYHfpWPNhh180km7/xXdCkHShyABmOXmICXdT6Ig9eo7Yr3f7j4Dx9jsn/uwQxxbl6/dunCJ/aqmPr5rg4KvDfhp/Mate77/efzUOUuqXpTQQ86et/dA2x4RJDFZWVFy9MRZ2lVFefEfyzYOHTGFGrPAdx3t6usBo3buO0LLvuw74tDRU/JQPnrC3EuBwV869ix3RffOmr9i0LCJO/ceDg4JoydAT4Oeks1+FfBVtHMalJcVipXT5y6jre+Kjbv2Hha7deqECFL2k0za9h4wir4QPZn9h07S/sXKPoPG0FehPYibI36bNeSXyTJIg4ZN2nfwxJETZ2k8aeZiWkwDenr0fGj9hUuBdPP0ORdibAaCpA9BAjDLzUFa77fH5jhqC2I8brIPDX4aNVXMDPx5gs1x2KUSiMdeCQrx277P6Vhvaw1Sfl5O7J04uU/RDLFnOmRTAGggghQaZv80I7mf/YdP0JgO9DbNGZJ8VjZHA9Zv3kXj2QtW2hxnSGLnpSXPtSvFGRJVisKZk50l9iOIIFFUxEqBgiQXiJnejieZl/dUTMogyYeIsejiqTMXxE3avqgooaDKvXUrBEkfggRglpuDRPGg7U+jp9kcZwzirq9bB0SewdBWGyRxFA4JDX+a80Qulqc1h475L13tR4N1m3aJZuQ+fdL7+9FyVyJI4gxDTMpB3yHjaLt52z7tpNhSkGgnttYnL07RyIx5y7Qro2NuiflBjpTeio0VN22tQRIXFB/w4+82x5ejIJWVFNBW/reIIIkxPX9tkGhLZ4fi6f06cZ7twyDRPosK87VfsfsgSPoQJACz3BYkt5FnSO4nIjF/8Rp+l5b2DMkk8RXFrzq7G4KkD0ECMMt6QTL++UZd68z5S3yyXckpyXzS8yFI+hAkALOsFyToJgiSPgQJwCwECQxCkPQhSABmWSNIlRUlRYX5L9t7h1NHbzKlhzjNyLeaioH2vbT6uvadth4LQdKHIAGYZY0ghV+3v5jNpnkFnRAcEsYXCzdv3RavQZemzPYVg/4//GZjuxo6YrLTHiSnlVaFIOlDkADMsliQxHkPbauryqgTV4NC6eY3A3+1Od54GxIabmutFA8SiYyKli8lp0d9O3gsDcSJFwUp4HIQ7Vm8GUjo1W+kzRGke/cS5av7+gwcQ8Iirm/ffUjs0+mr9FAIkj4ECcAsiwXpfnJy3rOcL1rfTyqCNHzMzOFjZixevkEEKTDYPtlukORbl6hn95PvOwVJ7tbmiNDoCXOvBIWI8Q8jp4g9XI+6QZUaOW7Wl31HWOzMCUHShyABmGWxIGkbIIO0c9+Rl5WlFCTx/tbvBtvfCSuDlPIgRfsQcf7Uy3H5A22QBg+ftGGLff2OPfbzHkG8bZYeFXAlSF6jj3aYn587brLPoWP+cqUFIEj6ECQAs6wRJCfJKcmZmY/kzXzH6xpSUx/S9l5SknaluHKEESVF9lc60BmY03xYxHUxSE//02nnFoMg6UOQAMyyZJCgOyBI+hAkALMQJDAIQdKHIAGYhSCBQQiSPgQJwCwECQxCkPQhSABmIUhgEIKkD0ECMAtBAoMQJH0IEoBZCBIYhCDpQ5AAzEKQwCAESR+CBGCWhwdp1Pj5tK3q+DP3Ll4K5pNG7D9yWux2yaqt/N52yZWhYS0XhtAXHBoxb9E6Pu+SsZNbrq330SFI+hAkALM8J0iiPWIbcDmEBqs37Jw4w5cG8q7MzAy5fu3G3WMmLhBBorsmzVr6JDvTaT++K/02bzvA9z/fd/2xk+fFnikztF22ZrtYlnjv3vWo6HFT/qDxyvU7xk1e+KK8WLuyuqrsuuN6qWIyOztLjNM138bRE3woeBQk3xV+4l4a0+DBgxTt01iycsvdxMQLl4KKi57TzPR5K2hy3ea94t7KilIaIEjdjRdBDYIEYJbnBOn3qYtpe/rcZXFTe+BOTm45js9asFquLy0psDnOkMRdwsGjpzds2UuDhIREMUNJE4N9h07R9nxAIG2rXpRQMMR1gMR5jzZItE1x3PXCcQFvuX/Rhnl/rBNnSPIZikFO9hOx7EXrJy2JMyT/s5dfVpY+cnyTRTK37zmiDRLVUaynM7bcp9liLHer/a/7uBAkfQgSgFmeE6SQsOvFhfkvW387x4OkPUaL47uNBYlOTehMhXojZ2bMXyUG5aWFYhAXf9fm+JWdNkhrN7Vc+VsESe7fpknC0lVbxA7bDZIk9m/T/Mpu3JRF8kSNLFi6URukw8fP0pjO9mjZ1eAw+V8q1sigfnQIkj4ECcAszwmS7cMIabdUi227j0TduDlu8kK5mMYRkdEUpIuXgiJvxCxcupEmj548Jx8lyCA57ZOC9ORJZsCVEJ0gTZixZMPWfZscLQkMuiZW8iCt89sTcDlk8qyl8gudvXCFlokgJdxNvBF9Uyym5NDY5jhJCgmN0AbpVuwdEa1pc1eEX79x5vyVP5ZvvhMXP2E6gtS9eBHUIEgAZnlUkHooOi2j7dxFbR/cZ0kIkj4ECcAsBAkMQpD0IUgAZiFIYBCCpA9BAjDL04L0NKfltWpdIjrmVnGh/YP1jCstKdC+JkLKz7N/yp+t42co/vFJH+1ZfrBsRyrKivikJ0CQ9CFIAGZ5WpCcXrFmxh/LN9O24Hnu5av2DzI3aPq8FfGtL5PTWuTYm62DZ7ht9xE+ybX72J4CQdKHIAGY5SFB+n3qYvEKaTpkHzt1Qbw07uLl4KlzltscL047HxB483bsmIkLykoKzpy/Mn9xy3t3Uv9MPXvB/oI0sSww6JqYr6q0v6tU7n/CdN+oGy0vdZs2d8WpMwE2+0vdjoqXWdM+123eI+6VQaKb8xbbn9LlwJD9h09NmLFE7IrmT54OkC+xoydDA1p58vTFdX57IqNipsxeduzkefFKB1qwcNkm8cDCgjy6qb3qBP1XnA+4Kna1e/9x+q8Tz+rIiXOTZi4R879PW7xi3XZPKBmCpA9BAjDLQ4K0Y+9ReQQX2517j4m7jp48R2cndC9Nije3jp/uKxaTvGc5NL99j/0EZde+4/LAXV1VJseUCjrc0805C9teCCfyIMajNO/7EUFKuJsoZ8R22ZptcrEYvKgoEWsOHz+7bddhmpk2byVtqR8UJBo8TE0VC2jG6bGC+C0fJW3bbvvDBREkW+t7eNt94EeBIOlDkADM8pAg3Uu6T9uszMeyAeKSPDnZTyorSumsIuZW7BHH+3VO+F/QPlCsD7gSQtu4uATa/pn2p7jLx3eDzfH+noyMR+Md7+bRHtZlkOYuWisu07DecYkHeYZ0I/qm+PcebZbkYM+BEzb7pYAe0Db3abYIklwpgmRzvDeWdnInLl77WJopeG7/FykZpCdZ9is40OmajQWJnqd84MeFIOlDkADM8pAggb6NW/fzSTdDkPQhSABmIUge7mpI+PmAq3ze/RAkfQgSgFkIEhiEIOlDkADMQpDAIARJH4IEYBaCBAYhSPoQJACzECQwCEHShyABmIUggUEIkj4ECcAsBAkMQpD0IUgAZiFIYBCCpA9BAjCr8V1dcGgEP/oAOAkMDuM/PxbAi6AGQQLoAp5wWRrwfPRzwn94LIAXQQ2CBNAFkpIfvtRcghqAoxrdT0nlPzwWwIugBkEC6BrnAoLpiIMsAZdwN3H0BB/+M2MZvAhqECSArnTc8TE/AFp/pmXwHxUr4UVQgyABAIApvAhqECQAADCFF0ENggQAAKbwIqhBkAAAwBReBDUIEgAAmMKLoAZBAgAAU3gR1CBIAABgCi+CGgQJAABM4UVQgyABAIApvAhqECQAADCFF0ENggQAAKbwIqhBkAAAwBReBDUIEgAAmMKLoAZBAgAAU3gR1CBIAABgCi+CGgQJAABM4UVQgyABAIApvAhqECQAADCFF0ENggQAAKbwIqjpsiCVlzzlzxIAAKyNDv68CGq6LEjZjxL4EwUAAGujgz8vgpouCxLJybjLnysAAFgVHfZ5C5R1ZZAaHOdJ+N0dAIDl0aG+C8+NhC4OEgAAgBoECQAAPAKCBAAAHgFBAgAAj4AgAQCAR0CQAADAIyBIAADgERAkAADwCAgSAAB4BAQJAAA8AoIEAAAeAUECAACPgCABAIBHQJAAAE2TA/AAAABDSURBVMAjIEgAAOARECQAAPAICBIAAHgEBAkAADwCggQAAB4BQQIAAI+AIAEAgEdAkAAAwCMgSAAA4BEQJAAA8Aj/A+mHozWriQx1AAAAAElFTkSuQmCC>
