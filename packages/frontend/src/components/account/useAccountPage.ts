// spec: docs/frontend/account-page.md#production-lp-data-contract-1373
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  deleteMyDocument,
  getMyLp,
  uploadMyDocuments,
  upsertMyLp,
} from "@/api";
import type { LpResponse, UploadDocumentsResponse } from "@/api";
import { useAuthSession } from "@/auth";
import { readSession } from "@/auth/session";
import { useAccountDocuments } from "./useAccountDocuments";

type ReadState = "loading" | "loaded" | "absent" | "error";
type Profile = { legalName: string; country: string };

function message(error: unknown): string {
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

function uploadErrorResponse(error: ApiError): UploadDocumentsResponse | null {
  const payload = error.payload;
  if (!payload || typeof payload !== "object") return null;
  if (!("files" in payload) || !Array.isArray(payload.files)) return null;
  if (!("lp" in payload) || !payload.lp || typeof payload.lp !== "object")
    return null;
  return payload as UploadDocumentsResponse;
}

export function useAccountPage(enabled = true) {
  const { token, email: sessionEmail } = useAuthSession();
  const [readState, setReadState] = useState<ReadState>("loading");
  const [lp, setLp] = useState<LpResponse | null>(null);
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [baseline, setBaseline] = useState<Profile>({
    legalName: "",
    country: "",
  });
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uncertainIds, setUncertainIds] = useState<number[] | null>(null);
  const [ambiguousNames, setAmbiguousNames] = useState<string[]>([]);
  const identity = useRef<string | undefined>(undefined);
  const request = useRef(0);
  const documents = useAccountDocuments();

  const current = useCallback(
    (expected: string) => readSession()?.token === expected,
    [],
  );
  const adopt = useCallback(
    (next: LpResponse | null, expected: string) => {
      if (!current(expected)) return;
      const nextIdentity = `${expected}:${next?.id ?? "absent"}`;
      if (identity.current !== nextIdentity) {
        const profile = {
          legalName: next?.legal_name ?? "",
          country: next?.country ?? "",
        };
        setLegalName(profile.legalName);
        setCountry(profile.country);
        setBaseline(profile);
        identity.current = nextIdentity;
      }
      setLp(next);
      setReadState(next ? "loaded" : "absent");
    },
    [current],
  );

  const refresh = useCallback(
    async (expected: string, signal?: AbortSignal) => {
      const serial = ++request.current;
      try {
        const next = await getMyLp(signal);
        if (serial === request.current && current(expected))
          adopt(next, expected);
        return next;
      } catch (error) {
        if (signal?.aborted || serial !== request.current || !current(expected))
          return undefined;
        if (error instanceof ApiError && error.status === 404) {
          adopt(null, expected);
          return null;
        }
        setReadState("error");
        setActionError(message(error));
        return undefined;
      }
    },
    [adopt, current],
  );

  useEffect(() => {
    request.current++;
    identity.current = undefined;
    setLp(null);
    setLegalName("");
    setCountry("");
    setBaseline({ legalName: "", country: "" });
    setActionError(undefined);
    setUncertainIds(null);
    setAmbiguousNames([]);
    setBusy(false);
    if (!enabled) return;
    if (!token) {
      setReadState("error");
      setActionError("Sign in to view your account.");
      return;
    }
    setReadState("loading");
    const controller = new AbortController();
    void refresh(token, controller.signal);
    return () => {
      controller.abort();
    };
  }, [enabled, token, refresh]);

  const email =
    lp?.contact_email ?? (readState === "absent" ? sessionEmail : undefined);
  const writable = lp?.writable ?? readState === "absent";
  const profileChanged =
    legalName.trim() !== baseline.legalName.trim() ||
    (country.trim() || null) !== (baseline.country.trim() || null);
  const canWrite = Boolean(
    token &&
    email &&
    writable &&
    !busy &&
    (readState === "loaded" || readState === "absent"),
  );
  const canSaveProfile =
    canWrite &&
    legalName.trim().length > 0 &&
    (readState === "absent" || profileChanged);
  const canUpload =
    canWrite &&
    !uncertainIds &&
    documents.canSave &&
    (readState === "loaded" || legalName.trim().length > 0);

  async function saveProfile() {
    if (!canSaveProfile || !email || !token) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const saved = await upsertMyLp({
        legal_name: legalName.trim(),
        country: country.trim() || null,
        contact_email: email,
      });
      if (!current(token)) return;
      adopt(saved, token);
      const profile = {
        legalName: saved.legal_name,
        country: saved.country ?? "",
      };
      setLegalName(profile.legalName);
      setCountry(profile.country);
      setBaseline(profile);
    } catch (error) {
      if (!current(token)) return;
      setActionError(message(error));
      if (error instanceof ApiError && error.status === 409)
        await refresh(token);
    } finally {
      if (current(token)) setBusy(false);
    }
  }

  function applyUpload(
    response: UploadDocumentsResponse,
    files: File[],
    expected: string,
  ) {
    if (!current(expected)) return;
    adopt(response.lp, expected);
    const successful: number[] = [];
    const failures: string[] = [];
    files.forEach((file, index) => {
      const result = response.files[index];
      if (result?.status === 201 && result.id !== null) successful.push(index);
      else failures.push(`${file.name}: ${result?.error ?? "Upload failed"}`);
    });
    documents.removeFilesAt(successful);
    if (failures.length)
      setActionError(`Some files were not uploaded. ${failures.join("; ")}`);
  }

  async function reconcile(
    idsBefore: number[],
    expected: string,
    files: File[],
  ) {
    const refreshed = await getMyLp();
    if (!current(expected)) return;
    const added = refreshed.documents.filter(
      (document) => !idsBefore.includes(document.id),
    );
    const stagedCounts = new Map<string, number>();
    const addedCounts = new Map<string, number>();
    files.forEach((file) =>
      stagedCounts.set(file.name, (stagedCounts.get(file.name) ?? 0) + 1),
    );
    added.forEach((document) =>
      addedCounts.set(
        document.original_filename,
        (addedCounts.get(document.original_filename) ?? 0) + 1,
      ),
    );
    const ambiguous = [...stagedCounts.keys()].filter(
      (name) =>
        (addedCounts.get(name) ?? 0) > 0 &&
        ((stagedCounts.get(name) ?? 0) > 1 || (addedCounts.get(name) ?? 0) > 1),
    );
    const matched: number[] = [];
    for (const document of added) {
      if (ambiguous.includes(document.original_filename)) continue;
      const index = files.findIndex(
        (file, i) =>
          !matched.includes(i) && file.name === document.original_filename,
      );
      if (index >= 0) matched.push(index);
    }
    documents.removeFilesAt(matched);
    adopt(refreshed, expected);
    setAmbiguousNames(ambiguous);
    if (ambiguous.length === 0) setUncertainIds(null);
    setActionError(
      ambiguous.length
        ? "New uploaded documents match staged files with duplicate names. We cannot tell which copy uploaded. Discard the uncertain staged files, review the uploaded list, then select any missing files again."
        : matched.length
          ? "Some files were uploaded before the connection failed. Review the remaining files and save again."
          : "No new files were found. You can retry the upload.",
    );
  }

  async function saveDocuments() {
    if (!canUpload || !token || !email) return;
    setBusy(true);
    setActionError(undefined);
    const files = documents.files;
    let target = lp;
    try {
      if (!target) {
        target = await upsertMyLp({
          legal_name: legalName.trim(),
          country: country.trim() || null,
          contact_email: email,
        });
        if (!current(token)) return;
        adopt(target, token);
        const profile = {
          legalName: target.legal_name,
          country: target.country ?? "",
        };
        setBaseline(profile);
        setLegalName(profile.legalName);
        setCountry(profile.country);
      }
      const idsBefore = target.documents.map((document) => document.id);
      try {
        const response = await uploadMyDocuments(files);
        applyUpload(response, files, token);
      } catch (error) {
        if (!current(token)) return;
        if (error instanceof ApiError && error.status === 400) {
          const response = uploadErrorResponse(error);
          if (response) {
            applyUpload(response, files, token);
            return;
          }
        }
        if (!(error instanceof ApiError)) {
          setUncertainIds(idsBefore);
          try {
            await reconcile(idsBefore, token, files);
          } catch {
            if (current(token))
              setActionError(
                "Upload status is unknown. Check uploads after your connection returns before retrying.",
              );
          }
        } else {
          setActionError(message(error));
          if (error.status === 404 || error.status === 409)
            await refresh(token);
        }
      }
    } catch (error) {
      if (!current(token)) return;
      setActionError(message(error));
      if (error instanceof ApiError && error.status === 409)
        await refresh(token);
    } finally {
      if (current(token)) setBusy(false);
    }
  }

  async function removeDocument(id: number) {
    const target = lp?.documents.find((document) => document.id === id);
    if (
      !token ||
      !lp?.writable ||
      !target ||
      target.status === "Verified" ||
      busy
    )
      return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteMyDocument(id);
      if (!current(token)) return;
      adopt(
        {
          ...lp,
          documents: lp.documents.filter((document) => document.id !== id),
        },
        token,
      );
      if (target.status === "Rejected")
        setActionError("Document removed. Upload the corrected file and save.");
    } catch (error) {
      if (!current(token)) return;
      setActionError(message(error));
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 409)
      )
        await refresh(token);
    } finally {
      if (current(token)) setBusy(false);
    }
  }

  return {
    token,
    readState,
    lp,
    email,
    legalName,
    setLegalName,
    country,
    setCountry,
    writable,
    busy,
    actionError,
    uncertainIds,
    ambiguousNames,
    documents,
    canSaveProfile,
    canUpload,
    saveProfile,
    saveDocuments,
    removeDocument,
    retry: () => {
      if (token) {
        setActionError(undefined);
        setReadState("loading");
        void refresh(token);
      }
    },
    checkUploads: async () => {
      if (!token || !uncertainIds || busy) return;
      setBusy(true);
      try {
        await reconcile(uncertainIds, token, documents.files);
      } catch (error) {
        if (current(token)) setActionError(message(error));
      } finally {
        if (current(token)) setBusy(false);
      }
    },
    discardAmbiguous: () => {
      if (busy || ambiguousNames.length === 0) return;
      documents.removeFilesAt(
        documents.files.flatMap((file, index) =>
          ambiguousNames.includes(file.name) ? [index] : [],
        ),
      );
      setAmbiguousNames([]);
      setUncertainIds(null);
      setActionError(
        "Uncertain staged files were discarded. Review uploaded documents and select any missing files again.",
      );
    },
  };
}
