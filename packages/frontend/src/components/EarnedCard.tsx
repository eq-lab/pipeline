import React from "react";
import { Card } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#earnedcard
// (composition, states A/B/C, Figma frame 1497:94556 node 1497:94691).

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
   * Formatted total PnL in dollars, e.g. `"+$123.00"` (realized + unrealized,
   * sourced from `GET /v1/pnl` `total_pnl`). When present, this replaces the
   * placeholder value.
   */
  earnedPnlLabel?: string;
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"sm"` (8px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

/** Base label id prefix — each instance gets a unique suffix from useId(). */
const LABEL_ID_BASE = "earned-card-label";

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

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
    { className, mobileHomeState, earnedPnlLabel, ...rest },
    ref,
  ) {
    // Use a unique id per instance to avoid duplicate id attributes when both
    // the mobile and desktop blocks render this card in the same DOM.
    const instanceId = React.useId();
    const LABEL_ID = `${LABEL_ID_BASE}-${instanceId}`;

    const composed = [
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    // spec: docs/frontend/dashboard-components.md#earnedcard (state → display-value table).
    let earnedValue: string;
    let valueExtra: string | undefined;

    if (earnedPnlLabel !== undefined) {
      earnedValue = earnedPnlLabel;
      valueExtra = undefined;
    } else if (mobileHomeState === "empty" || mobileHomeState === "plusd") {
      earnedValue = "Nothing yet";
      valueExtra = undefined;
    } else {
      earnedValue = "Tracked once you stake";
      valueExtra = undefined;
    }

    // PnL value classes: use the green positive token for the earned value.
    const stateValueClasses =
      earnedPnlLabel !== undefined
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
