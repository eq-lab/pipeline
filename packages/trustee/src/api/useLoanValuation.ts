/**
 * React Query hook — fetches one loan's collateral valuation + CCR from the
 * Pipeline API (`GET /v1/loan-book/{loan_id}/valuations`) for the Trustee
 * **Loan detail** page's "Price & collateral" card (issue #845, Figma node
 * `4116:10549`).
 *
 * Mirrors `useLoanBook.ts` conventions (Stellar-scoped `chain_id`, 30 s poll,
 * `apiFetch`). The trustee app deliberately does NOT depend on
 * `@pipeline/frontend` (epic #775), so the types below are a self-contained
 * port of the backend shape (`packages/api/src/routes/collateral_valuation.rs`)
 * — another TD-42 hand-mirroring (`docs/exec-plans/tech-debt-tracker.md`). Only
 * the fields this page reads are modeled (the full response also carries the
 * concentrate `waterfall`, per-metal `metals`, and `penalties` — not used here).
 *
 * Data-layer note
 * ---------------
 * Unlike the loan-book **list**, this endpoint's money fields are **already
 * plain 2-decimal USD strings** computed server-side (`collateral_value`,
 * `ccr.outstanding_senior_principal`, `ccr.collateral_value`) — they are NOT
 * registry base-6 and NOT 1000× off. Do **NOT** apply the `#840`
 * `scaleRegistryAmount` workaround or the list's CCR ÷1000 correction here;
 * `ccr.ccr_pct` is display-ready. `reference_price` / `quantity_dmt` are plain
 * decimal strings. Any field may be `null` when an input is missing (see
 * `missing_inputs`); the endpoint 404s when the loan has no valuation anchor.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Echo of the valuation inputs (only the fields the Price & collateral card reads). */
export interface CollateralValuationInputs {
  /** Haircut applied to the mine-gate value, percent string (e.g. `"10"`). */
  haircut_pct: string;
  /** Reference-price asset symbol (e.g. `"Li2CO3"`). */
  reference_price_asset: string;
  /** Price provider name. */
  price_provider: string;
  /** Latest reference price (USD, decimal string); `null` when none on record. */
  reference_price: string | null;
  /** Collateral quantity (DMT, decimal string); `null` when no quantity reported. */
  quantity_dmt: string | null;
}

/** CCR block; `null` on the response when collateral or the loan snapshot is missing. */
export interface Ccr {
  /** Collateral value (USD, 2-decimal string). */
  collateral_value: string;
  /** Outstanding senior principal (USD, 2-decimal string) — the CCR denominator. */
  outstanding_senior_principal: string;
  /** CCR in basis points (`17800` = 178%). Already correctly scaled. */
  ccr_bps: number;
  /** CCR as a percentage string, e.g. `"178.00"`. Display-ready — do NOT correct. */
  ccr_pct: string;
}

/** Shape of the `GET /v1/loan-book/{loan_id}/valuations` response (fields used here). */
export interface CollateralValuationResponse {
  chain_id: number;
  loan_id: string;
  commodity: string;
  /** `"StandardGoods"` | `"MetalConcentrate"`. */
  valuation_mode: string;
  inputs: CollateralValuationInputs;
  /** Collateral value in USD (2-decimal string); `null` when an input is missing. */
  collateral_value: string | null;
  /** CCR block; `null` when collateral is unavailable or the loan snapshot is absent. */
  ccr: Ccr | null;
  /** Names of absent inputs, e.g. `["reference_price","quantity"]`. Empty when complete. */
  missing_inputs: string[];
}

/** Return value of `useLoanValuation`. */
export interface UseLoanValuationResult {
  data: CollateralValuationResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the on-demand collateral valuation + CCR for one loan.
 *
 * - Always enabled once `loanId` is a non-empty string (public endpoint).
 * - Stellar-scoped (`chain_id = ENV.STELLAR_CHAIN_ID`), like `useLoanBook`.
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - A 404 (no valuation anchor for the loan) surfaces via `error`.
 */
export function useLoanValuation(loanId: string): UseLoanValuationResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<CollateralValuationResponse, Error>({
    queryKey: ["loan-valuation", chainId, loanId],
    queryFn: () =>
      apiFetch<CollateralValuationResponse>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/valuations?chain_id=${chainId}`,
      ),
    enabled: loanId.length > 0,
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
