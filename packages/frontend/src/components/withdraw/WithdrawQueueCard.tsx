// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { Card, InfoRow, StatusChip } from "@pipeline/ui";
import type { WithdrawQueueInfo } from "@/wallet";
import { useWithdrawQueueCard } from "./useWithdrawQueueCard";
import { WithdrawQueueInfoCard } from "./WithdrawQueueInfoCard";

interface WithdrawQueueCardProps {
  queue: WithdrawQueueInfo | undefined;
  hasRequest: boolean;
}

export function WithdrawQueueCard({
  queue,
  hasRequest,
}: WithdrawQueueCardProps) {
  const view = useWithdrawQueueCard(queue);

  return (
    <Card
      variant="plain"
      padding="none"
      data-testid="withdraw-queue-card"
      className="flex flex-col gap-8 px-4 pt-6 pb-4"
    >
      <WithdrawQueueInfoCard />
      {hasRequest && (
        <InfoRow
          data-testid="withdraw-queue-position"
          label="Your position"
          value={
            <span className="inline-flex items-center gap-2">
              <strong className="font-[var(--font-weight-emphasized)]">
                {view.position}
              </strong>
              <StatusChip
                data-testid="withdraw-queue-status"
                tone={view.tone}
                label={view.status}
              />
            </span>
          }
        />
      )}
    </Card>
  );
}
