/**
 * Query-wiring + value→display mapping for the Origination details / review
 * page (issue #816, Figma node `4116:9292`), the destination opened by
 * clicking a row on the #813 Origination table.
 *
 * Per `docs/FRONTEND.md` Code structure rule 2, the `.tsx` route is JSX/
 * styling only; this hook owns:
 *   - Resolving the `SubmissionView` to render (router state, or a refetch
 *     fallback for direct-URL / refresh access — Open Question #3).
 *   - Calling `useCollateralValuation` and mapping its response to display
 *     rows for the INPUTS / NSR-waterfall / CCR columns.
 *   - All `loan_data` field extraction, defensively guarded exactly like
 *     `-useOriginationTable.ts`'s `safeString`/`safeNumber` (loan_data is
 *     `serde_json::Value` on the wire — never fabricate, always `—`).
 *
 * ## Field mapping (resolved Open Questions, see the exec plan + issue #816 comments)
 *
 *   - Heading/breadcrumb/Deal-Details "Originator" → `loan_data.originator`
 *     (the human name, e.g. "Open Mineral") — NOT `SubmissionView.originator`
 *     (the authenticated submitter address), which is what the #813 table
 *     uses. Distinct sources, resolved by human direction.
 *   - Start date  → `economics.origination_date`.
 *   - Maturity    → `economics.original_maturity_date`.
 *   - Facility/tranches/offtaker price → `economics.*`, `formatFullUsd`.
 *   - Rate        → `economics.senior_interest_rate_bps`, `formatBpsRate`
 *     (+ " p.a." suffix per Figma "14.0% p.a.").
 *   - Corridor    → `loan_data.corridor`, arrow-formatted (same regex as #813).
 *   - Governing law → `loan_data.governing_law`.
 *   - Documents   → the top-level `submission.documents` (NOT `loan_data.documents`
 *     directly — the backend already lifts it; `[]` renders a graceful empty
 *     state, per Open Question #5).
 *   - Status chip → `submission.status` ("Awaiting your review" for
 *     `InReview`; the other two statuses get their own labels).
 *   - Valuation-mode chip → `valuations.valuation_mode`, ONLY rendered when
 *     the valuation call actually succeeds (Open Question #4) — never
 *     fabricated pre-mint.
 *   - The "All three mint invariants pass" and "Originator signature
 *     verified" banners are OMITTED entirely (no backend source — Open
 *     Question #4, resolved: do not fabricate).
 *
 * ## The valuation card's default state
 *
 * Every current submission 404s `/valuations` (verified on stage — see the
 * exec plan's Assumptions). `notFound: true` from `useCollateralValuation` is
 * therefore the default rendered state, not a rare edge — the view must
 * render the card shell + `—` rows, never an error banner.
 *
 * One figure IS available even in this default state, though: the
 * originator's submission-time `loan_data.initial_ccr` (1e6-scaled fixed
 * point — `1_500_000` = 150%, per `loan_book.rs`). This is a real, backed
 * value carried on every submission from day one, distinct from the live
 * `/valuations` CCR (which recomputes against current assay/market inputs
 * once the loan is anchored on-chain). It is surfaced as its own clearly
 * labeled "Initial CCR (at submission)" row in the waterfall→CCR column,
 * rendered independently of `hasData` — the detailed NSR INPUTS and the
 * computed waterfall rows stay `—`/empty until `/valuations` returns real
 * data, but this one row is never blank when `initial_ccr` is present.
 */
import { useMemo } from "react";
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import {
  useCollateralValuation,
  type CollateralValuationResponse,
} from "@/api/useCollateralValuation";
import { formatBpsRate, formatFullUsd } from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";

// ── Helpers (mirrors -useOriginationTable.ts) ────────────────────────────────

/** `"—"` for anything not a non-empty string — never fabricates a value. */
function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

/** `"—"` for anything not a finite number. */
function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** `"—"` for a `null`/`undefined`/empty string value already on the wire. */
function safeWireString(value: string | null | undefined): string {
  return value != null && value.length > 0 ? value : "—";
}

/** Renders the corridor hyphen as the Figma arrow glyph ("PE-CN" → "PE → CN"). */
function formatCorridor(value: unknown): string {
  return safeString(value).replace(/\s*-\s*/g, " → ");
}

/**
 * Formats `loan_data.initial_ccr` (1e6-scaled fixed point — `"1e6-scaled;
 * >= 1_000_000"`, `loan_book.rs`) as a whole-number percentage, e.g.
 * `1_500_000` → `"150%"`. `—` for anything not a finite number. This is a
 * unit conversion of a directly-submitted value, not a derived metric.
 */
function formatInitialCcr(value: unknown): string | null {
  const num = safeNumber(value);
  if (num == null) return null;
  return `${Math.round(num / 10_000)}%`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type OriginationDetailState = "loading" | "not-found" | "ready";

/** Status chip discriminant — mirrors the #813 table's per-status labels. */
export type StatusChip =
  | { kind: "in-review"; label: string }
  | { kind: "approved"; label: string }
  | { kind: "rejected"; label: string }
  | { kind: "unknown"; label: string };

export interface LoanTermsDisplay {
  facility: string;
  senior: string;
  equity: string;
  offtakerPrice: string;
  rate: string;
  startDate: string;
  maturityDate: string;
}

export interface DocumentDisplay {
  name: string;
  uri: string;
}

export interface DealDetailsDisplay {
  originator: string;
  commodity: string;
  corridor: string;
  governingLaw: string;
  documents: DocumentDisplay[];
}

/** One INPUTS-column row (label + formatted value). */
export interface ValuationInputRow {
  label: string;
  value: string;
  /** Sub-label shown under the value (e.g. "off-chain API"). */
  subLabel?: string;
}

/** One NSR-waterfall row (label + formatted USD value). */
export interface WaterfallRow {
  label: string;
  value: string;
}

export interface ValuationDisplay {
  /** `true` once the endpoint has resolved data (not the 404/empty default). */
  hasData: boolean;
  modeLabel: string | null;
  inputRows: ValuationInputRow[];
  /** Empty when `waterfall` is `null` (StandardGoods, missing inputs, or 404). */
  waterfallRows: WaterfallRow[];
  /**
   * The live CCR from `/valuations` (`ccr.ccr_pct`), when that endpoint has
   * data. `null` while `/valuations` 404s — the pre-mint default today.
   */
  ccrLabel: string | null;
  /**
   * The submission-time CCR the originator submitted
   * (`loan_data.initial_ccr`, 1e6-scaled — `1_500_000` = 150%). This is a
   * real, backed figure available from the moment of submission, DISTINCT
   * from the live `/valuations` CCR above: it does not get recomputed against
   * current market/assay inputs. Rendered as a separate, clearly-labeled
   * row so it is never confused with the live figure. `null` when
   * `loan_data.initial_ccr` is missing/malformed.
   */
  initialCcrLabel: string | null;
  freshnessLabel: string | null;
}

export interface OriginationDetailResult {
  state: OriginationDetailState;
  heading: string;
  breadcrumb: string;
  statusChip: StatusChip;
  loanTerms: LoanTermsDisplay;
  dealDetails: DealDetailsDisplay;
  valuation: ValuationDisplay;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function resolveStatusChip(submission: SubmissionView): StatusChip {
  switch (submission.status) {
    case "InReview":
      return { kind: "in-review", label: "Awaiting your review" };
    case "Approved":
      return { kind: "approved", label: "Approved" };
    case "Rejected":
      return { kind: "rejected", label: "Rejected" };
    default:
      return { kind: "unknown", label: safeString(submission.status) };
  }
}

// ── Loan Terms / Deal Details mapping ────────────────────────────────────────

function mapLoanTerms(submission: SubmissionView): LoanTermsDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  const economics: Partial<SubmissionView["loan_data"]["economics"]> =
    loanData.economics ?? {};

  return {
    facility: formatFullUsd(economics.original_facility_size ?? null),
    senior: formatFullUsd(economics.original_senior_tranche ?? null),
    equity: formatFullUsd(economics.original_equity_tranche ?? null),
    offtakerPrice: formatFullUsd(economics.original_offtaker_price ?? null),
    rate: (() => {
      const formatted = formatBpsRate(
        safeNumber(economics.senior_interest_rate_bps),
      );
      return formatted === "—" ? formatted : `${formatted} p.a.`;
    })(),
    startDate: formatMaturityDate(safeNumber(economics.origination_date)),
    maturityDate: formatMaturityDate(
      safeNumber(economics.original_maturity_date),
    ),
  };
}

function mapDealDetails(submission: SubmissionView): DealDetailsDisplay {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};

  return {
    originator: safeString(loanData.originator),
    commodity: safeString(loanData.commodity),
    corridor: formatCorridor(loanData.corridor),
    governingLaw: safeString(loanData.governing_law),
    documents: Array.isArray(submission.documents)
      ? submission.documents.map((doc) => ({
          name: safeString(doc?.name),
          uri: typeof doc?.uri === "string" ? doc.uri : "",
        }))
      : [],
  };
}

function mapHeading(submission: SubmissionView): string {
  const loanData: Partial<SubmissionView["loan_data"]> =
    submission.loan_data ?? {};
  return `${safeString(loanData.originator)} — ${safeString(loanData.commodity)}`;
}

// ── Valuation mapping ────────────────────────────────────────────────────────

/** Human label for `valuation_mode` (chip + card title). */
function modeLabel(
  mode: CollateralValuationResponse["valuation_mode"],
): string {
  switch (mode) {
    case "MetalConcentrate":
      return "NSR";
    case "StandardGoods":
      return "Standard";
    default:
      return safeString(mode);
  }
}

function usdOrDash(value: string | null | undefined): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return formatFullUsd(value);
}

function mapValuation(
  data: CollateralValuationResponse | undefined,
  notFound: boolean,
  initialCcrLabel: string | null,
): ValuationDisplay {
  if (!data || notFound) {
    return {
      hasData: false,
      modeLabel: null,
      inputRows: [],
      waterfallRows: [],
      ccrLabel: null,
      initialCcrLabel,
      freshnessLabel: null,
    };
  }

  const { inputs, waterfall, ccr } = data;

  const inputRows: ValuationInputRow[] = [];
  if (inputs.metals.length > 0) {
    const metal = inputs.metals[0];
    inputRows.push({
      label: "Au grade / payable / min deduction",
      value: `${safeWireString(metal?.grade_g_per_t)} g/t · ${safeWireString(metal?.payable_pct)}% · ${safeWireString(metal?.min_deduction_g_per_t)} g/t`,
    });
  }
  inputRows.push({
    label: "Quantity (updates as shipped)",
    value: inputs.quantity_dmt != null ? `${inputs.quantity_dmt} dmt` : "—",
  });
  inputRows.push({
    label: "Moisture · arsenic",
    value: safeWireString(inputs.moisture_pct),
  });
  inputRows.push({
    label: "TC / RC",
    value:
      inputs.treatment_charge_per_dmt != null
        ? `$${inputs.treatment_charge_per_dmt}/dmt`
        : "—",
  });
  inputRows.push({
    label: "Reference price",
    value: usdOrDash(inputs.reference_price),
    subLabel: inputs.price_provider ? "off-chain API" : undefined,
  });
  inputRows.push({
    label: "Quotation period",
    value: safeWireString(inputs.quotational_period),
  });

  const waterfallRows: WaterfallRow[] = waterfall
    ? [
        { label: "Gross value", value: usdOrDash(waterfall.gross_value) },
        {
          label: "− TC − RC − penalties",
          value: `− ${usdOrDash(waterfall.treatment_charge)}`,
        },
        {
          label: "− realisation costs → mine-gate value",
          value: usdOrDash(waterfall.mine_gate_value),
        },
        {
          label: "× (1 − haircut) → collateral value",
          value: usdOrDash(waterfall.collateral_value),
        },
      ]
    : [];

  const ccrLabel = ccr ? `${ccr.ccr_pct}%` : null;

  return {
    hasData: true,
    modeLabel: modeLabel(data.valuation_mode),
    inputRows,
    waterfallRows,
    ccrLabel,
    initialCcrLabel,
    freshnessLabel: ccr ? "recomputed off-chain every 60 min" : null,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Resolves the submission to render (router state, or a refetch fallback by
 * `loanId` — Open Question #3) and wires the collateral-valuation call.
 *
 * @param loanId            the `$loanId` route param (the submission's `id`).
 * @param stateSubmission   `SubmissionView` passed via router navigation
 *                           state by the #813 row click, if present.
 */
export function useOriginationDetail(
  loanId: string,
  stateSubmission: SubmissionView | undefined,
): OriginationDetailResult {
  const { data: submissions, isLoading: submissionsLoading } =
    useLoanSubmissions();

  const submission = useMemo<SubmissionView | undefined>(() => {
    if (stateSubmission) return stateSubmission;
    return submissions?.find((s) => String(s.id) === loanId);
  }, [stateSubmission, submissions, loanId]);

  const needsFallback = !stateSubmission;
  const submissionState: OriginationDetailState = submission
    ? "ready"
    : needsFallback && submissionsLoading
      ? "loading"
      : "not-found";

  const { data: valuationData, notFound: valuationNotFound } =
    useCollateralValuation(submission?.id ?? "", submissionState === "ready");

  return useMemo<OriginationDetailResult>(() => {
    if (!submission) {
      return {
        state: submissionState,
        heading: "—",
        breadcrumb: "—",
        statusChip: { kind: "unknown", label: "—" },
        loanTerms: {
          facility: "—",
          senior: "—",
          equity: "—",
          offtakerPrice: "—",
          rate: "—",
          startDate: "—",
          maturityDate: "—",
        },
        dealDetails: {
          originator: "—",
          commodity: "—",
          corridor: "—",
          governingLaw: "—",
          documents: [],
        },
        valuation: {
          hasData: false,
          modeLabel: null,
          inputRows: [],
          waterfallRows: [],
          ccrLabel: null,
          initialCcrLabel: null,
          freshnessLabel: null,
        },
      };
    }

    const initialCcrLabel = formatInitialCcr(
      (submission.loan_data as Partial<SubmissionView["loan_data"]> | undefined)
        ?.initial_ccr,
    );

    return {
      state: "ready",
      heading: mapHeading(submission),
      breadcrumb: mapHeading(submission),
      statusChip: resolveStatusChip(submission),
      loanTerms: mapLoanTerms(submission),
      dealDetails: mapDealDetails(submission),
      valuation: mapValuation(
        valuationData,
        valuationNotFound,
        initialCcrLabel,
      ),
    };
  }, [submission, submissionState, valuationData, valuationNotFound]);
}
