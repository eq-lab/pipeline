// spec: docs/frontend/ui-components.md#modaldialog
import { useId } from "react";
import type { ReactNode } from "react";
import { Button } from "../Button";
import { useModalDialog } from "./useModalDialog";

export interface ModalDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  "data-testid"?: string;
}

export function ModalDialog({
  open,
  title,
  onClose,
  children,
  "data-testid": testId = "modal-dialog",
}: ModalDialogProps) {
  const titleId = useId();
  const { panelRef, closeButtonRef } = useModalDialog({ open, onClose });

  if (!open) return null;

  return (
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-[6px] bg-white px-7 py-6 shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[color:var(--color-pipeline-ink)]"
        >
          {title}
        </h2>
        <div className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]">
          {children}
        </div>
        <div className="flex items-center justify-end pt-1">
          <Button
            ref={closeButtonRef}
            variant="primary-dark"
            size="m"
            data-testid={`${testId}-close`}
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ModalDialog;
