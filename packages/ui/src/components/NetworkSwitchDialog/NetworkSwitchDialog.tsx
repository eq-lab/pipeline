import { useEffect, useRef } from "react";
import { Button } from "../Button";

/**
 * NetworkSwitchDialog — confirmation shown before navigating to a sibling
 * network deployment.
 * spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
 */

export interface NetworkSwitchDialogProps {
  open: boolean;
  /** Display label of the target network (e.g. "Mainnet"). */
  targetLabel: string;
  /** `true` when the target is mainnet — drives the real-funds styling/copy. */
  isMainnet: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function NetworkSwitchDialog({
  open,
  targetLabel,
  isMainnet,
  onCancel,
  onConfirm,
}: NetworkSwitchDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      data-testid="network-switch-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-switch-title"
        data-testid="network-switch-dialog"
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-[6px] bg-white px-7 py-6 shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="network-switch-title"
          className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-[22px] leading-[30px] text-[color:var(--color-pipeline-ink)]"
        >
          <span
            className={[
              "size-2.5 shrink-0 rounded-full",
              isMainnet
                ? "bg-[color:var(--color-pipeline-warning)]"
                : "bg-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
            aria-hidden="true"
          />
          Switch to {targetLabel}?
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
          {isMainnet
            ? "You'll leave this test environment for Mainnet, where real funds are at stake."
            : `You'll leave this environment for ${targetLabel}.`}{" "}
          Your wallet will need to be connected again there.
        </p>
        <div className="flex items-center justify-end gap-3 pt-4">
          <Button
            variant="secondary"
            data-testid="network-switch-cancel"
            onClick={onCancel}
            className="!h-10"
          >
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant="primary-dark"
            data-testid="network-switch-confirm"
            onClick={onConfirm}
            className="!h-10"
          >
            Switch to {targetLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NetworkSwitchDialog;
