// spec: docs/product-specs/kyb-lp-verification.md#lp-entity-registration-and-kyb-documents
import { authHeaders } from "@/auth/session";
import { apiFetch } from "./client";

export interface LpDocument {
  id: number;
  lp_id: number;
  original_filename: string;
  size_bytes: number;
  content_type: string;
  status: "Provided" | "Verified" | "Rejected";
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  download_url: string | null;
}

export interface LpResponse {
  id: number;
  legal_name: string;
  country: string | null;
  contact_email: string;
  stellar_address: string | null;
  address_linked_at: string | null;
  kyb_status: string;
  writable: boolean;
  owner_account_id: string;
  owner_chain_id: number | null;
  owner_address: string | null;
  created_at: string;
  documents: LpDocument[];
}

export interface UploadDocumentsResponse {
  lp: LpResponse;
  files: Array<{
    filename: string;
    status: number;
    id: number | null;
    error: string | null;
  }>;
}

export function getMyLp(signal?: AbortSignal): Promise<LpResponse> {
  return apiFetch<LpResponse>("/v1/lps/me", {
    headers: authHeaders(),
    signal,
  });
}

export function upsertMyLp(profile: {
  legal_name: string;
  country: string | null;
  contact_email: string;
}): Promise<LpResponse> {
  return apiFetch<LpResponse>("/v1/lps/me", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}

export function uploadMyDocuments(
  files: File[],
): Promise<UploadDocumentsResponse> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  return apiFetch<UploadDocumentsResponse>("/v1/lps/me/documents", {
    method: "POST",
    headers: authHeaders(),
    body,
  });
}

export function deleteMyDocument(id: number): Promise<void> {
  return apiFetch<void>(`/v1/lps/me/documents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
}
