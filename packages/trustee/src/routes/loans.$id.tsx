import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import {
  useLoanDetail,
  type LoanStatusBand,
  type PriceCollateralView,
} from "./-useLoanDetail";

/**
 * Loan detail page (issue #845, Figma node `4116:10549`) — the destination
 * opened by clicking a loan row on the Loans list (`/loans`, #843). Driven by
 * the clicked `LoanBookEntry` (router navigation state, for the hero) +
 * `GET /v1/loan-book/{loan_id}/valuations` (via `useLoanValuation`, for the
 * Price & collateral card).
 *
 * ## Scope (issue #845)
 * Only the **hero** and **"Price & collateral"** sections are implemented. The
 * Figma's Deal-journey stepper, the three summary tiles, "Registry state &
 * derived", "Current stage", and "Other actions" are OUT OF SCOPE (no data yet).
 *
 * ## Never-fabricate defaults (see `-useLoanDetail.ts`)
 * `corridor`, the spot feed age, the senior-outstanding repaid date, the CCR
 * "price risk closed" phrase, and the "Last on-chain write …" line have no
 * backend source → omitted. "N days left" is derived from the served `maturity`.
 *
 * ## Figma → token / px map
 *   - `‹ Loans` back link: `font-display text-[18px] leading-[25.2px]` ink → `/loans`.
 *   - Title `Besley 44px / #262524`: `font-display text-[44px] leading-[48.4px]` ink.
 *   - Status chip: reuses the #843 loan-status colours — positive
 *     (`--color-pipeline-positive-primary` `#208000`), attention amber `#6e6400`,
 *     negative `#b20000` (documented one-off, ≠ `--color-pipeline-negative`),
 *     neutral `rgba(56,55,53,0.6)`; `bg`/`border` at 0.08/0.3 alpha of each.
 *   - Meta line `Inter 14px / rgba(56,55,53,0.6)` = ink-muted.
 *   - Card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]`,
 *     `p-[26px]`. Card title `Besley 28px` ink; sub-header `Inter 12px` ink-muted.
 *   - Rows: label `Inter 15px` ink-muted, value `Inter 16px` ink; negative spot
 *     change `#b20000`. Footnote-less (the on-chain-write line is omitted).
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
/** Figma loan red — a documented one-off (≠ `--color-pipeline-negative` `#c0392b`), matching #843. */
const NEGATIVE_RED = "#b20000";
const ATTENTION_AMBER = "#6e6400";

/** Status-chip colour tokens per band (text, bg, border) — mirrors #843/origination pills. */
const STATUS_COLORS: Record<
  LoanStatusBand,
  { text: string; bg: string; border: string }
> = {
  positive: {
    text: "var(--color-pipeline-positive-primary)",
    bg: "rgba(32,128,0,0.08)",
    border: "rgba(32,128,0,0.3)",
  },
  attention: {
    text: ATTENTION_AMBER,
    bg: "rgba(211,235,117,0.16)",
    border: "rgba(56,55,53,0.18)",
  },
  negative: {
    text: NEGATIVE_RED,
    bg: "rgba(178,0,0,0.08)",
    border: "rgba(178,0,0,0.3)",
  },
  neutral: {
    text: "rgba(56,55,53,0.6)",
    bg: "rgba(191,189,187,0.12)",
    border: "rgba(191,189,187,0.3)",
  },
};

function StatusChip({ label, band }: { label: string; band: LoanStatusBand }) {
  const c = STATUS_COLORS[band];
  return (
    <span
      data-testid="loan-detail-status-chip"
      className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
      style={{ color: c.text, backgroundColor: c.bg, borderColor: c.border }}
    >
      {label}
    </span>
  );
}

function DetailRow({
  label,
  children,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]">
        {label}
      </span>
      <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        {children}
      </span>
    </div>
  );
}

function PriceCollateralCard({ pc }: { pc: PriceCollateralView }) {
  return (
    <div
      data-testid="loan-detail-price-collateral"
      className="flex w-full flex-col gap-[16px] rounded-[4px] border border-solid bg-white p-[26px]"
      style={{ borderColor: LINE_COLOR }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <h2 className="font-[family-name:var(--font-display)] text-[28px] leading-[35.84px] text-[#262524]">
          Price &amp; collateral
        </h2>
        <span className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[rgba(56,55,53,0.6)]">
          {pc.feedNote}
        </span>
      </div>

      {pc.state === "loading" ? (
        <div
          data-testid="loan-detail-price-collateral-loading"
          className="flex flex-col gap-2"
          aria-busy="true"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-[36px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      ) : pc.state === "error" ? (
        <p
          data-testid="loan-detail-price-collateral-error"
          className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[rgba(56,55,53,0.6)]"
        >
          {pc.errorMessage}
        </p>
      ) : (
        <div>
          <DetailRow label="Spot (off-chain API)">
            {pc.spot == null ? (
              "—"
            ) : (
              <span
                style={pc.spot.negative ? { color: NEGATIVE_RED } : undefined}
              >
                {pc.spot.text}
              </span>
            )}
          </DetailRow>
          <DetailRow label="Quantity (trustee feed)">{pc.quantity}</DetailRow>
          <DetailRow label={pc.collateralLabel}>{pc.collateralValue}</DetailRow>
          <DetailRow label="Senior outstanding">
            {pc.seniorOutstanding}
          </DetailRow>
          <DetailRow label="CCR" isLast>
            {pc.ccr}
          </DetailRow>
        </div>
      )}
    </div>
  );
}

function LoanDetail() {
  const { id } = Route.useParams();
  const location = useLocation();
  const navEntry = location.state.entry;
  const detail = useLoanDetail(id, navEntry);

  if (detail.state === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[39px] pb-[80px]">
        <div
          data-testid="loan-detail-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading loan"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[60px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }

  if (detail.state === "not-found" || !detail.hero || !detail.priceCollateral) {
    return (
      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[39px] pb-[80px]">
        <p
          data-testid="loan-detail-not-found"
          className="font-[family-name:var(--font-body)] text-[16px] text-[rgba(56,55,53,0.6)]"
        >
          Loan not found.{" "}
          <Link to="/loans" className="text-[#000080] underline">
            Back to Loans
          </Link>
        </p>
      </main>
    );
  }

  const { hero, priceCollateral } = detail;

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[8px] px-[56px] pt-[39px] pb-[80px]">
      <Link
        to="/loans"
        className="font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
      >
        ‹ Loans
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        {hero.title}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <StatusChip label={hero.status.label} band={hero.status.band} />
        <span
          data-testid="loan-detail-meta"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]"
        >
          {hero.meta}
        </span>
      </div>

      <div className="pt-[18px]">
        <PriceCollateralCard pc={priceCollateral} />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/loans/$id")({
  component: LoanDetail,
});
