// spec: docs/frontend/auth-components.md#companydocsmodal
import { Button } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { UploadedFileRow } from "@/components/UploadedFileRow";
import { AccountUploadRow } from "@/components/account/AccountUploadRow";
import { AccountRequirementsList } from "@/components/account/AccountRequirementsList";
import { useAccountDocuments } from "@/components/account/useAccountDocuments";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyDocsModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (files: File[]) => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function CompanyDocsModal({
  open,
  onDismiss,
  onSubmit,
}: CompanyDocsModalProps) {
  const headingId = "company-docs-modal-heading";
  const { files, rejected, addFiles, removeFile, canSave, handleSave } =
    useAccountDocuments({ onSave: onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Finish account setup"
      description="Upload your company documents and personal KYC for each shareholder so we can verify your account."
      headingId={headingId}
      testId="company-docs-modal"
      showImagePanel={false}
      align="center"
    >
      <div className="mt-2 flex w-full flex-col gap-8 pb-16">
        <div
          data-node-id="6701:96889"
          className="flex w-full flex-col gap-4 rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface)] px-2 pt-2 pb-4"
        >
          <AccountUploadRow
            rejected={rejected}
            onFiles={addFiles}
            dataNodeId="6701:96891"
            testId="company-docs-upload-row"
          />
          <AccountRequirementsList
            dataNodeId="6701:96892"
            testId="company-docs-requirements-list"
            className="px-2"
          />
          {files.length > 0 && (
            <ul
              role="list"
              data-node-id="6701:96893"
              className="flex w-full flex-col gap-3"
            >
              {files.map((file, index) => (
                <UploadedFileRow
                  key={`${file.name}-${index}`}
                  file={file}
                  onRemove={() => removeFile(index)}
                />
              ))}
            </ul>
          )}
        </div>

        <Button
          variant="primary-dark"
          disabled={!canSave}
          onClick={handleSave}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          Submit
        </Button>
      </div>
    </AuthModalShell>
  );
}

export default CompanyDocsModal;
