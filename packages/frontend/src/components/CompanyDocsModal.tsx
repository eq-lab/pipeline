// spec: docs/frontend/auth-components.md#companydocsmodal
import { useEffect, useState } from "react";
import { Button, TextField } from "@pipeline/ui";
import {
  ApiError,
  deleteMyDocument,
  getMyLp,
  upsertMyLp,
  uploadMyDocuments,
} from "@/api";
import type { LpResponse } from "@/api";
import { readSession } from "@/auth/session";
import { AuthModalShell } from "@/components/AuthModalShell";
import { UploadedFileRow } from "@/components/UploadedFileRow";
import { AccountUploadRow } from "@/components/account/AccountUploadRow";
import { AccountRequirementsList } from "@/components/account/AccountRequirementsList";
import { useAccountDocuments } from "@/components/account/useAccountDocuments";

export interface CompanyDocsModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (files: File[]) => void;
  lp?: LpResponse | null;
  sessionEmail?: string;
  onLpChange?: (lp: LpResponse) => void;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Connection lost. Check your connection and try again.";
  switch (error.status) {
    case 400:
      return `Check your profile and files: ${error.message}`;
    case 401:
      return "Your session expired. Sign in again to continue.";
    case 404:
      return "The account or document was not found. Refresh and try again.";
    case 409:
      return "This account or document can no longer be changed. Refresh to see its current status.";
    case 413:
      return "A file is too large or too many files were selected. Choose fewer files under 10MB each.";
    default:
      return error.message || "The request failed. Try again.";
  }
}

export function CompanyDocsModal({
  open,
  onDismiss,
  onSubmit,
  lp,
  sessionEmail,
  onLpChange,
}: CompanyDocsModalProps) {
  const preview = lp === undefined;
  const [serverLp, setServerLp] = useState<LpResponse | null>(lp ?? null);
  const [legalName, setLegalName] = useState(lp?.legal_name ?? "");
  const [country, setCountry] = useState(lp?.country ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uncertainIds, setUncertainIds] = useState<number[] | null>(null);
  const {
    files,
    rejected,
    addFiles,
    removeFile,
    removeFilesAt,
    canSave,
    handleSave,
  } = useAccountDocuments({ onSave: onSubmit });

  useEffect(() => {
    if (lp === undefined) return;
    setServerLp(lp);
    setLegalName(lp?.legal_name ?? "");
    setCountry(lp?.country ?? "");
  }, [lp]);

  const writable = preview || (serverLp?.writable ?? true);
  const email = serverLp?.contact_email || sessionEmail;
  const canSubmit =
    canSave &&
    legalName.trim().length > 0 &&
    writable &&
    !busy &&
    !uncertainIds &&
    (preview || Boolean(email));

  async function reconcile(idsBefore: number[]) {
    const refreshed = await getMyLp();
    const added = refreshed.documents.filter(
      (document) => !idsBefore.includes(document.id),
    );
    const matched: number[] = [];
    for (const document of added) {
      const index = files.findIndex(
        (file, i) =>
          !matched.includes(i) && file.name === document.original_filename,
      );
      if (index >= 0) matched.push(index);
    }
    removeFilesAt(matched);
    setServerLp(refreshed);
    onLpChange?.(refreshed);
    setUncertainIds(null);
    setError(
      matched.length
        ? "Some files were uploaded before the connection failed. Review the remaining files and submit again."
        : "No new files were found. You can retry the upload.",
    );
  }

  async function submit() {
    if (preview) {
      if (canSubmit) handleSave();
      return;
    }
    if (!canSubmit || !email) return;
    setBusy(true);
    setError(undefined);
    const token = readSession()?.token;
    try {
      const saved = await upsertMyLp({
        legal_name: legalName.trim(),
        country: country.trim() || null,
        contact_email: email,
      });
      if (readSession()?.token !== token) return;
      setServerLp(saved);
      onLpChange?.(saved);
      const idsBefore = saved.documents.map((document) => document.id);
      let response;
      try {
        response = await uploadMyDocuments(files);
      } catch (uploadError) {
        if (!(uploadError instanceof ApiError)) {
          setUncertainIds(idsBefore);
          try {
            await reconcile(idsBefore);
          } catch {
            setError(
              "Upload status is unknown. Check uploads after your connection returns before retrying.",
            );
          }
        } else {
          if (uploadError.status === 409 || uploadError.status === 404) {
            const refreshed = await getMyLp().catch(() => undefined);
            if (refreshed) {
              setServerLp(refreshed);
              onLpChange?.(refreshed);
            }
          }
          setError(errorMessage(uploadError));
        }
        return;
      }
      if (readSession()?.token !== token) return;
      setServerLp(response.lp);
      onLpChange?.(response.lp);
      const successful: number[] = [];
      const failures: string[] = [];
      files.forEach((file, index) => {
        const result = response.files[index];
        if (result?.status === 201 && result.id !== null)
          successful.push(index);
        else failures.push(`${file.name}: ${result?.error ?? "Upload failed"}`);
      });
      removeFilesAt(successful);
      if (failures.length)
        setError(`Some files were not uploaded. ${failures.join("; ")}`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(id: number) {
    if (!writable || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteMyDocument(id);
      const next = serverLp && {
        ...serverLp,
        documents: serverLp.documents.filter((document) => document.id !== id),
      };
      if (next) {
        setServerLp(next);
        onLpChange?.(next);
      }
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.status === 404 || requestError.status === 409)
      ) {
        const refreshed = await getMyLp().catch(() => undefined);
        if (refreshed) {
          setServerLp(refreshed);
          onLpChange?.(refreshed);
        }
      }
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Finish account setup"
      description="Upload your company documents and personal KYC for each shareholder so we can verify your account."
      headingId="company-docs-modal-heading"
      testId="company-docs-modal"
      showImagePanel={false}
      align="center"
    >
      <div className="mt-2 flex w-full flex-col gap-8 pb-16">
        <div className="flex w-full flex-col gap-5 rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface)] p-4">
          <label className="flex flex-col gap-2" htmlFor="company-legal-name">
            <span>Name</span>
            <TextField
              id="company-legal-name"
              value={legalName}
              onChange={setLegalName}
              placeholder="Legal company name"
              disabled={!writable || busy}
            />
          </label>
          <label className="flex flex-col gap-2" htmlFor="company-country">
            <span>Country</span>
            <TextField
              id="company-country"
              value={country}
              onChange={setCountry}
              placeholder="Country"
              disabled={!writable || busy}
            />
          </label>
        </div>
        <div
          data-node-id="6701:96889"
          className="flex w-full flex-col gap-4 rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface)] px-2 pt-2 pb-4"
        >
          <AccountUploadRow
            rejected={rejected}
            onFiles={addFiles}
            disabled={!writable || busy}
            dataNodeId="6701:96891"
            testId="company-docs-upload-row"
          />
          <AccountRequirementsList
            dataNodeId="6701:96892"
            testId="company-docs-requirements-list"
            className="px-2"
          />
          {(files.length > 0 || (serverLp?.documents.length ?? 0) > 0) && (
            <ul
              role="list"
              data-node-id="6701:96893"
              className="flex w-full flex-col gap-3"
            >
              {serverLp?.documents.map((document) => (
                <UploadedFileRow
                  key={`server-${document.id}`}
                  filename={document.original_filename}
                  status={document.status}
                  onRemove={
                    writable && document.status !== "Verified"
                      ? () => void removeDocument(document.id)
                      : undefined
                  }
                  disabled={busy}
                />
              ))}
              {files.map((file, index) => (
                <UploadedFileRow
                  key={`staged-${index}`}
                  file={file}
                  status="Ready to upload"
                  onRemove={() => removeFile(index)}
                  disabled={busy}
                />
              ))}
            </ul>
          )}
        </div>
        {!preview && !email && (
          <p role="alert">Sign out and sign in again to complete setup.</p>
        )}
        {error && (
          <p
            role="alert"
            className="text-[color:var(--color-pipeline-negative-strong)]"
          >
            {error}
          </p>
        )}
        {uncertainIds && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void reconcile(uncertainIds).catch((requestError) =>
                setError(errorMessage(requestError)),
              )
            }
          >
            Check uploads
          </Button>
        )}
        <Button
          variant="primary-dark"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          {busy ? "Saving…" : "Submit"}
        </Button>
      </div>
    </AuthModalShell>
  );
}

export default CompanyDocsModal;
