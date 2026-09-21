// spec: docs/frontend/account-page.md#useaccountdocuments
import { useState } from "react";
import { isAcceptedFile, MAX_FILE_BYTES } from "@/components/kybFileValidation";

export interface UseAccountDocumentsOptions {
  initialFiles?: File[];
  onSave?: (files: File[]) => void;
}

export interface UseAccountDocumentsResult {
  files: File[];
  rejected: boolean;
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  canSave: boolean;
  handleSave: () => void;
}

export function useAccountDocuments({
  initialFiles,
  onSave,
}: UseAccountDocumentsOptions = {}): UseAccountDocumentsResult {
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [rejected, setRejected] = useState(false);

  function addFiles(picked: File[]) {
    const accepted: File[] = [];
    let anyRejected = false;

    for (const file of picked) {
      if (isAcceptedFile(file) && file.size <= MAX_FILE_BYTES) {
        accepted.push(file);
      } else {
        anyRejected = true;
      }
    }

    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
    }
    setRejected(anyRejected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const canSave = files.length > 0;

  function handleSave() {
    if (!canSave) return;
    onSave?.(files);
  }

  return { files, rejected, addFiles, removeFile, canSave, handleSave };
}
