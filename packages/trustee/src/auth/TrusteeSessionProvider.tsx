/**
 * TrusteeSessionProvider — orchestrates the #791 sign-in flow and exposes
 * `useTrusteeSession()` to the rest of the app.
 *
 * Flow (see docs/exec-plans/active/issue-791-trustee-sign-in-flow.md, step 6):
 *   1. `signIn()` sets `status = "connecting"` and opens the wallet-connect
 *      modal (`useConnectModal().open()`). This component then watches the
 *      EVM/Stellar wallet hooks reactively — whichever chain the user
 *      connects on triggers the rest of the flow with that wallet's address
 *      and chain id.
 *   2. `GET /v1/auth/challenge?address=&chain_id=`. A `401` means the address
 *      is not on the server allow-list → `status = "unauthorized"` with an
 *      explanatory error; the flow stops there (no client-side role read —
 *      authorization is entirely server-side).
 *   3. The connected wallet signs the returned `message` (EVM `personal_sign`
 *      hex / Stellar SEP-0053 base64, both via `@pipeline/wallet-connect`'s
 *      `signMessage`). If the user rejects the signature, the flow returns to
 *      `unauthenticated` silently (not an error — a user choice).
 *   4. `POST /v1/auth/verify { chain_id, address, signature }`. On success the
 *      token is stored (`sessionStore`, sessionStorage-backed) and the caller
 *      is redirected to `/`. A `401` here is rare (nonce race / signature
 *      mismatch) and surfaces as a verification-failed error.
 *
 * `signOut()` clears the stored token and disconnects the wallet — there is
 * no server logout endpoint (bearer-token transport, see the exec plan's
 * Decision Log), so sign-out is purely client-side.
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

export function TrusteeSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionState = useSessionState();
  const evmWallet = useEvmWallet();
  const stellarWallet = useStellarWallet();
  const { open: openConnectModal } = useConnectModal();
  const navigate = useNavigate();

  // Guards against re-running the challenge/verify orchestration more than
  // once for the same connect (e.g. re-renders while awaiting the backend).
  const orchestratingRef = useRef(false);

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
      } catch {
        // User rejected the signature (or the wallet errored) — not a hard
        // error, just return to unauthenticated silently.
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
        void navigate({ to: "/" });
      } catch {
        // A 401 here is rare on the happy path (nonce expired / signature
        // mismatch / already consumed) — unlike the challenge step, a 401
        // from /v1/auth/verify does not distinguish "unknown address" from
        // "bad signature", so it is always framed as a verification failure
        // rather than repeating the "not authorized" copy.
        setSessionStatus(
          "unauthorized",
          "Sign-in verification failed. Please try again.",
        );
      }
    },
    [navigate],
  );

  // Reactively watch for a wallet connection while a sign-in is in progress.
  // The connect modal resolves asynchronously via wagmi / the Stellar kit's
  // own callbacks, so rather than coupling this provider to those internals,
  // it watches the already-reactive `useEvmWallet()` / `useStellarWallet()`
  // state and picks up whichever chain the user connected on.
  useEffect(() => {
    if (sessionState.status !== "connecting") return;
    if (orchestratingRef.current) return;

    if (evmWallet.isConnected && evmWallet.address) {
      orchestratingRef.current = true;
      void runSignIn(
        evmWallet.address,
        ENV.EVM_CHAIN_ID,
        evmWallet.signMessage,
      ).finally(() => {
        orchestratingRef.current = false;
      });
      return;
    }

    if (stellarWallet.isConnected && stellarWallet.address) {
      orchestratingRef.current = true;
      void runSignIn(
        stellarWallet.address,
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

  const signIn = useCallback(() => {
    setSessionStatus("connecting");
    openConnectModal();
  }, [openConnectModal]);

  const signOut = useCallback(() => {
    setSession(undefined);
    if (evmWallet.isConnected) evmWallet.disconnect();
    if (stellarWallet.isConnected) stellarWallet.disconnect();
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
