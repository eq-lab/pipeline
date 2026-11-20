// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { Card, InfoRow } from "@pipeline/ui";
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
    <div data-testid="withdraw-queue-card" className="flex flex-col gap-[2px]">
      <Card
        variant="plain"
        padding="none"
        data-testid="withdraw-queue-info-block"
        className="px-4 py-4"
      >
        <WithdrawQueueInfoCard />
      </Card>
      {hasRequest && (
        <Card
          variant="plain"
          padding="none"
          data-testid="withdraw-queue-position-block"
          className="flex flex-col gap-3 px-4 py-4"
        >
          <InfoRow
            data-testid="withdraw-queue-request"
            label="Your request"
            value={view.request}
          />
          <InfoRow
            data-testid="withdraw-queue-position"
            label="Queue position"
            value={view.position}
          />
        </Card>
      )}
    </div>
  );
}
