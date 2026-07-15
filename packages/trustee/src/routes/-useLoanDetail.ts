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
 *   - Summary tiles · current stage · other actions ← `LOAN_DETAIL_MOCK` (no
 *     backend source yet).
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
  LoanFinancialsResponse,
  UseLoanFinancialsResult,
} from "@/api/useLoanFinancials";
import { ApiError } from "@/api/client";
import { formatFullUsd, formatRegistryCompactUsd } from "@/utils/formatUsd";
import {
  LOAN_DETAIL_MOCK,
  type CurrentStage,
  type OtherActions,
  type SummaryTile,
} from "./-loanDetailMock";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StatusBand = "positive" | "attention" | "negative" | "neutral";

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

export interface UseLoanDetailResult {
  /** Driven by the loan-book fetch (the hero source). */
  state: LoanDetailState;
  errorMessage: string | null;
  hero: HeroView;
  lifecycle: LifecycleStep[];
  tiles: SummaryTile[];
  registry: RegistryView;
  currentStage: CurrentStage;
  otherActions: OtherActions;
  priceCollateral: PriceCollateralView;
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
    case "Performing":
      return { label: "Performing", band: "positive", raw: rawStatus };
    case "Watchlist":
    case "WatchList":
      return { label: "Watchlist", band: "attention", raw: rawStatus };
    case "Matured":
      return { label: "Past Due", band: "negative", raw: rawStatus };
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
  /** Status label (the §3.2 chip label). */
  label: string;
  /** Short descriptor beneath the node, from the §3.2 "Meaning" column. */
  sub: string;
  state: StepState;
  /** 1-based position shown inside active/pending nodes (done nodes show a check). */
  index: number;
}

/**
 * The loan lifecycle, in order — the stepper's fixed node list. It opens with
 * **Origination** (the §3.1 In Review → Approved phase, before the loan exists
 * on-chain), which is always complete for any loan the loan-book returns; then
 * the §3.2 chip statuses. Sub-lines are short descriptors distilled from the
 * MD's "Meaning" columns (static design copy, not per-loan data).
 */
const LIFECYCLE: readonly { label: string; sub: string }[] = [
  { label: "Origination", sub: "reviewed & approved" },
  { label: "Disbursing", sub: "minted, not yet funded" },
  { label: "Performing", sub: "deployed & current" },
  { label: "Watchlist", sub: "elevated risk" },
  { label: "Past Due", sub: "overdue, unpaid" },
  { label: "Default", sub: "council declared" },
  { label: "Closed", sub: "terminal" },
] as const;

/**
 * Builds the loan-lifecycle stepper from the raw on-chain status. Any loan the
 * loan-book returns has already cleared **Origination** (it exists on-chain), so
 * that first step is always done. The current step is then the mapped chip label
 * (`statusToChip`); earlier steps render done, later steps pending.
 *
 * Data note: on-chain `Performing` maps to the **Performing** step, so
 * **Disbursing** (approved on-chain but the disbursement wire not yet sent) also
 * shows as done and is never the current step here — distinguishing it needs the
 * off-chain "wire sent" movement signal, which this page is not served yet. The
 * step exists so the derivation is ready the moment that signal lands. An
 * absent status (no loan-book row) leaves every step pending — never fabricated.
 */
export function buildLifecycle(rawStatus: string | undefined): LifecycleStep[] {
  const hasStatus = rawStatus != null && rawStatus.length > 0;
  const currentLabel = hasStatus ? statusToChip(rawStatus).label : null;
  const currentIndex = currentLabel
    ? LIFECYCLE.findIndex((s) => s.label === currentLabel)
    : -1;
  return LIFECYCLE.map((step, i) => {
    let state: StepState;
    if (currentIndex < 0) {
      // Loan exists but its status is unmapped: Origination is still complete.
      state = hasStatus && step.label === "Origination" ? "done" : "pending";
    } else {
      state =
        i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
    }
    return { label: step.label, sub: step.sub, index: i + 1, state };
  });
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
 * The status bar carries **no dates** (maturity is a "key number", not a status
 * field — design assignment §S5): the meta is the loan id plus the raw on-chain
 * status the backend serves (always printed per §3.2), while the chip shows the
 * mapped display label (`statusToChip`).
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
  return {
    backLabel: BACK_LABEL,
    title: `${entry.originator} · ${entry.commodity}`,
    status: { label: chip.label, band: chip.band },
    meta: `Loan #${entry.loan_id} · on-chain ${chip.raw}`,
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
export function buildFinancials(data: LoanFinancialsResponse): RegistryRow[] {
  const loc = data.location;
  const statusLocation = loc
    ? `${data.status} · ${loc.location_type} ${loc.location_identifier}`.trim()
    : data.status;

  return [
    { label: "Status / location", value: statusLocation, tag: "chain" },
    // No epoch/terms field on /financials yet — pending clarification (#852).
    { label: "Epochs", value: "—", tag: "chain" },
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

  const state: LoanDetailState = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : "ready";

  const priceCollateral = buildPriceCollateralState(
    valuation,
    entry?.spot_change_7d ?? null,
  );

  return {
    state,
    errorMessage: loanBook.error?.message ?? null,
    hero: buildHero(loanId, entry),
    lifecycle: buildLifecycle(entry?.status),
    tiles: LOAN_DETAIL_MOCK.tiles,
    registry: buildRegistryState(financials),
    currentStage: LOAN_DETAIL_MOCK.currentStage,
    otherActions: LOAN_DETAIL_MOCK.otherActions,
    priceCollateral,
  };
}
