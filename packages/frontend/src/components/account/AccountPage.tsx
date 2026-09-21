// spec: docs/frontend/account-page.md#accountpage
import { Button } from "@pipeline/ui";
import { AccountWalletCard } from "./AccountWalletCard";
import { AccountEmailCard } from "./AccountEmailCard";
import { AccountDocumentsCard } from "./AccountDocumentsCard";
import { useAccountDocuments } from "./useAccountDocuments";
import {
  ACCOUNT_STATE_PREVIEWS,
  createPreviewStagedFiles,
  deriveDocumentsState,
  type AccountDocumentsState,
} from "./accountPageState";

function UserGlyph() {
  return (
    <svg
      width={36}
      height={36}
      viewBox="0 0 36 36"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M18 3C26.2843 3 33 9.71573 33 18C33 26.2843 26.2843 33 18 33C9.71573 33 3 26.2843 3 18C3 9.71573 9.71573 3 18 3ZM18 22.5C14.2511 22.5 10.8261 23.8778 8.19726 26.1519C10.536 28.9612 14.0588 30.75 18 30.75C21.9408 30.75 25.4625 28.9608 27.8013 26.1519C25.1727 23.878 21.7485 22.5 18 22.5ZM18 9C15.2143 9 13.125 11.3505 13.125 14.25C13.125 17.1495 15.2143 19.5 18 19.5C20.7857 19.5 22.875 17.1495 22.875 14.25C22.875 11.3505 20.7857 9 18 9Z"
      />
    </svg>
  );
}

export interface AccountPageProps {
  previewState?: AccountDocumentsState;
  onLogOut?: () => void;
}

export function AccountPage({ previewState, onLogOut }: AccountPageProps) {
  const preview = previewState
    ? ACCOUNT_STATE_PREVIEWS[previewState]
    : undefined;
  const kybStatus = preview?.kybStatus ?? "NotStarted";
  const documents = preview?.documents ?? [];
  const missingDocumentName = preview?.missingDocumentName;

  const { files, rejected, addFiles, removeFile, canSave, handleSave } =
    useAccountDocuments({
      initialFiles:
        previewState === "staged" ? createPreviewStagedFiles() : undefined,
    });

  const documentsState: AccountDocumentsState =
    previewState ??
    deriveDocumentsState({ kybStatus, documents, stagedCount: files.length });

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center gap-8 bg-[color:var(--color-pipeline-paper)] p-4 text-[color:var(--color-pipeline-ink)] md:p-32"
      data-testid="account-page"
    >
      <div
        className="flex w-full max-w-[480px] flex-col items-center gap-8"
        data-node-id="6701:98100"
      >
        <div
          className="flex w-full flex-col items-center gap-4"
          data-node-id="6701:98101"
        >
          <div className="flex size-18 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-fill-muted)] text-[color:var(--color-pipeline-ink-subtle)]">
            <UserGlyph />
          </div>
          <h1
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-m)]",
              "leading-[var(--text-pipeline-heading-m--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            Account
          </h1>
        </div>

        <AccountWalletCard />

        <AccountEmailCard email={undefined} />

        <div className="flex w-full flex-col items-start gap-3">
          <p
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            Documents
          </p>
          <AccountDocumentsCard
            state={documentsState}
            documents={documents}
            missingDocumentName={missingDocumentName}
            stagedFiles={files}
            rejected={rejected}
            onAddFiles={addFiles}
            onRemoveStagedFile={removeFile}
            canSave={canSave}
            onSave={handleSave}
          />
        </div>

        <Button
          variant="secondary"
          className="w-full !bg-[color:var(--color-pipeline-surface)]"
          onClick={() => onLogOut?.()}
        >
          Log Out
        </Button>
      </div>
    </div>
  );
}

export default AccountPage;
