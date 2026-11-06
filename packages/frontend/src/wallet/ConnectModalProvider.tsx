// spec: docs/frontend/wallet-flows.md#single-connected-wallet
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConnectModalContext } from "./ConnectModalContext";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { useWalletGate } from "./WalletGateContext";
import { readTermsAcknowledged } from "./useTermsAcknowledgement";
import { useWalletPresence } from "./useWalletPresence";
import heroUrl from "../assets/connect-hero-ship.webp?url";

function warmHeroImage() {
  const img = new Image();
  img.src = heroUrl;
}

export function ConnectModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { openGate } = useWalletGate();
  const { isAnyConnected, isConnectionPending } = useWalletPresence();
  const requestedWhilePending = useRef(false);

  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(warmHeroImage, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(warmHeroImage, 500);
    return () => clearTimeout(id);
  }, []);

  const openModal = useCallback(() => setIsOpen(true), []);

  const openNow = useCallback(() => {
    if (readTermsAcknowledged()) {
      openModal();
    } else {
      openGate(openModal);
    }
  }, [openGate, openModal]);

  const open = useCallback(() => {
    if (isAnyConnected) return;
    if (isConnectionPending) {
      requestedWhilePending.current = true;
      return;
    }
    openNow();
  }, [isAnyConnected, isConnectionPending, openNow]);

  useEffect(() => {
    if (isConnectionPending || !requestedWhilePending.current) return;
    requestedWhilePending.current = false;
    if (!isAnyConnected) openNow();
  }, [isConnectionPending, isAnyConnected, openNow]);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <ConnectModalContext.Provider value={{ open, close }}>
      {children}
      <ConnectWalletModal open={isOpen} onDismiss={close} />
    </ConnectModalContext.Provider>
  );
}
