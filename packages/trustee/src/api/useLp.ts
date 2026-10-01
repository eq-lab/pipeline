// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";
import { getSessionToken, setSession } from "@/auth/sessionStore";
import type { LpSummary } from "./useLps";

export interface LpDocument {
  id: number;
  lp_id: number;
  original_filename: string;
  size_bytes: number;
  content_type: string;
  status: string;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  download_url: string | null;
}

export interface LpDetail extends LpSummary {
  address_linked_at: string | null;
  writable: boolean;
  notify_on_review: boolean;
  kyb_submitted_at: string | null;
  kyb_decided_at: string | null;
  kyb_decision_reason: string | null;
  owner_chain_id: number | null;
  owner_address: string | null;
  documents: LpDocument[];
}

export async function lpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getSessionToken();
  try {
    const result = await apiFetch<T>(path, init);
    if (getSessionToken() !== token)
      throw new Error("The trustee session changed. Sign in and try again.");
    return result;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      getSessionToken() === token
    ) {
      setSession(undefined);
    }
    throw error;
  }
}

export function useLp(id: number) {
  return useQuery<LpDetail, Error>({
    queryKey: ["lp", id],
    queryFn: ({ signal }) => lpFetch<LpDetail>(`/v1/lps/${id}`, { signal }),
    enabled: Number.isSafeInteger(id) && id > 0,
    refetchInterval: 30_000,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) &&
      count < 2,
  });
}
