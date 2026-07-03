/**
 * React Query hook — fetches the Protocol's Statement of Financial Position
 * from the Pipeline API (`GET /v1/financial-position`).
 *
 * The hook is always enabled (no wallet connection required — this is a
 * protocol-level view visible to everyone).
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/financial-position`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * All monetary amounts from this endpoint are **base-6 decimal strings already
 * in human units** (e.g. `"8000000.000000"` = $8M). They are NOT raw sub-unit
 * bigints. Use `formatCompactUsd` from `@/utils/formatCompactUsd`.
 *
 * Fields that the REST layer cannot source are `null`. The Balance Sheet panel
 * overrides some `null` leaves (PLUSD outstanding, USDC reserve) with on-chain
 * Soroban reads — see `useBalanceSheetPanel.ts`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Liquid assets — cash-like holdings. All `null` in v1 (not indexed). */
export interface LiquidAssets {
  /** Σ of available liquid leaves; `null` while none are sourced. */
  total: string | null;
  /** Capital-Wallet USDC balance. `null` in v1 — sourced on-chain instead. */
  cash_stablecoins: string | null;
  /** USYC holding at NAV. `null` in v1. */
  tokenized_tbills: string | null;
  /** Off-chain / in-transit USD. `null` — off-chain. */
  off_chain_usd: string | null;
}

/** Deployed assets — capital out on active loans. */
export interface DeployedAssets {
  /** `secured_loans_outstanding` + `accrued_interest_receivable`. */
  total: string | null;
  /** Σ (senior + equity tranche) over active loans, USDC (base-6 decimal string). */
  secured_loans_outstanding: string | null;
  /** Σ cumulative senior interest received, USDC (base-6 decimal string). */
  accrued_interest_receivable: string | null;
}

/** Asset side of the balance sheet. */
export interface FinancialAssets {
  /** Σ of all available asset leaves. */
  total: string | null;
  liquid: LiquidAssets;
  deployed: DeployedAssets;
}

/** Senior claims on the protocol. */
export interface SeniorClaims {
  /**
   * Total PLUSD outstanding. `null` in v1 — sourced on-chain via
   * `useStellarPlusdTotalSupply()`.
   */
  plusd_outstanding: string | null;
}

/** Subordinated (junior / equity) capital. */
export interface SubordinatedCapital {
  /** Total Originator first-loss margin: Σ equity tranche, USDC (base-6 decimal string). */
  junior_tranche: string | null;
}

/** Liability side of the balance sheet. */
export interface FinancialLiabilities {
  /** Σ of all available liability leaves. */
  total: string | null;
  senior_claims: SeniorClaims;
  subordinated_capital: SubordinatedCapital;
}

/** Shape of the `GET /v1/financial-position` response. */
export interface FinancialPositionResponse {
  assets: FinancialAssets;
  liabilities: FinancialLiabilities;
}

/** Return value of `useFinancialPosition`. */
export interface UseFinancialPositionResult {
  data: FinancialPositionResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the protocol Statement of Financial Position.
 *
 * - Always enabled — no wallet connection required.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 *
 * All monetary string fields are base-6 decimal strings **already in human
 * units**. Use `formatCompactUsd` (not `formatUsdc`) to display them.
 * `null` fields are overridden by on-chain reads in `useBalanceSheetPanel`.
 */
export function useFinancialPosition(): UseFinancialPositionResult {
  const query = useQuery<FinancialPositionResponse, Error>({
    queryKey: ["financial-position"],
    queryFn: () =>
      apiFetch<FinancialPositionResponse>("/v1/financial-position"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
