// spec: docs/frontend/bank-transfers.md#addusdcard
import React from "react";
import { Card, Button, CheckIllustration } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";
import type { AddUsdCardVariant } from "./addUsdCardState";

export interface AddUsdCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  variant: AddUsdCardVariant;
  usdBalanceLabel?: string;
  padding?: CardPadding;
  onAddFunds?: () => void;
  onWithdraw?: () => void;
  onStartVerification?: () => void;
  onViewStatus?: () => void;
}

const NODE_IDS: Record<AddUsdCardVariant, string> = {
  locked: "6701:98378",
  verify: "6701:97695",
  verifying: "6701:98539",
  unlocked: "6701:97494",
  funded: "6701:97289",
};

const eyebrowClasses = [
  "m-0",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const headingClasses = [
  "m-0",
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const subCaptionClasses = [
  "m-0",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const sectionDescriptionClasses = [
  "m-0",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const withdrawClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "cursor-pointer bg-transparent p-0",
].join(" ");

function CardHorizontal({
  variant,
  usdBalanceLabel,
  onAddFunds,
  onWithdraw,
  labelId,
}: {
  variant: "locked" | "unlocked" | "funded";
  usdBalanceLabel: string | undefined;
  onAddFunds?: () => void;
  onWithdraw?: () => void;
  labelId: string;
}) {
  const eyebrow = variant === "funded" ? "USD Balance" : "Add USD";
  const heading =
    variant === "funded" ? (usdBalanceLabel ?? "—") : "Use a bank transfer";
  const subCaption =
    variant === "funded"
      ? "on Trust account"
      : variant === "unlocked"
        ? "Transfers unlocked"
        : "KYB verification required";

  return (
    <div className="flex h-full w-full flex-col justify-between gap-4">
      <div className="flex flex-col">
        <p className={eyebrowClasses}>{eyebrow}</p>
        <h3 id={labelId} className={headingClasses}>
          {heading}
        </h3>
        <p className={subCaptionClasses}>{subCaption}</p>
      </div>
      <div
        className={[
          "flex items-end",
          variant === "funded" ? "justify-between" : "justify-end",
        ].join(" ")}
      >
        {variant === "funded" && (
          <button
            type="button"
            onClick={onWithdraw}
            className={withdrawClasses}
          >
            Withdraw
          </button>
        )}
        <Button
          variant="circular-blue"
          disabled={variant === "locked"}
          onClick={onAddFunds}
        >
          Add Funds
        </Button>
      </div>
    </div>
  );
}

function Section({
  variant,
  onStartVerification,
  onViewStatus,
  labelId,
}: {
  variant: "verify" | "verifying";
  onStartVerification?: () => void;
  onViewStatus?: () => void;
  labelId: string;
}) {
  const heading =
    variant === "verify" ? "Verify your account" : "Verifying account…";
  const description =
    variant === "verify"
      ? "Complete KYB to unlock bank transfers."
      : "We are reviewing your documents.";
  const actionLabel =
    variant === "verify" ? "Start Verification" : "View Status";
  const onAction = variant === "verify" ? onStartVerification : onViewStatus;

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden">
      <CheckIllustration
        width={291}
        tone="muted"
        className="pointer-events-none absolute right-[-10px] bottom-[-15px]"
      />
      <div className="relative flex flex-col gap-1">
        <h3 id={labelId} className={headingClasses}>
          {heading}
        </h3>
        <p className={sectionDescriptionClasses}>{description}</p>
      </div>
      <div className="relative">
        <Button variant="primary-dark" size="m" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

export const AddUsdCard = React.forwardRef<HTMLDivElement, AddUsdCardProps>(
  function AddUsdCard(
    {
      variant,
      usdBalanceLabel,
      padding = "md",
      onAddFunds,
      onWithdraw,
      onStartVerification,
      onViewStatus,
      className,
      ...rest
    },
    ref,
  ) {
    const instanceId = React.useId();
    const labelId = `add-usd-card-title-${instanceId}`;

    const composed = [
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Card
        ref={ref}
        variant="white"
        padding={padding}
        role="region"
        aria-labelledby={labelId}
        className={composed}
        data-node-id={NODE_IDS[variant]}
        data-variant={variant}
        {...rest}
      >
        {variant === "verify" || variant === "verifying" ? (
          <Section
            variant={variant}
            onStartVerification={onStartVerification}
            onViewStatus={onViewStatus}
            labelId={labelId}
          />
        ) : (
          <CardHorizontal
            variant={variant}
            usdBalanceLabel={usdBalanceLabel}
            onAddFunds={onAddFunds}
            onWithdraw={onWithdraw}
            labelId={labelId}
          />
        )}
      </Card>
    );
  },
);

AddUsdCard.displayName = "AddUsdCard";

export default AddUsdCard;
