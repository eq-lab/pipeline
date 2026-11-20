// spec: docs/frontend/bank-transfers.md#wire-out
import { useState } from "react";
import { ModalDialog } from "@pipeline/ui";

export const WIRE_OUT_DESCRIPTION =
  "You can also withdraw to a bank account. You request a wire-out of an amount of PLUSD. The PLUSD moves into escrow. When the wire is sent, the Trustee settles the request and the PLUSD is burned. The Trustee can cancel the request instead, and the PLUSD returns to you. Your address must be authorised to hold PLUSD to request or to receive it back.";

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
      data-testid="wire-out-info-icon"
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

export function WireOutInfoCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p
        data-testid="wire-out-info"
        className="m-0 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]"
      >
        <InfoIcon />
        Your PLUSD stays in escrow until the Trustee sends the wire.{" "}
        <button
          type="button"
          aria-haspopup="dialog"
          data-testid="wire-out-learn-more"
          onClick={() => setOpen(true)}
          className="inline-flex cursor-pointer items-center gap-1 bg-transparent p-0 text-[color:var(--color-pipeline-ink-muted)] underline"
        >
          Learn more
          <ArrowRight />
        </button>
      </p>
      <ModalDialog
        open={open}
        title="Bank wire withdrawals"
        onClose={() => setOpen(false)}
        data-testid="wire-out-modal"
      >
        <span data-testid="wire-out-description">{WIRE_OUT_DESCRIPTION}</span>
      </ModalDialog>
    </>
  );
}
