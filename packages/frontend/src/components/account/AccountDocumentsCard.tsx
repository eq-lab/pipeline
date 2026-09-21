// spec: docs/frontend/account-page.md#accountdocumentscard
import { Button } from "@pipeline/ui";
import { UploadedFileRow } from "@/components/UploadedFileRow";
import {
  AccountStatusBanner,
  ShieldCheckIcon,
  WarningTriangleIcon,
} from "./AccountStatusBanner";
import { AccountUploadRow } from "./AccountUploadRow";
import { AccountRequirementsList } from "./AccountRequirementsList";
import { AccountDocumentRow } from "./AccountDocumentRow";
import type {
  AccountDocumentsState,
  AccountDocumentRecord,
} from "./accountPageState";

export interface AccountDocumentsCardProps {
  state: AccountDocumentsState;
  documents: AccountDocumentRecord[];
  missingDocumentName?: string;
  stagedFiles: File[];
  rejected: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveStagedFile: (index: number) => void;
  canSave: boolean;
  onSave: () => void;
  onUploadMissingDocument?: () => void;
  onReuploadDocument?: (documentName: string) => void;
}

const CONTAINER_CLASS_BY_STATE: Record<AccountDocumentsState, string> = {
  verify: "gap-4 px-2 py-4",
  staged: "gap-4 px-2 py-4",
  "under-review": "gap-2 px-2 pt-4 pb-2",
  missing: "gap-2 px-2 pt-4 pb-2",
  invalid: "gap-2 px-2 pt-4 pb-2",
  verified: "gap-2 p-2",
};

const NODE_ID_BY_STATE: Record<AccountDocumentsState, string> = {
  verify: "6701:98153",
  staged: "6701:98191",
  "under-review": "6701:98153",
  missing: "6701:98038",
  invalid: "6701:97998",
  verified: "6701:98077",
};

export function AccountDocumentsCard({
  state,
  documents,
  missingDocumentName,
  stagedFiles,
  rejected,
  onAddFiles,
  onRemoveStagedFile,
  canSave,
  onSave,
  onUploadMissingDocument,
  onReuploadDocument,
}: AccountDocumentsCardProps) {
  const visibleDocuments = documents.filter((d) => d.status !== "NotProvided");

  const composed = [
    "flex w-full flex-col items-start justify-center",
    "rounded-[var(--radius-pipeline-card)]",
    "bg-[color:var(--color-pipeline-surface)]",
    CONTAINER_CLASS_BY_STATE[state],
  ].join(" ");

  return (
    <div
      className={composed}
      data-testid="account-documents-card"
      data-node-id={NODE_ID_BY_STATE[state]}
    >
      {(state === "verify" || state === "staged") && (
        <div className="w-full px-2">
          <AccountStatusBanner
            tone="warning"
            icon={<ShieldCheckIcon />}
            title={
              state === "staged"
                ? "Verify your identity"
                : "Verify your account"
            }
            caption="Upload your company documents to unlock bank transfers."
          />
        </div>
      )}

      {state === "under-review" && (
        <div className="w-full px-2">
          <AccountStatusBanner
            tone="warning"
            icon={<ShieldCheckIcon />}
            title="Verifying account"
            caption="We are reviewing your documents."
          />
        </div>
      )}

      {state === "missing" && (
        <div className="w-full px-2">
          <AccountStatusBanner
            tone="negative"
            icon={<WarningTriangleIcon />}
            iconTile
            title={
              <>
                <span>{missingDocumentName}</span>
                <span>{" required"}</span>
              </>
            }
            caption="Please upload the document."
            action={{
              label: "Upload",
              onClick: () => onUploadMissingDocument?.(),
            }}
          />
        </div>
      )}

      {state === "invalid" && (
        <div className="w-full px-2">
          <AccountStatusBanner
            tone="negative"
            icon={<WarningTriangleIcon />}
            title="Re-upload your document"
            caption="Some information may be missing or incorrect"
          />
        </div>
      )}

      {(state === "verify" || state === "staged") && (
        <AccountUploadRow rejected={rejected} onFiles={onAddFiles} />
      )}

      {(state === "verify" || state === "staged") && (
        <AccountRequirementsList />
      )}

      {state === "staged" && stagedFiles.length > 0 && (
        <ul role="list" className="flex w-full flex-col gap-1">
          {stagedFiles.map((file, index) => (
            <UploadedFileRow
              key={`${file.name}-${index}`}
              file={file}
              onRemove={() => onRemoveStagedFile(index)}
            />
          ))}
        </ul>
      )}

      {(state === "under-review" ||
        state === "missing" ||
        state === "invalid" ||
        state === "verified") &&
        visibleDocuments.length > 0 && (
          <ul role="list" className="flex w-full flex-col gap-2">
            {visibleDocuments.map((document) => (
              <AccountDocumentRow
                key={document.name}
                document={document}
                onReupload={onReuploadDocument}
              />
            ))}
          </ul>
        )}

      {(state === "verify" || state === "staged") && (
        <div className="w-full px-2">
          <Button
            variant="primary-dark"
            disabled={!canSave}
            onClick={onSave}
            className="w-full disabled:opacity-[0.32]"
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

export default AccountDocumentsCard;
