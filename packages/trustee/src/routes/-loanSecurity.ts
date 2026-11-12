// spec: docs/frontend/trustee-flows.md#security-card
import type {
  LoanSecurityMarginCall,
  LoanSecurityResponse,
  UseLoanSecurityResult,
} from "@/api/useLoanSecurity";
import { formatFullUsd } from "@/utils/formatUsd";
import { formatMaturityDate } from "@/utils/formatDate";
import { toUserError } from "@/utils/userError";

export const LTV_NO_VALUE_SENTINEL = 4_294_967_295;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LtvTone = "negative" | "attention" | "neutral";

export interface SecurityRow {
  label: string;
  value: string;
}

export interface SecurityCardView {
  state: "hidden" | "loading" | "error" | "no-terms" | "ready";
  errorMessage: string | null;
  errorDetails: string | null;
  ltv: string;
  ltvTone: LtvTone;
  rows: SecurityRow[];
  priceStale: boolean;
  refreshPending: boolean;
  notes: string[];
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatLtvBps(bps: unknown): string {
  if (typeof bps !== "number" || !Number.isFinite(bps)) return "—";
  if (bps === LTV_NO_VALUE_SENTINEL) return "No security value";
  const pct = (Math.round(bps) / 100).toFixed(1);
  return `${pct.endsWith(".0") ? pct.slice(0, -2) : pct}%`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatUnixDate(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "—";
  const seconds = Number(value);
  return Number.isFinite(seconds) ? formatMaturityDate(seconds) : "—";
}

export function formatMarginCall(
  mc: LoanSecurityMarginCall | null | undefined,
): string {
  if (mc?.open === true) {
    let text = `Open since ${formatUnixDate(mc.opened_at)}`;
    if (typeof mc.cure_by === "string" && mc.cure_by.length > 0) {
      text += ` · cure by ${formatUnixDate(mc.cure_by)}`;
    }
    if (mc.cure_overdue === true) text += " (overdue)";
    return text;
  }
  if (mc?.open === false) return "None";
  return "—";
}

// ── Derivations ───────────────────────────────────────────────────────────────

export function ltvTone(sec: LoanSecurityResponse | null | undefined): LtvTone {
  if (
    sec?.margin_call?.open === true ||
    sec?.margin_call?.ltv_above_ratio_no_onchain_call === true
  ) {
    return "negative";
  }
  const ltv = sec?.valuation?.ltv_bps;
  const advance = sec?.terms?.advance_ratio_bps;
  if (
    isFiniteNumber(ltv) &&
    isFiniteNumber(advance) &&
    ltv !== LTV_NO_VALUE_SENTINEL &&
    ltv > advance
  ) {
    return "attention";
  }
  return "neutral";
}

export function priceStale(
  sec: LoanSecurityResponse | null | undefined,
): boolean {
  return (
    sec?.valuation?.price_stale === true || sec?.prices?.price_stale === true
  );
}

function emptyCard(state: SecurityCardView["state"]): SecurityCardView {
  return {
    state,
    errorMessage: null,
    errorDetails: null,
    ltv: "—",
    ltvTone: "neutral",
    rows: [],
    priceStale: false,
    refreshPending: false,
    notes: [],
  };
}

export function buildSecurityCard(
  result: UseLoanSecurityResult,
): SecurityCardView {
  if (result.notConfigured) return emptyCard("hidden");
  if (result.isLoading) return emptyCard("loading");
  if (result.error) {
    const mapped = toUserError(
      result.error,
      "Failed to load the loan security.",
    );
    return {
      ...emptyCard("error"),
      errorMessage: mapped.message,
      errorDetails: mapped.details,
    };
  }
  const sec = result.data;
  if (sec?.terms == null) {
    return {
      ...emptyCard("no-terms"),
      notes: ["No security terms are set for this loan."],
    };
  }

  const notes: string[] = [];
  if (sec.valuation == null) notes.push("No valuation yet.");

  return {
    ...emptyCard("ready"),
    ltv: formatLtvBps(sec.valuation?.ltv_bps),
    ltvTone: ltvTone(sec),
    rows: [
      {
        label: "Advance ratio",
        value: formatLtvBps(sec.terms.advance_ratio_bps),
      },
      {
        label: "Margin-call ratio",
        value: formatLtvBps(sec.terms.margin_call_ratio_bps),
      },
      {
        label: "Security value",
        value: formatFullUsd(sec.valuation?.value),
      },
      { label: "Amount owed", value: formatFullUsd(sec.valuation?.debt) },
      { label: "Margin call", value: formatMarginCall(sec.margin_call) },
    ],
    priceStale: priceStale(sec),
    refreshPending: sec.refresh_pending === true,
    notes,
  };
}

export function formatLtvLine(result: UseLoanSecurityResult): string | null {
  const card = buildSecurityCard(result);
  if (card.state !== "ready") return null;
  const sec = result.data;
  const marginCallRatio = sec?.terms?.margin_call_ratio_bps;
  const mc = formatLtvBps(marginCallRatio);
  if (sec?.margin_call?.open === true) return `${card.ltv} — margin call open`;
  if (sec?.margin_call?.ltv_above_ratio_no_onchain_call === true) {
    return `${card.ltv} — above the ${mc} margin-call ratio`;
  }
  if (isFiniteNumber(marginCallRatio)) {
    return `${card.ltv} — margin call at ${mc}`;
  }
  return card.ltv;
}
