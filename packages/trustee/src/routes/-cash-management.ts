/**
 * View-model + data wiring for the Trustee Cash Management page's On/Off-ramp
 * review queue (`cash-management.tsx`). Per `docs/FRONTEND.md` rule 2 the
 * `.tsx` is JSX/styling only; this hook owns the fetch + value→display
 * mapping.
 *
 * spec: docs/frontend/trustee-flows.md#cash-management--onoff-ramp--t-bills
 * (On/Off-ramp tab, data-sourcing).
 */
import { useRampEvents, type RampEvent } from "@/api/useRampEvents";
import {
  useReviewRampEvent,
  type ReviewRampEventInput,
} from "@/api/useReviewRampEvent";
import { useRampAddresses } from "@/api/useRampAddresses";
import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { formatFullUsd } from "@/utils/formatUsd";

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** `"GABC…WXYZ"` — first 4 + last 4 of a Strkey; short addresses render whole. */
export function truncateStrkey(addr: string | null | undefined): string {
  if (addr == null || addr.length === 0) return "—";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Relative age of an event, e.g. `"3h ago"` / `"2d ago"` / `"just now"`, from a
 * Unix-seconds timestamp. `"—"` for a missing/invalid stamp (never fabricated).
 */
export function formatRelativeAge(
  createdAtSec: number | null | undefined,
  nowSec: number,
): string {
  if (createdAtSec == null || !Number.isFinite(createdAtSec)) return "—";
  const diff = Math.max(0, nowSec - createdAtSec);
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Plain USDC amount with thousands separators (`"8,400,000"`); `"—"` when unknown. */
export function formatUsdcAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value,
  );
}

// ── View types ──────────────────────────────────────────────────────────────

export interface RampEventRow {
  id: number;
  /** Fully-expanded whole-dollar USDC amount, e.g. `"$4,950,000"`. */
  amount: string;
  from: string;
  to: string;
  age: string;
}

export interface CashManagementView {
  state: "loading" | "error" | "ready";
  errorMessage: string | null;
  /** `OnRamp` events (ramp → custody). */
  inbound: RampEventRow[];
  /** `OffRamp` events (custody → ramp). */
  outbound: RampEventRow[];
  /** `true` when there are no pending events (empty review queue). */
  isEmpty: boolean;
  review: (input: ReviewRampEventInput) => void;
  /** The event id currently being reviewed (per-row pending state), or `null`. */
  reviewPendingId: number | null;
  reviewErrorMessage: string | null;

  // ── Swap-form data (UI shell — #943 chose B; execution/quote have no backend) ──
  /** Capital Wallet on-chain USDC balance (`useCapitalWalletBalance`); `null` when unavailable. */
  usdcBalanceValue: number | null;
  /** The same balance formatted, or `"—"`. */
  usdcBalanceDisplay: string;
  /** The off-ramp destination — first configured ramp address, truncated; `"—"` when none. */
  rampAddressDisplay: string;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

function mapEvent(event: RampEvent, nowSec: number): RampEventRow {
  return {
    id: event.id,
    amount: formatFullUsd(event.amount),
    from: truncateStrkey(event.from),
    to: truncateStrkey(event.to),
    age: formatRelativeAge(event.created_at, nowSec),
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCashManagement(): CashManagementView {
  const rampEvents = useRampEvents();
  const review = useReviewRampEvent();
  const balance = useCapitalWalletBalance();
  const addresses = useRampAddresses();

  const nowSec = Math.floor(Date.now() / 1000);
  const events = rampEvents.data?.events ?? [];

  const balanceNum = balance.data != null ? Number(balance.data) : null;
  const usdcBalanceValue =
    balanceNum != null && Number.isFinite(balanceNum) ? balanceNum : null;
  const rampAddress = addresses.data?.ramp_addresses[0];

  const state: CashManagementView["state"] = rampEvents.isLoading
    ? "loading"
    : rampEvents.error
      ? "error"
      : "ready";

  const inbound = events
    .filter((e) => e.type === "OnRamp")
    .map((e) => mapEvent(e, nowSec));
  const outbound = events
    .filter((e) => e.type === "OffRamp")
    .map((e) => mapEvent(e, nowSec));

  return {
    state,
    errorMessage: rampEvents.error?.message ?? null,
    inbound,
    outbound,
    isEmpty: state === "ready" && events.length === 0,
    review: review.review,
    reviewPendingId: review.pendingId,
    reviewErrorMessage: review.error?.message ?? null,
    usdcBalanceValue,
    usdcBalanceDisplay: formatUsdcAmount(usdcBalanceValue),
    rampAddressDisplay: truncateStrkey(rampAddress),
  };
}
