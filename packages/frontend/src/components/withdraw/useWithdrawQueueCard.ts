// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

export interface WithdrawQueueCardView {
  position: string;
  request: string;
}

export function useWithdrawQueueCard(
  queue: WithdrawQueueInfo | undefined,
): WithdrawQueueCardView {
  return {
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
