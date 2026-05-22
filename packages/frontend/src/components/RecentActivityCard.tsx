import React from "react";
import { Link } from "@tanstack/react-router";
import { ActivityEmptyIllustration, Card, EmptyState } from "@pipeline/ui";
import { useWallet } from "@/wallet";
import { useRequests } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";

/**
 * RecentActivityCard — right-column card on the home dashboard.
 *
 * Renders in two states:
 *
 * **Connected + data** (Figma frame `1497:95119`):
 *   Shows the top 3 most recent requests as `ActivityRow` entries (identical
 *   visuals to `/transactions`) followed by a right-aligned "View All →" link
 *   that navigates to `/transactions`. Row rendering is delegated to the shared
 *   `renderRequestRow` helper so the home card and the transactions page always
 *   render rows from the same code path.
 *
 * **Everything else** (disconnected, loading, error, connected but no rows):
 *   Shows the existing `ActivityEmptyIllustration` + caption empty state
 *   (Figma node `1497:94567`). No "View All" link is shown — there is nothing
 *   to navigate to.
 *
 * Layout:
 *   - The Card is the positioning context. Inner content is a vertical flex
 *     column so the heading hugs the top and the body stretches to fill the
 *     remaining height.
 *   - `min-h-[564px]` mirrors the Figma height (`1497:94567` is 564px tall).
 *     The card may grow with content but never collapses below the designed
 *     silhouette so both states stay visually balanced.
 *
 * Typography:
 *   - Title uses the Heading M token (`--text-pipeline-heading-m` = 28px,
 *     line-height 36px) in the Besley display family — matches the Figma
 *     heading instance `1497:94568`.
 *   - "View All →" uses body token utilities — no raw font sizes or colors.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a landmark via
 *     `role="region"` + `aria-labelledby` referencing the heading id so
 *     assistive tech announces "Recent activity, region".
 *   - The illustration is decorative; `ActivityEmptyIllustration` sets
 *     `aria-hidden="true"` internally.
 *
 * Figma references:
 *   - Connected state: `1497:95119`
 *   - Empty/disconnected state: `1497:94567`
 */

export type RecentActivityCardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
>;

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
const HEADING_ID = "recent-activity-card-title";

// Figma `IMG` slot inside the Placeholder is exactly 240×240
// (node `1497:94570`). Pin the illustration to that size so the muted variant
// reads at the same scale as the design.
const ILLUSTRATION_WIDTH = 240;

// Maximum rows to show on the home card. The Figma frame `1497:95207` shows
// 5 rows (Sell / Sell / Unstake / Stake / Buy) filling the card height
// (min-h-[564px]) with a "View All" affordance below.
const MAX_ROWS = 5;

export const RecentActivityCard = React.forwardRef<
  HTMLDivElement,
  RecentActivityCardProps
>(function RecentActivityCard({ className, ...rest }, ref) {
  const { isConnected } = useWallet();
  const { data, isLoading, error } = useRequests();
  const requests = data?.requests ?? [];
  const showList = isConnected && !isLoading && !error && requests.length > 0;

  const composed = [
    // Heading top, body fills the rest — mirrors the Figma
    // "heading" / "Placeholder" vertical stack on node 1497:94567.
    "flex flex-col gap-4",
    "min-h-[564px] w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="white"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:94567"
      {...rest}
    >
      {/* Heading — top-left of the card. Matches the Figma heading instance
          (node 1497:94568) which renders the Heading M token in the display
          serif family with the primary ink token. */}
      <h2
        id={HEADING_ID}
        className={[
          "font-[family-name:var(--font-display)]",
          "text-[length:var(--text-pipeline-heading-m)]",
          "leading-[var(--text-pipeline-heading-m--line-height)]",
          "font-[var(--font-weight-regular)]",
          "text-[color:var(--color-pipeline-ink)]",
          "m-0",
        ].join(" ")}
        data-node-id="1497:94568"
      >
        Recent activity
      </h2>

      {/* Body — either the activity list (connected + data) or the empty state */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-4"
        data-node-id="1497:94569"
      >
        {showList ? (
          <>
            <ul className="flex flex-col">
              {requests.slice(0, MAX_ROWS).map((item, i) => (
                <li key={i}>{renderRequestRow(item)}</li>
              ))}
            </ul>
            <Link
              to="/transactions"
              className={[
                "self-end",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-ink)]",
                "no-underline hover:underline",
              ].join(" ")}
            >
              View All →
            </Link>
          </>
        ) : (
          <EmptyState
            illustration={
              <ActivityEmptyIllustration
                tone="muted"
                width={ILLUSTRATION_WIDTH}
                data-node-id="1497:94570"
              />
            }
            caption="You will see all transactions here"
            data-node-id="1497:94665"
          />
        )}
      </div>
    </Card>
  );
});

RecentActivityCard.displayName = "RecentActivityCard";

export default RecentActivityCard;
