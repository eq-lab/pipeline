// spec: docs/frontend/auth-components.md#session-module
import { useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { subscribeSessionEnded, type SessionEndReason } from "@/api";
import { useToast } from "@/lib/toast";
import { useAuthFlow } from "./AuthFlowContext";
import { clearSession, readSession } from "./session";
import { useAuthSession } from "./useAuthSession";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export function useSessionEndSignOut(): void {
  const navigate = useNavigate();
  const toast = useToast();
  const { open: openAuthFlow } = useAuthFlow();
  const { expiresAt } = useAuthSession();

  const endSession = useCallback(
    (reason: SessionEndReason) => {
      clearSession();
      void navigate({ to: "/", replace: true });
      if (reason !== "suspended") {
        toast.show({
          id: "session-expired",
          tone: "neutral",
          title: "Your session expired. Sign in again to continue.",
          action: { label: "Sign in", onClick: () => openAuthFlow("sign-in") },
          durationMs: 10_000,
        });
      }
    },
    [navigate, toast, openAuthFlow],
  );

  useEffect(
    () =>
      subscribeSessionEnded((reason) => {
        if (!readSession()) return;
        endSession(reason);
      }),
    [endSession],
  );

  useEffect(() => {
    if (expiresAt === undefined) return;
    const delay = expiresAt - Date.now();
    if (delay > MAX_TIMEOUT_MS) return;
    const id = setTimeout(() => endSession("expired"), Math.max(0, delay));
    return () => clearTimeout(id);
  }, [expiresAt, endSession]);
}
