import React from "react";
import {
  Button,
  Card,
  SignUpIllustration,
  WalletIllustration,
} from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#connectwalletpromocard
// (composition, layout, illustration positioning, variants, Figma frame 1497:94556 node 1497:94566; zero-state node 6701:98331).

export type ConnectWalletPromoCardVariant = "connect-wallet" | "get-started";

export interface ConnectWalletPromoCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  onConnect?: () => void;
  padding?: CardPadding;
  variant?: ConnectWalletPromoCardVariant;
}

const HEADING_ID_BASE = "connect-wallet-promo-card-title";

export const ConnectWalletPromoCard = React.forwardRef<
  HTMLDivElement,
  ConnectWalletPromoCardProps
>(function ConnectWalletPromoCard(
  { onConnect, className, variant = "connect-wallet", ...rest },
  ref,
) {
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;
  const composed = [
    "relative",
    "flex flex-col justify-between",
    "min-h-[274px] w-full",
    "overflow-hidden",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const heading = variant === "get-started" ? "Get Started" : "Connect Wallet";
  const ctaLabel = variant === "get-started" ? "Sign Up" : "Connect";
  const nodeId = variant === "get-started" ? "6701:98331" : "1497:94566";

  return (
    <Card
      ref={ref}
      variant="yellow"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id={nodeId}
      data-variant={variant}
      {...rest}
    >
      {variant === "get-started" ? (
        <span className="pointer-events-none absolute top-[42px] right-0 w-[288px]">
          <SignUpIllustration
            tone="primary"
            width="100%"
            data-node-id="6702:105867"
          />
        </span>
      ) : (
        <span
          className={[
            "pointer-events-none absolute -translate-y-1/2",
            "top-[192px] right-[-48px] w-[235px]",
            "md:top-[70%] md:w-[314px]",
          ].join(" ")}
        >
          <WalletIllustration
            tone="primary"
            width="100%"
            data-node-id="I1497:94566;1360:49452"
          />
        </span>
      )}

      <header
        className="relative flex flex-col gap-1"
        data-node-id="I1497:94566;1360:49019"
        data-testid="home-connect-header"
      >
        <h2
          id={HEADING_ID}
          className={[
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-m-mobile)]",
            "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
            "md:text-[length:var(--text-pipeline-heading-m)]",
            "md:leading-[var(--text-pipeline-heading-m--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94566;1360:49019;6539:2329"
          data-testid="home-connect-heading"
        >
          {heading}
        </h2>
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94566;1360:49019;6539:2331"
        >
          Access real-world yield on-chain
        </p>
      </header>

      <Button
        variant="primary-dark"
        size="m"
        onClick={onConnect}
        className="relative self-start"
        data-node-id="I1497:94566;1360:49021"
        data-testid="home-connect-cta"
      >
        {ctaLabel}
      </Button>
    </Card>
  );
});

ConnectWalletPromoCard.displayName = "ConnectWalletPromoCard";

export default ConnectWalletPromoCard;
