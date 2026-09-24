// spec: docs/product-specs/api-authorization-email.md#frontend
import { useSyncExternalStore } from "react";
import { clearSession, readSession, subscribeSession } from "./session";

export interface UseAuthSessionResult {
  token: string | undefined;
  expiresAt: number | undefined;
  isAuthenticated: boolean;
  signOut: () => void;
}

function getTokenSnapshot(): string | null {
  return readSession()?.token ?? null;
}

export function useAuthSession(): UseAuthSessionResult {
  const token = useSyncExternalStore(
    subscribeSession,
    getTokenSnapshot,
    () => null,
  );
  const expiresAt =
    token !== null ? (readSession()?.expiresAt ?? undefined) : undefined;

  return {
    token: token ?? undefined,
    expiresAt,
    isAuthenticated: token !== null,
    signOut: clearSession,
  };
}
