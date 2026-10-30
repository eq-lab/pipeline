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
          className="px-4 py-4"
        >
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
        </Card>
      )}
    </div>
  );
}
