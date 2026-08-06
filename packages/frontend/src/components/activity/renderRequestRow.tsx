import React from "react";
import { ActivityRow, AmountPill } from "@pipeline/ui";
import type { RequestItem } from "@/api";
import { formatTokenAmount, formatActivityTime } from "@/lib/format";
import { SAC_DECIMALS } from "@/wallet";
import type { WalletViewKind } from "@/wallet";

// spec: docs/frontend/dashboard-components.md#renderrequestrow
// (shared row-visual rule, chain-aware decimal table, fail-loud contract).

/**
 * TwoLineAmount — right-aligned two-line amount block for stake / unstake /
 * pending rows. Uses only design tokens via Tailwind utilities.
 *
 * `primary`   — top line, body size.
 * `secondary` — bottom line, caption size, always muted ink.
 * `tone`      — `"default"` renders the top line in primary ink (completed
 *               rows); `"muted"` renders both lines in muted ink (pending
 *               rows, communicating non-final state). Defaults to `"default"`.
 */
export function TwoLineAmount({
  primary,
  secondary,
  tone = "default",
}: {
  primary: string;
  secondary: string;
  tone?: "default" | "muted";
}) {
  const primaryColor =
    tone === "muted"
      ? "text-[color:var(--color-pipeline-ink-muted)]"
      : "text-[color:var(--color-pipeline-ink)]";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-body)]",
          "leading-[var(--text-pipeline-body--line-height)]",
          "font-[var(--font-weight-regular)]",
          primaryColor,
          "whitespace-nowrap",
        ].join(" ")}
      >
        {primary}
      </span>
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-caption)]",
          "leading-[var(--text-pipeline-caption--line-height)]",
          "font-[var(--font-weight-regular)]",
          "text-[color:var(--color-pipeline-ink-muted)]",
          "whitespace-nowrap",
        ].join(" ")}
      >
        {secondary}
      </span>
    </div>
  );
}

/**
 * Renders a single `RequestItem` as an `<ActivityRow>`.
 *
 * @param testId optional `data-testid` applied to the rendered row, so list
 *   call sites can give each row a stable, indexed handle
 *   (e.g. `transactions-row-0`, `home-activity-row-0`).
 */
export function renderRequestRow(
  item: RequestItem,
  chainKind: WalletViewKind,
  testId?: string,
  className?: string,
): React.ReactNode {
  const timestamp = formatActivityTime(item.created_at);
  // Derive decimal scales from the active chain (Issue #674).
  const paymentDecimals = chainKind === "stellar" ? SAC_DECIMALS : 6;
  const stakeDecimals = chainKind === "stellar" ? SAC_DECIMALS : 18;

  if (item.type === "Deposit") {
    const amount = formatTokenAmount(item.amount, paymentDecimals);
    if (item.status === "Completed") {
      return (
        <ActivityRow
          data-testid={testId}
          className={className}
          icon="check-circle"
          tone="success"
          title="Buy"
          timestamp={timestamp}
          amount={<AmountPill>+{amount} PLUSD</AmountPill>}
        />
      );
    }
    const secondary =
      item.status === "VerificationFailed" ? "Verification failed" : "Pending";
    return (
      <ActivityRow
        data-testid={testId}
        className={className}
        icon="clock-pending"
        tone="warning"
        title="Buy"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`+${amount} PLUSD`}
            secondary={secondary}
            tone="muted"
          />
        }
      />
    );
  }

  if (item.type === "Withdraw") {
    const amount = formatTokenAmount(item.amount, paymentDecimals);
    if (item.status === "Completed") {
      return (
        <ActivityRow
          data-testid={testId}
          className={className}
          icon="check-circle"
          tone="success"
          title="Sell"
          timestamp={timestamp}
          amount={<AmountPill>+{amount} USDC</AmountPill>}
        />
      );
    }
    const secondary =
      item.status === "VerificationFailed" ? "Verification failed" : "Pending";
    return (
      <ActivityRow
        data-testid={testId}
        className={className}
        icon="clock-pending"
        tone="warning"
        title="Sell"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`+${amount} USDC`}
            secondary={secondary}
            tone="muted"
          />
        }
      />
    );
  }

  if (item.type === "Stake") {
    // Fail-loud contract: spec: docs/frontend/dashboard-components.md#renderrequestrow.
    const assets =
      item.assets !== undefined
        ? formatTokenAmount(item.assets, stakeDecimals)
        : "—";
    const shares =
      item.shares !== undefined
        ? formatTokenAmount(item.shares, stakeDecimals)
        : "—";
    return (
      <ActivityRow
        data-testid={testId}
        className={className}
        icon="arrow-down-circle"
        title="Stake"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`−${assets} PLUSD`}
            secondary={`+${shares} sPLUSD`}
          />
        }
      />
    );
  }

  // Unstake — fail-loud: see Stake branch above for rationale.
  const assets =
    item.assets !== undefined
      ? formatTokenAmount(item.assets, stakeDecimals)
      : "—";
  const shares =
    item.shares !== undefined
      ? formatTokenAmount(item.shares, stakeDecimals)
      : "—";
  return (
    <ActivityRow
      data-testid={testId}
      className={className}
      icon="arrow-up-circle"
      title="Unstake"
      timestamp={timestamp}
      amount={
        <TwoLineAmount
          primary={`+${assets} PLUSD`}
          secondary={`−${shares} sPLUSD`}
        />
      }
    />
  );
}
