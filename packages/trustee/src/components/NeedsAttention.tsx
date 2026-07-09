import { Card } from "@pipeline/ui";
import { OriginationIcon } from "./TrusteeNavIcons";
import { useNeedsAttention } from "./useNeedsAttention";

/**
 * NeedsAttention — the Trustee Overview page's "Needs Attention" section,
 * Origination group ONLY (issue #818, Figma node `4116:9004` section header /
 * `4116:9006` group header / `4116:9008` row). Real data:
 * `GET /v1/loan-book/submissions?status=InReview` via `useNeedsAttention`.
 *
 * Scope (issue #818, cross-linked to #799): the Loans — Payments Due, Cash
 * Management, and Risk Council groups (Figma nodes `4116:9018`+) are
 * deliberately OMITTED — no backend endpoints exist for them yet. This
 * component renders ONLY the Origination group.
 *
 * Empty/loading/error handling (resolved OQ#3, human review): the section —
 * heading and all — renders NOTHING unless there is at least one in-review
 * submission. No skeleton on loading, no error surface; this is a
 * supplementary block, not the page's primary content (unlike
 * `CapitalAllocationCard`, which does show loading/error states).
 *
 * Resolved OQ#1 (human): the "Review" button is rendered per Figma but
 * **inert** — disabled/no-op, no wiring/navigation. Mirrors the origination
 * page's disabled Review button pattern (`-useOriginationTable.ts` /
 * `origination.tsx`'s `StatusCell` "in-review" case).
 *
 * Pixel/token mapping from the Figma export:
 *   - Card: white surface, same `Card` primitive as `CapitalAllocationCard`
 *     (`variant="white"`, `rounded-[4px]` → `--radius-pipeline-card`,
 *     `p-[32px]`) — per Figma node `4116:8928`, the "Needs Attention"
 *     heading/group/rows live INSIDE the SAME white background container as
 *     the Capital Allocation content, not in a separate transparent section.
 *     Human review follow-up (this issue): the initial cut rendered this on
 *     the page's transparent background — corrected to match the Figma card.
 *   - Section heading "Needs Attention": Besley display, `text-[36px]
 *     leading-[46px]`, `--color-pipeline-ink` (exact `#262524`) — NOT
 *     `--text-pipeline-title` (64px); arbitrary one-off at a non-token size,
 *     same precedent as `CapitalAllocationCard`'s `58px` total.
 *   - Group header "Origination": uppercase, `text-[12px] leading-[16.8px]
 *     tracking-[0.96px]`, `--color-pipeline-ink-muted` (exact
 *     `rgba(56,55,53,0.6)`) — `tracking-[0.96px]` has no token, arbitrary
 *     one-off.
 *   - Row: `bg-[rgba(211,235,117,0.16)]` + `border-[rgba(56,55,53,0.18)]` —
 *     NO matching token for either (scoped one-offs, same precedent as
 *     `CapitalAllocationCard`'s provenance chips and the origination table's
 *     `LINE_COLOR`); `rounded-[4px]`, `min-h-[72px]`, `px-[17px] py-[15px]`,
 *     `gap-[16px]`, `items-center`.
 *   - Icon circle: 36px, `--color-pipeline-brand` (exact `#000080`) bg,
 *     wrapping `OriginationIcon` (18px, white) — reuses the existing sidebar
 *     lightbulb glyph rather than redrawing the Figma SVG asset (both are the
 *     lightbulb glyph; see the exec plan's Assumptions section).
 *   - Row title: `text-[16px] leading-[22.4px]`, `--color-pipeline-ink`
 *     (exact `#262524`).
 *   - Row subtitle: `text-[12px] leading-[16.8px]`, `--color-pipeline-ink-muted`
 *     (exact `rgba(56,55,53,0.6)`).
 *   - Review button (Figma node `4116:9016`): `--color-pipeline-brand` (exact
 *     `#000080`) bg, white text, `rounded-[4px]`, `h-[40px]`, `px-[16px]`,
 *     `text-[16px]` Inter regular, full opacity. Human review follow-up (this
 *     issue): the initial cut wrongly copied the ORIGINATION TABLE's disabled
 *     Review button shape (`h-[36px]`/`text-[15px]`/`opacity-60`, Figma node
 *     `4116:9159`) — a DIFFERENT Figma component from this section's button.
 *     This button stays visually identical to Figma (no dimming) while still
 *     being functionally inert via `disabled`/`aria-disabled` (accessibility,
 *     not a visual affordance, signals the no-op state here).
 */
export function NeedsAttention() {
  const { state, rows } = useNeedsAttention();

  if (state !== "ready" || rows.length === 0) {
    return null;
  }

  return (
    <Card
      variant="white"
      padding="none"
      className="flex w-full flex-col items-start gap-[10px] p-8"
      data-testid="needs-attention"
      aria-label="Needs Attention"
    >
      <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
        Needs Attention
      </h2>

      <div
        className="flex w-full flex-col items-start gap-[14px]"
        data-testid="needs-attention-origination"
      >
        <p className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[color:var(--color-pipeline-ink-muted)] uppercase">
          Origination
        </p>

        <div className="flex w-full flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              data-testid="needs-attention-row"
              className="flex min-h-[72px] w-full items-center gap-[16px] rounded-[4px] border border-solid px-[17px] py-[15px]"
              style={{
                backgroundColor: "rgba(211,235,117,0.16)",
                borderColor: "rgba(56,55,53,0.18)",
              }}
            >
              <span
                className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-[color:var(--color-pipeline-brand)]"
                aria-hidden="true"
              >
                <OriginationIcon
                  width={18}
                  height={18}
                  className="text-white"
                />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                <p className="truncate font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[color:var(--color-pipeline-ink)]">
                  {row.title}
                </p>
                <p className="truncate font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[color:var(--color-pipeline-ink-muted)]">
                  {row.subtitle}
                </p>
              </div>

              <button
                type="button"
                disabled
                aria-disabled="true"
                aria-label="Review submission (not yet available)"
                data-testid="needs-attention-review"
                className="flex h-[40px] shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] bg-[color:var(--color-pipeline-brand)] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white"
              >
                Review
              </button>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default NeedsAttention;
