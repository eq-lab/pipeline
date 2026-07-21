/**
 * Payment-waterfall preview for the Record-coupon flow (issue #882):
 * `GET /v1/loan-book/{loan_id}/waterfall`. Given an incoming offtaker payment,
 * the backend computes the carve-outs the trustee records with `record_payment`
 * (senior principal returned, net senior coupon → vault, and the mgmt / perf /
 * OET fees). Read-only preview; the on-chain write is `useRecordPayment`.
 *
 * Mirrors `useLoanFinancials` / `useLoanCcrHistory`: Stellar-scoped (`chain_id`
 * from ENV), `apiFetch` REST call, hand-mirrored DTO (TD-42). `amount` and the
 * response fields are raw on-chain base-unit integer strings. Route presenters
 * convert operator-entered USD to raw units before calling this hook and divide
 * response fields by the configured decimals for display. The query stays
 * disabled until a positive raw amount is provided.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { ENV } from "@/lib/env";

/**
 * The five carve-outs, each a whole-base-unit integer string, mapping 1:1 to a
 * `recordPayment` argument (see the backend `WaterfallResponse`).
 */
export interface WaterfallResponse {
  /** Amortises outstanding senior principal (`min(amount, outstanding)`). → seniorPrincipal. */
  senior_principal_returned: string;
  /** Net senior coupon → sPLUSD vault (gross interest − mgmt − perf). → seniorInterest. */
  senior_coupon_net: string;
  /** Management fee carve-out. → mgmtFee. */
  management_fee: string;
  /** Performance fee carve-out. → perfFee. */
  performance_fee: string;
  /** OET allocation carve-out. → oetAlloc. */
  oet_allocation: string;
}

export interface UseLoanWaterfallResult {
  data: WaterfallResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * @param loanId  on-chain loan id
 * @param amount  incoming offtaker payment, raw on-chain base units (string);
 *                pass `""`/`"0"` to keep the query disabled
 * @param asOf    repayment date, Unix seconds (optional — drives the fee/interest
 *                tenor); defaults to now on the backend
 */
export function useLoanWaterfall(
  loanId: string,
  amount: string,
  asOf: number | null,
): UseLoanWaterfallResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const enabled =
    loanId.length > 0 && /^[0-9]+$/.test(amount) && amount !== "0";

  const query = useQuery<WaterfallResponse, Error>({
    queryKey: ["loan-waterfall", chainId, loanId, amount, asOf],
    queryFn: () =>
      apiFetch<WaterfallResponse>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/waterfall` +
          `?amount=${amount}&chain_id=${chainId}` +
          (asOf != null ? `&as_of=${asOf}` : ""),
      ),
    enabled,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
