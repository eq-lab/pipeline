/**
 * View-model + data wiring for the Trustee **Loan detail** page (issues #845 /
 * #847, Figma node `4116:10549`). Per `docs/FRONTEND.md` Code structure rule 2
 * the `.tsx` route is render-only; this hook owns the live fetches, the
 * value→display mapping, and the composition of live + still-mock sections, so
 * the builders below are unit-testable without a DOM (mirrors `-useLoansTable.ts`).
 *
 * ## Live vs. mock (data-sourcing convention)
 * Now that `GET /v1/loan-book` serves a real `loan_id`, two sections are sourced
 * live for the clicked loan; the rest remain the #847 static mock until a
 * backend source lands (then migrate them the same way):
 *   - **Hero identity** ← the matching `/v1/loan-book` row (originator, commodity,
 *     on-chain status), keyed by `loan_id`. The status bar carries no dates
 *     (maturity is a key number, not a status field — §S5); the chip maps the
 *     raw on-chain status via `statusToChip` (design assignment §3.2).
 *   - **Price & collateral** ← `GET /v1/loan-book/{loan_id}/valuations`
 *     (`useLoanValuation`).
 *   - **Loan-lifecycle stepper** ← derived from the on-chain status
 *     (`buildLifecycle`); no longer a static fixture (design assignment §3.2).
 *   - **Registry state & derived** ← `GET /v1/loan-book/{loan_id}/financials`
 *     (`useLoanFinancials`, issue #852).
 *   - **Summary tiles** ← the matching `/v1/loan-book` row plus
 *     `/financials` for unminted yield / epoch APY (issue #874).
 *   - Current stage · other actions ← `LOAN_DETAIL_MOCK` (no backend source yet).
 *
 * ## Never-fabricate (memory: no frontend-computed metrics)
 * The valuation endpoint drives P&C directly; fields it does not serve are NOT
 * carried over from the old mock:
 *   - the "feed 2h old · recalcs every 60 min" freshness note → replaced by the
 *     real `price_provider` attribution (or dropped when absent);
 *   - the "Last on-chain write: CCR 135% · 12 May" footnote → dropped (no source);
 *   - absent inputs surface as `—` plus a real `missing_inputs` "Awaiting:" note.
 * The one cross-source value is the spot 7-day change, taken from the loan-book
 * row's `spot_change_7d` (same underlying price series as the valuation's
 * `reference_price`) — a served field, not a derived one.
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
  formatRegistryCompactUsd,
} from "@/utils/formatUsd";
import { formatEpochDate, formatMaturityDate } from "@/utils/formatDate";
import {
  LOAN_DETAIL_MOCK,
  LOAN_DETAIL_DISBURSING_OTHER_ACTIONS,
  LOAN_DETAIL_MATURED_MOCK,
  LOAN_DETAIL_WATCHLIST_MOCK,
  type CurrentStage,
  type OtherActions,
  type RolloverCard,
  type SummaryTile,
} from "./-loanDetailMock";
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

/**
 * The CCR-trend chart view-model (Watchlist variant), built from the real
 * `/ccr-history` series (#879) — replaces the fixed-geometry mock (#859).
 * `points` are the CCR percentages oldest → newest; the card derives the
 * polyline + a per-loan y-scale from them and the thresholds.
 */
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

/**
 * Protocol CCR watchlist thresholds (spec §9.6): 120% maintenance-margin and
 * 110% margin-call — the two dashed guide-lines the Figma chart shows. These are
 * protocol-wide defaults; no endpoint serves per-loan overrides yet (#879).
 */
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

/**
 * Maps the raw on-chain loan status string to its display chip + colour band,
 * per the Trustee Dashboard design assignment §3.2 "Loan status chip":
 *
 *   | on-chain status | chip label | band      |
 *   | Performing      | Performing | positive  |
 *   | Watchlist       | Watchlist  | attention |
 *   | Matured         | Past Due   | negative  |  ← display rename
 *   | Default         | Default    | negative  |
 *   | Closed          | Closed     | neutral   |
 *
 * The `Disbursing` chip (a Performing loan whose outbound disbursement has not
 * reached "Wired") is a data-derived divergence that needs movement state not
 * served to this page, so it is not distinguished here — a Performing loan
 * renders "Performing". Backend accepts both `Watchlist` and the legacy
 * `WatchList` casing. Unknown values fall through to a neutral chip printing the
 * raw string verbatim (never fabricated).
 */
export function statusToChip(rawStatus: string): StatusChip {
  switch (rawStatus) {
    // `Disbursing` is a backend-derived display status (off-ramp not yet
    // complete); a Performing-family in-progress state → `info` (brand) band.
    case "Disbursing":
      return { label: "Disbursing", band: "info", raw: rawStatus };
    case "Performing":
      return { label: "Performing", band: "positive", raw: rawStatus };
    case "Watchlist":
    case "WatchList":
      return { label: "Watchlist", band: "attention", raw: rawStatus };
    // Backend now serves `Past Due` directly; keep `Matured` as a legacy fallback.
    // Past-maturity: the backend serves `Past Due`, but the design renders this
    // state as **Matured** (chip + dedicated screen + rollover, #866/#867). The
    // legacy `Matured` value maps the same. Olive/attention band.
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

/**
 * Short descriptor for each live status on the middle "live" node (design
 * assignment §3.2 "Meaning" column).
 */
const LIVE_STATUS_SUB: Record<string, string> = {
  Performing: "deployed & current",
  Watchlist: "elevated risk",
  Matured: "past maturity",
  Default: "council declared",
};

/**
 * Builds the loan-lifecycle stepper from the raw on-chain status.
 *
 * The stepper is the **happy-path spine** of the design-assignment §3.2 status
 * diagram — `Origination → Disbursing → (live) → Closed` — NOT a linear list of
 * every status. Watchlist / Past Due / Default are **branch flows off the live
 * state**, not sequential stages, so they are never shown as "upcoming" steps
 * (issue #854): a healthy Performing loan's only forward step is **Closed**.
 *
 * The middle **live node** reflects where the loan actually is: while live it
 * takes the current status label (`Performing` / `Watchlist` / `Past Due` /
 * `Default` via `statusToChip`); once `Closed` it reads as the completed
 * `Performing` phase. States:
 *   - `Origination` — done for any loan the loan-book returns (it exists on-chain).
 *   - `Disbursing` — **active** when the served status is `Disbursing` (off-ramp
 *     not yet complete, issue #862); done once the loan is live/closed; pending
 *     when no status. (Now that the backend serves `Disbursing` directly, this
 *     step can be the current one — closes the #854 data gap.)
 *   - live node — active while the loan is a live non-Disbursing status; done
 *     once Closed; pending while still Disbursing.
 *   - `Closed` — active when the status is `Closed`, else pending.
 *
 * An absent status (no loan-book row) leaves every step pending — never fabricated.
 */
export function buildLifecycle(rawStatus: string | undefined): LifecycleStep[] {
  const hasStatus = rawStatus != null && rawStatus.length > 0;
  const chip = hasStatus ? statusToChip(rawStatus) : null;
  const isClosed = chip?.label === "Closed";
  const isDisbursing = chip?.label === "Disbursing";
  // Live = a non-Disbursing, non-Closed status (Performing / Watchlist / Past Due / Default).
  const isLive = hasStatus && !isClosed && !isDisbursing;

  // The live node adopts the current status while live; a neutral "Performing"
  // phase label before (Disbursing / no status) or after (Closed) — we don't
  // store the prior live status, so we never fabricate a specific risk state.
  const liveLabel = isLive ? chip!.label : "Performing";
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

/**
 * Builds the hero view-model from the matching loan-book row. When no row is
 * found (e.g. a direct URL to a non-active loan), degrades to the loan id only —
 * never fabricates identity.
 *
 * The meta prints the loan id + the **maturity date** (both layouts — issue #859;
 * the maturity is a real served field, `entry.maturity`). The chip shows the
 * mapped display status (`statusToChip`). The Figma hero corridor
 * (`Colombia → Italy`) has no backend source and is omitted (never fabricated).
 */
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
  const maturityDate = formatMaturityDate(entry.maturity);
  // A matured loan's maturity has passed → "<date> — passed"; otherwise
  // "matures <date>". Dropped entirely when the date is unavailable.
  const maturityClause =
    maturityDate === "—"
      ? null
      : chip.label === "Matured"
        ? `${maturityDate} — passed`
        : `matures ${maturityDate}`;
  const metaParts = [`Loan #${entry.loan_id}`, maturityClause].filter(
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
 * Builds the Price & collateral view-model from the valuation response. `spotChange7d`
 * is the loan-book row's served trailing change (decimal fraction, e.g. `"-0.012"`),
 * paired with the valuation's `reference_price`; `null` drops the change span.
 */
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

/**
 * Maps the valuation query's load/error/data states to the P&C view-model. A
 * 404 (`ApiError.status === 404`) is the loan having no valuation anchor on
 * record → a neutral `"empty"` note, not a red error.
 */
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
    return placeholderPc("error", { errorMessage: valuation.error.message });
  }
  if (valuation.data) return buildPriceCollateral(valuation.data, spotChange7d);
  return placeholderPc("ready");
}

/** A P&C view carrying only a state + a neutral spot placeholder (no rows). */
function placeholderPc(
  state: PriceCollateralView["state"],
  opts: { errorMessage?: string | null; missingNote?: string | null } = {},
): PriceCollateralView {
  return {
    state,
    errorMessage: opts.errorMessage ?? null,
    providerNote: "",
    spot: { main: "—", change: null, changeNegative: false },
    rows: [],
    missingNote: opts.missingNote ?? null,
  };
}

// ── Registry state & derived (issue #852) ────────────────────────────────────

/**
 * ⚠️ #840 workaround (issue #852 open question a) — the financials money fields
 * are registry/loan-snapshot-sourced, so they are treated as **1000× too small on
 * the wire** and scaled ×1000 (`formatRegistryCompactUsd`), the same family as the
 * loan-book `senior_outstanding` correction. **Verify against real data**; if this
 * endpoint serves correct-scale amounts, swap to `formatCompactUsd`.
 */
const fmtRegistryUsd = formatRegistryCompactUsd;

/**
 * Builds the "Registry state & derived" rows from the financials response.
 *
 * `Epochs` and `Custodian co-sig on mint` have no field on this endpoint yet, so
 * they render `—` pending clarification (issue #852 open question c) — never
 * fabricated. `not_minted_yield` is shown as a single figure (no vault/treasury
 * split — open question b).
 */
/**
 * Formats the current epoch as `"1 · 10.0% · 18 Jun 2026 → 19 Aug 2029"`
 * (number · APY · start → maturity); `—` when no epoch is on record (#857).
 */
function formatEpoch(epoch: Epoch | null): string {
  if (epoch == null) return "—";
  return (
    `${epoch.number} · ${formatBpsRate(epoch.current_apy_bps)} · ` +
    `${formatEpochDate(epoch.start_date)} → ${formatEpochDate(epoch.maturity_date)}`
  );
}

export function buildFinancials(data: LoanFinancialsResponse): RegistryRow[] {
  const loc = data.location;
  const statusLocation = loc
    ? `${data.status} · ${loc.location_type} ${loc.location_identifier}`.trim()
    : data.status;

  return [
    { label: "Status / location", value: statusLocation, tag: "chain" },
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
  const facility = formatRegistryCompactUsd(entry?.principal);
  const repaid = formatRegistryCompactUsd(entry?.repaid_to_date);
  const disbursedAmount =
    entry == null
      ? "—"
      : entry.disbursed
        ? facility
        : formatRegistryCompactUsd("0.000000");

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
            formatRegistryCompactUsd(entry?.original_senior_tranche),
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
      value: formatRegistryCompactUsd(financials?.not_minted_yield),
      sub: "not minted yield",
      subTone: "attention",
    },
  ];
}

/**
 * Maps the financials query's load/error/data states to the Registry view-model.
 * A 404 (`ApiError.status === 404`) — no financials on record for the loan —
 * renders a neutral `"empty"` note, not a red error (mirrors P&C).
 */
export function buildRegistryState(
  financials: UseLoanFinancialsResult,
): RegistryView {
  if (financials.isLoading) {
    return { state: "loading", errorMessage: null, rows: [] };
  }
  if (financials.error) {
    if (
      financials.error instanceof ApiError &&
      financials.error.status === 404
    ) {
      return { state: "empty", errorMessage: null, rows: [] };
    }
    return { state: "error", errorMessage: financials.error.message, rows: [] };
  }
  if (financials.data) {
    return {
      state: "ready",
      errorMessage: null,
      rows: buildFinancials(financials.data),
    };
  }
  return { state: "ready", errorMessage: null, rows: [] };
}

/**
 * Builds the CCR-trend view-model from the `/ccr-history` series (#879).
 * `ccr_bps` (12_000 = 120%) → percent. Returns `null` when the series has no
 * points (never priced / empty window) so the card is simply omitted rather
 * than drawing a fabricated line.
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

/**
 * Wires the loan-book row (hero + lifecycle), the per-loan valuation (Price &
 * collateral), and the per-loan financials (Registry state & derived) for
 * `loanId`, composed with the still-mock sections. The top-level `state` tracks
 * the loan-book fetch (hero source); Price & collateral and Registry each carry
 * their own `state` so they load/error independently within the page.
 */
export function useLoanDetail(loanId: string): UseLoanDetailResult {
  const loanBook = useLoanBook();
  const valuation = useLoanValuation(loanId);
  const financials = useLoanFinancials(loanId);

  const entry = loanBook.data?.loans.find((l) => l.loan_id === loanId);

  // CCR-trend series (#879) — from the loan's origination
  // (`maturity − duration_days`) through now, daily. The hook self-disables
  // until `from` is known; we only build the chart for the Watchlist variant.
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

  // Status-conditional layout (§859 / §862 / §866): the served display status
  // selects the section set. Watchlist and Matured have their own layouts;
  // Disbursing reuses the performing layout with the disbursement-complete card.
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
  const otherActions =
    variant === "watchlist"
      ? LOAN_DETAIL_WATCHLIST_MOCK.otherActions
      : variant === "matured"
        ? LOAN_DETAIL_MATURED_MOCK.otherActions
        : variant === "disbursing"
          ? LOAN_DETAIL_DISBURSING_OTHER_ACTIONS
          : LOAN_DETAIL_MOCK.otherActions;
  // Only the Watchlist variant renders a current-stage card (its escalation
  // copy). The Performing "on-ramp in transit" card was removed (#876);
  // Disbursing shows the disbursement-complete action, Matured the rollover
  // card. `null` for every non-watchlist variant.
  const currentStage =
    variant === "watchlist"
      ? (LOAN_DETAIL_WATCHLIST_MOCK.currentStage ?? null)
      : null;

  return {
    state,
    errorMessage: loanBook.error?.message ?? null,
    variant,
    hero: buildHero(loanId, entry),
    lifecycle: buildLifecycle(entry?.status),
    tiles,
    registry: buildRegistryState(financials),
    currentStage,
    otherActions,
    priceCollateral,
    ccrTrend: variant === "watchlist" ? buildCcrTrend(ccrHistory) : null,
    rollover: variant === "matured" ? LOAN_DETAIL_MATURED_MOCK.rollover : null,
    maturityDate: entry ? formatMaturityDate(entry.maturity) : null,
  };
}
