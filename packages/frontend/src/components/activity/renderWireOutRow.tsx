// spec: docs/frontend/bank-transfers.md#wire-out
import React from "react";
import { ActivityRow } from "@pipeline/ui";
import type { WireOutItem } from "@/api";
import type { WireOutRead } from "@/wallet";
import {
  formatActivityTime,
  formatDecimalAmount,
  formatTokenAmount,
} from "@/lib/format";
import { TwoLineAmount } from "./renderRequestRow";

export interface RenderWireOutRowInput {
  timestamp: string | undefined;
  read: WireOutRead | undefined;
  decimals: number | undefined;
  testId?: string;
  className?: string;
}

interface WireOutRowInput {
  timestamp: string | undefined;
  amount: string;
  status: string | undefined;
  testId?: string;
  className?: string;
}

function buildWireOutRow({
  timestamp,
  amount,
  status,
  testId,
  className,
}: WireOutRowInput): React.ReactNode {
  const icon =
    status === "Settled"
      ? "check-circle"
      : status === "Cancelled"
        ? "arrow-down-circle"
        : "clock-pending";
  const tone =
    status === "Settled"
      ? "success"
      : status === "Cancelled"
        ? "neutral"
        : "warning";

  return (
    <ActivityRow
      data-testid={testId}
      className={className}
      icon={icon}
      tone={tone}
      title="Withdraw funds"
      timestamp={timestamp ? formatActivityTime(timestamp) : "—"}
      amount={
        <TwoLineAmount
          primary={`−${amount} PLUSD`}
          secondary={`Bank transfer · ${status || "—"}`}
          tone={status === "Settled" ? "default" : "muted"}
        />
      }
    />
  );
}

export function renderWireOutRow({
  timestamp,
  read,
  decimals,
  testId,
  className,
}: RenderWireOutRowInput): React.ReactNode {
  const amount =
    read?.amountRaw !== undefined
      ? formatTokenAmount(read.amountRaw, decimals)
      : "—";
  return buildWireOutRow({
    timestamp,
    amount,
    status: read?.status,
    testId,
    className,
  });
}

export function renderWireOutItemRow(
  item: WireOutItem,
  testId?: string,
  className?: string,
): React.ReactNode {
  return buildWireOutRow({
    timestamp: item.requested_at,
    amount: formatDecimalAmount(item.amount),
    status: item.status,
    testId,
    className,
  });
}
