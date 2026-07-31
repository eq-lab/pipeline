/**
 * React Query hook — fetches one loan's collateral valuation from the Pipeline
 * API (`GET /v1/loan-book/{loan_id}/valuations`) for the Trustee **Loan detail**
 * page's Price & collateral section (issues #845 / #847, Figma node `4116:10549`).
 *
 * Mirrors `useLoanBook.ts`'s conventions (queryKey shape, `apiFetch`,
 * `refetchInterval`, Stellar-scoped `chain_id`). Like the rest of the Trustee
 * app it does NOT depend on `@pipeline/frontend` (epic #775), so the types below
 * are a self-contained port of the backend DTO
 * (`packages/api/src/routes/collateral_valuation.rs`, `CollateralValuationResponse`)
 * rather than an import — a fifth hand-mirroring alongside TD-42's existing
 * trustee/LP pairs (see `docs/exec-plans/tech-debt-tracker.md`).
 *
 * ## Scale note
 * This endpoint recomputes collateral value and CCR in **plain USD**, so its
 * money fields (`collateral_value`, `ccr.collateral_value`,
 * `ccr.outstanding_senior_principal`) are correct-scale decimal strings —
 * display them as served, via plain `formatCompactUsd`. (The frontend no
 * longer rescales any endpoint's amounts — the ×1000 `scaleRegistryAmount`
 * workaround was removed project-wide in issue #906.) `inputs.haircut_pct`
 * is a fraction in `[0,1]` (e.g. `"0.10"` = 10%). `ccr.ccr_pct` is a percent
 * string (`"178.00"`).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types (port of the backend DTO) ─────────────────────────────────────────

/** `StandardGoods` or `MetalConcentrate` (backend `ValuationMode`). */
export type ValuationMode = "StandardGoods" | "MetalConcentrate";

/** One payable-metal input line (concentrate mode). */
export interface MetalInput {
  metal: string;
  grade_g_per_t: string;
  payable_pct: string;
  min_deduction_g_per_t: string;
  reference_price: string;
  rc_per_oz: string;
}

/**
 * One penalty-tier input line (concentrate mode).
 *
 * `level_pct` / `threshold_pct` / `step_pct` are **percent-normalised** by the
 * backend (#966) — always in percent regardless of whether the tier was authored
 * in percent or ppm (a `10` ppm tier echoes as `0.001`, not `10`). So whoever
 * renders these should treat them as percent (append a `%`, no scaling and no
 * ppm conversion). Not currently surfaced anywhere in the Console (#986
 * verification: no penalty display and no offtake-authoring form yet) — this
 * note documents the contract for when they are.
 */
export interface PenaltyInput {
  element: string;
  level_pct: string;
  threshold_pct: string;
  step_pct: string;
  rate_per_dmt: string;
}

/** Echo of the valuation inputs (left column of the design). */
export interface ValuationInputs {
  /** Haircut as a fraction in `[0,1]` (e.g. `"0.10"` = 10%). */
  haircut_pct: string;
  reference_price_asset: string;
  price_provider: string;
  /** Latest reference price (USD, plain decimal string); `null` when none is on record. */
  reference_price: string | null;
  /** Quantity in dry metric tonnes (plain decimal string); `null` when absent. */
  quantity_dmt: string | null;
  moisture_pct: string | null;
  metals: MetalInput[];
  penalties: PenaltyInput[];
  treatment_charge_per_dmt: string | null;
  realisation_costs: string | null;
  quotational_period: string | null;
  pricing_reference: string | null;
  incoterm: string | null;
  assay_status: string | null;
  assay_certificate_uri: string | null;
}

/** The concentrate NSR waterfall (right column of the design). All plain-USD strings. */
export interface Waterfall {
  gross_value: string;
  treatment_charge: string;
  refining_charge: string;
  penalties: string;
  nsr: string;
  realisation_costs: string;
  mine_gate_value: string;
  collateral_value: string;
}

/** CCR block — present only when both a collateral value and a loan snapshot exist. */
export interface ValuationCcr {
  /** Collateral value (plain USD, 2-decimal string). */
  collateral_value: string;
  /** Outstanding senior principal (plain USD, 2-decimal string) — the CCR denominator. */
  outstanding_senior_principal: string;
  /** CCR in basis points (`17800` = 178%). */
  ccr_bps: number;
  /** CCR as a percent string, e.g. `"178.00"`. */
  ccr_pct: string;
}

/** Shape of the `GET /v1/loan-book/{loan_id}/valuations` response. */
export interface LoanValuationResponse {
  chain_id: number;
  loan_id: string;
  commodity: string;
  valuation_mode: ValuationMode;
  inputs: ValuationInputs;
  /** `null` for standard-goods loans and when a required concentrate input is missing. */
  waterfall: Waterfall | null;
  /** Collateral value in USD (plain 2-decimal string); `null` when an input is missing. */
  collateral_value: string | null;
  /** CCR block; `null` when collateral is unavailable or the loan snapshot is missing. */
  ccr: ValuationCcr | null;
  /** Names of absent inputs, e.g. `["assay","quantity","loan_snapshot"]`. Empty when complete. */
  missing_inputs: string[];
}

/** Return value of `useLoanValuation`. */
export interface UseLoanValuationResult {
  data: LoanValuationResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns one loan's collateral valuation (inputs, waterfall, collateral value,
 * CCR, and any missing inputs).
 *
 * - Public endpoint — always enabled once a `loanId` is present (disabled while
 *   the id is empty, so it never fires on a half-mounted route).
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — the Trustee app is
 *   Stellar-scoped, matching `useLoanBook`.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`), consistent with `useLoanBook`.
 */
export function useLoanValuation(loanId: string): UseLoanValuationResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<LoanValuationResponse, Error>({
    queryKey: ["loan-valuation", chainId, loanId],
    queryFn: () =>
      apiFetch<LoanValuationResponse>(
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
