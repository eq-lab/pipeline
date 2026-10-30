// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export type WithdrawQueueTone = "positive" | "pending" | "neutral";

export interface WithdrawQueueCardView {
  tone: WithdrawQueueTone;
  status: string;
  position: string;
  request: string;
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
