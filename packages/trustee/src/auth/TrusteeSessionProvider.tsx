/**
 * TrusteeSessionProvider — orchestrates the #791 sign-in flow and exposes
 * `useTrusteeSession()` to the rest of the app.
 *
 * Flow (see docs/exec-plans/active/issue-791-trustee-sign-in-flow.md, step 6):
 *   1. `signIn()` ALWAYS sets `status = "connecting"` and opens the
 *      wallet-connect modal (`useConnectModal().open()`) — this is a
 *      separate app with its own explicit login, so sign-in must always be
 *      driven by the user's deliberate pick in the modal, never by ambient
 *      wallet state (#795: wagmi auto-reconnects a persisted EVM session on
 *      page load, which used to hijack `signIn()` into signing that wallet
 *      directly and skipping the modal — Freighter/Soroban was never
 *      offered). Once the user picks a chain (`onModalWalletSelect`), that
 *      chain becomes the sole driver of the rest of the flow: if it's
 *      already connected, sign-in runs immediately; otherwise the watch
 *      effect below runs it once that specific chain connects. A wallet on
 *      the *other* chain connecting (or already being connected) never
 *      triggers sign-in. If the modal is dismissed with no wallet chosen,
 *      `onCancel` resets `status` back to `unauthenticated` (#793 — no more
 *      stuck "Connecting…").
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
  const {
    open: openConnectModal,
    onCancel: onModalCancel,
    onWalletSelect: onModalWalletSelect,
  } = useConnectModal();
  const navigate = useNavigate();

  // Guards against re-running the challenge/verify orchestration more than
  // once for the same connect (e.g. re-renders while awaiting the backend).
  const orchestratingRef = useRef(false);

  // (#795) Which chain to drive the sign-in with — set ONLY by the user's
  // explicit pick in the modal (`onModalWalletSelect`), never inferred from
  // ambient wallet state. "undecided" until the user picks a row; the watch
  // effect below stays inert until this is a concrete chain.
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
  // state.
  //
  // (#795) This only ever acts for the chain the user explicitly picked in
  // the modal (`preferredChainRef`, set by `onModalWalletSelect`). There is
  // deliberately NO "whichever connects first" fallback for the "undecided"
  // case — wagmi auto-reconnects a persisted EVM session on page load, so an
  // ambient/already-connected wallet must never be treated as the user's
  // choice. Until the user picks a row, this effect stays inert.
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

  // (#793) Reset the busy state when the modal is cancelled with no wallet
  // chosen — `onCancel` never fires for a wallet-row selection (see
  // `ConnectModalProvider`), so this can't race a real connect attempt.
  useEffect(() => {
    return onModalCancel(() => {
      preferredChainRef.current = "undecided";
      if (!orchestratingRef.current) {
        setSessionStatus("unauthenticated");
      }
    });
  }, [onModalCancel]);

  // (#794, tightened by #795) The ONLY place `preferredChainRef` is set: the
  // user explicitly picking a chain tab/row in the modal. Ambient connection
  // state (a wallet already connected, or auto-reconnected by wagmi on page
  // load) never sets it — see the watch effect above and `signIn()` below.
  // Recorded as a ref, so a plain re-render is enough for the watch effect to
  // pick it up for a wallet that connects (or reconnects) AFTER this fires.
  //
  // One case the watch effect alone can't cover: the user picks a wallet
  // that is ALREADY connected (e.g. a persisted Freighter session) — the
  // kit/wagmi treat reconnecting to the same address as a no-op, so no
  // `isConnected`/`address` change follows and no re-render would otherwise
  // pick it up. Kick off `runSignIn` directly here when that's the case —
  // this is still gated on the user's explicit pick, not ambient state.
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
        return;
      }

      if (
        preferred === "stellar" &&
        stellarWallet.isConnected &&
        stellarWallet.address
      ) {
        orchestratingRef.current = true;
        void runSignIn(
          stellarWallet.address,
          ENV.STELLAR_CHAIN_ID,
          stellarWallet.signMessage,
        ).finally(() => {
          orchestratingRef.current = false;
        });
      }
      // Otherwise the picked wallet is not connected yet (fresh connect) —
      // the watch effect above will pick it up once `isConnected`/`address`
      // update and trigger a re-render.
    });
  }, [
    onModalWalletSelect,
    evmWallet.isConnected,
    evmWallet.address,
    evmWallet.signMessage,
    stellarWallet.isConnected,
    stellarWallet.address,
    stellarWallet.signMessage,
    runSignIn,
  ]);

  // (#795) ALWAYS opens the modal — this is a separate app with its own
  // explicit login, so sign-in must always be an explicit connect+sign, never
  // driven by ambient wallet state. Previously this skipped the modal and
  // signed in directly when exactly one wallet was "already connected"
  // (#794), but wagmi auto-reconnects a persisted EVM session on page load,
  // so that ambient EVM connection would hijack every sign-in attempt — no
  // modal, a direct EVM sign that stalls, and Freighter/Soroban never
  // offered. `preferredChainRef` resets to "undecided" here; only the user's
  // explicit pick in the modal (`onModalWalletSelect`) can set it.
  const signIn = useCallback(() => {
    setSessionStatus("connecting");
    preferredChainRef.current = "undecided";
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
