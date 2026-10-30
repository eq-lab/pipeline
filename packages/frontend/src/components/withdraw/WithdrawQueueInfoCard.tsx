// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { Button, Card, ModalDialog } from "@pipeline/ui";

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]";

export function WithdrawQueueInfoCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        variant="white"
        data-testid="withdraw-queue-info"
        className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4"
      >
        <p className={bodyClasses}>
          <strong className="font-[var(--font-weight-emphasized)]">
            Paid in order.
          </strong>{" "}
          Requests are paid first in, first out.
        </p>
        <Button
          variant="secondary"
          size="compact"
          className="self-start whitespace-nowrap md:self-auto"
          data-testid="withdraw-queue-learn-more"
          onClick={() => setOpen(true)}
        >
          Learn more
        </Button>
      </Card>
      <ModalDialog
        open={open}
        title="Withdrawal queue"
        onClose={() => setOpen(false)}
        data-testid="withdraw-queue-modal"
      >
        Paid in order. Requests are paid first in, first out. A request can be
        claimed once the withdrawal custody account holds enough USDC to cover
        it and every earlier unclaimed request. Until then the claim is refused
        as too early. Your PLUSD stays in the queue. Nothing is lost.
      </ModalDialog>
    </>
  );
}
