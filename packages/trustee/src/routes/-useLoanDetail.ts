// spec: docs/frontend/trustee-flows.md#loan-detail
import { useLoanBook } from "@/api/useLoanBook";
import type { LoanBookEntry } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import type {
  Epoch,
  LoanFinancialsResponse,
  UseLoanFinancialsResult,
} from "@/api/useLoanFinancials";
import { ApiError } from "@/api/client";
import type { StatusBand } from "@/components/detail/detailTokens";
import { formatBpsRate, formatCompactUsd } from "@/utils/formatUsd";
import { formatEpochDate, formatMaturityDate } from "@/utils/formatDate";
import { formatNearestPayment } from "./-useLoansTable";
import { findLoanEntry } from "@/lib/loanRoute";
import { stellarOnlyActionReason, targetChainLabel } from "@/lib/targetChains";
import { toUserError } from "@/utils/userError";
import { useDeal } from "@/api/useDealToken";
import { debtTokenRegistered, type DealReadState } from "@/lib/dealToken";
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
import { buildSecurityCard, type SecurityCardView } from "./-loanSecurity";

// ── Types ─────────────────────────────────────────────────────────────────────

export type { StatusBand };

/** The hero identity block, sourced from the loan-book row. */
export interface HeroView {
  backLabel: string;
  title: string;
  status: { label: string; band: StatusBand } | null;
  meta: string;
}

/** One document row of the Documents card — name + the URI it opens. */
export interface DocumentDisplay {
  name: string;
  uri: string;
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

// spec: docs/frontend/trustee-flows.md#wired-actions.
export function allowedLifecycleTargets(current: string): string[] {
  if (current === "Performing" || current === "WatchList") {
    return ["Performing", "WatchList"];
  }
  if (current === "Approved" || current === "Default") return [current];
  return [];
}

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
  security: SecurityCardView;
  /** Rollover card (Matured only); `null` otherwise. */
  rollover: RolloverCard | null;
  /** Formatted maturity date (e.g. `"15 Jun 2026"`), for the Matured rollover-card title; `null` when absent. */
  maturityDate: string | null;
  /** Documents card rows. Spec: `docs/frontend/trustee-flows.md#documents`. */
  documents: DocumentDisplay[];
  onChainBlockedReason: string | null;
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
  const metaParts = [
    `Loan #${entry.loan_id}`,
    targetChainLabel(entry.chain_id),
    paymentClause,
  ].filter((p): p is string => p != null);
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
  return [
    { label: "Status", value: data.status, tag: "chain" },
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

// A 404 → neutral "empty" note, not a red error.
// spec: docs/frontend/trustee-flows.md#registry-state--derived-852.
export function buildRegistryState(
  financials: UseLoanFinancialsResult,
  protection: string | null = null,
  deal: DealReadState | null = null,
): RegistryView {
  const debtRows: RegistryRow[] =
    deal === null
      ? []
      : [
          {
            label: "Debt token",
            value: debtTokenRegistered(deal).debt ?? "—",
            tag: "chain",
          },
        ];
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
      rows: [...buildFinancials(financials.data, protection), ...debtRows],
    };
  }
  return {
    state: "ready",
    errorMessage: null,
    errorDetails: null,
    rows: debtRows,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

// Wires loan-book (hero source, top-level `state`) + security + financials
// (each with their own `state`) for `loanId`. spec: trustee-flows.md#loan-detail.
export function useLoanDetail(
  chainId: number,
  loanId: string,
): UseLoanDetailResult {
  const loanBook = useLoanBook();
  const security = useLoanSecurity(chainId, loanId);
  const financials = useLoanFinancials(chainId, loanId);
  const deal = useDeal(chainId, /^\d+$/.test(loanId) ? Number(loanId) : null);

  const entry = findLoanEntry(loanBook.data?.loans, chainId, loanId);

  const state: LoanDetailState = loanBook.isLoading
    ? "loading"
    : loanBook.error
      ? "error"
      : "ready";

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
    registry: buildRegistryState(financials, entry?.protection ?? null, deal),
    currentStage,
    otherActions,
    security: buildSecurityCard(security),
    rollover: variant === "matured" ? MATURED_ROLLOVER_CARD : null,
    maturityDate: entry ? formatMaturityDate(entry.maturity) : null,
    documents: buildDocuments(entry),
    onChainBlockedReason: entry
      ? stellarOnlyActionReason(entry.chain_id)
      : null,
  };
}
