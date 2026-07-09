/**
 * React Query hook — fetches the per-loan collateral valuation
 * (`GET /v1/loan-book/{loan_id}/valuations`) for the Trustee Origination
 * details page (issue #816).
 *
 * Ports the response types from `packages/api/src/routes/collateral_valuation.rs`
 * (the trustee app deliberately does NOT depend on `@pipeline/frontend` — epic
 * #775 keeps the two apps separate; see TD-42 in
 * `docs/exec-plans/tech-debt-tracker.md` for the cross-package duplication
 * this creates). All money/number fields on the wire are already human-scaled
 * USD strings (2 dp) — never re-scale them.
 *
 * ## The 404 / "no valuation yet" case (default today, not an edge case)
 *
 * `loan_id` for `/valuations` is the on-chain loan id, which "does not exist
 * until the loan is drawn" (`loan_book.rs:206`) — a pre-mint submission
 * (`Awaiting your review`) has no on-chain loan yet, so the endpoint 404s.
 * Verified live against stage: every current submission 404s here. This is a
 * first-class **non-error** empty state, not a failure — `apiFetch` throws a
 * plain `Error` on any non-2xx response (it doesn't carry the HTTP status),
 * so this hook treats ANY error from this endpoint as "no valuation
 * available yet" rather than surfacing an error banner. There is no scenario
 * where showing a scary error state for the expected pre-mint default is the
 * right call — a genuine backend outage on this endpoint degrades to the same
 * empty-state UI, which is an acceptable trade-off given the endpoint is
 * purely additive/decorative on this page (see the exec plan, Step 2).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types (ported from packages/api/src/routes/collateral_valuation.rs) ────────

/** `StandardGoods` or `MetalConcentrate` (`shared::collateral_valuation_repo::ValuationMode`). */
export type ValuationMode =
  | "StandardGoods"
  | "MetalConcentrate"
  | (string & Record<never, never>);

/** One payable-metal input line (concentrate mode only). */
export interface MetalInput {
  metal: string;
  grade_g_per_t: string;
  payable_pct: string;
  min_deduction_g_per_t: string;
  reference_price: string;
  rc_per_oz: string;
}

/** One penalty-tier input line (concentrate mode only). */
export interface PenaltyInput {
  element: string;
  level_pct: string;
  threshold_pct: string;
  step_pct: string;
  rate_per_dmt: string;
}

/** Echo of the valuation inputs (left/INPUTS column of the design). */
export interface CollateralValuationInputs {
  haircut_pct: string;
  reference_price_asset: string;
  price_provider: string;
  reference_price: string | null;
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

/** The concentrate NSR waterfall (right column of the design). `null` for standard goods. */
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

/** CCR block. `null` when collateral or the loan snapshot denominator is unavailable. */
export interface Ccr {
  collateral_value: string;
  outstanding_senior_principal: string;
  ccr_bps: number;
  /** CCR as a percentage string, e.g. `"178.00"`. Display-only — never recompute. */
  ccr_pct: string;
}

/** Response for `GET /v1/loan-book/{loan_id}/valuations`. */
export interface CollateralValuationResponse {
  chain_id: number;
  loan_id: string;
  commodity: string;
  valuation_mode: ValuationMode;
  inputs: CollateralValuationInputs;
  waterfall: Waterfall | null;
  collateral_value: string | null;
  ccr: Ccr | null;
  missing_inputs: string[];
}

/** Return value of `useCollateralValuation`. */
export interface UseCollateralValuationResult {
  /** The parsed response, or `undefined` while loading / on no-valuation-yet. */
  data: CollateralValuationResponse | undefined;
  isLoading: boolean;
  /**
   * `true` once settled and there is no valuation to show (404, or any other
   * fetch failure — see the module doc). Distinct from a hard error: the
   * view must NEVER render an error banner for this case, only the "awaiting
   * valuation" empty state.
   */
  notFound: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the collateral valuation for `loanId` (Stellar-scoped,
 * `chain_id=99000001`). Pass `enabled = false` while the caller doesn't yet
 * have a resolved loan id (e.g. the submission is still loading).
 */
export function useCollateralValuation(
  loanId: string | number,
  enabled: boolean,
): UseCollateralValuationResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<CollateralValuationResponse, Error>({
    queryKey: ["collateral-valuation", chainId, String(loanId)],
    queryFn: () =>
      apiFetch<CollateralValuationResponse>(
        `/v1/loan-book/${loanId}/valuations?chain_id=${chainId}`,
      ),
    enabled: enabled && loanId !== "" && loanId !== undefined,
    retry: false,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    // Any settled error (404 is the expected default pre-mint outcome; any
    // other failure degrades to the same non-error empty state — see module
    // doc) OR a successful-but-empty response is treated as "no valuation".
    notFound: enabled && !query.isLoading && (!!query.error || !query.data),
  };
}
