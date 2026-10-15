// spec: docs/frontend/auth-components.md#resetpasswordmodal
import { useCallback, useEffect, useState } from "react";
import { ApiError, resetPassword } from "@/api";
import { clearSession } from "@/auth/session";
import { describeApiError } from "@/components/useEmailAuthFlow";
import { PASSWORD_POLICY_ERROR_MESSAGE } from "@/components/useAuthCredentialsForm";
import type { ResetPasswordView } from "@/components/ResetPasswordModal";

const RESET_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function readResetToken(hash: string): string | undefined {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("token")?.trim();
  return raw && RESET_TOKEN_PATTERN.test(raw) ? raw : undefined;
}

export interface UseResetPasswordFlowResult {
  view: ResetPasswordView;
  formError: string | undefined;
  passwordServerError: string | undefined;
  submit: (payload: { password: string }) => Promise<void>;
  clearErrors: () => void;
}

export function useResetPasswordFlow(): UseResetPasswordFlowResult {
  const [token] = useState(() => readResetToken(window.location.hash));
  const [view, setView] = useState<ResetPasswordView>(
    token ? "form" : "expired",
  );
  const [formError, setFormError] = useState<string>();
  const [passwordServerError, setPasswordServerError] = useState<string>();

  useEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);

  const clearErrors = useCallback(() => {
    setFormError(undefined);
    setPasswordServerError(undefined);
  }, []);

  const submit = useCallback(
    async ({ password }: { password: string }) => {
      if (!token) return;
      clearErrors();
      try {
        await resetPassword({ token, password });
        clearSession();
        setView("done");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setView("expired");
        } else if (error instanceof ApiError && error.status === 400) {
          setPasswordServerError(
            error.message || PASSWORD_POLICY_ERROR_MESSAGE,
          );
        } else {
          setFormError(describeApiError(error));
        }
        throw error;
      }
    },
    [token, clearErrors],
  );

  return { view, formError, passwordServerError, submit, clearErrors };
}
