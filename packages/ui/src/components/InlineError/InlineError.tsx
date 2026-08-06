import { ErrorDetailsDialog } from "../ErrorDetailsDialog/ErrorDetailsDialog";
import { useInlineError } from "./useInlineError";

/**
 * InlineError — the one-line half of the error-UX pattern (#1034): a short
 * human `message` (always safe to render — never raw) plus, when raw
 * `details` are available, a "View details" trigger that opens a shared
 * `ErrorDetailsDialog`. This is the component adopted at every error
 * surface (`StepRow`, dashboard panels, etc.) — the disclosure state lives
 * here so callers don't each reimplement it.
 * spec: docs/frontend/error-handling.md
 */
export interface InlineErrorProps {
  /** The short human line. Always safe to render — never raw. */
  message: string;
  /** Raw error text. When present, a "View details" trigger appears. */
  details?: string;
  /** Optional dialog heading override. */
  detailsTitle?: string;
  className?: string;
}

const messageClasses =
  "text-[13px] leading-[18px] text-[color:var(--color-pipeline-negative)]";

export function InlineError({
  message,
  details,
  detailsTitle,
  className,
}: InlineErrorProps) {
  const { open, openDialog, closeDialog } = useInlineError();
  const hasDetails = Boolean(details && details.length > 0);

  return (
    <>
      <span
        data-testid="inline-error"
        role="alert"
        className={[messageClasses, className].filter(Boolean).join(" ")}
      >
        {message}
        {hasDetails && (
          <>
            {" "}
            <button
              type="button"
              data-testid="inline-error-view-details"
              onClick={openDialog}
              className="cursor-pointer underline"
            >
              View details
            </button>
          </>
        )}
      </span>
      {hasDetails && (
        <ErrorDetailsDialog
          open={open}
          title={detailsTitle}
          summary={message}
          details={details as string}
          onClose={closeDialog}
        />
      )}
    </>
  );
}

export default InlineError;
