/**
 * TrusteeSessionProvider — orchestrates the #791 sign-in flow and exposes
 * `useTrusteeSession()` to the rest of the app.
 *
 * Flow (see docs/exec-plans/active/issue-791-trustee-sign-in-flow.md, step 6):
 *   1. `signIn()` sets `status = "connecting"` and either drives straight into
 *      step 2 (exactly one wallet is already connected — #794) or opens the
 *      wallet-connect modal (`useConnectModal().open()`). While the modal is
 *      open this component watches for the chain the user actually acts on —
 *      via `onWalletSelect` when more than one wallet is already connected,
 *      or reactively via the EVM/Stellar wallet hooks otherwise — and drives
 *      the rest of the flow with that wallet's address and chain id. If the
 *      modal is dismissed with no wallet chosen, `onCancel` resets `status`
 *      back to `unauthenticated` (#793 — no more stuck "Connecting…").
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

  // (#794) Which chain to drive the sign-in with:
  //   - "evm" / "stellar" — resolved, either because exactly one wallet was
  //     already connected when `signIn()` ran, or because the user picked a
  //     row in the modal (`onModalWalletSelect`).
  //   - "undecided" — neither wallet was connected when this sign-in attempt
  //     started. The watch effect below may safely auto-pick whichever chain
  //     connects first, since at most one CAN be connected in that case.
  //   - "ambiguous" — BOTH wallets were already connected when `signIn()`
  //     ran. Ambient state can't tell us which one the user means, so the
  //     watch effect's auto-pick fallback must stay disabled until
  //     `onModalWalletSelect` resolves it to a concrete chain.
  const preferredChainRef = useRef<
    "evm" | "stellar" | "undecided" | "ambiguous"
  >("undecided");

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
  // (#794) Which chain "wins" when both are connected is no longer a fixed
  // EVM-first preference — it defers to `preferredChainRef`, set either in
  // `signIn()` (exactly one wallet already connected) or by
  // `onModalWalletSelect` (the user explicitly picked a row). Only when
  // neither wallet was connected before this sign-in attempt AND the user
  // hasn't picked a row yet do we fall back to "whichever connects first" —
  // safe because in that case at most one CAN be connected at a time.
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
      return;
    }

    // No explicit preference yet — safe to pick up whichever chain connects
    // first, since this branch is only reached when neither was connected at
    // the start of this sign-in attempt (see `signIn()` / the preferred-chain
    // doc comment above). "ambiguous" (both already connected) deliberately
    // does NOT fall through here — it waits for `onModalWalletSelect`.
    if (preferred === "undecided") {
      if (evmReady) {
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

      if (stellarReady) {
        orchestratingRef.current = true;
        void runSignIn(
          stellarWallet.address!,
          ENV.STELLAR_CHAIN_ID,
          stellarWallet.signMessage,
        ).finally(() => {
          orchestratingRef.current = false;
        });
      }
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

  // (#794) Learn which chain the user actually picked in the modal, so a
  // pre-connected wallet on the *other* chain doesn't win by ambient-state
  // accident when both are already connected. Recorded as a ref, so a plain
  // re-render is enough for the watch effect above to pick it up for a
  // wallet that connects (or reconnects) AFTER this fires.
  //
  // One case the watch effect alone can't cover: the user re-picks a wallet
  // that was ALREADY connected before this sign-in attempt (both chains
  // pre-connected, user clicks the row for the one that's already theirs).
  // The kit/wagmi treat reconnecting to the same address as a no-op — no
  // `isConnected`/`address` change, so no re-render would otherwise follow.
  // Kick off `runSignIn` directly here when that's the case.
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

  const signIn = useCallback(() => {
    setSessionStatus("connecting");

    const evmReady = evmWallet.isConnected && !!evmWallet.address;
    const stellarReady = stellarWallet.isConnected && !!stellarWallet.address;

    // (#794) Exactly one wallet already connected — sign in with it directly,
    // without opening the modal (no ambiguity, nothing to race).
    if (evmReady && !stellarReady) {
      preferredChainRef.current = "evm";
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

    if (stellarReady && !evmReady) {
      preferredChainRef.current = "stellar";
      orchestratingRef.current = true;
      void runSignIn(
        stellarWallet.address!,
        ENV.STELLAR_CHAIN_ID,
        stellarWallet.signMessage,
      ).finally(() => {
        orchestratingRef.current = false;
      });
      return;
    }

    // Neither connected, or both connected — open the picker so the user
    // makes (or re-confirms) an explicit chain choice.
    //   - Both connected: genuinely ambiguous — only `onModalWalletSelect`
    //     may resolve `preferredChainRef` from here (#794).
    //   - Neither connected: "undecided" lets the watch effect's
    //     first-to-connect fallback resolve it once a wallet connects.
    preferredChainRef.current =
      evmReady && stellarReady ? "ambiguous" : "undecided";
    openConnectModal();
  }, [
    openConnectModal,
    evmWallet.isConnected,
    evmWallet.address,
    evmWallet.signMessage,
    stellarWallet.isConnected,
    stellarWallet.address,
    stellarWallet.signMessage,
    runSignIn,
  ]);

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
