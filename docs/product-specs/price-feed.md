# Price Feed & Notifications

## Overview

The relayer service runs a continuous price feed and notification subsystem that monitors every active loan in the LoanRegistry in real time. It computes per-loan collateral coverage ratios (CCR) against external commodity reference prices and dispatches notifications to relevant parties on threshold crossings and operational events.

## Price Feed

**Sources.** Platts (S&P Global) and Argus (LSEG) reference prices for each financed commodity, consumed via licensed data subscription. Prices are consumed off-chain; they are not published to any on-chain oracle.

**Polling cadence.** Every 15 minutes during market hours; less frequently overnight. The cadence is a configurable parameter.

**Per-loan collateral valuation.** For each active loan, the system computes current collateral value using:
- The commodity reference price from the feed.
- The current collateral quantity from the trustee feed (original quantity minus any delivered portions tracked off-chain).
- The commodity-specific haircut schedule defined in the credit framework.
- The loan's current outstanding senior principal.

## CCR Computation

CCR = `collateral_value / outstanding_senior_principal`, expressed in basis points (e.g., 14000 = 140%).

CCR is recomputed on every price feed tick. LoanRegistry `lastReportedCCR` updates are batched and written only on threshold crossings, not on every tick, to avoid on-chain spam.

## Notification Events

| Event | Trigger | Recipients |
|---|---|---|
| Watchlist | CCR < 130% (amber) | Team, Originator, Trustee |
| Maintenance margin call | CCR < 120% | Team, Originator, Borrower (via Originator), Trustee |
| Margin call | CCR < 110% (red) | Team, Originator, Borrower (via Originator), Trustee |
| Payment delay (amber) | Scheduled repayment > 7 days late | Team, Originator, Trustee |
| Payment delay (red) | Scheduled repayment > 21 days late | Team, Originator, Trustee |
| AIS blackout | Vessel tracking loss > 12 hours | Team, Originator, Trustee |
| CMA discrepancy | Reported collateral quantity differs from CMA by > 3% | Team, Originator, Trustee |
| Status transition | Any change to LoanRegistry mutable status field | Team, Originator, Trustee |

Borrower notifications for margin-call events are delivered through the Originator as the commercial intermediary; the protocol does not contact the borrower directly.

## Delivery Channels

Each recipient receives notifications via:
- **In-app banner** — inside the Operations Console (Trustee / Team) or Originator UI.
- **Email** — to the address bound to the operator account.
- **Optional webhook** — Telegram or Slack webhook, configurable per recipient.

The notification feed in the Originator UI is a chronological log filterable by event type. Marking a notification as read or acknowledged does not change any on-chain state.

## LoanRegistry Updates on Threshold Crossings

When a CCR computation crosses a defined threshold, the relayer service notifies the trustee
via the Operations Console. The trustee writes the updated `lastReportedCCR` and
`lastReportedCCRTimestamp` on LoanRegistry directly from the Trustee key (holder of the
`TRUSTEE` role); Relayer has no write access to LoanRegistry. Updates are batched per
threshold crossing event; the LoanRegistry is not updated on every price tick. Because
LoanRegistry is informational — not a NAV input — these writes do not move sPLUSD share
price.

## Threshold Configuration

CCR thresholds and notification rules are configurable at two levels:

- **Protocol-wide defaults** — set by the foundation multisig and apply to all loans unless overridden.
- **Per-loan overrides** — set by the Trustee (holder of the `TRUSTEE` role on LoanRegistry) for loan-specific adjustments.

## Event History

All notification events are appended to the real-time event log visible in Protocol Dashboard Panel B. This log provides a full chronological audit trail of loan lifecycle events — watchlist triggers, margin calls, payment delays, AIS blackouts, CMA discrepancies, and status transitions — per loan.
