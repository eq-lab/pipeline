// spec: docs/frontend/account-page.md#settlement-address
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getLinkAddressChallenge,
  getMyLp,
  verifyLinkAddress,
} from "@/api";
import type { LpResponse } from "@/api";
import {
  baseAction,
  connectedWallet,
  settlementWritable,
  type SettlementKind,
  type SettlementLinkState,
  type SettlementPhase,
} from "@/components/account/settlementAddress";
import { ENV } from "@/lib/env";
import { ToastContext } from "@/lib/toast/useToast";
import { useEvmWallet, useStellarWallet } from "@/wallet";
import { readSession } from "./session";

interface Args {
  token: string | undefined;
  lp: LpResponse | null;
  lpLoaded: boolean;
  onLp: (lp: LpResponse) => void;
}

export interface SettlementAddressLink {
  state: SettlementLinkState;
  link(kind: SettlementKind): void;
  beginChange(kind: SettlementKind): void;
  cancelChange(): void;
}

const IDLE: SettlementLinkState = { kind: null, phase: "idle" };

export function useSettlementAddressLink({
  token,
  lp,
  lpLoaded,
  onLp,
}: Args): SettlementAddressLink {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const toast = useContext(ToastContext);
  const [state, setState] = useState<SettlementLinkState>(IDLE);
  const inFlight = useRef(false);
  const connected = connectedWallet(evm, stellar);
  const latest = useRef({
    token,
    lp,
    lpLoaded,
    onLp,
    toast,
    connected,
    evm,
    stellar,
  });
  latest.current = {
    token,
    lp,
    lpLoaded,
    onLp,
    toast,
    connected,
    evm,
    stellar,
  };

  useEffect(() => {
    if (!inFlight.current) setState(IDLE);
  }, [token, connected?.kind, connected?.address]);

  const beginChange = useCallback((kind: SettlementKind) => {
    const { lp: current, connected: wallet } = latest.current;
    if (inFlight.current || baseAction(current, kind, wallet) !== "change")
      return;
    setState({ kind, phase: "confirming" });
  }, []);

  const cancelChange = useCallback(() => {
    if (!inFlight.current) setState(IDLE);
  }, []);

  const link = useCallback((kind: SettlementKind) => {
    const {
      token: sessionToken,
      lp: current,
      lpLoaded: loaded,
      connected: wallet,
    } = latest.current;
    if (inFlight.current || !sessionToken || !loaded || !current) return;
    if (!wallet || baseAction(current, kind, wallet) === null) return;
    inFlight.current = true;
    setState({ kind, phase: "requesting" });
    const chainId = kind === "evm" ? ENV.EVM_CHAIN_ID : ENV.STELLAR_CHAIN_ID;
    const address =
      kind === "evm" ? wallet.address.toLowerCase() : wallet.address;
    const stale = () => readSession()?.token !== sessionToken;
    const finish = (phase: SettlementPhase) => {
      inFlight.current = false;
      setState(phase === "idle" ? IDLE : { kind, phase });
    };
    const fail = async (error: unknown) => {
      if (stale()) return finish("idle");
      if (error instanceof ApiError && error.status === 422)
        return finish("proofFailed");
      latest.current.toast?.show({
        tone: "danger",
        title:
          error instanceof ApiError && error.message
            ? error.message
            : "Your wallet could not be linked.",
      });
      if (error instanceof ApiError && error.status === 409) {
        try {
          const refreshed = await getMyLp();
          if (stale()) return finish("idle");
          latest.current.onLp(refreshed);
          return finish(settlementWritable(refreshed) ? "taken" : "idle");
        } catch {
          return finish("taken");
        }
      }
      finish("error");
    };
    void (async () => {
      let message: string;
      try {
        ({ message } = await getLinkAddressChallenge(chainId, address));
      } catch (error) {
        return fail(error);
      }
      if (stale()) return finish("idle");
      setState({ kind, phase: "signing" });
      let signature: string;
      try {
        const signer =
          kind === "evm" ? latest.current.evm : latest.current.stellar;
        ({ signature } = await signer.signMessage(message));
      } catch {
        return finish(stale() ? "idle" : "declined");
      }
      if (stale()) return finish("idle");
      setState({ kind, phase: "verifying" });
      try {
        const linked = await verifyLinkAddress({
          chain_id: chainId,
          address,
          signature,
        });
        if (stale()) return finish("idle");
        latest.current.onLp(linked);
        finish("idle");
      } catch (error) {
        return fail(error);
      }
    })();
  }, []);

  return { state, link, beginChange, cancelChange };
}
