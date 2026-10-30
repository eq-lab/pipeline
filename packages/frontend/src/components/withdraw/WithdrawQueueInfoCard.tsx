// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { ModalDialog } from "@pipeline/ui";

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body-s)] leading-[var(--text-pipeline-body-s--line-height)] text-[color:var(--color-pipeline-ink-muted)]";

function ArrowRight() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
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
      <div
        data-testid="withdraw-queue-info"
        className={`${bodyClasses} flex flex-wrap items-center gap-x-1 md:flex-nowrap md:whitespace-nowrap`}
      >
        <span>
          <strong className="font-[var(--font-weight-emphasized)]">
            Paid in order.
          </strong>{" "}
          Requests are paid first in, first out.
        </span>
        <button
          type="button"
          aria-haspopup="dialog"
          data-testid="withdraw-queue-learn-more"
          onClick={() => setOpen(true)}
          className={`${bodyClasses} inline-flex shrink-0 cursor-pointer items-center gap-1 bg-transparent p-0 whitespace-nowrap underline`}
        >
          Learn more
          <ArrowRight />
        </button>
      </div>
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
