// spec: docs/frontend/account-page.md#accountuploadrow
import { useRef } from "react";
import { Button } from "@pipeline/ui";
import { FileUploadIcon } from "@/components/UploadedFileRow";
import { AccountIconTile } from "./AccountIconTile";

export interface AccountUploadRowProps {
  rejected: boolean;
  onFiles: (files: File[]) => void;
  dataNodeId?: string;
  testId?: string;
}

export function AccountUploadRow({
  rejected,
  onFiles,
  dataNodeId = "6701:98157",
  testId = "account-upload-row",
}: AccountUploadRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length > 0) onFiles(picked);
  }

  return (
    <div
      className="flex w-full items-center gap-3 p-2"
      data-testid={testId}
      data-node-id={dataNodeId}
    >
      <AccountIconTile className="bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]">
        <FileUploadIcon />
      </AccountIconTile>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          Upload documents
        </p>
        <p
          role={rejected ? "alert" : undefined}
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            rejected
              ? "text-[color:var(--color-pipeline-negative-strong)]"
              : "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          pdf, jpg, png files up to 10MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="account-upload-input"
        onChange={handleChange}
      />
      <div className="flex shrink-0 items-center justify-center p-1">
        <Button
          variant="secondary"
          size="compact"
          className="border border-[color:var(--color-pipeline-line)]"
          onClick={() => inputRef.current?.click()}
        >
          Upload
        </Button>
      </div>
    </div>
  );
}

export default AccountUploadRow;
