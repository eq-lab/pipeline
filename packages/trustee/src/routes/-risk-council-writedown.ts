/**
 * View-model + data wiring for the Trustee Risk Council — Write-down close
 * (Default resolution) page (`risk-council.writedown.$id.tsx`). Per
 * `docs/FRONTEND.md` rule 2 the `.tsx` route is JSX/styling only; this hook
 * owns the live fetch + value→display mapping (mirrors
 * `-risk-council-reterm.ts`).
 *
 * spec: docs/frontend/trustee-flows.md#write-down-close--default-resolution-flow-12--read-only-no-action
 * (flow, real-vs-mock data sourcing).
 */
import { useLoanBook } from "@/api/useLoanBook";
import { formatFullUsd } from "@/utils/formatUsd";
import { toUserError } from "@/utils/userError";

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
  errorDetails: string | null;
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

  const loanBookError = loanBook.error
    ? toUserError(loanBook.error, "Failed to load the loan.")
    : null;

  return {
    state,
    errorMessage: loanBookError?.message ?? null,
    errorDetails: loanBookError?.details ?? null,
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
