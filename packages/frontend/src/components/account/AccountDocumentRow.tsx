// spec: docs/frontend/account-page.md#accountdocumentrow
import { Button } from "@pipeline/ui";
import { FileUploadIcon } from "@/components/UploadedFileRow";
import type { AccountDocumentRecord } from "./accountPageState";

function CheckBadgeIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 1.33333C11.6819 1.33333 14.6667 4.3181 14.6667 8C14.6667 11.6819 11.6819 14.6667 8 14.6667C4.3181 14.6667 1.33333 11.6819 1.33333 8C1.33333 4.3181 4.3181 1.33333 8 1.33333ZM11.0202 5.97982C10.8249 5.78456 10.5084 5.78456 10.3132 5.97982L7 9.29297L5.68685 7.97982C5.49159 7.78456 5.17508 7.78456 4.97982 7.97982C4.78456 8.17508 4.78456 8.49159 4.97982 8.68685L6.64648 10.3535C6.84175 10.5488 7.15825 10.5488 7.35352 10.3535L11.0202 6.68685C11.2154 6.49159 11.2154 6.17508 11.0202 5.97982Z"
      />
    </svg>
  );
}

function CrossBadgeIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 1.33333C11.6819 1.33333 14.6667 4.3181 14.6667 8C14.6667 11.6819 11.6819 14.6667 8 14.6667C4.3181 14.6667 1.33333 11.6819 1.33333 8C1.33333 4.3181 4.3181 1.33333 8 1.33333ZM10.6868 5.31315C10.4916 5.11789 10.1751 5.11789 9.97982 5.31315L8 7.29297L6.02018 5.31315C5.82492 5.11789 5.50841 5.11789 5.31315 5.31315C5.11789 5.50841 5.11789 5.82492 5.31315 6.02018L7.29297 8L5.31315 9.97982C5.11789 10.1751 5.11789 10.4916 5.31315 10.6868C5.50841 10.8821 5.82492 10.8821 6.02018 10.6868L8 8.70703L9.97982 10.6868C10.1751 10.8821 10.4916 10.8821 10.6868 10.6868C10.8821 10.4916 10.8821 10.1751 10.6868 9.97982L8.70703 8L10.6868 6.02018C10.8821 5.82492 10.8821 5.50841 10.6868 5.31315Z"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M9.21973 16.2197C8.92683 16.5126 8.92683 16.9874 9.21973 17.2803C9.51262 17.5732 9.98738 17.5732 10.2803 17.2803L14.7803 12.7803C15.0732 12.4874 15.0732 12.0126 14.7803 11.7197L10.2803 7.21973C9.98738 6.92683 9.51262 6.92683 9.21973 7.21973C8.92683 7.51262 8.92683 7.98738 9.21973 8.28027L13.1895 12.25L9.21973 16.2197Z" />
    </svg>
  );
}

const CAPTION_BY_STATUS: Record<
  Exclude<AccountDocumentRecord["status"], "NotProvided">,
  { text: string; tone: string }
> = {
  Verified: { text: "Verified", tone: "var(--color-pipeline-positive-strong)" },
  Rejected: {
    text: "Invalid document",
    tone: "var(--color-pipeline-negative-strong)",
  },
  Provided: { text: "Uploaded", tone: "var(--color-pipeline-ink-muted)" },
};

export interface AccountDocumentRowProps {
  document: AccountDocumentRecord;
  onReupload?: (documentName: string) => void;
}

export function AccountDocumentRow({
  document,
  onReupload,
}: AccountDocumentRowProps) {
  const caption =
    CAPTION_BY_STATUS[
      document.status as Exclude<AccountDocumentRecord["status"], "NotProvided">
    ] ?? CAPTION_BY_STATUS.Provided;

  return (
    <div
      className="flex w-full items-center gap-3 p-2"
      data-node-id="6701:98116"
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]">
        <FileUploadIcon />
        {document.status === "Verified" && (
          <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-surface)] p-0.5 text-[color:var(--color-pipeline-positive-strong)]">
            <CheckBadgeIcon />
          </span>
        )}
        {document.status === "Rejected" && (
          <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-surface)] p-0.5 text-[color:var(--color-pipeline-negative-strong)]">
            <CrossBadgeIcon />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={[
            "truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {document.name}
        </p>
        <p
          className="truncate text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)]"
          style={{ color: caption.tone }}
        >
          {caption.text}
        </p>
      </div>

      {document.status === "Verified" && (
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center text-[color:var(--color-pipeline-ink-subtle)]"
        >
          <ChevronRightIcon />
        </span>
      )}
      {document.status === "Rejected" && (
        <div className="flex shrink-0 items-center justify-center p-1">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => onReupload?.(document.name)}
            className="!text-[color:var(--color-pipeline-ink-muted)]"
          >
            Re-upload
          </Button>
        </div>
      )}
    </div>
  );
}

export default AccountDocumentRow;
