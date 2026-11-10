// spec: docs/product-specs/minter-cash-book.md#api-contract
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";

export type CashBookWireInStatus =
  | "Direct"
  | "Escrowed"
  | "Assigned"
  | "Returned";

export interface CashBookSummary {
  bank_cash: string;
  in_flight: string;
  complete: boolean;
  checkpoint_ledger?: number;
  as_of_ledger?: number;
}

export interface CashBookWireIn {
  id: number;
  status: CashBookWireInStatus;
  receiver: string;
  amount: string;
  value_date: string;
  ref_hash: string;
  recorded_at: string;
  assigned_at?: string;
  returned_at?: string;
  return_ref_hash?: string;
}

export interface CashBookWireOut {
  id: number;
  status: "Pending" | "Settled" | "Cancelled";
  lp: string;
  lp_id?: number;
  lp_legal_name?: string;
  amount: string;
  requested_at: string;
  settled_at?: string;
  value_date?: string;
  ref_hash?: string;
  cancelled_at?: string;
}

export interface CashBookRamp {
  id: number;
  status: "Open" | "Closed";
  direction: "UsdcToBank" | "BankToUsdc";
  amount: string;
  opened_at: string;
  open_ref_hash: string;
  received?: string;
  loss?: string;
  closed_at?: string;
  close_ref_hash?: string;
}

export interface CashBookResponse {
  chain_id: number;
  minter: string;
  summary: CashBookSummary;
  wire_ins: CashBookWireIn[];
  wire_outs: CashBookWireOut[];
  ramps: CashBookRamp[];
}

export interface UseCashBookOptions {
  enabled: boolean;
  refetchMs: number;
}

export function cashBookKey(chainId: number) {
  return ["cash-book", chainId] as const;
}

export function useCashBook(
  chainId: number,
  { enabled, refetchMs }: UseCashBookOptions,
) {
  return useQuery<CashBookResponse, Error>({
    queryKey: cashBookKey(chainId),
    queryFn: () =>
      apiFetch<CashBookResponse>(`/v1/cash-book?chain_id=${chainId}`),
    enabled,
    refetchInterval: refetchMs,
    retry: (count, error) =>
      !(
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) && count < 2,
  });
}
