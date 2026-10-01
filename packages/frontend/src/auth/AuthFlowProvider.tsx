// spec: docs/frontend/auth-components.md#authflowprovider
import React, { useCallback, useEffect, useState } from "react";
import { AuthFlowContext } from "./AuthFlowContext";
import { EmailAuthFlow } from "@/components/EmailAuthFlow";
import type { EmailAuthScreen } from "@/components/useEmailAuthFlow";
import { useConnectModal } from "@/wallet";
import { useAuthSession } from "./useAuthSession";
import { ApiError, getMyLp } from "@/api";
import type { LpResponse } from "@/api";
import { AccountInReviewModal } from "@/components/AccountInReviewModal";
import { CompanyDocsModal } from "@/components/CompanyDocsModal";

interface SetupState {
  token: string;
  status: "loading" | "absent" | "loaded" | "error";
  lp: LpResponse | null;
  open: boolean;
  reviewOpen?: boolean;
}

export function AuthFlowProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState<EmailAuthScreen>("sign-in");
  const { open: openConnectModal } = useConnectModal();
  const { token, email } = useAuthSession();
  const [setup, setSetup] = useState<SetupState | null>(null);

  useEffect(() => {
    if (!token) {
      setSetup(null);
      return;
    }
    const controller = new AbortController();
    setSetup({ token, status: "loading", lp: null, open: false });
    getMyLp(controller.signal)
      .then((lp) => {
        if (!controller.signal.aborted) {
          setSetup({
            token,
            status: "loaded",
            lp,
            open: lp.documents.length === 0,
          });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setSetup({ token, status: "absent", lp: null, open: true });
        } else {
          setSetup({ token, status: "error", lp: null, open: false });
        }
      });
    return () => controller.abort();
  }, [token]);

  const open = useCallback((nextScreen: EmailAuthScreen = "sign-in") => {
    setScreen(nextScreen);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <AuthFlowContext.Provider value={{ open, close }}>
      {children}
      <EmailAuthFlow
        open={isOpen}
        initialScreen={screen}
        onClose={close}
        onConnectWallet={openConnectModal}
      />
      {token &&
        setup?.token === token &&
        (setup.status === "absent" || setup.status === "loaded") && (
          <>
            <CompanyDocsModal
              key={token}
              open={setup.open}
              onDismiss={() =>
                setSetup((previous) =>
                  previous ? { ...previous, open: false } : null,
                )
              }
              onSubmitSuccess={() =>
                setSetup((previous) =>
                  previous?.token === token
                    ? { ...previous, open: false, reviewOpen: true }
                    : previous,
                )
              }
              lp={setup.lp}
              sessionEmail={email}
              onLpChange={(lp) =>
                setSetup((previous) =>
                  previous?.token === token
                    ? { ...previous, status: "loaded", lp }
                    : previous,
                )
              }
            />
            <AccountInReviewModal
              key={`review-${token}`}
              open={setup.reviewOpen ?? false}
              onDismiss={() =>
                setSetup((previous) =>
                  previous?.token === token
                    ? { ...previous, reviewOpen: false }
                    : previous,
                )
              }
              onGoToApp={() =>
                setSetup((previous) =>
                  previous?.token === token
                    ? { ...previous, reviewOpen: false }
                    : previous,
                )
              }
            />
          </>
        )}
    </AuthFlowContext.Provider>
  );
}
