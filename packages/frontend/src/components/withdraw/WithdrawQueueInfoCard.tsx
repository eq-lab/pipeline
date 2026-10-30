// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { Card, ModalDialog } from "@pipeline/ui";

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]";

function ArrowRight() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
    >
      <path
        d="M1 6H11M7 2L11 6L7 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WithdrawQueueInfoCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card variant="white" padding="md" data-testid="withdraw-queue-info">
        <p className={bodyClasses}>
          <strong className="font-[var(--font-weight-emphasized)]">
            Paid in order.
          </strong>{" "}
          Requests are paid first in, first out.{" "}
          <button
            type="button"
            aria-haspopup="dialog"
            data-testid="withdraw-queue-learn-more"
            onClick={() => setOpen(true)}
            className={`${bodyClasses} inline-flex cursor-pointer items-center gap-1 bg-transparent p-0 whitespace-nowrap underline`}
          >
            Learn more
            <ArrowRight />
          </button>
        </p>
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
