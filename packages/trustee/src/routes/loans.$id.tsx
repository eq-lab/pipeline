import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useLoanDetail,
  type HeroView,
  type LabelValueRow,
  type LifecycleStep,
  type PriceCollateralView,
  type StatusBand,
} from "./-useLoanDetail";
import {
  type RegistryRow,
  type SummaryTile,
  type TileTone,
} from "./-loanDetailMock";

/**
 * Loan detail page (issues #845 / #847, Figma node `4116:10549`) — the
 * destination opened by clicking a loan row on the Loans list (`/loans`, #843).
 * A real route at `/loans/$id`, keyed by the loan-book `loan_id` (the #847
 * in-page "fake navigation" is gone now that a real id is served).
 *
 * ## Live vs. mock sections (see `-useLoanDetail.ts`)
 *   - **Hero identity** and **Price & collateral** are sourced live for the
 *     clicked loan (loan-book row + `GET /v1/loan-book/{loan_id}/valuations`).
 *   - Deal journey · summary tiles · registry state · current stage · other
 *     actions remain the #847 static mock until a backend source lands.
 * All action buttons are inert (visual only) for this issue.
 *
 * ## Figma → token / px map
 *   - `‹ Loans` `Besley 18px / #262524`; title `Besley 44px`; both ink.
 *   - Status chip → colour band (`statusToBand`): positive green (0.08 bg / 0.3
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

function toneColor(tone: TileTone): string {
  switch (tone) {
    case "positive":
      return POSITIVE_GREEN;
    case "attention":
      return ATTENTION_AMBER;
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

function RegistryCard({ registry }: { registry: RegistryRow[] }) {
  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[8px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-registry"
    >
      <CardTitle>Registry state &amp; derived</CardTitle>
      <div>
        {registry.map((row, i) => (
          <KeyValueRow
            key={row.label}
            label={row.label}
            tag={row.tag}
            isLast={i === registry.length - 1}
          >
            {row.value}
          </KeyValueRow>
        ))}
      </div>
    </div>
  );
}

// ── Current stage ─────────────────────────────────────────────────────────────

function CurrentStageCard({
  stage,
}: {
  stage: ReturnType<typeof useLoanDetail>["currentStage"];
}) {
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-current-stage"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle>{stage.title}</CardTitle>
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          {stage.tag}
        </span>
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
}: {
  otherActions: ReturnType<typeof useLoanDetail>["otherActions"];
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
            className="inline-flex h-[40px] items-center rounded-[4px] border border-solid bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
            style={{ borderColor: LINE_COLOR }}
          >
            {label}
          </button>
        ))}
      </div>
      <p
        className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
        style={{ color: INK_MUTED }}
      >
        {otherActions.note}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LoanDetail() {
  const { id } = Route.useParams();
  const detail = useLoanDetail(id);

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
      ) : (
        <>
          <Hero hero={detail.hero} />
          <Lifecycle steps={detail.lifecycle} />
          <SummaryTiles tiles={detail.tiles} />
          <div className="flex w-full flex-col gap-[16px] lg:flex-row">
            <PriceCollateralCard pc={detail.priceCollateral} />
            <RegistryCard registry={detail.registry} />
          </div>
          <CurrentStageCard stage={detail.currentStage} />
          <OtherActionsCard otherActions={detail.otherActions} />
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/loans/$id")({
  component: LoanDetail,
});
