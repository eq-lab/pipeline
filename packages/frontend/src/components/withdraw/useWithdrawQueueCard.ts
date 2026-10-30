// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatUnits } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export type WithdrawQueueTone = "payable" | "waiting" | "unknown";

export interface WithdrawQueueCardView {
  tone: WithdrawQueueTone;
  status: string;
  position: string;
  recoveryRate: string | undefined;
}

export function useWithdrawQueueCard(
  queue: WithdrawQueueInfo | undefined,
  hasRequest: boolean,
): WithdrawQueueCardView {
  const payableNow = queue?.payableNow;
  const tone: WithdrawQueueTone =
    payableNow === undefined ? "unknown" : payableNow ? "payable" : "waiting";
  const rateKnown =
    queue?.rateRaw !== undefined && queue.rateDecimals !== undefined;
  return {
    tone: hasRequest ? tone : "unknown",
    status:
      tone === "payable"
        ? "Payable now"
        : tone === "waiting"
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
