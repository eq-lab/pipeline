// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { Card, InfoRow, StatusChip } from "@pipeline/ui";
import type { WithdrawQueueInfo } from "@/wallet";
import { useWithdrawQueueCard } from "./useWithdrawQueueCard";
import { WithdrawQueueInfoCard } from "./WithdrawQueueInfoCard";

interface WithdrawQueueCardProps {
  queue: WithdrawQueueInfo | undefined;
  hasRequest: boolean;
}

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)]";

export function WithdrawQueueCard({
  queue,
  hasRequest,
}: WithdrawQueueCardProps) {
  const view = useWithdrawQueueCard(queue);

  return (
    <>
      <Card
        padding="md"
        data-testid="withdraw-queue-card"
        className="flex flex-col gap-2"
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
      {view.recoveryRate !== undefined && (
        <Card variant="yellow" data-testid="withdraw-recovery-rate-notice">
          <p
            className={`${bodyClasses} text-[color:var(--color-pipeline-ink)]`}
          >
            Recovery rate {view.recoveryRate}. Every claim pays USDC equal to
            the PLUSD burned times this rate.
          </p>
        </Card>
      )}
    </>
  );
}
