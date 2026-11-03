// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { useState } from "react";
import { InfoRow, ModalDialog } from "@pipeline/ui";

function WarningTriangle() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
    >
      <path
        d="M7 1.5L13 12H1L7 1.5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M7 5.5V8.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle cx="7" cy="10.25" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function WithdrawRecoveryRateRow({ rate }: { rate: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <InfoRow
        data-testid="withdraw-recovery-rate"
        label="Recovery rate"
        value={
          <span className="inline-flex items-center gap-1">
            {rate}
            <button
              type="button"
              aria-label="About the recovery rate"
              aria-haspopup="dialog"
              data-testid="withdraw-recovery-rate-info"
              onClick={() => setOpen(true)}
              className="inline-flex cursor-pointer items-center bg-transparent p-0 text-[color:var(--color-pipeline-warning)]"
            >
              <WarningTriangle />
            </button>
          </span>
        }
      />
      <ModalDialog
        open={open}
        title="Recovery rate"
        onClose={() => setOpen(false)}
        data-testid="withdraw-recovery-rate-modal"
      >
        The protocol administrator can set a recovery rate below 1 on the
        withdrawal queue, once. After that, every claim pays USDC equal to the
        PLUSD burned times that rate. The rate applies to every claim made after
        it is set, whatever the request date. It cannot be changed afterwards.
      </ModalDialog>
    </>
  );
}
