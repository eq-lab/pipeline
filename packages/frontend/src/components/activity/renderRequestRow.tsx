import React from "react";
import { ActivityRow, AmountPill } from "@pipeline/ui";
import type { RequestItem } from "@/api";
import { formatTokenAmount, formatActivityTime } from "@/lib/format";

/**
 * renderRequestRow — shared row renderer for `RequestItem` data.
 *
 * Both `RecentActivityCard` (home, connected state, Figma `1497:95119`) and
 * the `/transactions` page (Figma `1497-94912`) render rows with identical
 * visuals. This helper is the single source of truth for the type→icon,
 * status→tone, and amount-formatting logic so neither call site can drift.
 *
 * Rule: row visuals must stay identical between the home card and
 * `/transactions`. Any change to row appearance belongs here, not in the
 * individual consumers.
 *
 * @param item - A single `RequestItem` returned by `GET /v1/requests`.
 * @returns A React element representing the activity row, ready to be embedded
 *          in a list or container by the caller.
 */

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

/** Renders a single `RequestItem` as an `<ActivityRow>`. */
export function renderRequestRow(item: RequestItem): React.ReactNode {
  const timestamp = formatActivityTime(item.created_at);

  if (item.type === "Deposit") {
    const amount = formatTokenAmount(item.amount, 6);
    if (item.status === "Completed") {
      return (
        <ActivityRow
          icon="check-circle"
          tone="success"
          title="Buy"
          timestamp={timestamp}
          amount={<AmountPill>+{amount} USDC</AmountPill>}
        />
      );
    }
    const secondary =
      item.status === "VerificationFailed" ? "Verification failed" : "Pending";
    return (
      <ActivityRow
        icon="clock-pending"
        tone="warning"
        title="Buy"
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

  if (item.type === "Withdraw") {
    const amount = formatTokenAmount(item.amount, 6);
    if (item.status === "Completed") {
      return (
        <ActivityRow
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
    const assets = formatTokenAmount(item.assets ?? item.amount, 18);
    const shares = formatTokenAmount(item.shares ?? "0", 18);
    return (
      <ActivityRow
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

  // Unstake
  const assets = formatTokenAmount(item.assets ?? item.amount, 18);
  const shares = formatTokenAmount(item.shares ?? "0", 18);
  return (
    <ActivityRow
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
