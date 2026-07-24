import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCompleteDisbursement } from "@/api/useCompleteDisbursement";
import { useRollover } from "@/api/useRollover";
import {
  useUpdateLifecycle,
  type LocationInput,
} from "@/api/useUpdateLifecycle";
import {
  useLoanDetail,
  type HeroView,
  type LabelValueRow,
  type LifecycleStep,
  type PriceCollateralView,
  type RegistryView,
  type StatusBand,
  type CcrTrend,
} from "./-useLoanDetail";
import {
  type RolloverCard as RolloverCardData,
  type SummaryTile,
  type TileTone,
} from "./-loanDetailStatic";

/**
 * Loan detail page (issues #845 / #847, Figma node `4116:10549`) — the
 * destination opened by clicking a loan row on the Loans list (`/loans`, #843).
 * A real route at `/loans/$id`, keyed by the loan-book `loan_id` (the #847
 * in-page "fake navigation" is gone now that a real id is served).
 *
 * ## Status-conditional layout (#859 / #862)
 * The page branches on `detail.variant` (derived from the served display status):
 *   - **performing** — lifecycle stepper + Price & collateral + Registry state.
 *   - **watchlist** — no stepper; a CCR-trend chart beside Price & collateral,
 *     a "Days on watchlist" tile, and an escalation current-stage card (Figma
 *     node `4116:10803`).
 *   - **disbursing** — the performing layout, but the current-stage card is the
 *     wired disbursement-complete action (`POST …/disbursement/complete`, #862);
 *     the lifecycle shows the Disbursing node active.
 *   - **matured** — no stepper; a rollover card beside Price & collateral, the
 *     hero shows `<date> — passed`, and Roll over is the matured-only fast-path
 *     (Figma node `4116:10969`, #866). The served `Past Due` status maps here.
 * Shared live sections render in both: Hero + status chip (loan-book row), Price
 * & collateral (`/valuations`), Registry (`/financials`, performing only).
 * Watchlist CCR trend and summary tiles are live; action labels and explanatory
 * copy are static product configuration unless a branch opens a wired flow below.
 *
 * ## Figma → token / px map
 *   - `‹ Loans` `Besley 18px / #262524`; title `Besley 44px`; both ink.
 *   - Status chip → colour band (`chipStyle`): positive green (0.08 bg / 0.3
 *     border), attention amber `#6e6400`, negative red `#b20000`, neutral muted.
 *   - Card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]`.
 *   - Card title `Besley 26px` ink; row label `Inter 15px` ink-muted; value `Inter 16px` ink.
 *   - Stepper: done ✓ green `#208000` (= `--color-pipeline-positive-primary`);
 *     active filled navy `#000080` (= `--color-pipeline-brand`); pending muted ring.
 *   - Primary button `#000080` white text (`--color-pipeline-brand`).
 *   - Sub-lines tones: positive green `#208000`; attention amber `#6e6400` (one-off);
 *     negative `#b20000` (one-off, ≠ `--color-pipeline-negative`); muted ink-muted.
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";
const INK = "var(--color-pipeline-ink)";
const INK_MUTED = "rgba(56,55,53,0.6)";

/**
 * Lifecycle stepper one-offs (Figma node `4116:10560`): the done node's green
 * tint fill + 30%-green border, which also colours the filled connector line;
 * the active node's 12%-brand ring glow.
 */
const STEP_DONE_BG = "rgba(32, 128, 0, 0.08)";
const STEP_DONE_LINE = "rgba(32, 128, 0, 0.3)";
const STEP_ACTIVE_RING = "0px 0px 0px 4px rgba(0, 0, 128, 0.12)";

/** CCR-trend chart dashed guide-line colour (Watchlist variant, Figma 4116:10868). */
const CCR_GUIDE = "rgba(178, 0, 0, 0.35)";

function toneColor(tone: TileTone): string {
  switch (tone) {
    case "positive":
      return POSITIVE_GREEN;
    case "attention":
      return ATTENTION_AMBER;
    case "negative":
      return NEGATIVE_RED;
    default:
      return INK_MUTED;
  }
}

/** Status-chip colours per band (matches the Loans-table CCR one-offs). */
function chipStyle(band: StatusBand): React.CSSProperties {
  switch (band) {
    case "positive":
      return {
        color: POSITIVE_GREEN,
        backgroundColor: "rgba(32,128,0,0.08)",
        borderColor: "rgba(32,128,0,0.3)",
      };
    case "attention":
      return {
        color: ATTENTION_AMBER,
        backgroundColor: "rgba(110,100,0,0.08)",
        borderColor: "rgba(110,100,0,0.3)",
      };
    case "negative":
      return {
        color: NEGATIVE_RED,
        backgroundColor: "rgba(178,0,0,0.08)",
        borderColor: "rgba(178,0,0,0.3)",
      };
    case "info":
      return {
        color: BRAND,
        backgroundColor: "rgba(0,0,128,0.08)",
        borderColor: "rgba(0,0,128,0.3)",
      };
    default:
      return {
        color: INK_MUTED,
        backgroundColor: "rgba(56,55,53,0.06)",
        borderColor: LINE_COLOR,
      };
  }
}

/** Small circular checkmark for completed lifecycle nodes (redrawn inline, 14px). */
function CheckIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      {...props}
    >
      <path
        d="M3.5 7L6 9.5L10.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function cardStyle() {
  return { border: `1px solid ${LINE_COLOR}` } as const;
}

const CARD_CLASS =
  "flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)]";

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({ hero }: { hero: HeroView }) {
  return (
    <div className="flex flex-col gap-[8px]">
      <Link
        to="/loans"
        className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
      >
        {hero.backLabel}
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        {hero.title}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        {hero.status && (
          <span
            data-testid="loan-detail-status-chip"
            className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
            style={chipStyle(hero.status.band)}
          >
            {hero.status.label}
          </span>
        )}
        <span
          data-testid="loan-detail-meta"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          {hero.meta}
        </span>
      </div>
    </div>
  );
}

// ── Deal journey stepper ──────────────────────────────────────────────────────

function JourneyNode({ stage }: { stage: LifecycleStep }) {
  if (stage.state === "done") {
    return (
      <span
        className="flex size-[28px] items-center justify-center rounded-full border border-solid"
        style={{
          backgroundColor: STEP_DONE_BG,
          borderColor: STEP_DONE_LINE,
          color: POSITIVE_GREEN,
        }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (stage.state === "active") {
    return (
      <span
        className="flex size-[28px] items-center justify-center rounded-full font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-white"
        style={{ backgroundColor: BRAND, boxShadow: STEP_ACTIVE_RING }}
      >
        {stage.index}
      </span>
    );
  }
  return (
    <span
      className="flex size-[28px] items-center justify-center rounded-full border border-solid bg-white font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
      style={{ borderColor: LINE_COLOR, color: INK_MUTED }}
    >
      {stage.index}
    </span>
  );
}

function Lifecycle({ steps }: { steps: LifecycleStep[] }) {
  return (
    <div
      className={`${CARD_CLASS} gap-[20px] px-[32px] pt-[47px] pb-[32px]`}
      style={cardStyle()}
      data-testid="loan-detail-lifecycle"
    >
      <p
        className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] uppercase"
        style={{ color: INK_MUTED }}
      >
        Lifecycle
      </p>
      <div className="flex items-start justify-center">
        {steps.map((stage, i) => {
          const filled = stage.state === "done" || stage.state === "active";
          const labelColor =
            stage.state === "active"
              ? BRAND
              : stage.state === "pending"
                ? INK_MUTED
                : INK;
          return (
            <div
              key={stage.label}
              className="relative flex flex-1 flex-col items-center gap-px px-[4px]"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-[14px] right-1/2 h-px w-full"
                  style={{
                    backgroundColor: filled ? STEP_DONE_LINE : LINE_COLOR,
                  }}
                />
              )}
              <span className="relative z-[1]">
                <JourneyNode stage={stage} />
              </span>
              <span
                className={`pt-[9px] text-center font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] whitespace-nowrap ${
                  stage.state === "active" ? "font-semibold" : "font-normal"
                }`}
                style={{ color: labelColor }}
              >
                {stage.label}
              </span>
              <span
                className="text-center font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
                style={{ color: INK_MUTED }}
              >
                {stage.sub}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Summary tiles ─────────────────────────────────────────────────────────────

function SummaryTiles({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <div
      className="grid w-full grid-cols-1 gap-[14px] md:grid-cols-3"
      data-testid="loan-detail-tiles"
    >
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`${CARD_CLASS} items-start px-[21px] py-[19px]`}
          style={cardStyle()}
        >
          <p
            className="font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]"
            style={{ color: INK_MUTED }}
          >
            {tile.label}
          </p>
          <p className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]">
            {tile.value}
          </p>
          <p
            className="pt-[6px] font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]"
            style={{ color: toneColor(tile.subTone) }}
          >
            {tile.sub}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Cards shared row ──────────────────────────────────────────────────────────

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-[26px] leading-[33.28px] text-[#262524]">
      {children}
    </h2>
  );
}

function KeyValueRow({
  label,
  children,
  tag,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  tag?: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        {label}
        {tag && (
          <span
            className="ml-[6px] text-[11px] lowercase"
            style={{ color: INK_MUTED }}
          >
            {tag}
          </span>
        )}
      </span>
      <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        {children}
      </span>
    </div>
  );
}

// ── Price & collateral (live) ─────────────────────────────────────────────────

function PriceCollateralCard({ pc }: { pc: PriceCollateralView }) {
  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[8px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-price-collateral"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle>Price &amp; collateral</CardTitle>
        {pc.providerNote && (
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {pc.providerNote}
          </span>
        )}
      </div>

      {pc.state === "loading" ? (
        <div
          data-testid="loan-detail-price-collateral-loading"
          className="flex flex-col gap-[10px] pt-[6px]"
          aria-busy="true"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-[22px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : pc.state === "error" ? (
        <p
          role="alert"
          data-testid="loan-detail-price-collateral-error"
          className="pt-[6px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: NEGATIVE_RED }}
        >
          {pc.errorMessage ?? "Failed to load the valuation."}
        </p>
      ) : pc.state === "empty" ? (
        <p
          data-testid="loan-detail-price-collateral-empty"
          className="pt-[6px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          {pc.missingNote ?? "No valuation on record for this loan."}
        </p>
      ) : (
        <>
          <div>
            <KeyValueRow label="Spot">
              <span style={{ color: INK }}>{pc.spot.main}</span>
              {pc.spot.change && (
                <>
                  <span style={{ color: INK }}> · </span>
                  <span
                    style={{
                      color: pc.spot.changeNegative ? NEGATIVE_RED : INK,
                    }}
                  >
                    {pc.spot.change}
                  </span>
                </>
              )}
            </KeyValueRow>
            {pc.rows.map((row: LabelValueRow, i: number) => (
              <KeyValueRow
                key={row.label}
                label={row.label}
                isLast={i === pc.rows.length - 1}
              >
                {row.value}
              </KeyValueRow>
            ))}
          </div>
          {pc.missingNote && (
            <p
              data-testid="loan-detail-price-collateral-missing"
              className="pt-[10px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
              style={{ color: INK_MUTED }}
            >
              {pc.missingNote}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Registry state & derived ──────────────────────────────────────────────────

function RegistryCard({ registry }: { registry: RegistryView }) {
  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[8px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-registry"
    >
      <CardTitle>Registry state &amp; derived</CardTitle>

      {registry.state === "loading" ? (
        <div
          data-testid="loan-detail-registry-loading"
          className="flex flex-col gap-[10px] pt-[6px]"
          aria-busy="true"
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[22px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : registry.state === "error" ? (
        <p
          role="alert"
          data-testid="loan-detail-registry-error"
          className="pt-[6px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: NEGATIVE_RED }}
        >
          {registry.errorMessage ?? "Failed to load the financials."}
        </p>
      ) : registry.state === "empty" ? (
        <p
          data-testid="loan-detail-registry-empty"
          className="pt-[6px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          No financials on record for this loan.
        </p>
      ) : (
        <div>
          {registry.rows.map((row, i) => (
            <KeyValueRow
              key={row.label}
              label={row.label}
              tag={row.tag}
              isLast={i === registry.rows.length - 1}
            >
              {row.value}
            </KeyValueRow>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Current stage ─────────────────────────────────────────────────────────────

function CurrentStageCard({
  stage,
}: {
  stage: NonNullable<ReturnType<typeof useLoanDetail>["currentStage"]>;
}) {
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-current-stage"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle>{stage.title}</CardTitle>
        {stage.tagTone === "risk" ? (
          <span
            data-testid="loan-detail-stage-tag"
            className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
            style={{
              color: NEGATIVE_RED,
              backgroundColor: "rgba(178,0,0,0.08)",
              borderColor: "rgba(178,0,0,0.3)",
            }}
          >
            {stage.tag}
          </span>
        ) : (
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {stage.tag}
          </span>
        )}
      </div>
      <p className="max-w-[640px] font-[family-name:var(--font-body)] text-[15px] leading-[22px] text-[#262524]">
        {stage.body}
      </p>
      <button
        type="button"
        data-testid="loan-detail-primary-action"
        className="inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white"
        style={{ backgroundColor: BRAND }}
      >
        {stage.actionLabel}
      </button>
    </div>
  );
}

// ── Other actions ─────────────────────────────────────────────────────────────

function OtherActionsCard({
  otherActions,
  onAction,
}: {
  otherActions: ReturnType<typeof useLoanDetail>["otherActions"];
  /** Fired with the button label when clicked; wired actions (e.g. "Update lifecycle") open a modal. */
  onAction?: (label: string) => void;
}) {
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-other-actions"
    >
      <p
        className="font-[family-name:var(--font-body)] text-[11px] tracking-[0.08em] uppercase"
        style={{ color: INK_MUTED }}
      >
        Other actions on this loan
      </p>
      <div className="flex flex-wrap gap-[10px]">
        {otherActions.actions.map((label) => (
          <button
            key={label}
            type="button"
            data-testid={`loan-detail-action-${label}`}
            onClick={() => onAction?.(label)}
            className="inline-flex h-[40px] items-center rounded-[4px] border border-solid bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
            style={{ borderColor: LINE_COLOR }}
          >
            {label}
          </button>
        ))}
      </div>
      {otherActions.note && (
        <p
          className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
          style={{ color: INK_MUTED }}
        >
          {otherActions.note}
        </p>
      )}
    </div>
  );
}

// ── Disbursement action (Disbursing variant, #862) ───────────────────────────

/**
 * The Disbursing-loan current-stage card with the wired "Mark disbursement
 * complete" action (`POST …/disbursement/complete`, issues #862 / #864).
 * Disbursing has no dedicated Figma flow, so the page keeps the Performing
 * layout and only this "Next Step" card differs. The `Complete off-ramp` button
 * is the one real, status-changing action — it flips the loan out of
 * `Disbursing` and refetches. Pending disables the button; a failure surfaces
 * inline (404 = loan not indexed).
 */
function DisbursementActionCard({
  loanName,
  onRequestComplete,
}: {
  loanName: string;
  /** Opens the confirmation modal — the actual POST fires on confirm. */
  onRequestComplete: () => void;
}) {
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-disbursement"
    >
      <CardTitle>Next Step</CardTitle>
      <p className="max-w-[640px] font-[family-name:var(--font-body)] text-[15px] leading-[22px] text-[#262524]">
        Mark {loanName} USDC off-ramp complete — this will move the Disbursing
        status to Performing.
      </p>
      <button
        type="button"
        data-testid="loan-detail-complete-disbursement"
        onClick={onRequestComplete}
        className="inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white"
        style={{ backgroundColor: BRAND }}
      >
        Complete off-ramp
      </button>
    </div>
  );
}

/**
 * Small confirmation modal for the "Complete off-ramp" action (#864). Mirrors
 * the shared dialog shell (`-RejectReasonDialog.tsx`): `role="dialog"`,
 * `aria-modal`, Escape + backdrop-click cancel (never a stray confirm), navy
 * confirm button. The `POST …/disbursement/complete` fires on Confirm; pending
 * disables both buttons and the mutation error surfaces inline.
 */
function DisbursementConfirmDialog({
  open,
  loanName,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  loanName: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      data-testid="disbursement-confirm-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={() => !pending && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disbursement-confirm-title"
        data-testid="disbursement-confirm-dialog"
        className="flex w-[460px] max-w-[calc(100vw-32px)] flex-col gap-[8px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="disbursement-confirm-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Complete off-ramp?
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[15px] leading-[22px] text-[rgba(56,55,53,0.6)]">
          Mark {loanName} USDC off-ramp complete — this will move the Disbursing
          status to Performing.
        </p>
        {error && (
          <p
            role="alert"
            data-testid="disbursement-confirm-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {error}
          </p>
        )}
        <div className="flex items-start justify-end gap-[12px] pt-[16px]">
          <button
            type="button"
            data-testid="disbursement-confirm-cancel"
            onClick={onCancel}
            disabled={pending}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="disbursement-confirm-submit"
            onClick={onConfirm}
            disabled={pending}
            className="h-[40px] rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {pending ? "Completing…" : "Complete off-ramp"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Matured rollover card (Matured variant, #866) ────────────────────────────

/**
 * The Matured "rollover" card (Figma `4116:10969`, right column). The title
 * interpolates the loan's live maturity date; the `rollover available` tag is an
 * olive/attention pill. The "Roll over →" button opens the wired rollover
 * confirmation flow (#870).
 */
function MaturedRolloverCard({
  rollover,
  maturityDate,
  onRollover,
}: {
  rollover: RolloverCardData;
  maturityDate: string | null;
  /** Opens the rollover confirmation modal (#870). */
  onRollover: () => void;
}) {
  const title =
    maturityDate != null
      ? `Matured ${maturityDate} without full repayment`
      : "Matured without full repayment";
  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-rollover"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle>{title}</CardTitle>
        <span
          data-testid="loan-detail-rollover-tag"
          className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
          style={chipStyle("attention")}
        >
          {rollover.tag}
        </span>
      </div>
      <p className="max-w-[640px] font-[family-name:var(--font-body)] text-[15px] leading-[22px] text-[#262524]">
        {rollover.body}
      </p>
      <button
        type="button"
        data-testid="loan-detail-rollover-action"
        onClick={onRollover}
        className="inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white"
        style={{ backgroundColor: BRAND }}
      >
        {rollover.actionLabel}
      </button>
    </div>
  );
}

/**
 * The Roll over confirmation modal (S9, Figma node `4116:14050`, issue #870).
 * Collects the new rate (bps) + new maturity, then submits the on-chain
 * `LoanRegistry.rollover` via `useRollover`. Mirrors the shared dialog shell
 * (Escape/backdrop cancel, navy confirm, pending/error). The mint-ceiling delta
 * is not previewed with a figure — the real ceiling change is computed on-chain
 * at rollover (avoids fabricating a transaction-effect number).
 */
function RolloverDialog({
  open,
  loanName,
  maturityLabel,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  loanName: string;
  maturityLabel: string | null;
  onClose: () => void;
  onConfirm: (newRateBps: number, newMaturityUnix: number) => void;
  pending: boolean;
  error: string | null;
}) {
  const [rateBps, setRateBps] = useState("");
  const [maturity, setMaturity] = useState("");

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setRateBps("");
      setMaturity("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  const bps = Number.parseInt(rateBps, 10);
  const maturityUnix = maturity
    ? Math.floor(new Date(`${maturity}T00:00:00Z`).getTime() / 1000)
    : NaN;
  const valid =
    Number.isFinite(bps) && bps > 0 && Number.isFinite(maturityUnix);

  const fieldClass =
    "w-full rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[10px] font-[family-name:var(--font-body)] text-[15px] text-[#262524]";

  return (
    <div
      data-testid="rollover-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={() => !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollover-title"
        data-testid="rollover-dialog"
        className="flex w-[560px] max-w-[calc(100vw-32px)] flex-col gap-[12px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="rollover-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Rollover — {loanName}
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          LoanRegistry.rollover · your key · appends an epoch from the prior
          maturity, sets currentMaturityDate, returns status to Performing.
          Raises the mint ceiling only — mints nothing.
        </p>

        <div
          data-testid="rollover-guard"
          className="rounded-[4px] border border-solid px-[14px] py-[12px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{
            color: POSITIVE_GREEN,
            backgroundColor: "rgba(32,128,0,0.08)",
            borderColor: "rgba(32,128,0,0.3)",
          }}
        >
          Guard passes: matured{maturityLabel ? ` ${maturityLabel}` : ""}.
        </div>

        <div className="flex flex-wrap gap-[16px] pt-[4px]">
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className="font-[family-name:var(--font-body)] text-[13px] text-[rgba(56,55,53,0.6)]">
              New rate (bps)
            </span>
            <input
              type="number"
              inputMode="numeric"
              data-testid="rollover-rate"
              value={rateBps}
              disabled={pending}
              onChange={(e) => setRateBps(e.target.value)}
              placeholder="e.g. 1450"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className="font-[family-name:var(--font-body)] text-[13px] text-[rgba(56,55,53,0.6)]">
              New maturity
            </span>
            <input
              type="date"
              data-testid="rollover-maturity"
              value={maturity}
              disabled={pending}
              onChange={(e) => setMaturity(e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>

        <p className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[rgba(56,55,53,0.6)]">
          The new mint ceiling is computed on-chain at rollover (interest
          headroom only — no mint).
        </p>

        {error && (
          <p
            role="alert"
            data-testid="rollover-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {error}
          </p>
        )}

        <div className="flex items-start justify-end gap-[12px] pt-[12px]">
          <button
            type="button"
            data-testid="rollover-cancel"
            onClick={onClose}
            disabled={pending}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            data-testid="rollover-submit"
            onClick={() => onConfirm(bps, maturityUnix)}
            disabled={!valid || pending}
            className="h-[40px] rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {pending ? "Rolling over…" : "Roll over loan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Update-lifecycle modal (S10, Figma node `4116:14087`, issue #872).
 * Collects the non-economic mutable fields — status, CCR %, location, optional
 * metadata URI — then submits the on-chain `LoanRegistry.updateMutable` via
 * `useUpdateLifecycle`. Default/Closed are not offered (they route to the Risk
 * Council / close flows); Past Due/Matured are derived, not settable here.
 */
function UpdateLifecycleDialog({
  open,
  loanName,
  currentStatus,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  loanName: string;
  /** On-chain status to default the selector to (`Performing` | `WatchList`). */
  currentStatus: string;
  onClose: () => void;
  onConfirm: (input: {
    status: string;
    ccrPercent: number;
    location: LocationInput;
    metadataUri: string;
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [ccr, setCcr] = useState("");
  const [locationType, setLocationType] = useState("Vessel");
  const [locationId, setLocationId] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [metadataUri, setMetadataUri] = useState("");

  useEffect(() => {
    if (open) {
      setStatus(currentStatus);
      setCcr("");
      setLocationType("Vessel");
      setLocationId("");
      setTrackingUrl("");
      setMetadataUri("");
    }
  }, [open, currentStatus]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  const ccrPercent = Number.parseFloat(ccr);
  const valid =
    Number.isFinite(ccrPercent) &&
    ccrPercent > 0 &&
    locationId.trim().length > 0;

  const fieldClass =
    "w-full rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[10px] font-[family-name:var(--font-body)] text-[15px] text-[#262524]";
  const labelClass =
    "font-[family-name:var(--font-body)] text-[13px] text-[rgba(56,55,53,0.6)]";

  return (
    <div
      data-testid="update-lifecycle-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={() => !pending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-lifecycle-title"
        data-testid="update-lifecycle-dialog"
        className="flex w-[600px] max-w-[calc(100vw-32px)] flex-col gap-[12px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="update-lifecycle-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Update lifecycle — {loanName}
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          LoanRegistry.updateMutable · your key · non-economic fields only · no
          NAV impact. CCR is written only at 130 / 120 / 110% threshold
          crossings, with its timestamp.
        </p>

        <label className="flex flex-col gap-[6px] pt-[4px]">
          <span className={labelClass}>
            Status (Default and Closed route elsewhere)
          </span>
          <select
            data-testid="update-lifecycle-status"
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className={fieldClass}
          >
            <option value="Performing">Performing</option>
            <option value="WatchList">Watchlist</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-[16px]">
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className={labelClass}>CCR %</span>
            <input
              type="number"
              inputMode="decimal"
              data-testid="update-lifecycle-ccr"
              value={ccr}
              disabled={pending}
              onChange={(e) => setCcr(e.target.value)}
              placeholder="e.g. 135"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className={labelClass}>Location type</span>
            <select
              data-testid="update-lifecycle-location-type"
              value={locationType}
              disabled={pending}
              onChange={(e) => setLocationType(e.target.value)}
              className={fieldClass}
            >
              <option value="Vessel">Vessel</option>
              <option value="Warehouse">Warehouse</option>
              <option value="TankFarm">Tank farm</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-[16px]">
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className={labelClass}>Location identifier</span>
            <input
              type="text"
              data-testid="update-lifecycle-location"
              value={locationId}
              disabled={pending}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. MV Andes · IMO 9741205"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-[6px]">
            <span className={labelClass}>Tracking URL (optional)</span>
            <input
              type="text"
              data-testid="update-lifecycle-tracking"
              value={trackingUrl}
              disabled={pending}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://…"
              className={fieldClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-[6px]">
          <span className={labelClass}>
            Append metadataURI (assay / offtake hash)
          </span>
          <input
            type="text"
            data-testid="update-lifecycle-metadata"
            value={metadataUri}
            disabled={pending}
            onChange={(e) => setMetadataUri(e.target.value)}
            placeholder="ipfs://… (optional)"
            className={fieldClass}
          />
        </label>

        {error && (
          <p
            role="alert"
            data-testid="update-lifecycle-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {error}
          </p>
        )}

        <div className="flex items-start justify-end gap-[12px] pt-[12px]">
          <button
            type="button"
            data-testid="update-lifecycle-cancel"
            onClick={onClose}
            disabled={pending}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="update-lifecycle-submit"
            onClick={() =>
              onConfirm({
                status,
                ccrPercent,
                location: {
                  location_type: locationType,
                  location_identifier: locationId.trim(),
                  tracking_url: trackingUrl.trim(),
                  updated_at: Math.floor(Date.now() / 1000),
                },
                metadataUri: metadataUri.trim(),
              })
            }
            disabled={!valid || pending}
            className="h-[40px] rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {pending ? "Updating…" : "Update loan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CCR trend (Watchlist variant) ────────────────────────────────────────────
/**
 * CCR-trend line chart (Watchlist variant, Figma node `4116:10868`), drawn from
 * the real `/ccr-history` series (#879). The y-scale is per-loan: it spans the
 * series' own CCR range widened to include the threshold guide-lines, so the
 * decline and its distance to the 120% / 110% levels read correctly for each
 * loan. A single point renders as a dot.
 */
function CcrTrendCard({ trend }: { trend: CcrTrend }) {
  // Plot area within the 440×124 viewBox.
  const X0 = 10;
  const X1 = 430;
  const Y_TOP = 8;
  const Y_BOTTOM = 92;

  const thresholdPcts = trend.thresholds.map((t) => t.pct);
  const allPcts = [...trend.points, ...thresholdPcts];
  const rawMin = Math.min(...allPcts);
  const rawMax = Math.max(...allPcts);
  // Pad the range 4% (or a flat 1 when the series is flat) so lines aren't flush
  // to the edges.
  const pad = rawMax > rawMin ? (rawMax - rawMin) * 0.08 : 1;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const scaleY = (pct: number) =>
    Y_BOTTOM - ((pct - yMin) / (yMax - yMin)) * (Y_BOTTOM - Y_TOP);
  const scaleX = (i: number) =>
    trend.points.length <= 1
      ? X1
      : X0 + (i / (trend.points.length - 1)) * (X1 - X0);

  const polyline = trend.points.map((p, i) => `${scaleX(i)},${scaleY(p)}`);
  const lastX = scaleX(trend.points.length - 1);
  const lastY = scaleY(trend.points[trend.points.length - 1]!);

  // Right-edge labels (current value + one per threshold) share the same x, so
  // when the loan's CCR sits far from the thresholds — squeezing 120% / 110%
  // together on the per-loan scale — their text would overprint. Lay them out
  // top→bottom with a minimum vertical gap, then shift the stack up if it would
  // spill past the viewBox bottom.
  const LABEL_GAP = 13;
  const LABEL_MAX_Y = 122;
  const rightLabels = [
    {
      text: trend.currentLabel,
      fontSize: 13.4,
      fontWeight: 700,
      y: lastY + 13,
    },
    ...trend.thresholds.map((t) => ({
      text: t.label,
      fontSize: 10.5,
      fontWeight: 400,
      y: scaleY(t.pct),
    })),
  ].sort((a, b) => a.y - b.y);
  for (let i = 1; i < rightLabels.length; i++) {
    const minY = rightLabels[i - 1]!.y + LABEL_GAP;
    if (rightLabels[i]!.y < minY) rightLabels[i]!.y = minY;
  }
  const overflow = rightLabels[rightLabels.length - 1]!.y - LABEL_MAX_Y;
  if (overflow > 0) for (const l of rightLabels) l.y -= overflow;

  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[14px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-ccr-trend"
    >
      <CardTitle>CCR trend</CardTitle>
      <svg
        viewBox="0 0 440 124"
        className="w-full"
        role="img"
        aria-label={`CCR trend, currently ${trend.currentLabel}`}
      >
        {/* Dashed threshold guide lines, drawn at their true scaled y. */}
        {trend.thresholds.map((t) => (
          <line
            key={t.pct}
            x1={X0}
            y1={scaleY(t.pct)}
            x2={X1}
            y2={scaleY(t.pct)}
            stroke={CCR_GUIDE}
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}
        {/* CCR line (or a lone dot for a single point) + current dot. */}
        {polyline.length > 1 && (
          <polyline
            points={polyline.join(" ")}
            fill="none"
            stroke={NEGATIVE_RED}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <circle cx={lastX} cy={lastY} r="4" fill={NEGATIVE_RED} />
        {/* Current value (bold) + threshold labels, laid out without overlap. */}
        {rightLabels.map((l, i) => (
          <text
            key={i}
            x={X1 - 2}
            y={l.y}
            textAnchor="end"
            fontFamily="var(--font-body)"
            fontSize={l.fontSize}
            fontWeight={l.fontWeight}
            fill={NEGATIVE_RED}
          >
            {l.text}
          </text>
        ))}
        {/* Series-start caption (bottom-left). */}
        <text
          x={X0}
          y="115"
          fontFamily="var(--font-body)"
          fontSize="12.4"
          fill={INK_MUTED}
        >
          {trend.startLabel}
        </text>
      </svg>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LoanDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const detail = useLoanDetail(id);
  const completeDisbursement = useCompleteDisbursement();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rolloverMutation = useRollover();
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const updateLifecycle = useUpdateLifecycle();
  const [updateOpen, setUpdateOpen] = useState(false);

  const onOtherAction = (label: string) => {
    if (label === "Update lifecycle") {
      updateLifecycle.reset();
      setUpdateOpen(true);
    } else if (label === "Roll over") {
      // Opens the same wired RolloverDialog as the Matured variant's rollover
      // widget (#923) — the "Roll over" other-action was previously unhandled,
      // so clicking it in the actions card did nothing.
      rolloverMutation.reset();
      setRolloverOpen(true);
    } else if (label === "Record coupon") {
      // Full-page destination (issue #882, Figma `4116-11452`) — not a modal,
      // so this navigates rather than opening a dialog like the other actions.
      void navigate({ to: "/loans/$id/record-coupon", params: { id } });
    } else if (label === "Close loan") {
      // Full-page destination (issue #884, Figma `4116-11621`) — this action
      // does NOT close the loan directly; it opens the Record Repayment page,
      // where the trustee records the final principal repayment and only
      // then closes the loan from there.
      void navigate({ to: "/loans/$id/record-repayment", params: { id } });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
      {detail.state === "error" ? (
        <>
          <Link
            to="/loans"
            className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
          >
            ‹ Loans
          </Link>
          <div
            role="alert"
            data-testid="loan-detail-error"
            className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
          >
            {detail.errorMessage ?? "Failed to load the loan."}
          </div>
        </>
      ) : detail.state === "loading" ? (
        <div
          data-testid="loan-detail-loading"
          className="flex w-full flex-col gap-[16px]"
          aria-busy="true"
          aria-label="Loading loan"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[120px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : detail.variant === "watchlist" ? (
        // Watchlist layout (#859): no lifecycle stepper, no Registry card — a
        // CCR-trend chart sits beside Price & collateral, and the current-stage
        // card is escalation-focused.
        <>
          <Hero hero={detail.hero} />
          <SummaryTiles tiles={detail.tiles} />
          <div className="flex w-full flex-col gap-[16px] lg:flex-row">
            <PriceCollateralCard pc={detail.priceCollateral} />
            {detail.ccrTrend && <CcrTrendCard trend={detail.ccrTrend} />}
          </div>
          {detail.currentStage && (
            <CurrentStageCard stage={detail.currentStage} />
          )}
          <OtherActionsCard
            otherActions={detail.otherActions}
            onAction={onOtherAction}
          />
        </>
      ) : detail.variant === "matured" ? (
        // Matured layout (#866): no stepper, no Registry — a rollover card sits
        // beside Price & collateral (rollover is the matured-only fast-path).
        <>
          <Hero hero={detail.hero} />
          <SummaryTiles tiles={detail.tiles} />
          <div className="flex w-full flex-col gap-[16px] lg:flex-row">
            <PriceCollateralCard pc={detail.priceCollateral} />
            {detail.rollover && (
              <MaturedRolloverCard
                rollover={detail.rollover}
                maturityDate={detail.maturityDate}
                onRollover={() => {
                  rolloverMutation.reset();
                  setRolloverOpen(true);
                }}
              />
            )}
          </div>
          <OtherActionsCard
            otherActions={detail.otherActions}
            onAction={onOtherAction}
          />
          <RolloverDialog
            open={rolloverOpen}
            loanName={detail.hero.title}
            maturityLabel={detail.maturityDate}
            pending={rolloverMutation.isPending}
            error={rolloverMutation.error?.message ?? null}
            onClose={() => setRolloverOpen(false)}
            onConfirm={(newRateBps, newMaturity) => {
              // Close on success; the error surfaces inline via the hook state.
              void rolloverMutation
                .mutateAsync({ loanId: Number(id), newRateBps, newMaturity })
                .then(() => setRolloverOpen(false))
                .catch(() => {});
            }}
          />
        </>
      ) : (
        // Performing layout (default) + Disbursing (same layout, but the
        // current-stage card is the wired disbursement-complete action, #862).
        <>
          <Hero hero={detail.hero} />
          <Lifecycle steps={detail.lifecycle} />
          <SummaryTiles tiles={detail.tiles} />
          <div className="flex w-full flex-col gap-[16px] lg:flex-row">
            <PriceCollateralCard pc={detail.priceCollateral} />
            <RegistryCard registry={detail.registry} />
          </div>
          {detail.variant === "disbursing" && (
            <DisbursementActionCard
              loanName={detail.hero.title}
              onRequestComplete={() => {
                completeDisbursement.reset();
                setConfirmOpen(true);
              }}
            />
          )}
          <OtherActionsCard
            otherActions={detail.otherActions}
            onAction={onOtherAction}
          />
          <DisbursementConfirmDialog
            open={confirmOpen}
            loanName={detail.hero.title}
            pending={completeDisbursement.isPending}
            error={completeDisbursement.error?.message ?? null}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() =>
              completeDisbursement.mutate(
                { loanId: id },
                { onSuccess: () => setConfirmOpen(false) },
              )
            }
          />
        </>
      )}

      {/* Update-lifecycle modal (#872) — opened by the "Update lifecycle" action
          in any variant; self-guards on `open`. */}
      <UpdateLifecycleDialog
        open={updateOpen}
        loanName={detail.hero.title}
        currentStatus={
          detail.hero.status?.label === "Watchlist" ? "WatchList" : "Performing"
        }
        pending={updateLifecycle.isPending}
        error={updateLifecycle.error?.message ?? null}
        onClose={() => setUpdateOpen(false)}
        onConfirm={(input) => {
          void updateLifecycle
            .mutateAsync({ loanId: Number(id), ...input })
            .then(() => setUpdateOpen(false))
            .catch(() => {});
        }}
      />
    </main>
  );
}

export const Route = createFileRoute("/loans/$id")({
  component: LoanDetail,
});
