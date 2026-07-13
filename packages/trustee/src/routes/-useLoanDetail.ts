/**
 * View-model for the Trustee **Loan detail** page (issue #845, Figma node
 * `4116:10549`). Per `docs/FRONTEND.md` rule 2 the `.tsx` route is render-only;
 * this hook owns the data wiring (`useLoanValuation` + a `useLoanBook` fallback)
 * and maps it into a hero + Price & collateral view-model — unit-testable
 * without a DOM (mirrors `-useLoanDetail`'s sibling `-useLoansTable.ts`).
 *
 * ## Data sources
 * - **Hero identity** comes from the clicked `LoanBookEntry`, passed via router
 *   navigation state from the `/loans` row. On a direct URL / hard refresh that
 *   state is gone, so we fall back to `useLoanBook()` and find the row by
 *   `loan_id`; a not-found state renders when it is absent (mirrors
 *   `-origination-detail.ts`).
 * - **Price & collateral** comes from `useLoanValuation(loanId)` →
 *   `GET /v1/loan-book/{loan_id}/valuations`.
 *
 * ## Scale note
 * The valuation endpoint serves **plain USD** (already computed) — the `#840`
 * ×1000 registry workaround and the list page's CCR ÷1000 correction do NOT
 * apply here. `ccr.ccr_pct` is display-ready.
 *
 * ## Never-fabricate (exec plan open questions, default = omit)
 * `corridor` (unavailable anywhere), the spot feed **age**, the senior-outstanding
 * **repaid date**, the CCR **"price risk closed"** phrase, and the **"Last
 * on-chain write …"** history line have no data source → omitted. The hero's
 * "N days left" IS derived from the served `maturity` (a display transform of a
 * served field, like the #843 CCR staleness age).
 */
import { useLoanBook, type LoanBookEntry } from "@/api/useLoanBook";
import {
  useLoanValuation,
  type CollateralValuationResponse,
} from "@/api/useLoanValuation";
import { formatFullUsd } from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";

/**
 * Declares the `entry` key on TanStack Router's `HistoryState` (module
 * augmentation, mirroring `-origination-detail.ts`'s `submission` key) so the
 * `/loans` row's `navigate({ state: { entry } })` and this route's
 * `useLocation().state.entry` read type-check without a cast.
 */
declare module "@tanstack/history" {
  interface HistoryState {
    entry?: LoanBookEntry;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Status-chip colour band — the view maps each to the #843 status colours. */
export type LoanStatusBand = "positive" | "attention" | "negative" | "neutral";

export interface HeroView {
  /** `originator · commodity`, e.g. `"Helios Metals · Lithium"`. */
  title: string;
  /** Status chip label (prettified) + colour band. */
  status: { label: string; band: LoanStatusBand };
  /** Meta line, e.g. `"Loan #4488 · matures 30 Jun 2026 · 9 days left"`. */
  meta: string;
}

/** The spot sub-line of the Price & collateral card. */
export interface SpotView {
  /** e.g. `"Li2CO3 $10,450"` or with change `"Li2CO3 $10,450 · −1.2% 7d"`. */
  text: string;
  /** Trailing 7-day change is negative → the view paints it red. */
  negative: boolean;
}

export interface PriceCollateralView {
  state: "loading" | "error" | "ready";
  errorMessage: string | null;
  /** Static freshness note (Figma "recalcs every 60 min"; the "Nh old" age is unbacked). */
  feedNote: string;
  /** Spot line, or `null` when the asset is unpriced → renders `—`. */
  spot: SpotView | null;
  /** Quantity, e.g. `"620 t"`; `—` when unreported. */
  quantity: string;
  /** Collateral row label incl. the served haircut, e.g. `"Collateral value (after 10% haircut)"`. */
  collateralLabel: string;
  /** Collateral value, full USD (`$5,831,100`); `—` when an input is missing. */
  collateralValue: string;
  /** Outstanding senior, full USD (`$0`); `—` when the CCR block is unavailable. */
  seniorOutstanding: string;
  /** CCR, percent (`135%`) or `n/a` when unavailable. */
  ccr: string;
}

export type LoanDetailState = "loading" | "not-found" | "ready";

export interface UseLoanDetailResult {
  state: LoanDetailState;
  hero: HeroView | null;
  priceCollateral: PriceCollateralView | null;
}

// ── Hero helpers (pure) ─────────────────────────────────────────────────────────

function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

/** Prettified label + colour band for a served loan `status`. */
export function classifyStatus(status: string): {
  label: string;
  band: LoanStatusBand;
} {
  switch (status) {
    case "Performing":
      return { label: "Performing", band: "positive" };
    case "WatchList":
      return { label: "Watchlist", band: "attention" };
    case "Matured":
      return { label: "Past Due", band: "negative" };
    case "Default":
      return { label: "Default", band: "negative" };
    case "Closed":
      return { label: "Closed", band: "neutral" };
    case "Disbursing":
      return { label: "Disbursing", band: "neutral" };
    default:
      return { label: safeString(status), band: "neutral" };
  }
}

/**
 * Builds the hero view-model from a resolved `LoanBookEntry`. `nowMs` is injected
 * for deterministic "N days left". `corridor` is intentionally absent from the
 * meta line (no backend source — never fabricated).
 */
export function buildHero(entry: LoanBookEntry, nowMs: number): HeroView {
  const title = `${safeString(entry.originator)} · ${safeString(entry.commodity)}`;

  const segments: string[] = [`Loan #${safeString(entry.loan_id)}`];
  if (Number.isFinite(entry.maturity) && entry.maturity > 0) {
    segments.push(`matures ${formatMaturityDate(entry.maturity)}`);
    const daysLeft = Math.ceil((entry.maturity * 1000 - nowMs) / 86_400_000);
    if (daysLeft > 0) {
      segments.push(`${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`);
    }
  }

  return {
    title,
    status: classifyStatus(entry.status),
    meta: segments.join(" · "),
  };
}

// ── Price & collateral helpers (pure) ───────────────────────────────────────────

/** Formats a decimal-fraction 7-day change (`"-0.0120"`) as `"−1.2% 7d"`. */
function formatChange7d(fraction: string | null | undefined): {
  text: string;
  negative: boolean;
} | null {
  if (fraction == null) return null;
  const num = parseFloat(fraction);
  if (!Number.isFinite(num)) return null;
  const pct = Math.round(Math.abs(num) * 1000) / 10; // one decimal
  const sign = num < 0 ? "−" : "+";
  return { text: `${sign}${pct}% 7d`, negative: num < 0 };
}

/** Plain-number formatter (no `$`), e.g. `"620.000000"` → `"620"`. `—` on null/NaN. */
function formatQuantity(dmt: string | null): string {
  if (dmt == null) return "—";
  const num = parseFloat(dmt);
  if (!Number.isFinite(num)) return "—";
  return `${num.toLocaleString("en-US")} t`;
}

/** CCR percent string (`"135.00"`) → `"135%"` / `"178.5%"`; `n/a` when null. */
function formatCcrPct(ccrPct: string | null | undefined): string {
  if (ccrPct == null) return "n/a";
  const num = parseFloat(ccrPct);
  if (!Number.isFinite(num)) return "n/a";
  return `${num}%`;
}

/**
 * Builds the Price & collateral view-model. `spotChange7d` is threaded from the
 * loan-book row (it is not on the valuation endpoint). Every value degrades to
 * `—` / `n/a` on a missing input — never fabricated.
 */
export function buildPriceCollateral(
  valuation: CollateralValuationResponse,
  spotChange7d: string | null | undefined,
): Omit<PriceCollateralView, "state" | "errorMessage"> {
  const { inputs } = valuation;

  let spot: SpotView | null = null;
  if (inputs.reference_price != null) {
    const price = formatFullUsd(inputs.reference_price);
    if (price !== "—") {
      const asset = safeString(inputs.reference_price_asset);
      const change = formatChange7d(spotChange7d);
      spot = change
        ? {
            text: `${asset} ${price} · ${change.text}`,
            negative: change.negative,
          }
        : { text: `${asset} ${price}`, negative: false };
    }
  }

  const haircut = inputs.haircut_pct;
  const collateralLabel =
    haircut && parseFloat(haircut) > 0
      ? `Collateral value (after ${parseFloat(haircut)}% haircut)`
      : "Collateral value";

  return {
    feedNote: "recalcs every 60 min",
    spot,
    quantity: formatQuantity(inputs.quantity_dmt),
    collateralLabel,
    collateralValue: formatFullUsd(valuation.collateral_value),
    seniorOutstanding: formatFullUsd(
      valuation.ccr?.outstanding_senior_principal ?? null,
    ),
    ccr: formatCcrPct(valuation.ccr?.ccr_pct),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Wires the loan detail page's data. `navEntry` is the `LoanBookEntry` passed via
 * router navigation state (undefined on direct URL / refresh → resolved from the
 * loan-book list by `loanId`).
 */
export function useLoanDetail(
  loanId: string,
  navEntry: LoanBookEntry | undefined,
): UseLoanDetailResult {
  const book = useLoanBook();
  const valuation = useLoanValuation(loanId);

  const entry = navEntry ?? book.data?.loans.find((l) => l.loan_id === loanId);

  // Resolve the hero identity first (page-level state).
  if (!entry) {
    if (!navEntry && book.isLoading) {
      return { state: "loading", hero: null, priceCollateral: null };
    }
    return { state: "not-found", hero: null, priceCollateral: null };
  }

  const hero = buildHero(entry, Date.now());

  // The Price & collateral card carries its own sub-state.
  let priceCollateral: PriceCollateralView;
  if (valuation.isLoading) {
    priceCollateral = {
      state: "loading",
      errorMessage: null,
      feedNote: "recalcs every 60 min",
      spot: null,
      quantity: "—",
      collateralLabel: "Collateral value",
      collateralValue: "—",
      seniorOutstanding: "—",
      ccr: "n/a",
    };
  } else if (valuation.error || !valuation.data) {
    priceCollateral = {
      state: "error",
      errorMessage:
        valuation.error?.message ?? "No valuation available for this loan.",
      feedNote: "recalcs every 60 min",
      spot: null,
      quantity: "—",
      collateralLabel: "Collateral value",
      collateralValue: "—",
      seniorOutstanding: "—",
      ccr: "n/a",
    };
  } else {
    priceCollateral = {
      state: "ready",
      errorMessage: null,
      ...buildPriceCollateral(valuation.data, entry.spot_change_7d),
    };
  }

  return { state: "ready", hero, priceCollateral };
}
