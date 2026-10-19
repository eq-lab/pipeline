// spec: docs/frontend/trustee-flows.md#loan-detail (per-loan identity = (chain_id, loan_id); `chain` search param).
import type { LoanBookEntry } from "@/api/useLoanBook";
import { DEFAULT_TARGET_CHAIN_ID } from "@/lib/targetChains";

export interface LoanRouteSearch {
  chain: number;
}

export function parseLoanRouteSearch(
  raw: Record<string, unknown>,
): LoanRouteSearch {
  const value = raw.chain;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return {
    chain:
      Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TARGET_CHAIN_ID,
  };
}

export function findLoanEntry(
  loans: ReadonlyArray<LoanBookEntry> | undefined,
  chainId: number,
  loanId: string,
): LoanBookEntry | undefined {
  return loans?.find((l) => l.chain_id === chainId && l.loan_id === loanId);
}

export function loanRowKey(chainId: number, loanId: string): string {
  return `${chainId}:${loanId}`;
}
