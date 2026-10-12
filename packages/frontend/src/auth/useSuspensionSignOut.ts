// spec: docs/frontend/auth-components.md#session-module
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { subscribeAccountSuspended } from "@/api";
import { clearSession, readSession } from "./session";

export function useSuspensionSignOut(): void {
  const navigate = useNavigate();
  useEffect(
    () =>
      subscribeAccountSuspended(() => {
        if (!readSession()) return;
        clearSession();
        void navigate({ to: "/", replace: true });
      }),
    [navigate],
  );
}
