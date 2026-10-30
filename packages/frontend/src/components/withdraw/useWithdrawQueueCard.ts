// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export type WithdrawQueueTone = "positive" | "pending" | "neutral";

export interface WithdrawQueueCardView {
  tone: WithdrawQueueTone;
  status: string;
  position: string;
  request: string;
  requestStatus:
    | { label: string; tone: WithdrawQueueTone; icon?: "queue" }
    | undefined;
}

function requestStatusChip(
  status: string | undefined,
): WithdrawQueueCardView["requestStatus"] {
  if (status === undefined) return undefined;
  if (status === "PendingClaim")
    return { label: "In queue", tone: "neutral", icon: "queue" };
  if (status === "Completed") return { label: "Claimed", tone: "positive" };
  return { label: status, tone: "neutral" };
}

export function useWithdrawQueueCard(
  queue: WithdrawQueueInfo | undefined,
): WithdrawQueueCardView {
  const payableNow = queue?.payableNow;
  const tone: WithdrawQueueTone =
    payableNow === undefined ? "neutral" : payableNow ? "positive" : "pending";
  return {
    tone,
    status:
      tone === "positive"
        ? "Payable now"
        : tone === "pending"
          ? "Not payable yet"
          : "—",
    requestStatus: requestStatusChip(queue?.requestStatus),
    request:
      queue?.requestAmount !== undefined
        ? `${formatTokenAmount(queue.requestAmount, queue.plusdDecimals)} PLUSD`
        : "—",
    position:
      queue?.position !== undefined
        ? `${formatTokenAmount(queue.position, queue.plusdDecimals)} PLUSD`
        : "—",
  };
}
