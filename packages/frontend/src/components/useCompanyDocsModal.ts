// spec: docs/frontend/auth-components.md#companydocsmodal (five fixed slots,
// validation, no-op onSubmit seam; Figma nodes 6486:81679 / 6486:81817)
import { useEffect, useState } from "react";
import {
  isAcceptedFile,
  MAX_FILE_BYTES,
  ACCEPTED_FILE_TYPES,
} from "@/components/kybFileValidation";

export { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES };

export const COMPANY_DOCUMENT_SLOTS = [
  { id: "certificate-of-incorporation", label: "Certificate of Incorporation" },
  { id: "registry-of-legal-entities", label: "Registry of Legal Entities" },
  { id: "certificate-of-good-standing", label: "Certificate of Good Standing" },
  { id: "legal-address", label: "Legal Address" },
  { id: "shareholder-register", label: "Shareholder Register" },
] as const;

export type CompanyDocumentSlotId =
  (typeof COMPANY_DOCUMENT_SLOTS)[number]["id"];

export interface UseCompanyDocsModalOptions {
  open: boolean;
  onSubmit?: (documents: Record<CompanyDocumentSlotId, File>) => void;
}

export interface UseCompanyDocsModalResult {
  files: Partial<Record<CompanyDocumentSlotId, File>>;
  rejected: Partial<Record<CompanyDocumentSlotId, boolean>>;
  selectFile: (id: CompanyDocumentSlotId, file: File) => void;
  clearFile: (id: CompanyDocumentSlotId) => void;
  isComplete: boolean;
  handleSubmit: () => void;
}

export function useCompanyDocsModal({
  open,
  onSubmit,
}: UseCompanyDocsModalOptions): UseCompanyDocsModalResult {
  const [files, setFiles] = useState<
    Partial<Record<CompanyDocumentSlotId, File>>
  >({});
  const [rejected, setRejected] = useState<
    Partial<Record<CompanyDocumentSlotId, boolean>>
  >({});

  useEffect(() => {
    if (open) {
      setFiles({});
      setRejected({});
    }
  }, [open]);

  function selectFile(id: CompanyDocumentSlotId, file: File) {
    const accepted = isAcceptedFile(file) && file.size <= MAX_FILE_BYTES;

    if (accepted) {
      setFiles((prev) => ({ ...prev, [id]: file }));
      setRejected((prev) => ({ ...prev, [id]: false }));
    } else {
      setRejected((prev) => ({ ...prev, [id]: true }));
    }
  }

  function clearFile(id: CompanyDocumentSlotId) {
    setFiles((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRejected((prev) => ({ ...prev, [id]: false }));
  }

  const isComplete = COMPANY_DOCUMENT_SLOTS.every((slot) => files[slot.id]);

  function handleSubmit() {
    if (!isComplete) return;
    onSubmit?.(files as Record<CompanyDocumentSlotId, File>);
  }

  return { files, rejected, selectFile, clearFile, isComplete, handleSubmit };
}
