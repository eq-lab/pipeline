/**
 * View-model for the Cash Management **Withdrawal Queue** tab (#945). Behavior
 * from the working doc (`Cash management.md` §Withdrawal queue); per
 * `docs/FRONTEND.md` rule 2 the `.tsx` is JSX/styling only and this hook owns
 * the wiring.
 *
 * Doc wants: the WithdrawalQueue **wallet balance**, the **total claimable**
 * (`totalClaimable`), and a **top-up alert** when `balance < totalClaimable +
 * reserve`. Of these, `GET /v1/withdrawal-queue` serves the queue total
 * (`in_queue_usd`) and request count — but NOT the wallet's on-chain USDC
 * balance. So:
 *   - total claimable / requests → served, shown.
 *   - wallet balance → no served source → `"—"`.
 *   - top-up alert → needs the wallet balance to compare, which is not served,
 *     so it is never shown (an alert is never fabricated from missing data).
 *
 * The top-up transfer itself is a Capital-Wallet MPC action (3-of-5, Type 2,
 * flow 9, #781) with no backend path yet — the dialog is a disabled shell.
 */
import { useWithdrawalQueue } from "@/api/useWithdrawalQueue";
import { formatFullUsd } from "@/utils/formatUsd";

export type WithdrawalQueueState = "loading" | "error" | "ready";

export interface WithdrawalQueueView {
  state: WithdrawalQueueState;
  errorMessage: string | null;
  /** WithdrawalQueue wallet USDC balance — no served source yet → `"—"`. */
  walletBalanceDisplay: string;
  /** Total claimable in the queue (`in_queue_usd`), full USD, or `"—"`. */
  totalClaimableDisplay: string;
  /** Number of withdrawal requests, or `"—"`. */
  requestsDisplay: string;
  /**
   * Whether to surface the top-up alert. Always `false` until the wallet
   * balance is served — the alert compares balance against claimable + reserve,
   * and that comparison is never fabricated from missing data.
   */
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
