// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import type { WithdrawQueueInfo } from "@/wallet";
import { formatUnits } from "@/wallet";

export function formatRecoveryRate(
  queue: WithdrawQueueInfo | undefined,
): string | undefined {
  if (!queue?.recoveryActive) return undefined;
  if (queue.rateRaw === undefined || queue.rateDecimals === undefined)
    return undefined;
  return formatUnits(queue.rateRaw, queue.rateDecimals);
}
