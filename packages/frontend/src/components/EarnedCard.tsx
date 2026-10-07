// spec: docs/frontend/dashboard-components.md#earnedcard
import React from "react";
import { Card } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

export type EarnedCardLayout = "default" | "compact";

export interface EarnedCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  earnedPnlLabel?: string;
  padding?: CardPadding;
  layout?: EarnedCardLayout;
}

const LABEL_ID_BASE = "earned-card-label";

const ELEVATION_BORDER = "!border-t !border-r-[3px] !border-b-[3px] !border-l";

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

const compactValueClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "m-0",
].join(" ");

function pnlValueClasses(earnedPnlLabel: string, compact: boolean): string {
  return [
    "font-[family-name:var(--font-display)]",
    compact
      ? "text-[length:var(--text-pipeline-heading-s)]"
      : "text-[length:var(--text-pipeline-heading-s-mobile)]",
    compact
      ? "leading-[var(--text-pipeline-heading-s--line-height)]"
      : "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
    compact ? "" : "md:text-[length:var(--text-pipeline-heading-s)]",
    compact ? "" : "md:leading-[var(--text-pipeline-heading-s--line-height)]",
    "font-[var(--font-weight-regular)]",
    earnedPnlLabel.startsWith("+")
      ? "text-[color:var(--color-pipeline-chart-positive)]"
      : "text-[color:var(--color-pipeline-ink)]",
    "m-0",
  ]
    .filter(Boolean)
    .join(" ");
}

export const EarnedCard = React.forwardRef<HTMLDivElement, EarnedCardProps>(
  function EarnedCard(
    { className, earnedPnlLabel, padding, layout = "default", ...rest },
    ref,
  ) {
    const instanceId = React.useId();
    const LABEL_ID = `${LABEL_ID_BASE}-${instanceId}`;

    const earnedValue = earnedPnlLabel ?? "Tracked once you stake";
    const isCompact = layout === "compact";

    const stateValueClasses =
      earnedPnlLabel !== undefined
        ? pnlValueClasses(earnedPnlLabel, isCompact)
        : isCompact
          ? compactValueClasses
          : valueClasses;

    if (isCompact) {
      const compactComposed = [
        "flex h-[82px] w-full items-center gap-2",
        ELEVATION_BORDER,
        className,
      ]
        .filter(Boolean)
        .join(" ");

      return (
        <Card
          ref={ref}
          variant="white"
          padding={padding ?? "md"}
          role="region"
          aria-labelledby={LABEL_ID}
          className={compactComposed}
          data-node-id="6701:97918"
          {...rest}
        >
          <div
            className="flex min-w-0 flex-1 flex-col"
            data-node-id="6701:97919"
            data-testid="home-earned-content"
          >
            <p
              id={LABEL_ID}
              className={labelClasses}
              data-node-id="6701:97920"
              data-testid="home-earned-label"
            >
              Earnings
            </p>
            <p
              className={stateValueClasses}
              data-node-id="6701:97925"
              data-testid="home-earned-value"
            >
              {earnedValue}
            </p>
          </div>
        </Card>
      );
    }

    const composed = [ELEVATION_BORDER, className].filter(Boolean).join(" ");

    return (
      <Card
        ref={ref}
        variant="white"
        padding={padding}
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
            Earnings
          </p>
          <p
            className={stateValueClasses}
            data-node-id="1497:94698"
            data-testid="home-earned-value"
          >
            {earnedValue}
          </p>
        </div>
      </Card>
    );
  },
);

EarnedCard.displayName = "EarnedCard";

export default EarnedCard;
