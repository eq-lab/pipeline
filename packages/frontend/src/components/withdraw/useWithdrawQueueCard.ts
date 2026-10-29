// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatUnits } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export interface WithdrawQueueCardView {
  position: string | undefined;
  payableNow: string;
  totalQueued: string;
  totalClaimed: string;
  recoveryRate: string | undefined;
}

function plusd(raw: bigint | undefined, decimals: number | undefined) {
  return raw !== undefined ? `${formatTokenAmount(raw, decimals)} PLUSD` : "—";
}

export function useWithdrawQueueCard(
  queue: WithdrawQueueInfo | undefined,
  hasRequest: boolean,
): WithdrawQueueCardView {
  const payable =
    queue?.payableNow === undefined
      ? "—"
      : queue.payableNow
        ? "Yes"
        : "Not yet";
  const rateKnown =
    queue?.rateRaw !== undefined && queue.rateDecimals !== undefined;
  return {
    position: hasRequest
      ? plusd(queue?.position, queue?.plusdDecimals)
      : undefined,
    payableNow: payable,
    totalQueued: plusd(queue?.totalQueued, queue?.plusdDecimals),
    totalClaimed: plusd(queue?.totalClaimed, queue?.plusdDecimals),
    recoveryRate:
      queue?.recoveryActive && rateKnown
        ? formatUnits(queue.rateRaw as bigint, queue.rateDecimals as number)
        : undefined,
  };
}
