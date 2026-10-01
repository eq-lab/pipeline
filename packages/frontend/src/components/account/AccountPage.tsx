// spec: docs/frontend/account-page.md#accountpage
import { Button } from "@pipeline/ui";
import { useAuthSession } from "@/auth";
import { AccountWalletCard } from "./AccountWalletCard";
import { AccountEmailCard } from "./AccountEmailCard";
import { AccountDocumentsCard } from "./AccountDocumentsCard";
import { AccountProfileCard } from "./AccountProfileCard";
import { useAccountDocuments } from "./useAccountDocuments";
import { useAccountPage } from "./useAccountPage";
import {
  ACCOUNT_STATE_PREVIEWS,
  createPreviewStagedFiles,
  deriveDocumentsState,
  deriveProductionDocumentsState,
  documentsFromLp,
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
  const { token } = useAuthSession();
  return previewState ? (
    <AccountPageContent previewState={previewState} onLogOut={onLogOut} />
  ) : (
    <ProductionAccountPage key={token ?? "signed-out"} onLogOut={onLogOut} />
  );
}

function ProductionAccountPage({
  onLogOut,
}: Pick<AccountPageProps, "onLogOut">) {
  const account = useAccountPage();
  return <AccountPageContent account={account} onLogOut={onLogOut} />;
}

function AccountPageContent({
  previewState,
  onLogOut,
  account,
}: AccountPageProps & { account?: ReturnType<typeof useAccountPage> }) {
  const preview = previewState
    ? ACCOUNT_STATE_PREVIEWS[previewState]
    : undefined;
  const kybStatus = preview?.kybStatus ?? "NotStarted";
  const documents = preview?.documents ?? [];
  const missingDocumentName = preview?.missingDocumentName;

  const previewDocuments = useAccountDocuments({
    initialFiles:
      previewState === "staged" ? createPreviewStagedFiles() : undefined,
  });
  const staging = account?.documents ?? previewDocuments;
  const { files, rejected, addFiles, removeFile, canSave, handleSave } =
    staging;

  const documentsState: AccountDocumentsState =
    previewState ??
    (account?.lp
      ? deriveProductionDocumentsState({
          kybStatus: account.lp.kyb_status as typeof kybStatus,
          documents: documentsFromLp(account.lp.documents),
          stagedCount: files.length,
          writable: account.lp.writable,
        })
      : deriveDocumentsState({
          kybStatus,
          documents,
          stagedCount: files.length,
        }));
  const visibleDocuments = account?.lp
    ? documentsFromLp(account.lp.documents)
    : documents;
  const ready = Boolean(
    previewState ||
    account?.readState === "loaded" ||
    account?.readState === "absent",
  );

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center gap-8 bg-[color:var(--color-pipeline-paper)] px-4 py-8 text-[color:var(--color-pipeline-ink)] md:px-8 md:py-16"
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

        {account?.readState === "loading" && (
          <p role="status">Loading account…</p>
        )}
        {account?.readState === "error" && (
          <div className="flex w-full flex-col gap-3" role="alert">
            <p>{account.actionError ?? "Could not load your account."}</p>
            <Button variant="secondary" onClick={account.retry}>
              Retry
            </Button>
          </div>
        )}

        {ready && <AccountEmailCard email={account?.email} />}

        {ready && account && (
          <AccountProfileCard
            legalName={account.legalName}
            country={account.country}
            onLegalNameChange={account.setLegalName}
            onCountryChange={account.setCountry}
            onSave={() => void account.saveProfile()}
            canSave={account.canSaveProfile}
            disabled={
              !account.writable ||
              account.busy ||
              account.uncertainSubmission ||
              !account.email
            }
            busy={account.busy}
          />
        )}

        {ready && account?.readState === "loaded" && !account.writable && (
          <p role="status">
            {account.lp?.kyb_status === "Failed"
              ? "Your account verification was declined. Profile and document changes are unavailable."
              : "Your account is under review or approved. Profile and document changes are unavailable."}
          </p>
        )}
        {ready && account?.readState === "absent" && !account.email && (
          <p role="alert">Sign out and sign in again to complete setup.</p>
        )}
        {ready && account?.actionError && (
          <p
            role="alert"
            className="text-[color:var(--color-pipeline-negative-strong)]"
          >
            {account.actionError}
          </p>
        )}
        {ready && account?.uncertainIds && (
          <Button
            variant="secondary"
            disabled={account.busy}
            onClick={account.checkUploads}
          >
            Check uploads
          </Button>
        )}
        {ready && account && account.ambiguousNames.length > 0 && (
          <Button
            variant="secondary"
            disabled={account.busy}
            onClick={account.discardAmbiguous}
          >
            Discard uncertain staged files
          </Button>
        )}

        {ready && account?.uncertainSubmission && (
          <Button
            variant="secondary"
            disabled={account.busy}
            onClick={() => void account.checkSubmission()}
          >
            Check submission status
          </Button>
        )}
        {ready && account?.profileChanged && account.lp?.writable && (
          <p role="status">
            Save your profile changes before uploading documents or submitting
            for review.
          </p>
        )}
        {ready && (
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
              documents={visibleDocuments}
              missingDocumentName={missingDocumentName}
              stagedFiles={files}
              rejected={rejected}
              onAddFiles={
                account
                  ? (picked) => {
                      if (
                        !account.busy &&
                        !account.uncertainIds &&
                        !account.uncertainSubmission
                      )
                        addFiles(picked);
                    }
                  : addFiles
              }
              onRemoveStagedFile={
                account
                  ? (index) => {
                      if (
                        !account.busy &&
                        !account.uncertainIds &&
                        !account.uncertainSubmission
                      )
                        removeFile(index);
                    }
                  : removeFile
              }
              canSave={account ? account.canUpload : canSave}
              onSave={account ? () => void account.saveDocuments() : handleSave}
              production={Boolean(account)}
              failed={account?.lp?.kyb_status === "Failed"}
              canSubmitForReview={account?.canSubmitForReview}
              onSubmitForReview={
                account ? () => void account.submitForReview() : undefined
              }
              writable={account?.writable ?? true}
              busy={
                account
                  ? account.busy ||
                    Boolean(account.uncertainIds) ||
                    account.uncertainSubmission
                  : false
              }
              onRemoveDocument={
                account ? (id) => void account.removeDocument(id) : undefined
              }
              onReuploadDocument={
                account ? (id) => void account.removeDocument(id) : undefined
              }
            />
          </div>
        )}

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
