// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatUnits } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export type WithdrawQueueTone = "positive" | "pending" | "neutral";

export interface WithdrawQueueCardView {
  tone: WithdrawQueueTone;
  status: string;
  position: string;
  recoveryRate: string | undefined;
}

export function useWithdrawQueueCard(
  queue: WithdrawQueueInfo | undefined,
): WithdrawQueueCardView {
  const payableNow = queue?.payableNow;
  const tone: WithdrawQueueTone =
    payableNow === undefined ? "neutral" : payableNow ? "positive" : "pending";
  const rateKnown =
    queue?.rateRaw !== undefined && queue.rateDecimals !== undefined;
  return {
    tone,
    status:
      tone === "positive"
        ? "Payable now"
        : tone === "pending"
          ? "Not payable yet"
          : "—",
    position:
      queue?.position !== undefined
        ? `${formatTokenAmount(queue.position, queue.plusdDecimals)} PLUSD`
        : "—",
    recoveryRate:
      queue?.recoveryActive && rateKnown
        ? formatUnits(queue.rateRaw as bigint, queue.rateDecimals as number)
        : undefined,
  };
}
