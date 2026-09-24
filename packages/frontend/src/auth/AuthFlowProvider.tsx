// spec: docs/frontend/auth-components.md#authflowprovider
import React, { useCallback, useState } from "react";
import { AuthFlowContext } from "./AuthFlowContext";
import { EmailAuthFlow } from "@/components/EmailAuthFlow";
import type { EmailAuthScreen } from "@/components/useEmailAuthFlow";
import { useConnectModal } from "@/wallet";

export function AuthFlowProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState<EmailAuthScreen>("sign-in");
  const { open: openConnectModal } = useConnectModal();

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
    </AuthFlowContext.Provider>
  );
}
