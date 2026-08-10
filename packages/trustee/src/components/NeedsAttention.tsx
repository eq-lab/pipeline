import { Link } from "@tanstack/react-router";
import { OriginationIcon } from "./TrusteeNavIcons";
import { useNeedsAttention } from "./useNeedsAttention";

/**
 * NeedsAttention — the Trustee Overview page's "Needs Attention" section,
 * Origination group ONLY (issue #818, Figma node `4116:9004` section header /
 * `4116:9006` group header / `4116:9008` row). Real data:
 * `GET /v1/loan-book/submissions` (unfiltered) via `useNeedsAttention`, which
 * keeps `InReview` + `ChangesRequested` rows (#1046) — a changes-requested
 * origination stays visible while awaiting the originator's resubmit, with a
 * status-derived row title ("…: changes requested") and the SAME "Review"
 * link (the `/origination/$id` detail renders the reason banner, #950).
 *
 * Scope (issue #818, cross-linked to #799): the Loans — Payments Due, Cash
 * Management, and Risk Council groups (Figma nodes `4116:9018`+) are
 * deliberately OMITTED — no backend endpoints exist for them yet. This
 * component renders ONLY the Origination group.
 *
 * Empty/loading/error handling (resolved OQ#3, human review): the section —
 * heading and all — renders NOTHING unless at least one group has a row
 * (in-flight submission or needs-attention loan). No skeleton on loading, no
 * error surface; this is a
 * supplementary block, not the page's primary content (unlike
 * `CapitalAllocationCard`, which does show loading/error states).
 *
 * Resolved OQ#1 (human, superseded by issue #821): the "Review" button now
 * navigates to `/origination/$id`, passing the row's source `SubmissionView`
 * as router state — mirroring `origination.tsx`'s `StatusCell` "in-review"
 * case, which was wired the same way in the same issue.
 *
 * NOT a `Card` (human review follow-up, issue #818): per the Figma
 * background node `4116:8928`, the "Needs Attention" heading/group/rows live
 * INSIDE the SAME single white surface as the Capital Allocation content —
 * ONE continuous card, not two stacked white blocks. This component
 * therefore renders plain content (no white background/border/radius of its
 * own); the Overview route passes it as `children` to `CapitalAllocationCard`,
 * which renders it inside its own `Card`, right after its own content. An
 * earlier cut wrapped this in its own `Card`, which visually produced a
 * second white block with a gap — corrected here.
 *
 * Pixel/token mapping from the Figma export:
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
 *     `text-[16px]` Inter regular, full opacity. Human review follow-up
 *     (issue #818): the initial cut wrongly copied the ORIGINATION TABLE's
 *     disabled Review button shape (`h-[36px]`/`text-[15px]`/`opacity-60`,
 *     Figma node `4116:9159`) — a DIFFERENT Figma component from this
 *     section's button. Issue #821 wires it live (navigates to
 *     `/origination/$id`); the `disabled`/`aria-disabled` inert affordance is
 *     removed accordingly, keeping the same visual shape.
 */
const ROW_CLASS =
  "flex min-h-[72px] w-full items-center gap-[16px] rounded-[4px] border border-solid px-[17px] py-[15px]";
const ROW_STYLE = {
  backgroundColor: "rgba(211,235,117,0.16)",
  borderColor: "rgba(56,55,53,0.18)",
} as const;
const GROUP_LABEL_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] text-[color:var(--color-pipeline-ink-muted)] uppercase";
const ACTION_CLASS =
  "flex h-[40px] shrink-0 items-center justify-center rounded-[4px] bg-[color:var(--color-pipeline-brand)] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white";

/** The lightbulb icon circle + the title/subtitle text block, shared by both groups. */
function RowBody({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <span
        className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-[color:var(--color-pipeline-brand)]"
        aria-hidden="true"
      >
        <OriginationIcon width={18} height={18} className="text-white" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <p className="truncate font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[color:var(--color-pipeline-ink)]">
          {title}
        </p>
        <p className="truncate font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] text-[color:var(--color-pipeline-ink-muted)]">
          {subtitle}
        </p>
      </div>
    </>
  );
}

export function NeedsAttention() {
  const { state, rows, loanRows } = useNeedsAttention();

  if (state !== "ready" || (rows.length === 0 && loanRows.length === 0)) {
    return null;
  }

  return (
    <div
      className="flex w-full flex-col items-start gap-[10px]"
      data-testid="needs-attention"
      aria-label="Needs Attention"
    >
      <h2 className="font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
        Needs Attention
      </h2>

      {rows.length > 0 && (
        <div
          className="flex w-full flex-col items-start gap-[14px]"
          data-testid="needs-attention-origination"
        >
          <p className={GROUP_LABEL_CLASS}>Origination</p>

          <div className="flex w-full flex-col gap-3">
            {rows.map((row) => (
              <div
                key={row.id}
                data-testid="needs-attention-row"
                className={ROW_CLASS}
                style={ROW_STYLE}
              >
                <RowBody title={row.title} subtitle={row.subtitle} />
                <Link
                  to="/origination/$id"
                  params={{ id: String(row.id) }}
                  state={{ submission: row.submission }}
                  aria-label="Review submission"
                  data-testid="needs-attention-review"
                  className={ACTION_CLASS}
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {loanRows.length > 0 && (
        <div
          className="flex w-full flex-col items-start gap-[14px]"
          data-testid="needs-attention-loans"
        >
          <p className={GROUP_LABEL_CLASS}>Loans</p>

          <div className="flex w-full flex-col gap-3">
            {loanRows.map((row) => (
              <div
                key={row.loanId}
                data-testid="needs-attention-loan-row"
                className={ROW_CLASS}
                style={ROW_STYLE}
              >
                <RowBody title={row.title} subtitle={row.subtitle} />
                <Link
                  to="/loans/$id"
                  params={{ id: row.loanId }}
                  aria-label={`Open ${row.title}`}
                  data-testid="needs-attention-open"
                  className={ACTION_CLASS}
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NeedsAttention;
