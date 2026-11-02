// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { useQuery } from "@tanstack/react-query";
import { useAuthSession } from "@/auth/useAuthSession";
import { getMyPaymentDetails } from "./lps";
import type { PaymentDetailsResponse } from "./lps";

export interface PaymentDetailsRequest {
  openId: number;
  chainId: number;
}

export interface UsePaymentDetailsResult {
  status: "idle" | "loading" | "ready" | "unavailable";
  data?: PaymentDetailsResponse;
  error?: unknown;
}

export function usePaymentDetails(
  request: PaymentDetailsRequest | null,
): UsePaymentDetailsResult {
  const { isAuthenticated } = useAuthSession();
  const enabled = request !== null && isAuthenticated;
  const query = useQuery<PaymentDetailsResponse>({
    queryKey: ["lp-payment-details", request?.openId, request?.chainId],
    queryFn: ({ signal }) =>
      getMyPaymentDetails((request as PaymentDetailsRequest).chainId, signal),
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!enabled) return { status: "idle" };
  if (query.isError) return { status: "unavailable", error: query.error };
  if (query.data) return { status: "ready", data: query.data };
  return { status: "loading" };
}
