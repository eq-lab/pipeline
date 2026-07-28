/**
 * View-model + data wiring for the Trustee **Cash Management** page's On/Off-ramp
 * review queue (`cash-management.tsx`, issue #943, Figma `4116-11802` for
 * styling; source of truth `docs/product-specs/trustee-dashboard.md` §Type 1
 * flow 2 + §Type 4). Per `docs/FRONTEND.md` rule 2 the `.tsx` is JSX/styling
 * only; this hook owns the fetch + value→display mapping.
 *
 * Wires `useRampEvents` (`GET /v1/ramp/events`, pending events only) and
 * `useReviewRampEvent` (`POST …/review`). Events are split by leg into
 * **inbound** (`OnRamp`, ramp→custody) and **outbound** (`OffRamp`,
 * custody→ramp), matching the Figma's INBOUND / OUTBOUND sections.
 *
 * Data-sourcing: everything shown here is REAL — the served `RampEvent`
 * (id/type/to/from/amount/created_at). The Figma's richer per-loan tagging /
 * batch grouping / progress is NOT in the contract (#943) and is deliberately
 * NOT fabricated.
 */
import { useRampEvents, type RampEvent } from "@/api/useRampEvents";
import {
  useReviewRampEvent,
  type ReviewRampEventInput,
} from "@/api/useReviewRampEvent";
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

  const nowSec = Math.floor(Date.now() / 1000);
  const events = rampEvents.data?.events ?? [];

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
  };
}
