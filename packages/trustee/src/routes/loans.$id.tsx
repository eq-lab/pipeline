import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useLoanDetailMock,
  type JourneyStage,
  type LabelValueRow,
  type RegistryRow,
  type SummaryTile,
  type TileTone,
} from "./-loanDetailMock";

/**
 * Loan detail page (issue #847, Figma node `4116:10549`) — the destination
 * opened by clicking a loan row on the Loans list (`/loans`, #843).
 *
 * ⚠️ MOCK BUILD. Every section renders a **static fixture** (`-loanDetailMock.ts`)
 * — no live API calls. This is the full-design counterpart to #845 (live hero +
 * Price & collateral, parked/blocked). Per the trustee data-sourcing rule, the
 * static mock stands in only until each section's real source lands, at which
 * point that slice migrates off the fixture (see `-loanDetailMock.ts`).
 *
 * ## Sections (all of node 4116-10549)
 * Hero · Deal journey stepper · three summary tiles · Price & collateral ·
 * Registry state & derived · Current stage · Other actions. All action buttons
 * are inert (visual only) for this issue.
 *
 * ## Figma → token / px map
 *   - `‹ Loans` `Besley 18px / #262524`; title `Besley 44px`; both ink.
 *   - Status chip Performing → positive-primary green pill (0.08 bg / 0.3 border).
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

/** Small circular checkmark for completed journey nodes (redrawn inline). */
function CheckIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 13 13"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={13}
      height={13}
      {...props}
    >
      <path
        d="M3 6.5L5.5 9L10 4"
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

function Hero({
  hero,
  onBack,
}: {
  hero: ReturnType<typeof useLoanDetailMock>["hero"];
  /** When provided, the back affordance is a button (fake in-page nav) instead of a router Link. */
  onBack?: () => void;
}) {
  const backClass =
    "self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline";
  return (
    <div className="flex flex-col gap-[8px]">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className={`${backClass} cursor-pointer bg-transparent p-0 text-left`}
        >
          {hero.backLabel}
        </button>
      ) : (
        <Link to="/loans" className={backClass}>
          {hero.backLabel}
        </Link>
      )}
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        {hero.title}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <span
          data-testid="loan-detail-status-chip"
          className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
          style={{
            color: POSITIVE_GREEN,
            backgroundColor: "rgba(32,128,0,0.08)",
            borderColor: "rgba(32,128,0,0.3)",
          }}
        >
          {hero.status.label}
        </span>
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

function JourneyNode({ stage }: { stage: JourneyStage }) {
  if (stage.state === "done") {
    return (
      <span
        className="flex size-[28px] items-center justify-center rounded-full border-2 border-solid bg-white"
        style={{ borderColor: POSITIVE_GREEN, color: POSITIVE_GREEN }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (stage.state === "active") {
    return (
      <span
        className="flex size-[28px] items-center justify-center rounded-full font-[family-name:var(--font-body)] text-[13px] text-white"
        style={{ backgroundColor: BRAND }}
      >
        {stage.index}
      </span>
    );
  }
  return (
    <span
      className="flex size-[28px] items-center justify-center rounded-full border border-solid bg-white font-[family-name:var(--font-body)] text-[13px]"
      style={{ borderColor: LINE_COLOR, color: INK_MUTED }}
    >
      {stage.index}
    </span>
  );
}

function DealJourney({ journey }: { journey: JourneyStage[] }) {
  return (
    <div
      className={`${CARD_CLASS} gap-[18px] px-[24px] py-[20px]`}
      style={cardStyle()}
      data-testid="loan-detail-journey"
    >
      <p
        className="font-[family-name:var(--font-body)] text-[11px] tracking-[0.08em] uppercase"
        style={{ color: INK_MUTED }}
      >
        Deal journey — click any stage to open it
      </p>
      <div className="flex items-start">
        {journey.map((stage, i) => {
          const filled = stage.state === "done" || stage.state === "active";
          return (
            <div
              key={stage.label}
              className="relative flex flex-1 flex-col items-center gap-[8px]"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-[13px] right-1/2 h-[2px] w-full"
                  style={{
                    backgroundColor: filled ? POSITIVE_GREEN : LINE_COLOR,
                  }}
                />
              )}
              <span className="relative z-[1]">
                <JourneyNode stage={stage} />
              </span>
              <span
                className="text-center font-[family-name:var(--font-body)] text-[13px] leading-[18px]"
                style={{ color: stage.state === "pending" ? INK_MUTED : INK }}
              >
                {stage.label}
              </span>
              <span
                className="text-center font-[family-name:var(--font-body)] text-[12px] leading-[16px]"
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

// ── Price & collateral ──────────────────────────────────────────────────────

function PriceCollateralCard({
  pc,
}: {
  pc: ReturnType<typeof useLoanDetailMock>["priceCollateral"];
}) {
  return (
    <div
      className={`${CARD_CLASS} flex-1 gap-[8px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-price-collateral"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <CardTitle>Price &amp; collateral</CardTitle>
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          {pc.feedNote}
        </span>
      </div>
      <div>
        <KeyValueRow label={pc.spot.label}>
          <span style={{ color: INK }}>{pc.spot.main} · </span>
          <span style={{ color: pc.spot.changeNegative ? NEGATIVE_RED : INK }}>
            {pc.spot.change}
          </span>
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
      <p
        className="pt-[10px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
        style={{ color: INK_MUTED }}
      >
        {pc.footnote}
      </p>
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
  stage: ReturnType<typeof useLoanDetailMock>["currentStage"];
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
  otherActions: ReturnType<typeof useLoanDetailMock>["otherActions"];
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

// ── View ────────────────────────────────────────────────────────────────────

/**
 * The full loan-detail view. Rendered both by the `/loans/$id` route (below)
 * and — until real routing is wired — inline from the Loans list as a "fake"
 * in-page navigation (`onBack` returns to the list without a URL change). See
 * `loans.tsx`.
 */
export function LoanDetailView({ onBack }: { onBack?: () => void }) {
  const mock = useLoanDetailMock();

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
      <Hero hero={mock.hero} onBack={onBack} />
      <DealJourney journey={mock.journey} />
      <SummaryTiles tiles={mock.tiles} />
      <div className="flex w-full flex-col gap-[16px] lg:flex-row">
        <PriceCollateralCard pc={mock.priceCollateral} />
        <RegistryCard registry={mock.registry} />
      </div>
      <CurrentStageCard stage={mock.currentStage} />
      <OtherActionsCard otherActions={mock.otherActions} />
    </main>
  );
}

export const Route = createFileRoute("/loans/$id")({
  component: () => <LoanDetailView />,
});
