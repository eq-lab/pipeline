import type { ReactNode } from "react";
import { Card } from "@pipeline/ui";
import { useCapitalAllocationCard } from "./useCapitalAllocationCard";

/**
 * CapitalAllocationCard — the Trustee Overview page's "Capital Allocation"
 * card (Figma node `4116:8928`, frame `4116-8854`), issue #797, extended in
 * #807 and #805 (including a human review follow-up on PR #811).
 *
 * Net scope for this issue (see `docs/exec-plans/active/issue-797-*.md`
 * "Decisions" section, human-confirmed 2026-07-08):
 *   - Big total (`formatFullUsd`), fully-expanded whole dollars.
 *   - A proportional allocation bar (see below) — originally an inert,
 *     equal-width placeholder (no client-computed percentages/proportions;
 *     see [no frontend-computed metrics]); superseded by a #805 review
 *     follow-up once per-bucket percentages were approved.
 *   - Per-bucket legend (Capital Wallet / In transit / Trust account /
 *     Deployed / T-Bills (USYC)) with compact dollar values, "—" for null.
 *
 * Static mock chrome (#807): the green reconciliation header
 * ("RECONCILES TO PLUSD BACKING · DRIFT < 0.01%") and the 4 provenance chips
 * below the legend are hard-coded mock strings — neither has a backing API
 * field yet. They were explicitly deferred in #797 and are added here as
 * interim static content per requester decision; a later follow-up wires
 * them to real provenance/drift data (see `docs/exec-plans/tech-debt-tracker.md`).
 *
 * Legend percentage pills (Figma node `4116:8961`, #805 scope addition): each
 * row shows `bucket_value ÷ displayed_total` (the SAME guarded total computed
 * for #805's Capital-Wallet fold-in), rounded to the nearest whole percent —
 * except a strictly-positive sub-1% share, which renders `"< 1%"` (human
 * review follow-up on PR #811; NOT rounded to `"0%"` or up to `"1%"`). This is
 * a deliberate, EXPLICITLY REQUESTED reversal of the bar's original "no
 * client-computed percentages" deferral — the requester decided the total is
 * now authoritative enough (backend + on-chain) to divide by. See
 * `useCapitalAllocationCard.ts` for the computation and
 * `docs/exec-plans/tech-debt-tracker.md` TD-41 for the tracked exception. A
 * `null` `percentDisplay` (bucket/total unknown, or a `<= 0` share) renders
 * the pre-#805 plain dot instead of a pill — never a fabricated `0%`.
 *
 * Proportional allocation bar (human review follow-up on #805, PR #811): each
 * segment's width = `row.barFraction * 100%` — the EXACT (unrounded) share of
 * the displayed total, computed alongside `percentDisplay` in
 * `useCapitalAllocationCard.ts`. Rows with a `null` `barFraction` render no
 * segment (filtered before mapping) rather than a fabricated share. Uses the
 * raw fraction, not the rounded/`"< 1%"` percent text, so segments sum to
 * ~100% instead of drifting from independent per-row rounding.
 *
 * Pixel/token mapping from the Figma export:
 *   - Card: white surface, `rounded-[4px]` → `--radius-pipeline-card`,
 *     `p-[32px]`.
 *   - Header label: Inter/body 16px, `--color-pipeline-ink`.
 *   - Total: Besley display, Figma `text-[58px]/leading-[81.2px]`, ink token.
 *   - Bar segment / legend dot colours: `#000080` → `--color-pipeline-brand`
 *     (exact match), `#208000` → `--color-pipeline-positive-primary` (exact
 *     match). `#c9a200` and `#6666b3` have no matching token — scoped
 *     one-offs, same precedent as `SignInCard`'s blur effect and #786's
 *     unbadged nav items. The mid grey segment
 *     (`rgba(56,55,53,0.35)`) is a darker alpha step of the ink token family
 *     than any existing muted/subtle token, so it is also a scoped one-off.
 *   - Drift text (`4116:8931`): `#208000` → `--color-pipeline-positive-primary`
 *     (exact). `text-[12.5px]`, `leading-[17.5px]`, `tracking-[0.75px]` are
 *     not tokens — documented one-off arbitrary values (Figma is pixel-exact
 *     at a non-token size).
 *   - Provenance chips (`4116:8966`): chip 1 text/dot `#000080` →
 *     `--color-pipeline-brand` (exact); chip 2 text/dot `#208000` →
 *     `--color-pipeline-positive-primary` (exact). Chip bg/border for both are
 *     alpha derivatives of those hexes with no matching token — one-offs.
 *     Chip 3 (`#6e6400` text/dot, `rgba(211,235,117,0.16)` bg,
 *     `rgba(201,162,0,0.35)` border) and chip 4 (`#b20000` text/dot,
 *     `rgba(178,0,0,0.07)` bg, `rgba(178,0,0,0.25)` border) have no token
 *     match at all — `#b20000` is deliberately NOT `--color-pipeline-negative`
 *     (`#c0392b`); all six values are scoped one-offs, same precedent as
 *     `SignInCard` / #786 / the #797 bucket colours above.
 *   - Percentage pill (`4116:8961`/`4116:8962`): pill background
 *     `rgba(191,189,187,0.12)` — same one-off as #786's nav badge background;
 *     `h-[16.8px]`, `rounded-[4px]`. Dot: `size-[8px] rounded-[2px]` in the
 *     row's own bucket colour (see above), `left-[4px]`. Percent text:
 *     `text-[12px]`/`leading-[16.8px]`, `rgba(56,55,53,0.6)` — an alpha step
 *     of the ink token family with no exact token match; scoped one-off,
 *     same precedent as the mid-grey bar segment above.
 *
 * `children` (issue #818, human review follow-up): the Figma background node
 * `4116:8928` wraps the ENTIRE Overview page content — Capital Allocation
 * AND "Needs Attention" — in ONE continuous white surface, not two separate
 * stacked cards. Rather than duplicating this `Card` wrapper in a second
 * component (which renders a visible gap/second white block), the Overview
 * route passes `<NeedsAttention />` in as `children` here, rendered directly
 * after this card's own content, still inside the SAME `Card`.
 * `NeedsAttention.tsx` itself renders plain content (no `Card` of its own).
 */

/**
 * Static mock provenance-chip descriptors (#807) — no backing field. Kept as
 * plain config in the view file per FRONTEND.md rule 2 (this is not derived
 * state, so it does not warrant a hook).
 */
const PROVENANCE_CHIPS = [
  {
    label: "on-chain balance · current block",
    text: "var(--color-pipeline-brand)",
    bg: "rgba(0,0,128,0.05)",
    border: "rgba(0,0,128,0.25)",
    dot: "var(--color-pipeline-brand)",
  },
  {
    label: "Relayer API · refreshed 2m ago",
    text: "var(--color-pipeline-positive-primary)",
    bg: "rgba(32,128,0,0.06)",
    border: "rgba(32,128,0,0.25)",
    dot: "var(--color-pipeline-positive-primary)",
  },
  {
    label: "Trustee feed · reconciled today",
    text: "#6e6400",
    bg: "rgba(211,235,117,0.16)",
    border: "rgba(201,162,0,0.35)",
    dot: "#6e6400",
  },
  {
    label: "stale values are labeled inline",
    text: "#b20000",
    bg: "rgba(178,0,0,0.07)",
    border: "rgba(178,0,0,0.25)",
    dot: "#b20000",
  },
] as const;

export interface CapitalAllocationCardProps {
  /**
   * Extra content rendered inside the SAME white `Card` as this component's
   * own content, directly after it (issue #818 — see the module doc's
   * `children` note). Used by the Overview route to append `<NeedsAttention />`
   * without creating a second, visually separate white block.
   */
  children?: ReactNode;
}

export function CapitalAllocationCard({
  children,
}: CapitalAllocationCardProps = {}) {
  const { isLoading, isError, errorMessage, totalDisplay, legend } =
    useCapitalAllocationCard();

  return (
    <Card
      variant="white"
      padding="none"
      className="flex w-full flex-col gap-4 p-8"
      data-testid="capital-allocation-card"
    >
      <div className="flex w-full items-baseline justify-between">
        <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]">
          Capital Allocation
        </span>
        {/* Static mock text, no backing field (issue #807) — drift is not
            served by any API yet; `justify-between` on the parent right-aligns
            this automatically. */}
        <span
          data-testid="capital-allocation-drift"
          className="font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px] font-bold tracking-[0.75px] text-[color:var(--color-pipeline-positive-primary)]"
        >
          RECONCILES TO PLUSD BACKING · DRIFT &lt; 0.01%
        </span>
      </div>

      {isError ? (
        <div
          role="alert"
          data-testid="capital-allocation-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          {errorMessage ?? "Failed to load Capital Allocation data."}
        </div>
      ) : isLoading ? (
        <div
          data-testid="capital-allocation-skeleton"
          className="flex w-full flex-col gap-4"
          aria-busy="true"
          aria-label="Loading Capital Allocation"
        >
          <div className="h-[58px] w-64 animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)]" />
          <div className="flex w-full flex-wrap gap-4">
            {legend.map((row) => (
              <div
                key={row.key}
                className="h-5 w-32 animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)]"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="font-[family-name:var(--font-display)] text-[58px] leading-[81.2px] tracking-[0.5px] text-[color:var(--color-pipeline-ink)]">
            {totalDisplay}
          </p>

          {/* Proportional allocation bar (human review follow-up on #805,
              PR #811) — each segment's width = that bucket's EXACT
              (unrounded) share of the displayed total (`row.barFraction`),
              the same guarded total used for the legend percentages, so the
              bar visually matches the legend. Supersedes #797/TD-39's inert
              equal-width placeholder. A null/unknown bucket renders no
              segment at all (filtered out below) rather than a fabricated
              share. */}
          <div
            className="flex h-2 w-full overflow-hidden rounded-[2px]"
            role="presentation"
            data-testid="capital-allocation-bar"
          >
            {legend
              .filter((row) => row.barFraction !== null)
              .map((row) => (
                <div
                  key={row.key}
                  className="h-full"
                  style={{
                    backgroundColor: row.color,
                    width: `${(row.barFraction as number) * 100}%`,
                  }}
                  data-testid={`capital-allocation-bar-segment-${row.key}`}
                />
              ))}
          </div>

          <div className="flex w-full flex-wrap items-end gap-x-6 gap-y-3">
            {legend.map((row) => (
              <div key={row.key} className="flex items-end gap-2">
                {/* Percentage pill (Figma node 4116:8961, #805 scope addition)
                    — bucket_value ÷ displayed total, rounded to the nearest
                    whole percent; renders nothing when the bucket/total is
                    unknown (never a fabricated 0%). Replaces the standalone
                    dot from #797 — the dot now lives inside the pill. */}
                {row.percentDisplay !== null && (
                  <span
                    className="relative flex h-[16.8px] shrink-0 items-center rounded-[4px] bg-[rgba(191,189,187,0.12)] pl-[4px]"
                    data-testid={`capital-allocation-percent-${row.key}`}
                  >
                    <span
                      className="size-[8px] shrink-0 rounded-[2px]"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                    <span className="pr-[5px] pl-[5px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[rgba(56,55,53,0.6)]">
                      {row.percentDisplay}
                    </span>
                  </span>
                )}
                {row.percentDisplay === null && (
                  <span
                    className="size-2 shrink-0 self-center rounded-[2px]"
                    style={{ backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]">
                  {row.label} {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Static mock provenance chips, no backing field (#807) — mirrors
              the legend's inline `style` pattern above since colours are
              chip-specific one-offs. */}
          <div
            className="flex w-full flex-wrap items-center gap-x-2 gap-y-2"
            data-testid="capital-allocation-provenance"
          >
            {PROVENANCE_CHIPS.map((chip) => (
              <div
                key={chip.label}
                className="inline-flex h-[25px] items-center gap-[7px] rounded-[var(--radius-pipeline-card)] border border-solid px-[7px]"
                style={{ backgroundColor: chip.bg, borderColor: chip.border }}
              >
                <span
                  className="size-[6px] shrink-0 rounded-[3px] opacity-75"
                  style={{ backgroundColor: chip.dot }}
                  aria-hidden="true"
                />
                <span
                  className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)]"
                  style={{ color: chip.text }}
                >
                  {chip.label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* #818: e.g. <NeedsAttention /> — rendered inside this SAME white
          Card, independent of this card's own loading/error state (it gates
          on its own hook). See the module doc's `children` note. */}
      {children}
    </Card>
  );
}

export default CapitalAllocationCard;
