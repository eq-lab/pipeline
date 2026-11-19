// spec: docs/frontend/dashboard-components.md#renderbanktransferrow
import React from "react";
import { ActivityRow } from "@pipeline/ui";
import type { EvmStakeDecimals, WalletViewKind } from "@/wallet";
import type { WireInItem } from "@/api";
import { formatActivityTime, formatDecimalAmount } from "@/lib/format";
import { TwoLineAmount, renderRequestRow } from "./renderRequestRow";
import { renderWireOutItemRow } from "./renderWireOutRow";
import type { ActivityFeedItem } from "./useActivityFeed";

export function renderWireInRow(
  item: WireInItem,
  testId?: string,
  className?: string,
): React.ReactNode {
  const received = item.status === "Direct" || item.status === "Assigned";
  const time = item.assigned_at ?? item.recorded_at;
  return (
    <ActivityRow
      data-testid={testId}
      className={className}
      icon={received ? "check-circle" : "clock-pending"}
      tone={received ? "success" : "neutral"}
      title="Add funds"
      timestamp={time ? formatActivityTime(time) : "—"}
      amount={
        <TwoLineAmount
          primary={`+${formatDecimalAmount(item.amount)} USD`}
          secondary={`Bank transfer · ${item.status || "—"}`}
          tone={received ? "default" : "muted"}
        />
      }
    />
  );
}

export function renderActivityRow(
  entry: ActivityFeedItem,
  chainKind: WalletViewKind,
  testId?: string,
  className?: string,
  evmStakeDecimals?: EvmStakeDecimals,
): React.ReactNode {
  if (entry.kind === "wireIn")
    return renderWireInRow(entry.item, testId, className);
  if (entry.kind === "wireOut") {
    return renderWireOutItemRow(entry.item, testId, className);
  }
  return renderRequestRow(
    entry.item,
    chainKind,
    testId,
    className,
    evmStakeDecimals,
  );
}
