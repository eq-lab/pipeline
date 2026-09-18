// spec: docs/frontend/auth-components.md#ownersmodal (unbounded id-keyed file
// list, ≥1-file Submit threshold; Figma nodes 6486:81710 / 6486:81783)
import { useEffect, useRef, useState } from "react";
import { isAcceptedFile, MAX_FILE_BYTES } from "@/components/kybFileValidation";

export interface OwnerFileEntry {
  id: number;
  file: File;
}

export interface UseOwnersModalOptions {
  open: boolean;
  onSubmit?: (files: File[]) => void;
}

export interface UseOwnersModalResult {
  entries: OwnerFileEntry[];
  rejected: boolean;
  addFiles: (files: File[]) => void;
  removeFile: (id: number) => void;
  isComplete: boolean;
  handleSubmit: () => void;
}

export function useOwnersModal({
  open,
  onSubmit,
}: UseOwnersModalOptions): UseOwnersModalResult {
  const [entries, setEntries] = useState<OwnerFileEntry[]>([]);
  const [rejected, setRejected] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    if (open) {
      setEntries([]);
      setRejected(false);
      nextId.current = 0;
    }
  }, [open]);

  function addFiles(files: File[]) {
    const accepted: OwnerFileEntry[] = [];
    let anyRejected = false;

    for (const file of files) {
      if (isAcceptedFile(file) && file.size <= MAX_FILE_BYTES) {
        accepted.push({ id: nextId.current++, file });
      } else {
        anyRejected = true;
      }
    }

    if (accepted.length > 0) {
      setEntries((prev) => [...prev, ...accepted]);
    }
    setRejected(anyRejected);
  }

  function removeFile(id: number) {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setRejected(false);
  }

  const isComplete = entries.length > 0;

  function handleSubmit() {
    if (!isComplete) return;
    onSubmit?.(entries.map((entry) => entry.file));
  }

  return { entries, rejected, addFiles, removeFile, isComplete, handleSubmit };
}
