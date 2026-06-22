import React from "react";
import { Card } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

/**
 * EarnedCard — Disconnected-state "Earned" placeholder card.
 *
 * Smallest card in the left column of the Disconnected dashboard (Figma frame
 * `1497:94556`, node `1497:94691` `card-horizontal` → child `1497:94692`
 * "Earned Balance"). It announces a not-yet-shipped surface and reserves the
 * footprint so the dashboard composition reads complete:
 *
 *   ┌─────────────────────────┐
 *   │  Earned                 │
 *   │  Tracked once you stake │
 *   └─────────────────────────┘
 *
 * Composition:
 *   - {@link Card} `variant="white"` paints the paper surface, hairline border,
 *     4px radius, and the design system's 24px interior padding. No raw colors
 *     are introduced — every surface value is owned by the Card primitive.
 *
 * Typography:
 *   - Label "Earned" — Body token (16 / 22) in Graphik LC, primary ink
 *     (`--color-pipeline-ink`). Mirrors Figma node `1497:94693`.
 *   - Value placeholder "Tracked once you stake" — Besley display at 20 / 28 ("Heading
 *     20" in the Figma type styles, see node `1497:94698`). It uses the
 *     `--color-pipeline-ink-subtle` (content-test/tertiary, 30% alpha) token
 *     to read as muted/disabled, signalling the surface is reserved.
 *
 * Italics: the Figma source is `Besley Regular` — not italic — so the
 * placeholder renders upright. The Issue's acceptance criterion allows italics
 * "per Figma if applicable"; here Figma does not call for italics, so the
 * component intentionally omits them.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a region with
 *     `role="region"` + `aria-labelledby` referencing the "Earned" label so
 *     assistive tech announces "Earned, region".
 *   - The placeholder value carries `aria-live="off"` semantics implicitly
 *     (it never changes). It is announced as part of the region's contents.
 *
 * Reuse: this composite belongs to the Disconnected home view alongside
 * {@link ConnectWalletPromoCard}. It is intentionally page-local — not
 * hoisted into `@pipeline/ui` — because the muted-placeholder framing is
 * specific to the wallet-less dashboard state. Once an Earned balance becomes
 * available the surface will be replaced by a value-bearing card, so the
 * "coming soon" framing has a bounded lifetime.
 */

/** Mobile home balance state — drives the earned value display. */
type MobileHomeState = "empty" | "plusd" | "splusd";

export interface EarnedCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /**
   * Mobile-only: connected balance state.
   * When `"splusd"` (State C), renders the tracking placeholder until PnL APY
   * exists.
   * When `"empty"` or `"plusd"` (States A/B), renders "Nothing yet".
   * When `undefined`, renders "Tracked once you stake".
   */
  mobileHomeState?: MobileHomeState;
  /**
   * Formatted PnL APY label, e.g. `"8.42% p.a."`. When present, this replaces
   * the placeholder value.
   */
  avgApyLabel?: string;
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"sm"` (8px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

/** Base label id prefix — each instance gets a unique suffix from useId(). */
const LABEL_ID_BASE = "earned-card-label";

// Label row — Body token (16/22) in Graphik LC, primary ink. Mirrors Figma
// node `1497:94693` "Earned" string.
const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

// Value row — Besley display, tertiary ink to read as muted/disabled.
// Mobile (base): heading-s-mobile = 18px / 28px (Figma node 1989:9030).
// Desktop (md+): heading-s = 20px / 28px.
// Mirrors Figma node `1497:94698` placeholder value.
const valueClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s-mobile)]",
  "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-s)]",
  "md:leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "m-0",
].join(" ");

export const EarnedCard = React.forwardRef<HTMLDivElement, EarnedCardProps>(
  function EarnedCard(
    { className, mobileHomeState, avgApyLabel, ...rest },
    ref,
  ) {
    // Use a unique id per instance to avoid duplicate id attributes when both
    // the mobile and desktop blocks render this card in the same DOM.
    const instanceId = React.useId();
    const LABEL_ID = `${LABEL_ID_BASE}-${instanceId}`;

    const composed = [
      // Figma asymmetric elevation border: 1px top/left, 3px right/bottom.
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    // Determine the display value based on state.
    // PnL APY, when available, wins over placeholders.
    // States A/B (empty/plusd) when connected: "Nothing yet".
    // Disconnected / desktop / State C without APY: tracking placeholder.
    let earnedValue: string;
    let valueExtra: string | undefined;

    if (avgApyLabel !== undefined) {
      earnedValue = avgApyLabel;
      valueExtra = undefined;
    } else if (mobileHomeState === "empty" || mobileHomeState === "plusd") {
      // States A/B: "Nothing yet" per Figma frames 1988:7074 / 1984:6501.
      earnedValue = "Nothing yet";
      valueExtra = undefined;
    } else {
      earnedValue = "Tracked once you stake";
      valueExtra = undefined;
    }

    // PnL APY value classes: use green positive token for the earned value.
    // Mobile (base): heading-s-mobile = 18px / 28px (Figma node 1886:46777).
    // Desktop (md+): heading-s = 20px / 28px.
    const stateValueClasses =
      avgApyLabel !== undefined
        ? [
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-s-mobile)]",
            "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
            "md:text-[length:var(--text-pipeline-heading-s)]",
            "md:leading-[var(--text-pipeline-heading-s--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-chart-positive)]",
            "m-0",
          ].join(" ")
        : valueClasses;

    return (
      <Card
        ref={ref}
        variant="white"
        role="region"
        aria-labelledby={LABEL_ID}
        className={composed}
        data-node-id="1497:94691"
        {...rest}
      >
        {/* Inner stack — label on top, value below. The two rows align with
            Figma node `1497:94692` "Earned Balance" which is a flex column
            with no gap (each row owns its own line-height). */}
        <div
          className="flex flex-col"
          data-node-id="1497:94692"
          data-testid="home-earned-content"
        >
          <p
            id={LABEL_ID}
            className={labelClasses}
            data-node-id="1497:94693"
            data-testid="home-earned-label"
          >
            Earned
          </p>
          <p
            className={stateValueClasses}
            data-node-id="1497:94698"
            data-testid="home-earned-value"
          >
            {earnedValue}
          </p>
          {valueExtra !== undefined && (
            <p
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-caption)]",
                "leading-[var(--text-pipeline-caption--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "m-0",
              ].join(" ")}
            >
              {valueExtra}
            </p>
          )}
        </div>
      </Card>
    );
  },
);

EarnedCard.displayName = "EarnedCard";

export default EarnedCard;
