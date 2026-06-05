import React from "react";
import { formatUnits } from "viem";
import { Button, Card } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";
import { useStats, formatApy } from "@/api";

/**
 * StakeCard — Stake PLUSD entry-point card.
 *
 * Small white card in the lower-middle slot of the Disconnected dashboard
 * (Figma frame `1497:94556`, node `1497:94702` "card-horizontal"). It
 * advertises the staking yield and offers the circular "Stake" CTA:
 *
 *   ┌───────────────────────────────────────┐
 *   │  Stake PLUSD                          │
 *   │  Earn X.XX%                           │
 *   │  From loan coupons and T-bills        │
 *   │                                       │
 *   │                              ╭─────╮  │
 *   │                              │Stake│  │
 *   │                              ╰─────╯  │
 *   └───────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="white"` supplies the paper-white surface with the
 *     hairline border, 4px radius and 16px interior padding mirroring the
 *     Figma "card-horizontal" frame.
 *   - {@link Button} `variant="circular-blue"` provides the round navy
 *     "Stake" CTA anchored bottom-right (Figma node `1497:94713`): 88px on
 *     mobile (Figma frame 1989-8292, node 2113:9115) and 128px on desktop.
 *
 * Layout:
 *   - The Card hosts a vertical flex column with `justify-between` so the
 *     text block hugs the top of the card and the circular CTA hugs the
 *     bottom-right — matching the Figma stack with `items-end`.
 *   - `min-h-[274px]` mirrors the Figma height; the card may grow with
 *     content but does not collapse below the designed silhouette.
 *   - `overflow-hidden` clips the round CTA to the rounded card edge if a
 *     narrow container ever pushes the circle outside the surface.
 *
 * Typography:
 *   - The top-line label ("Stake PLUSD") uses the Body token (16/22) in
 *     Graphik LC at primary ink — same treatment as the "Start here" /
 *     "Earned" labels on the sibling cards.
 *   - The main line ("Earn X.XX%") uses the Heading 20 token (20/28) in the
 *     Besley display family at primary ink, matching "Get PLUSD" / "Coming
 *     soon" headings on the sibling cards.
 *   - The subtitle ("From loan coupons and T-bills") uses the Caption token
 *     (12/16) in Graphik LC at muted ink, matching "Convert with USDC 1:1".
 *   No raw font sizes or colors are introduced — every value resolves to a
 *   token in `@pipeline/ui/styles/theme.css`.
 *
 * Content:
 *   - The APY figure is sourced from `useStats` (`GET /v1/stats`). Falls back
 *     to `—` when the API returns null or the request fails.
 *
 * Accessibility:
 *   - The Card is promoted to a labelled region via `role="region"` +
 *     `aria-labelledby` referencing the "Stake PLUSD" heading id so
 *     assistive tech announces "Stake PLUSD, region".
 *   - The circular CTA is a real `<button>` (provided by the `Button`
 *     primitive) and inherits focus-visible styling from the primitive.
 *     An `aria-label="Stake PLUSD"` makes the button's intent unambiguous
 *     when read in isolation (the visible label is just "Stake").
 *
 * Reuse: this composite belongs to the dashboard view. It is page-level
 * glue around `@pipeline/ui` primitives and lives next to the rest of the
 * page composers in `packages/frontend/src/components/`.
 */

/** Mobile home balance state — drives the StakeCard variant. */
type MobileHomeState = "empty" | "plusd" | "splusd";

export interface StakeCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  /**
   * Click handler for the Stake CTA. Optional so the card can be dropped
   * into Storybook / preview routes without wiring a staking flow; the
   * page-level container is expected to supply this in production.
   */
  onStake?: () => void;
  /**
   * When `true`, the Stake CTA is rendered in its disabled state (per Figma
   * node `1497:95069`). Pass `true` when the connected wallet's PLUSD balance
   * is zero so the button cannot initiate a stake flow with no tokens.
   */
  stakeDisabled?: boolean;
  /**
   * Mobile-only: connected balance state.
   * - `"empty"` (State A): circular CTA disabled, labelled "Nothing to Stake".
   * - `"plusd"` (State B): circular CTA enabled, labelled "Stake".
   * - `"splusd"` (State C): "Staked PLUSD" balance display + "Stake More" CTA
   *   + "Unstake" text link.
   * When `undefined` the desktop/disconnected appearance is preserved.
   */
  mobileHomeState?: MobileHomeState;
  /**
   * Mobile-only: sPLUSD share balance (raw bigint, 18 decimals).
   * Displayed as the top number ("shares") in State C.
   */
  mobileSplusdShares?: bigint;
  /**
   * Mobile-only: sPLUSD shares converted to PLUSD-equivalent (raw bigint, 18 dec).
   * Displayed as the sub-line ("X.XX sPLUSD") in State C.
   */
  mobileSplusdInPlusd?: bigint;
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"sm"` (8px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

/** Base heading id prefix — each instance gets a unique suffix from useId(). */
const HEADING_ID_BASE = "stake-card-title";

/** Format a bigint at 18 decimals to a locale number string (e.g. "1,000.00"). */
function formatBigintNumber(value: bigint | undefined): string {
  if (value === undefined) return "0.00";
  const asFloat = parseFloat(formatUnits(value, 18));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asFloat);
}

export const StakeCard = React.forwardRef<HTMLDivElement, StakeCardProps>(
  function StakeCard({
    onStake,
    stakeDisabled,
    className,
    mobileHomeState,
    mobileSplusdShares,
    mobileSplusdInPlusd,
    ...rest
  }, ref) {
    // Use a unique id per instance to avoid duplicate id attributes when both
    // the mobile and desktop blocks render this card in the same DOM.
    const instanceId = React.useId();
    const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

    const { data: statsData } = useStats();
    const apyLabel = `Earn ${formatApy(statsData?.vaults[0]?.apy)} p.a.`;

    const composed = [
      // Text block top, circular CTA bottom-right — mirrors the Figma
      // "card-horizontal" stack with `justify-between` + `items-end`.
      "flex flex-col items-end justify-between",
      "min-h-[274px] w-full",
      // Clip the circular CTA to the rounded card silhouette.
      "overflow-hidden",
      // Figma asymmetric elevation border: 1px top/left, 3px right/bottom.
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    // State C: "Staked PLUSD" display with shares and PLUSD-equivalent.
    if (mobileHomeState === "splusd") {
      const sharesFormatted = formatBigintNumber(mobileSplusdShares);
      const inPlusdFormatted = formatBigintNumber(mobileSplusdInPlusd);

      return (
        <Card
          ref={ref}
          variant="white"
          role="region"
          aria-labelledby={HEADING_ID}
          className={composed}
          data-node-id="1497:94702"
          {...rest}
        >
          {/* Staked PLUSD header */}
          <header
            className="flex w-full flex-col items-start gap-1 self-start"
            data-node-id="1497:94703"
          >
            <p
              id={HEADING_ID}
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink)]",
                "m-0",
              ].join(" ")}
            >
              Staked PLUSD
            </p>
            {/* Top number: sPLUSD shares */}
            <p
              className={[
                "font-[family-name:var(--font-display)]",
                // Mobile (base): heading-s-mobile = 18px / 28px (Figma node 1886:46777)
                "text-[length:var(--text-pipeline-heading-s-mobile)]",
                "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
                // Desktop (md+): heading-s = 20px / 28px
                "md:text-[length:var(--text-pipeline-heading-s)]",
                "md:leading-[var(--text-pipeline-heading-s--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink)]",
                "m-0",
              ].join(" ")}
              data-testid="splusd-shares"
            >
              {sharesFormatted}
            </p>
            {/* Sub-line: PLUSD-equivalent */}
            <p
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-caption)]",
                "leading-[var(--text-pipeline-caption--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "m-0",
              ].join(" ")}
              data-testid="splusd-in-plusd"
            >
              {inPlusdFormatted} sPLUSD
            </p>
          </header>

          {/* Bottom section: "Stake More" CTA + "Unstake" text link */}
          <div className="flex w-full flex-col items-end gap-2">
            {/* "Unstake" text link */}
            <button
              type="button"
              onClick={onStake}
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-caption)]",
                "leading-[var(--text-pipeline-caption--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "underline-offset-2 hover:underline",
                "bg-transparent border-0 cursor-pointer p-0",
              ].join(" ")}
              data-testid="unstake-link"
            >
              Unstake
            </button>
            {/* "Stake More" circular CTA.
                Size: 88px on mobile (matching the base Stake button),
                restoring the default 128px on desktop (md+). */}
            <Button
              variant="circular-blue"
              onClick={onStake}
              aria-label="Stake More PLUSD"
              className="size-[88px] md:size-32"
              data-node-id="1497:94713"
            >
              Stake More
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card
        ref={ref}
        variant="white"
        role="region"
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94702"
        {...rest}
      >
        {/* Text block — top of the card, left-aligned. The Card uses
            `items-end` for the CTA, so we restore left alignment locally
            with `self-start` and a `w-full` so the heading occupies the
            full width of the card surface (mirroring the Figma "Staked
            PLUSD Balance" frame). */}
        <header
          className="flex w-full flex-col items-start gap-1 self-start"
          data-node-id="1497:94703"
        >
          {/* Top-line label — "Stake PLUSD". Body token in Graphik LC. */}
          <p
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94704"
          >
            Stake PLUSD
          </p>
          {/* Main line — "Earn X.XX%". Heading 20 in Besley display. */}
          <p
            className={[
              "font-[family-name:var(--font-display)]",
              // Mobile (base): heading-s-mobile = 18px / 28px (Figma node 1989:9039)
              "text-[length:var(--text-pipeline-heading-s-mobile)]",
              "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
              // Desktop (md+): heading-s = 20px / 28px
              "md:text-[length:var(--text-pipeline-heading-s)]",
              "md:leading-[var(--text-pipeline-heading-s--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94709"
          >
            {apyLabel}
          </p>
          {/* Subtitle — "From senior loan coupons and T-bills". Caption in Graphik
              LC, muted ink. */}
          <p
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94711"
          >
            From senior loan coupons and T-bills
          </p>
        </header>

        {/* Stake CTA — bottom-right of the card. The parent flex column uses
            `items-end`, so the circular button naturally anchors to the
            right edge.
            State A (empty): disabled, labelled "Nothing to Stake".
            State B (plusd) or disconnected: enabled, labelled "Stake".
            Size: 88px on mobile (Figma node 2113:9115 in frame 1989-8292),
            restoring the default 128px on desktop (md+). */}
        <Button
          variant="circular-blue"
          onClick={onStake}
          disabled={
            stakeDisabled ||
            (mobileHomeState !== undefined && mobileHomeState === "empty")
          }
          aria-label={
            mobileHomeState === "empty" ? "Nothing to Stake" : "Stake PLUSD"
          }
          className="size-[88px] md:size-32"
          data-node-id="1497:94713"
        >
          {mobileHomeState === "empty" ? "Nothing to Stake" : "Stake"}
        </Button>
      </Card>
    );
  },
);

StakeCard.displayName = "StakeCard";

export default StakeCard;
