import React from "react";
import { Link } from "@tanstack/react-router";
import { ActivityEmptyIllustration, Card, EmptyState } from "@pipeline/ui";
import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";
import { useRequests } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";

/**
 * RecentActivityCard — right-column card on the home dashboard.
 *
 * Renders in two states:
 *
 * **Connected + data** (Figma frame `1497:95119`):
 *   Shows the top 3 most recent requests as `ActivityRow` entries (identical
 *   visuals to `/transactions`) followed by a right-aligned "View All" button
 *   (node `1497:95216`) that navigates to `/transactions`. The button renders
 *   ~48px tall, padded `12px` horizontally, with rounded-`8px` corners, Body
 *   Semi Bold typography, muted-ink color, and a right-chevron icon. Row
 *   rendering is delegated to the shared `renderRequestRow` helper so the home
 *   card and the transactions page always render rows from the same code path.
 *
 * **Everything else** (active chain disconnected, loading, error, connected but no rows):
 *   Shows the existing `ActivityEmptyIllustration` + caption empty state
 *   (Figma node `1497:94567`). No "View All" button is shown — there is
 *   nothing to navigate to.
 *
 * Active-chain gating (Issue #644): `isConnected` is keyed off the active
 * chain (`useWalletView().kind`) rather than EVM unconditionally, mirroring
 * `useRequests`. The empty state and list are mutually exclusive via `showList`.
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
 *   - "View All" uses Body Semi Bold (`Inter`, 16px / 22px,
 *     `--font-weight-emphasized`) with `--color-pipeline-ink-muted`.
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
 *   - View All button: `1497:95216`
 */

export type RecentActivityCardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
>;

/** Base heading id prefix — each instance gets a unique suffix from useId(). */
const HEADING_ID_BASE = "recent-activity-card-title";

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
  // Use a unique id per instance to avoid duplicate id attributes when both
  // the mobile and desktop blocks render this card in the same DOM.
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  // Active-chain gating (Issue #644): mirror useRequests' chain-selection logic.
  // Tech-debt: this derivation is duplicated in useRequests and transactions.tsx;
  // extract to a shared hook in a follow-up (see tech-debt-tracker.md).
  const { kind } = useWalletView();
  const { isConnected: isEvmConnected } = useEvmWallet();
  const { isConnected: isStellarConnected } = useStellarWallet();
  const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;
  const { data, isLoading, error } = useRequests();
  const requests = data?.requests ?? [];
  const showList = isConnected && !isLoading && !error && requests.length > 0;

  const composed = [
    // Heading top, body fills the rest — mirrors the Figma
    // "heading" / "Placeholder" vertical stack on node 1497:94567.
    "flex flex-col gap-4",
    "min-h-[564px] w-full",
    // Figma node 1497:95207 — asymmetric border: 1px on top/left, 3px on
    // right/bottom — same "stamped" elevation effect as StepsCard (1498-100130).
    // Use `!` prefix so per-side widths beat the uniform `border` shorthand in
    // Card's baseClasses regardless of Tailwind's CSS cascade order.
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
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
        data-testid="home-recent-activity-heading"
      >
        Recent activity
      </h2>

      {/* Body — either the activity list (connected + data) or the empty state */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-4"
        data-node-id="1497:94569"
        data-testid="home-recent-activity-body"
      >
        {showList ? (
          <>
            <ul className="flex flex-col" data-testid="home-activity-list">
              {requests.slice(0, MAX_ROWS).map((item, i) => (
                <li key={i} data-testid={`home-activity-row-${i}`}>
                  {renderRequestRow(item, kind)}
                </li>
              ))}
            </ul>
            <Link
              to="/transactions"
              className={[
                "mt-auto self-end",
                "inline-flex items-center gap-1",
                "h-12 rounded-lg px-3",
                "no-underline transition-colors",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-emphasized)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "hover:text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
              data-node-id="1497:95216"
              data-testid="home-view-all-activity"
            >
              <span>View All </span>
              <span className="inline-flex size-6 items-center justify-center">
                <ChevronRight />
              </span>
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

// ── Local icon ────────────────────────────────────────────────────────────────

/**
 * ChevronRight — 24×24 inline SVG icon painted with `currentColor`.
 * Matches the "›" shape used in the Figma "View All" button (node 1497:95216).
 * Decorative only; hidden from assistive technology.
 */
function ChevronRight() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

RecentActivityCard.displayName = "RecentActivityCard";

export default RecentActivityCard;
