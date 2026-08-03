/**
 * View-model for the Cash Management Withdrawal Queue tab (#945) — keeps the
 * `.tsx` JSX-only (FRONTEND.md rule 2). Total-claimable / requests are served;
 * the wallet balance is unserved (`"—"`), so the top-up alert is never fabricated.
 *
 * spec: docs/frontend/trustee-flows.md#cash-management--withdrawal-queue.
 */
import { useWithdrawalQueue } from "@/api/useWithdrawalQueue";
import { formatFullUsd } from "@/utils/formatUsd";

export type WithdrawalQueueState = "loading" | "error" | "ready";

export interface WithdrawalQueueView {
  state: WithdrawalQueueState;
  errorMessage: string | null;
  walletBalanceDisplay: string;
  totalClaimableDisplay: string;
  requestsDisplay: string;
  /** Always `false` until the wallet balance is served — never a fabricated alert. */
  needsTopUp: boolean;
}

export function useWithdrawalQueueView(): WithdrawalQueueView {
  const { data, isLoading, error } = useWithdrawalQueue();

  const state: WithdrawalQueueState = error
    ? "error"
    : isLoading && data == null
      ? "loading"
      : "ready";

  return {
    state,
    errorMessage: error?.message ?? null,
    walletBalanceDisplay: "—",
    totalClaimableDisplay: formatFullUsd(data?.summary.in_queue_usd),
    requestsDisplay:
      data?.summary.requests_count != null
        ? String(data.summary.requests_count)
        : "—",
    needsTopUp: false,
  };
}
