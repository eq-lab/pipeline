// spec: docs/frontend/auth-components.md#ownersmodal (Figma nodes 6486:81710 /
// 6486:81783 — default / enabled states)
import { Button } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { KybInfoBanner } from "@/components/KybInfoBanner";
import { FileDropZone } from "@/components/FileDropZone";
import { UploadedFileRow } from "@/components/UploadedFileRow";
import { useOwnersModal } from "@/components/useOwnersModal";

// ── Copy ──────────────────────────────────────────────────────────────────────

const OWNERS_HINT =
  "You could upload a passport, ID card, or driver’s licence, plus a recent (no older than 90 days) utility bill or bank statement as proof of address.";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OwnersModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (files: File[]) => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function OwnersModal({ open, onDismiss, onSubmit }: OwnersModalProps) {
  const headingId = "owners-modal-heading";
  const { entries, rejected, addFiles, removeFile, isComplete, handleSubmit } =
    useOwnersModal({ open, onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Add company owners"
      headingId={headingId}
      testId="owners-modal"
      showImagePanel={false}
      align="center"
      stepLabel={{ current: 2, total: 2 }}
    >
      <div
        data-node-id="6486:81710"
        className="mt-2 flex w-full flex-col gap-8 pb-16"
      >
        <div className="flex w-full flex-col gap-6">
          <KybInfoBanner tooltip={OWNERS_HINT}>
            Upload ID and proof of address documents for each owner
          </KybInfoBanner>
          <FileDropZone rejected={rejected} onFiles={addFiles} />
          {entries.length > 0 ? (
            <ul role="list" className="flex w-full flex-col gap-6">
              {entries.map((entry) => (
                <UploadedFileRow
                  key={entry.id}
                  file={entry.file}
                  onRemove={() => removeFile(entry.id)}
                />
              ))}
            </ul>
          ) : null}
        </div>

        <Button
          variant="primary-dark"
          disabled={!isComplete}
          onClick={handleSubmit}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          Submit
        </Button>

        <p className="text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]">
          Back
        </p>
      </div>
    </AuthModalShell>
  );
}

export default OwnersModal;
