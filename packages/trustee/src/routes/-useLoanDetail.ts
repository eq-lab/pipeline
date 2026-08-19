/**
 * View-model + data wiring for the Trustee Loan detail page. Per
 * `docs/FRONTEND.md` Code structure rule 2 the `.tsx` route is render-only;
 * this hook owns the live fetches, the value→display mapping, and the
 * composition of live data + static actions (mirrors `-useLoansTable.ts`).
 *
 * spec: docs/frontend/trustee-flows.md#loan-detail (data sources incl. the
 * #1040 Documents card, never-fabricate rules, status chip mapping,
 * lifecycle spine, variants).
 */
import { useLoanBook } from "@/api/useLoanBook";
import type { LoanBookEntry } from "@/api/useLoanBook";
import { useLoanValuation } from "@/api/useLoanValuation";
import type {
  LoanValuationResponse,
  UseLoanValuationResult,
} from "@/api/useLoanValuation";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type {
  Epoch,
  LoanFinancialsResponse,
  UseLoanFinancialsResult,
} from "@/api/useLoanFinancials";
import { ApiError } from "@/api/client";
import {
  formatBpsRate,
  formatFullUsd,
  formatCompactUsd,
} from "@/utils/formatUsd";
import { formatEpochDate, formatMaturityDate } from "@/utils/formatDate";
import { formatNearestPayment } from "./-useLoansTable";
import { toUserError } from "@/utils/userError";
import {
  CLOSED_OTHER_ACTIONS,
  DISBURSING_OTHER_ACTIONS,
  MATURED_OTHER_ACTIONS,
  MATURED_ROLLOVER_CARD,
  PERFORMING_OTHER_ACTIONS,
  WATCHLIST_OTHER_ACTIONS,
  type CurrentStage,
  type OtherActions,
  type RolloverCard,
  type SummaryTile,
} from "./-loanDetailStatic";
import {
  useLoanCcrHistory,
  type UseLoanCcrHistoryResult,
} from "@/api/useLoanCcrHistory";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A dashed CCR guide-line at a fixed percent (e.g. 120% maintenance margin). */
export interface CcrThreshold {
  pct: number;
  label: string;
}

// CCR-trend chart view-model. spec: trustee-flows.md#ccr-trend-chart-watchlist-variant-figma-node-411610868.
export interface CcrTrend {
  /** CCR percentages, oldest → newest (e.g. `146` for 146%). */
  points: number[];
  /** Bottom-left caption — series start (`"146% · 1 May 2026"`). */
  startLabel: string;
  /** Latest CCR, bold near the end dot (`"114%"`). */
  currentLabel: string;
  /** Dashed guide-lines (protocol watchlist thresholds), high → low. */
  thresholds: CcrThreshold[];
}

// Protocol-wide watchlist thresholds (spec §9.6) — no per-loan override endpoint yet (#879).
const CCR_TREND_THRESHOLDS: CcrThreshold[] = [
  { pct: 120, label: "120%" },
  { pct: 110, label: "110%" },
];

export type StatusBand =
  | "positive"
  | "attention"
  | "negative"
  | "neutral"
  | "info";

/** The hero identity block, sourced from the loan-book row. */
export interface HeroView {
  backLabel: string;
  title: string;
  status: { label: string; band: StatusBand } | null;
  meta: string;
}

/** A plain `label: value` row of the Price & collateral card. */
export interface LabelValueRow {
  label: string;
  value: string;
}

/** One document row of the Documents card — name + the URI it opens. */
export interface DocumentDisplay {
  name: string;
  uri: string;
}

/** The spot line (price + optional trailing-change), rendered two-tone. */
export interface SpotView {
  main: string;
  /** e.g. `"−1.2% 7d"`; `null` when no 7-day change is served. */
  change: string | null;
  changeNegative: boolean;
}

/**
 * The Price & collateral card view-model (its own load/error/ready state).
 * `"empty"` is a 404 from the valuations endpoint — the loan has no valuation
 * anchor on record — rendered as a neutral note, not a red error.
 */
export interface PriceCollateralView {
  state: "loading" | "error" | "empty" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  /** Right-aligned attribution, e.g. `"via coingecko"`; `""` when unknown. */
  providerNote: string;
  spot: SpotView;
  rows: LabelValueRow[];
  /** Muted footnote naming absent inputs, or `null` when the valuation is complete. */
  missingNote: string | null;
}

/** Source tag shown next to a registry row's label. */
export type RegistryTag = "chain" | "computed" | "relayer";

/** One row of the "Registry state & derived" card, with its source tag. */
export interface RegistryRow {
  label: string;
  value: string;
  tag: RegistryTag;
}

/** The "Registry state & derived" card view-model (its own load/error/ready state). */
export interface RegistryView {
  state: "loading" | "error" | "empty" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  rows: RegistryRow[];
}

export type LoanDetailState = "loading" | "error" | "ready";

/**
 * Which status-conditional layout the page renders (§S5 variants). Derived from
 * the served display status; drives the section set in `loans.$id.tsx`
 * (issues #859 / #862 / #866). Unbuilt statuses fall back to `performing`.
 */
export type LoanDetailVariant =
  | "performing"
  | "watchlist"
  | "disbursing"
  | "matured";

export interface UseLoanDetailResult {
  /** Driven by the loan-book fetch (the hero source). */
  state: LoanDetailState;
  errorMessage: string | null;
  errorDetails: string | null;
  /** Status-selected layout — the view branches on this before rendering. */
  variant: LoanDetailVariant;
  hero: HeroView;
  /** Lifecycle stepper — rendered only by the `performing`/`disbursing` layout (none on Watchlist/Matured). */
  lifecycle: LifecycleStep[];
  tiles: SummaryTile[];
  registry: RegistryView;
  /** Current-stage/escalation card — Watchlist only; `null` for every other variant (#876). */
  currentStage: CurrentStage | null;
  otherActions: OtherActions;
  priceCollateral: PriceCollateralView;
  /** CCR-trend chart (Watchlist only); `null` otherwise. */
  ccrTrend: CcrTrend | null;
  /** Rollover card (Matured only); `null` otherwise. */
  rollover: RolloverCard | null;
  /** Formatted maturity date (e.g. `"15 Jun 2026"`), for the Matured rollover-card title; `null` when absent. */
  maturityDate: string | null;
  /** Documents card rows. Spec: `docs/frontend/trustee-flows.md#documents`. */
  documents: DocumentDisplay[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BACK_LABEL = "‹ Loans";

/** The display chip derived from the raw on-chain status (design assignment §3.2). */
export interface StatusChip {
  /** Display label shown in the chip (may rename the raw status, e.g. Matured → Past Due). */
  label: string;
  band: StatusBand;
  /** The raw on-chain status string as served — always printed on the loan detail (§3.2). */
  raw: string;
}

/** The other-actions set for the loan's state — Closed loans are terminal and get none (#1092). */
export function selectOtherActions(
  chipLabel: string | null,
  variant: LoanDetailVariant,
): OtherActions {
  if (chipLabel === "Closed") return CLOSED_OTHER_ACTIONS;
  return variant === "watchlist"
    ? WATCHLIST_OTHER_ACTIONS
    : variant === "matured"
      ? MATURED_OTHER_ACTIONS
      : variant === "disbursing"
        ? DISBURSING_OTHER_ACTIONS
        : PERFORMING_OTHER_ACTIONS;
}

// spec: docs/frontend/trustee-flows.md#status-chip-mapping-design-assignment-32.
export function statusToChip(rawStatus: string): StatusChip {
  switch (rawStatus) {
    case "Disbursing":
      return { label: "Disbursing", band: "info", raw: rawStatus };
    case "Performing":
      return { label: "Active", band: "positive", raw: rawStatus };
    case "Watchlist":
    case "WatchList":
      return { label: "Watchlist", band: "attention", raw: rawStatus };
    // `Matured` is a legacy fallback — the backend now serves `Past Due` directly.
    case "Past Due":
    case "Matured":
      return { label: "Matured", band: "attention", raw: rawStatus };
    case "Default":
      return { label: "Default", band: "negative", raw: rawStatus };
    case "Closed":
      return { label: "Closed", band: "neutral", raw: rawStatus };
    default:
      return { label: rawStatus, band: "neutral", raw: rawStatus };
  }
}

// ── Loan-lifecycle stepper (design assignment §3.2 status diagram) ────────────

export type StepState = "done" | "active" | "pending";

/** One node of the loan-lifecycle stepper. */
export interface LifecycleStep {
  /** Node label — a spine phase, or the current live status on the live node. */
  label: string;
  /** Short descriptor beneath the node (static design copy, not per-loan data). */
  sub: string;
  state: StepState;
  /** 1-based position shown inside active/pending nodes (done nodes show a check). */
  index: number;
}

// Meaning column, design assignment §3.2 — short descriptor for the live node.
const LIVE_STATUS_SUB: Record<string, string> = {
  Active: "deployed & current",
  Watchlist: "elevated risk",
  Matured: "past maturity",
  Default: "council declared",
};

// Builds the loan-lifecycle stepper's happy-path spine. spec:
// docs/frontend/trustee-flows.md#loan-lifecycle-stepper-design-assignment-32-status-diagram.
export function buildLifecycle(rawStatus: string | undefined): LifecycleStep[] {
  const hasStatus = rawStatus != null && rawStatus.length > 0;
  const chip = hasStatus ? statusToChip(rawStatus) : null;
  const isClosed = chip?.label === "Closed";
  const isDisbursing = chip?.label === "Disbursing";
  // Live = a non-Disbursing, non-Closed status (Performing / Watchlist / Past Due / Default).
  const isLive = hasStatus && !isClosed && !isDisbursing;

  // The live node adopts the current status while live; a neutral "Active"
  // phase label before (Disbursing / no status) or after (Closed) — we don't
  // store the prior live status, so we never fabricate a specific risk state.
  const liveLabel = isLive ? chip!.label : "Active";
  const liveSub = isLive
    ? (LIVE_STATUS_SUB[chip!.label] ?? "live")
    : "deployed & current";

  return [
    {
      label: "Origination",
      sub: "reviewed & approved",
      index: 1,
      state: hasStatus ? "done" : "pending",
    },
    {
      label: "Disbursing",
      sub: "drawned, not yet funded",
      index: 2,
      state: isDisbursing ? "active" : hasStatus ? "done" : "pending",
    },
    {
      label: liveLabel,
      sub: liveSub,
      index: 3,
      state: isLive ? "active" : isClosed ? "done" : "pending",
    },
    {
      label: "Closed",
      sub: "terminal",
      index: 4,
      state: isClosed ? "active" : "pending",
    },
  ];
}

/** `$X` for a plain USD price string; `—` for null/non-finite. */
function formatPrice(price: string | null): string {
  return formatFullUsd(price);
}

/** `"10%"` for a `[0,1]` fraction string; `""` when unparseable (so the haircut clause is dropped). */
function formatHaircutClause(haircutFraction: string): string {
  const num = parseFloat(haircutFraction);
  if (!Number.isFinite(num)) return "";
  return ` (after ${Math.round(num * 100)}% haircut)`;
}

/** `"620 dmt"` for a quantity string; `—` when absent. */
function formatQuantity(quantityDmt: string | null): string {
  if (quantityDmt == null || quantityDmt.length === 0) return "—";
  return `${quantityDmt} dmt`;
}

/** `"178.00%"` for a CCR percent string; `—` when absent. */
function formatCcrPct(ccrPct: string | null | undefined): string {
  if (ccrPct == null || ccrPct.length === 0) return "—";
  return `${ccrPct}%`;
}

// Builds the hero view-model. spec: docs/frontend/trustee-flows.md#hero.
export function buildHero(
  loanId: string,
  entry: LoanBookEntry | undefined,
): HeroView {
  if (entry == null) {
    return {
      backLabel: BACK_LABEL,
      title: `Loan #${loanId}`,
      status: null,
      meta: `Loan #${loanId}`,
    };
  }
  const chip = statusToChip(entry.status);
  const np = formatNearestPayment(
    entry.next_payment_timestamp,
    entry.days_overdue,
  );
  const paymentClause =
    np.text === "—"
      ? null
      : np.overdue
        ? `payment ${np.text.toLowerCase()}`
        : `next payment ${np.text}`;
  const metaParts = [`Loan #${entry.loan_id}`, paymentClause].filter(
    (p): p is string => p != null,
  );
  return {
    backLabel: BACK_LABEL,
    title: `${entry.originator} · ${entry.commodity}`,
    status: { label: chip.label, band: chip.band },
    meta: metaParts.join(" · "),
  };
}

/**
 * Documents card rows from the loan-book row. Spec:
 * `docs/frontend/trustee-flows.md#documents`. `Array.isArray` guard mirrors
 * `mapDealDetails`'s defensive pattern for an older API build.
 */
export function buildDocuments(
  entry: LoanBookEntry | undefined,
): DocumentDisplay[] {
  if (entry == null || !Array.isArray(entry.documents)) return [];
  return entry.documents.map((doc) => ({
    name: doc.name ?? "",
    uri: doc.uri ?? "",
  }));
}

// spec: docs/frontend/trustee-flows.md#price--collateral-card.
export function buildPriceCollateral(
  valuation: LoanValuationResponse,
  spotChange7d: string | null,
): PriceCollateralView {
  const { inputs, collateral_value, ccr, missing_inputs } = valuation;

  const change = parseSpotChange(spotChange7d);
  const spot: SpotView =
    inputs.reference_price == null
      ? { main: "—", change: null, changeNegative: false }
      : {
          main: formatPrice(inputs.reference_price),
          change: change?.text ?? null,
          changeNegative: change?.negative ?? false,
        };

  const rows: LabelValueRow[] = [
    { label: "Quantity", value: formatQuantity(inputs.quantity_dmt) },
    {
      label: `Collateral value${formatHaircutClause(inputs.haircut_pct)}`,
      value: formatFullUsd(collateral_value),
    },
    {
      label: "Senior outstanding",
      value: formatFullUsd(ccr?.outstanding_senior_principal ?? null),
    },
    { label: "CCR", value: formatCcrPct(ccr?.ccr_pct) },
  ];

  const provider = inputs.price_provider;
  const providerNote =
    provider != null && provider.length > 0 ? `via ${provider}` : "";

  const missingNote =
    missing_inputs.length > 0 ? `Awaiting: ${missing_inputs.join(", ")}` : null;

  return {
    state: "ready",
    errorMessage: null,
    errorDetails: null,
    providerNote,
    spot,
    rows,
    missingNote,
  };
}

/** Formats a decimal-fraction 7-day change (`"-0.012"`) as `"−1.2% 7d"`; `null` when unavailable. */
function parseSpotChange(
  spotChange7d: string | null,
): { text: string; negative: boolean } | null {
  if (spotChange7d == null) return null;
  const change = parseFloat(spotChange7d);
  if (!Number.isFinite(change)) return null;
  const pct = Math.round(Math.abs(change) * 100 * 10) / 10;
  // U+2212 MINUS SIGN / U+002B PLUS SIGN, matching the Figma glyphs.
  const sign = change < 0 ? "−" : "+";
  return { text: `${sign}${pct}% 7d`, negative: change < 0 };
}

// A 404 → neutral "empty" note, not a red error. spec: trustee-flows.md#price--collateral-card.
export function buildPriceCollateralState(
  valuation: UseLoanValuationResult,
  spotChange7d: string | null,
): PriceCollateralView {
  if (valuation.isLoading) return placeholderPc("loading");
  if (valuation.error) {
    if (valuation.error instanceof ApiError && valuation.error.status === 404) {
      return placeholderPc("empty", {
        missingNote: "No valuation on record for this loan.",
      });
    }
    const mapped = toUserError(
      valuation.error,
      "Failed to load the valuation.",
    );
    return placeholderPc("error", {
      errorMessage: mapped.message,
      errorDetails: mapped.details,
    });
  }
  if (valuation.data) return buildPriceCollateral(valuation.data, spotChange7d);
  return placeholderPc("ready");
}

/** A P&C view carrying only a state + a neutral spot placeholder (no rows). */
function placeholderPc(
  state: PriceCollateralView["state"],
  opts: {
    errorMessage?: string | null;
    errorDetails?: string | null;
    missingNote?: string | null;
  } = {},
): PriceCollateralView {
  return {
    state,
    errorMessage: opts.errorMessage ?? null,
    errorDetails: opts.errorDetails ?? null,
    providerNote: "",
    spot: { main: "—", change: null, changeNegative: false },
    rows: [],
    missingNote: opts.missingNote ?? null,
  };
}

// ── Registry state & derived (issue #852) ────────────────────────────────────

// Displayed exactly as served (issue #906 — the ×1000 workaround was removed).
const fmtRegistryUsd = formatCompactUsd;

// spec: docs/frontend/trustee-flows.md#registry-state--derived-852.
function formatEpoch(epoch: Epoch | null): string {
  if (epoch == null) return "—";
  return (
    `${epoch.number} · ${formatBpsRate(epoch.current_apy_bps)} · ` +
    `${formatEpochDate(epoch.start_date)} → ${formatEpochDate(epoch.maturity_date)}`
  );
}

export function buildFinancials(
  data: LoanFinancialsResponse,
  protection: string | null = null,
): RegistryRow[] {
  const loc = data.location;
  const statusLocation = loc
    ? `${data.status} · ${loc.location_type} ${loc.location_identifier}`.trim()
    : data.status;

  return [
    { label: "Status / location", value: statusLocation, tag: "chain" },
    // Protection: #1014. spec: docs/frontend/trustee-flows.md#registry-state--derived-852.
    {
      label: "Protection",
      value: protection != null && protection.length > 0 ? protection : "—",
      tag: "relayer",
    },
    { label: "Epochs", value: formatEpoch(data.epoch), tag: "chain" },
    {
      label: "Recorded counters",
      value:
        `offtaker ${fmtRegistryUsd(data.offtaker)} · ` +
        `principal ${fmtRegistryUsd(data.principal)} · ` +
        `interest ${fmtRegistryUsd(data.interest)} · ` +
        `fees ${fmtRegistryUsd(data.fees)}`,
      tag: "chain",
    },
    {
      label: "Offtaker still owed",
      value: `${fmtRegistryUsd(data.offtaker_outstanding)} of ${fmtRegistryUsd(data.offtaker)}`,
      tag: "computed",
    },
    {
      label: "Unminted yield",
      value: fmtRegistryUsd(data.not_minted_yield),
      tag: "computed",
    },
    // No custodian-co-sig / mint-queue field on /financials yet — pending (#852).
    { label: "Custodian co-sig on mint", value: "—", tag: "relayer" },
  ];
}

function tileValuePair(left: string, right: string): string {
  return `${left} / ${right}`;
}

function formatRateWithEpochs(epoch: Epoch | null | undefined): SummaryTile {
  if (epoch == null) {
    return {
      label: "Rate · epochs",
      value: "—",
      sub: "—",
      subTone: "muted",
    };
  }
  return {
    label: "Rate · epochs",
    value: `${formatBpsRate(epoch.current_apy_bps)} p.a.`,
    sub: `epoch ${epoch.number}`,
    subTone: "muted",
  };
}

/**
 * Builds the three summary tiles from served backend fields. Missing fields
 * render `—`; the old static fixture is no longer used for these values.
 */
export function buildSummaryTiles(
  entry: LoanBookEntry | undefined,
  financials: LoanFinancialsResponse | undefined,
  variant: LoanDetailVariant,
): SummaryTile[] {
  const facility = formatCompactUsd(entry?.principal);
  const repaid = formatCompactUsd(entry?.repaid_to_date);
  const disbursedAmount =
    entry == null
      ? "—"
      : entry.disbursed
        ? facility
        : formatCompactUsd("0.000000");

  const facilityTile: SummaryTile =
    variant === "matured"
      ? {
          label: "Facility / senior",
          value: tileValuePair(facility, disbursedAmount),
          sub: "—",
          subTone: "muted",
        }
      : {
          label: "Facility / disbursed",
          value: tileValuePair(
            facility,
            formatCompactUsd(entry?.original_senior_tranche),
          ),
          sub:
            entry == null
              ? "—"
              : entry.disbursed
                ? "funded"
                : "drawned, not yet funded",
          subTone: entry?.disbursed ? "positive" : "attention",
        };

  const repaidTile: SummaryTile = {
    label: "Repaid to date",
    value: repaid,
    sub: "offtaker received",
    subTone: "muted",
  };

  if (variant === "watchlist") {
    return [
      facilityTile,
      repaidTile,
      {
        label: "Days on watchlist",
        value:
          entry?.days_on_watchlist == null
            ? "—"
            : String(entry.days_on_watchlist),
        sub: "—",
        subTone: "muted",
      },
    ];
  }

  if (variant === "matured") {
    return [facilityTile, repaidTile, formatRateWithEpochs(financials?.epoch)];
  }

  return [
    facilityTile,
    repaidTile,
    {
      label: "Interest to distribute",
      value: formatCompactUsd(financials?.not_minted_yield),
      sub: "not minted yield",
      subTone: "attention",
    },
  ];
}

// A 404 → neutral "empty" note, not a red error (mirrors P&C).
// spec: docs/frontend/trustee-flows.md#registry-state--derived-852.
export function buildRegistryState(
  financials: UseLoanFinancialsResult,
  protection: string | null = null,
): RegistryView {
  if (financials.isLoading) {
    return {
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    };
  }
  if (financials.error) {
    if (
      financials.error instanceof ApiError &&
      financials.error.status === 404
    ) {
      return {
        state: "empty",
        errorMessage: null,
        errorDetails: null,
        rows: [],
      };
    }
    const mapped = toUserError(
      financials.error,
      "Failed to load the financials.",
    );
    return {
      state: "error",
      errorMessage: mapped.message,
      errorDetails: mapped.details,
      rows: [],
    };
  }
  if (financials.data) {
    return {
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: buildFinancials(financials.data, protection),
    };
  }
  return { state: "ready", errorMessage: null, errorDetails: null, rows: [] };
}

/**
 * spec: docs/frontend/trustee-flows.md#ccr-trend-chart-watchlist-variant-figma-node-411610868.
 */
export function buildCcrTrend(
  ccrHistory: UseLoanCcrHistoryResult,
): CcrTrend | null {
  const points = ccrHistory.data?.points ?? [];
  if (points.length === 0) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const toPct = (bps: number) => Math.round(bps / 100);

  return {
    points: points.map((p) => p.ccr_bps / 100),
    startLabel: `${toPct(first.ccr_bps)}% · ${formatEpochDate(first.timestamp)}`,
    currentLabel: `${toPct(last.ccr_bps)}%`,
    thresholds: CCR_TREND_THRESHOLDS,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

// Wires loan-book (hero source, top-level `state`) + valuation + financials
// (each with their own `state`) for `loanId`. spec: trustee-flows.md#loan-detail.
export function useLoanDetail(loanId: string): UseLoanDetailResult {
  const loanBook = useLoanBook();
  const valuation = useLoanValuation(loanId);
  const financials = useLoanFinancials(loanId);

  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  // CCR-trend series (#879), origination through now, daily. Self-disables
  // until `from` is known; only built for the Watchlist variant.
  const ccrFrom =
    entry != null ? entry.maturity - entry.duration_days * 86_400 : null;
  const ccrHistory = useLoanCcrHistory(loanId, ccrFrom);

  const state: LoanDetailState = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : "ready";

  const priceCollateral = buildPriceCollateralState(
    valuation,
    entry?.spot_change_7d ?? null,
  );

  // spec: docs/frontend/trustee-flows.md#status-conditional-layout-859862866.
  const chipLabel = entry != null ? statusToChip(entry.status).label : null;
  const variant: LoanDetailVariant =
    chipLabel === "Watchlist"
      ? "watchlist"
      : chipLabel === "Disbursing"
        ? "disbursing"
        : chipLabel === "Matured"
          ? "matured"
          : "performing";

  const tiles = buildSummaryTiles(entry, financials.data, variant);
  const otherActions = selectOtherActions(chipLabel, variant);
  // Hidden for now (#938) — spec: trustee-flows.md#status-conditional-layout-859862866.
  const currentStage: CurrentStage | null = null;

  const loanBookError = loanBook.error
    ? toUserError(loanBook.error, "Failed to load the loan.")
    : null;

  return {
    state,
    errorMessage: loanBookError?.message ?? null,
    errorDetails: loanBookError?.details ?? null,
    variant,
    hero: buildHero(loanId, entry),
    lifecycle: buildLifecycle(entry?.status),
    tiles,
    registry: buildRegistryState(financials, entry?.protection ?? null),
    currentStage,
    otherActions,
    priceCollateral,
    ccrTrend: variant === "watchlist" ? buildCcrTrend(ccrHistory) : null,
    rollover: variant === "matured" ? MATURED_ROLLOVER_CARD : null,
    maturityDate: entry ? formatMaturityDate(entry.maturity) : null,
    documents: buildDocuments(entry),
  };
}
