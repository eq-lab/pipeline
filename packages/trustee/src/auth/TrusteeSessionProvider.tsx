/**
 * TrusteeSessionProvider — orchestrates the sign-in flow (modal pick →
 * challenge → sign → verify → store) and exposes `useTrusteeSession()`.
 *
 * spec: docs/frontend/trustee-flows.md#session--auth (flow steps, explicit-pick
 * rule, error taxonomy, no-navigation invariant, signOut).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  useEvmWallet,
  useStellarWallet,
  useConnectModal,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { getAuthChallenge, postAuthVerify } from "@/api/auth";
import {
  useSessionState,
  setSession,
  setSessionStatus,
  type SessionState,
} from "./sessionStore";

export interface TrusteeSessionContextValue extends SessionState {
  signIn(): void;
  signOut(): void;
}

const TrusteeSessionContext = createContext<TrusteeSessionContextValue | null>(
  null,
);

export function useTrusteeSession(): TrusteeSessionContextValue {
  const ctx = useContext(TrusteeSessionContext);
  if (!ctx) {
    throw new Error(
      "useTrusteeSession() must be called within a TrusteeSessionProvider",
    );
  }
  return ctx;
}

function isNotAuthorized(err: unknown): boolean {
  return err instanceof Error && err.name === "ApiUnauthorizedError";
}

/** The kit's "wallet has no signMessage" rejection (`code: -3`, #1112). */
function isSignUnsupported(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return (
    code === -3 ||
    (typeof message === "string" &&
      /does not support .*signMessage/i.test(message))
  );
}

export function TrusteeSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionState = useSessionState();
  const evmWallet = useEvmWallet();
  const stellarWallet = useStellarWallet();
  const {
    open: openConnectModal,
    onCancel: onModalCancel,
    onWalletSelect: onModalWalletSelect,
  } = useConnectModal();
  const navigate = useNavigate();

  // Single-flight guard for the challenge/verify orchestration.
  const orchestratingRef = useRef(false);

  // Set ONLY by the user's explicit modal pick — never ambient wallet state
  // (#795). spec: trustee-flows.md#sign-in-flow-791-hardened-793794795.
  const preferredChainRef = useRef<"evm" | "stellar" | "undecided">(
    "undecided",
  );

  const runSignIn = useCallback(
    async (
      address: string,
      chainId: number,
      sign: (msg: string) => Promise<{ signature: string }>,
    ) => {
      let challenge;
      try {
        challenge = await getAuthChallenge(address, chainId);
      } catch (err) {
        setSessionStatus(
          "unauthorized",
          isNotAuthorized(err)
            ? "This wallet is not authorized to sign in. Contact your administrator."
            : "Could not reach the sign-in service. Please try again.",
        );
        return;
      }

      let signature: string;
      try {
        const result = await sign(challenge.message);
        signature = result.signature;
      } catch (err) {
        if (isSignUnsupported(err)) {
          setSessionStatus(
            "unauthorized",
            "This wallet cannot sign authentication messages. Use Freighter, xBull, or LOBSTR.",
          );
          return;
        }
        // Rejection is a user choice, not an error — silent (spec).
        setSessionStatus("unauthenticated");
        return;
      }

      try {
        const verified = await postAuthVerify({ chainId, address, signature });
        setSession({
          token: verified.token,
          address,
          chainId,
          expiresAt: Date.now() + verified.expiresIn * 1000,
        });
        // No navigation — the render-level gate swaps the UI (#1008).
      } catch {
        // A verify 401 can't distinguish unknown-address from bad-signature,
        // so it is framed as a verification failure, not "not authorized".
        setSessionStatus(
          "unauthorized",
          "Sign-in verification failed. Please try again.",
        );
      }
    },
    [],
  );

  // Watch effect: runs sign-in once the explicitly-picked chain connects.
  // Deliberately NO "whichever connects first" fallback (#795, spec).
  useEffect(() => {
    if (sessionState.status !== "connecting") return;
    if (orchestratingRef.current) return;

    const evmReady = evmWallet.isConnected && !!evmWallet.address;
    const stellarReady = stellarWallet.isConnected && !!stellarWallet.address;
    const preferred = preferredChainRef.current;

    if (preferred === "evm" && evmReady) {
      orchestratingRef.current = true;
      void runSignIn(
        evmWallet.address!,
        ENV.EVM_CHAIN_ID,
        evmWallet.signMessage,
      ).finally(() => {
        orchestratingRef.current = false;
      });
      return;
    }

    if (preferred === "stellar" && stellarReady) {
      orchestratingRef.current = true;
      void runSignIn(
        stellarWallet.address!,
        ENV.STELLAR_CHAIN_ID,
        stellarWallet.signMessage,
      ).finally(() => {
        orchestratingRef.current = false;
      });
    }
  }, [
    sessionState.status,
    evmWallet.isConnected,
    evmWallet.address,
    evmWallet.signMessage,
    stellarWallet.isConnected,
    stellarWallet.address,
    stellarWallet.signMessage,
    runSignIn,
  ]);

  // Modal cancelled with no pick → back to unauthenticated (#793). `onCancel`
  // never fires for a wallet-row selection, so this can't race a real connect.
  useEffect(() => {
    return onModalCancel(() => {
      preferredChainRef.current = "undecided";
      if (!orchestratingRef.current) {
        setSessionStatus("unauthenticated");
      }
    });
  }, [onModalCancel]);

  // The ONLY place `preferredChainRef` is set. EVM may direct-run when
  // already connected (#794); Stellar never does — the ambient address can be
  // a stale different-wallet hydration (#1106, spec: sign-in flow).
  useEffect(() => {
    return onModalWalletSelect((chain) => {
      const preferred = chain === "soroban" ? "stellar" : "evm";
      preferredChainRef.current = preferred;

      if (orchestratingRef.current) return;

      if (preferred === "evm" && evmWallet.isConnected && evmWallet.address) {
        orchestratingRef.current = true;
        void runSignIn(
          evmWallet.address,
          ENV.EVM_CHAIN_ID,
          evmWallet.signMessage,
        ).finally(() => {
          orchestratingRef.current = false;
        });
      }
      // Fresh connect: the watch effect picks it up once the chain connects.
    });
  }, [
    onModalWalletSelect,
    evmWallet.isConnected,
    evmWallet.address,
    evmWallet.signMessage,
    runSignIn,
  ]);

  // ALWAYS opens the modal — never sign an ambient/auto-reconnected wallet
  // (#795, spec).
  const signIn = useCallback(() => {
    setSessionStatus("connecting");
    preferredChainRef.current = "undecided";
    openConnectModal();
  }, [openConnectModal]);

  const signOut = useCallback(() => {
    setSession(undefined);
    if (evmWallet.isConnected) evmWallet.disconnect();
    if (stellarWallet.isConnected) stellarWallet.disconnect();
    // URL convention only — the overlay gate doesn't depend on it (#1008).
    void navigate({ to: "/sign-in" });
  }, [evmWallet, stellarWallet, navigate]);

  const value: TrusteeSessionContextValue = {
    ...sessionState,
    signIn,
    signOut,
  };

  return (
    <TrusteeSessionContext.Provider value={value}>
      {children}
    </TrusteeSessionContext.Provider>
  );
}
