// spec: docs/frontend/auth-components.md#authflowprovider
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AuthFlowContext } from "./AuthFlowContext";
import type { AuthFlowContextValue } from "./AuthFlowContext";
import { EmailAuthFlow } from "@/components/EmailAuthFlow";
import type { EmailAuthScreen } from "@/components/useEmailAuthFlow";
import type { LpReadState } from "@/components/homeState";
import { useConnectModal } from "@/wallet";
import { useAuthSession } from "./useAuthSession";
import { isAccountSetupDismissed, markAccountSetupDismissed } from "./session";
import { ApiError, getMyLp, upsertMyLp } from "@/api";
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

function toLpReadState(status: SetupState["status"] | undefined): LpReadState {
  if (status === "loading" || status === undefined) return "unknown";
  return status;
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
            open: lp.documents.length === 0 && !isAccountSetupDismissed(token),
          });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setSetup({
            token,
            status: "absent",
            lp: null,
            open: !isAccountSetupDismissed(token),
          });
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

  const openAccountSetup = useCallback(() => {
    setSetup((previous) => (previous ? { ...previous, open: true } : previous));
  }, []);

  const lpRead = toLpReadState(setup?.status);
  const kybStatus =
    setup?.status === "loaded" ? setup.lp?.kyb_status : undefined;

  const contextValue = useMemo<AuthFlowContextValue>(
    () => ({ open, close, lpRead, kybStatus, openAccountSetup }),
    [open, close, lpRead, kybStatus, openAccountSetup],
  );

  const subscribeToReview = useCallback(async () => {
    const lp = setup?.lp;
    if (!token || !lp) throw new Error("No LP to subscribe");
    const updated = await upsertMyLp({
      legal_name: lp.legal_name,
      country: lp.country,
      contact_email: lp.contact_email,
      notify_on_review: true,
    });
    setSetup((previous) =>
      previous?.token === token ? { ...previous, lp: updated } : previous,
    );
  }, [setup?.lp, token]);

  return (
    <AuthFlowContext.Provider value={contextValue}>
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
              onDismiss={() => {
                markAccountSetupDismissed(token);
                setSetup((previous) =>
                  previous ? { ...previous, open: false } : null,
                );
              }}
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
              notified={setup.lp?.notify_on_review ?? false}
              onNotifyMe={subscribeToReview}
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
