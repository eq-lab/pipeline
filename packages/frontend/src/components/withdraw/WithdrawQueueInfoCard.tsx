// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { ModalDialog } from "@pipeline/ui";

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

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="mr-2 inline-block shrink-0 align-[-2px]"
      data-testid="withdraw-queue-info-icon"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M7 6.25V10M7 4V4.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WithdrawQueueInfoCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p
        data-testid="withdraw-queue-info"
        className="m-0 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink-muted)]"
      >
        <InfoIcon />
        Requests are paid in order.{" "}
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
      </p>
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
