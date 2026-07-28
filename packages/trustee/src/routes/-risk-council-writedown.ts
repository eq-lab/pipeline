/**
 * View-model + data wiring for the Trustee **Risk Council — Write-down close
 * (Default resolution)** page (`risk-council.writedown.$id.tsx`, issue #782,
 * Figma node `4116-13625`). Per `docs/FRONTEND.md` rule 2 the `.tsx` route is
 * JSX/styling only; this hook owns the live fetch + value→display mapping
 * (mirrors `-risk-council-reterm.ts`).
 *
 * ## Flow (spec `docs/product-specs/trustee-dashboard.md` §"Type 3", flow 12)
 * Write-down close is a RISK_COUNCIL `closeLoan(reason: OtherWriteDown)`
 * proposal. Like flow 11 (and unlike flow 10) it is a **read-only REVIEW**
 * screen — the Trustee has NO close button on this flow ("PLUSD backing impact
 * and audit trail are shown before execution"). Execution stays with the Risk
 * Council Safe after the timelock, GUARDIAN-cancelable.
 *
 * ## Real vs. mock (data-sourcing convention)
 * **Real** — the loan's resolution ledger identity, per-loan:
 *   - Loan (originator — commodity) and Principal outstanding
 *     (`senior_outstanding`, served display-scale as-is, #906) — the matching
 *     `useLoanBook` entry.
 *
 * **Mock** — the write-down resolution + the Safe voting layer. Nothing serves
 * a recovery-received figure, a pending `closeLoan` proposal, its `loanId`
 * string / recoveryAmount / writeDown, per-signer voting status, or the queue
 * timelock. `RiskCouncilSafe.propose(closeLoan)` is RISK_COUNCIL-only, not
 * Trustee-callable. Static Figma literals until that infra lands — the same
 * convention as flows 10/11's proposal sections.
 */
import { useLoanBook } from "@/api/useLoanBook";
import { formatFullUsd } from "@/utils/formatUsd";

// ── Mock constants (see module doc — no recovery / Safe / signer backend) ────

/** MOCK — no proposal timestamp is served. */
export const MOCK_PROPOSAL_TIMESTAMP = "21 Jun 2026, 14:32 UTC";

/** MOCK — queue timelock; no Safe/queue backend exists. */
export const MOCK_QUEUE_STATUS = "queued · 18h remaining";

/** MOCK — no recovery-received figure is served anywhere. */
export const MOCK_RECOVERY_RECEIVED = "$2,640,000";

/** MOCK — the write-down (principal − recovery); recovery is unserved, so this is a literal too. */
export const MOCK_WRITE_DOWN_AMOUNT = "$560,000";

/** MOCK — the `closeLoan` payload; no backend serves a pending proposal. */
export const MOCK_CLOSE_PAYLOAD = {
  loanId: "DELTA-COFFEE-04",
  reason: "OtherWriteDown",
  recoveryAmount: "2,640,000",
  writeDown: "560,000",
} as const;

export interface SignerStatus {
  name: string;
  /** `true` = signed (green), `false` = pending (muted). */
  signed: boolean;
}

/** MOCK — per-signer 3-of-5 Safe voting status; no signer/voting feed exists. */
export const MOCK_SIGNERS: SignerStatus[] = [
  { name: "Risk Council signer 1", signed: true },
  { name: "Risk Council signer 2", signed: true },
  { name: "Risk Council signer 3", signed: false },
];

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** `"Delta Commodities — Coffee"` — originator + commodity; `—` for missing parts. */
export function formatLoanLabel(
  originator: string | null | undefined,
  commodity: string | null | undefined,
): string {
  return `${originator ?? "—"} — ${commodity ?? "—"}`;
}

// ── View types ──────────────────────────────────────────────────────────────

export type ClosePayload = typeof MOCK_CLOSE_PAYLOAD;

export interface RiskCouncilWritedownView {
  state: "loading" | "error" | "not-found" | "ready";
  errorMessage: string | null;
  loanId: string;
  /** MOCK — see module doc. */
  timestamp: string;
  /** MOCK — see module doc. */
  queueStatus: string;
  loan: string;
  /** REAL — `senior_outstanding`, as-is (#906). */
  principalOutstanding: string;
  /** MOCK — see module doc. */
  recoveryReceived: string;
  /** MOCK — see module doc. */
  writeDownAmount: string;
  /** MOCK — see module doc. */
  closePayload: ClosePayload;
  /** MOCK — see module doc. */
  signers: SignerStatus[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the matching loan-book row (identity + principal outstanding) for
 * `loanId`, composed with the still-mock write-down resolution + Safe voting
 * sections. Read-only — no close/submit action on this flow.
 */
export function useRiskCouncilWritedown(
  loanId: string,
): RiskCouncilWritedownView {
  const loanBook = useLoanBook();
  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  const state: RiskCouncilWritedownView["state"] = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : entry == null
        ? "not-found"
        : "ready";

  return {
    state,
    errorMessage: loanBook.error?.message ?? null,
    loanId,
    timestamp: MOCK_PROPOSAL_TIMESTAMP,
    queueStatus: MOCK_QUEUE_STATUS,
    loan: formatLoanLabel(entry?.originator, entry?.commodity),
    principalOutstanding: formatFullUsd(entry?.senior_outstanding),
    recoveryReceived: MOCK_RECOVERY_RECEIVED,
    writeDownAmount: MOCK_WRITE_DOWN_AMOUNT,
    closePayload: MOCK_CLOSE_PAYLOAD,
    signers: MOCK_SIGNERS,
  };
}
