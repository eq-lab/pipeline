import React from "react";
import { Card, EmptyState, WalletIllustration } from "@pipeline/ui";

/**
 * RecentActivityCard — Disconnected-state right-column card.
 *
 * White card that sits in the right column of the Disconnected dashboard
 * (Figma frame `1497:94556`, node `1497:94567` "Section"). It shows the
 * "Recent activity" heading top-left and an `EmptyState` filling the body
 * with a muted `WalletIllustration` plus the caption
 * "You will see all transactions here". When transaction history lands the
 * card body will be swapped for a list; the heading and surface chrome stay.
 *
 *   ┌─────────────────────────────────────┐
 *   │  Recent activity                    │
 *   │                                     │
 *   │              ╱╱╱╱                   │
 *   │          ╱╱╱╱╱╱╱╱                   │
 *   │          ╱╱╱╱╱╱ ◯                   │
 *   │          ╱╱╱╱╱╱                     │
 *   │                                     │
 *   │      You will see all transactions  │
 *   │              here                   │
 *   │                                     │
 *   └─────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="white"` supplies the paper-white surface,
 *     hairline border, 4px radius and 24px interior padding (matches the
 *     other neutral dashboard cards).
 *   - {@link EmptyState} centres the illustration + caption vertically and
 *     horizontally inside the body region below the heading.
 *   - {@link WalletIllustration} `tone="muted"` paints the striped-wallet
 *     decoration in the neutral muted-ink token. The Figma `IMG` slot is
 *     240×240 (`1497:94570`); we honour that intrinsic size by passing
 *     `width={240}` so the illustration tracks the Figma footprint.
 *
 * Layout:
 *   - The Card is the positioning context. Inner content is a vertical flex
 *     column so the heading hugs the top and the EmptyState stretches to
 *     fill the remaining height — matching the Figma "heading" / "Placeholder"
 *     stack on node `1497:94567`.
 *   - `min-h-[564px]` mirrors the Figma height (`1497:94567` is 564px tall).
 *     The card may grow with future content but never collapses below the
 *     designed silhouette so the empty state stays visually balanced.
 *   - `min-h-0` on the EmptyState wrapper lets the flex child shrink/fill
 *     correctly so `h-full` inside `EmptyState` resolves to the available
 *     space rather than the intrinsic illustration height.
 *
 * Typography:
 *   - Title uses the Heading M token (`--text-pipeline-heading-m` = 28px,
 *     line-height 36px) in the Besley display family — matches the Figma
 *     heading instance `1497:94568`.
 *   No raw font sizes or colors are introduced; the caption styling lives
 *   in `EmptyState`.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a landmark via
 *     `role="region"` + `aria-labelledby` referencing the heading id so
 *     assistive tech announces "Recent activity, region".
 *   - The illustration is decorative; `WalletIllustration` sets
 *     `aria-hidden="true"` internally and `EmptyState` wraps the slot in an
 *     `aria-hidden` container, so the empty-state caption is the only thing
 *     the screen reader announces inside the body.
 *
 * Reuse: this composite belongs to the Disconnected (and pre-history)
 * dashboard view. Once transaction history is wired the body will be
 * replaced by a list rendered into the same `Card`, so the composite is
 * not hoisted into `@pipeline/ui` — it lives next to the rest of the
 * page-level components in `packages/frontend/src/components/`.
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

export const RecentActivityCard = React.forwardRef<
  HTMLDivElement,
  RecentActivityCardProps
>(function RecentActivityCard({ className, ...rest }, ref) {
  const composed = [
    // Heading top, EmptyState fills the rest — mirrors the Figma
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

      {/* EmptyState wrapper — `flex-1 min-h-0` lets EmptyState's internal
          `h-full` resolve against the remaining card height so the
          illustration + caption stack centres in the body region rather
          than hugging the heading. */}
      <div className="flex min-h-0 flex-1" data-node-id="1497:94569">
        <EmptyState
          illustration={
            <WalletIllustration
              tone="muted"
              width={ILLUSTRATION_WIDTH}
              data-node-id="1497:94570"
            />
          }
          caption="You will see all transactions here"
          data-node-id="1497:94665"
        />
      </div>
    </Card>
  );
});

RecentActivityCard.displayName = "RecentActivityCard";

export default RecentActivityCard;
