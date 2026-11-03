// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { chainDisplayName, usePaymentDetails } from "@/api";
import { toFundingDetailsView, toUnavailableView } from "./fundingDetails";
import type { FundingDetailsView } from "./fundingDetails";

export interface FundingRequest {
  openId: number;
  chainId: number;
  kind: "evm" | "stellar";
}

export function useFundingDetails(
  request: FundingRequest | null,
): FundingDetailsView {
  const result = usePaymentDetails(
    request ? { openId: request.openId, chainId: request.chainId } : null,
  );
  if (request === null) return { status: "loading" };
  if (result.status === "ready" && result.data) {
    return toFundingDetailsView(result.data, request.kind);
  }
  if (result.status === "unavailable") {
    return toUnavailableView(
      result.error,
      chainDisplayName(request.kind, request.chainId),
    );
  }
  return { status: "loading" };
}
