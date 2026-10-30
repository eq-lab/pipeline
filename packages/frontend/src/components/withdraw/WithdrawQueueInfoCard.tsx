// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { InfoRow, ModalDialog } from "@pipeline/ui";

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
      <InfoRow
        wrapLabel
        data-testid="withdraw-queue-info"
        label="Paid in order. Requests are paid first in, first out."
        value={
          <button
            type="button"
            aria-haspopup="dialog"
            data-testid="withdraw-queue-learn-more"
            onClick={() => setOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1 bg-transparent p-0 text-inherit underline"
          >
            Learn more
            <ArrowRight />
          </button>
        }
      />
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
