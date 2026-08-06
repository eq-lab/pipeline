import React from "react";

/**
 * PanelError — shared "error" body for Protocol Dashboard panels.
 * spec: docs/frontend/dashboard-components.md#panel-states
 */
export interface PanelErrorProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onError"
> {
  /** Invoked when the user clicks Retry. Usually the data hook's `refetch`. */
  onRetry?: () => void;
  /** Override the default failure message. */
  message?: React.ReactNode;
}

const wrapperClasses = "flex flex-col gap-2";
const messageClasses = "text-[color:var(--color-pipeline-ink-muted)]";
const retryClasses =
  "self-start text-[color:var(--color-pipeline-ink-muted)] underline cursor-pointer";

export function PanelError({
  onRetry,
  message = "Couldn’t load this panel",
  className,
  ...rest
}: PanelErrorProps) {
  const composed = [wrapperClasses, className].filter(Boolean).join(" ");
  return (
    <div className={composed} {...rest}>
      <span className={messageClasses}>{message}</span>
      <button type="button" onClick={onRetry} className={retryClasses}>
        Retry
      </button>
    </div>
  );
}

export default PanelError;
