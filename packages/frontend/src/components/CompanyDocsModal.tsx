// spec: docs/frontend/auth-components.md#companydocsmodal (Figma nodes
// 6486:81679 / 6486:81817 — empty / uploaded states)
import { Button } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { DocumentUploadRow } from "@/components/DocumentUploadRow";
import {
  COMPANY_DOCUMENT_SLOTS,
  useCompanyDocsModal,
  type CompanyDocumentSlotId,
} from "@/components/useCompanyDocsModal";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CompanyDocsModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (documents: Record<CompanyDocumentSlotId, File>) => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function CompanyDocsModal({
  open,
  onDismiss,
  onSubmit,
}: CompanyDocsModalProps) {
  const headingId = "company-docs-modal-heading";
  const { files, rejected, selectFile, clearFile, isComplete, handleSubmit } =
    useCompanyDocsModal({ open, onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Finish account setup"
      description="Upload your company documents so we can verify your account."
      headingId={headingId}
      testId="company-docs-modal"
      showImagePanel={false}
      align="center"
      stepLabel={{ current: 1, total: 2 }}
    >
      <div
        data-node-id="6486:81679"
        className="mt-2 flex w-full flex-col gap-8 pb-16"
      >
        <ul role="list" className="flex w-full flex-col gap-6">
          {COMPANY_DOCUMENT_SLOTS.map((slot) => (
            <DocumentUploadRow
              key={slot.id}
              slotId={slot.id}
              label={slot.label}
              file={files[slot.id]}
              rejected={Boolean(rejected[slot.id])}
              onSelect={(file) => selectFile(slot.id, file)}
              onRemove={() => clearFile(slot.id)}
            />
          ))}
        </ul>

        <Button
          variant="primary-dark"
          disabled={!isComplete}
          onClick={handleSubmit}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          Continue
        </Button>
      </div>
    </AuthModalShell>
  );
}

export default CompanyDocsModal;
