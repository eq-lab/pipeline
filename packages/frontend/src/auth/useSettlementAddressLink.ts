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
  otherAllowed,
  otherTarget,
  parseSettlementInput,
  settlementWritable,
  type ConnectedWallet,
  type SettlementKind,
  type SettlementLinkState,
  type SettlementPhase,
  type SettlementTarget,
} from "@/components/account/settlementAddress";
import { ENV } from "@/lib/env";
import { ToastContext } from "@/lib/toast/useToast";
import {
  useConnectModal,
  useEvmSignMessage,
  useEvmWallet,
  useStellarWallet,
} from "@/wallet";
import { readSession } from "./session";

interface Args {
  token: string | undefined;
  lp: LpResponse | null;
  lpLoaded: boolean;
  onLp: (lp: LpResponse) => void;
}

export interface SettlementAddressLink {
  state: SettlementLinkState;
  connected: ConnectedWallet | null;
  armConnectLink(): void;
  link(kind: SettlementKind): void;
  beginChange(kind: SettlementKind): void;
  cancelChange(): void;
  beginOther(kind: SettlementKind): void;
  linkOther(kind: SettlementKind, raw: string): void;
}

const IDLE: SettlementLinkState = { kind: null, phase: "idle", mode: "wallet" };

export function useSettlementAddressLink({
  token,
  lp,
  lpLoaded,
  onLp,
}: Args): SettlementAddressLink {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const evmSigner = useEvmSignMessage();
  const toast = useContext(ToastContext);
  const { onCancel: onConnectCancel } = useConnectModal();
  const [state, setState] = useState<SettlementLinkState>(IDLE);
  const inFlight = useRef(false);
  const pendingConnect = useRef<string | null>(null);
  const connected = connectedWallet(evm, stellar);
  const snapshot = {
    token,
    lp,
    lpLoaded,
    onLp,
    toast,
    connected,
    evmSigner,
    stellar,
  };
  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    if (!inFlight.current) setState(IDLE);
  }, [token, connected?.kind, connected?.address]);

  const armConnectLink = useCallback(() => {
    const { token: sessionToken, connected: wallet } = latest.current;
    if (sessionToken && !wallet) pendingConnect.current = sessionToken;
  }, []);

  useEffect(
    () =>
      onConnectCancel(() => {
        pendingConnect.current = null;
      }),
    [onConnectCancel],
  );

  const beginChange = useCallback((kind: SettlementKind) => {
    const { lp: current, connected: wallet } = latest.current;
    if (inFlight.current || baseAction(current, kind, wallet) !== "change")
      return;
    setState({ kind, phase: "confirming", mode: "wallet" });
  }, []);

  const cancelChange = useCallback(() => {
    if (!inFlight.current) setState(IDLE);
  }, []);

  const run = useCallback(
    (
      kind: SettlementKind,
      mode: "wallet" | "other",
      target: SettlementTarget,
      wallet: ConnectedWallet,
      sessionToken: string,
    ) => {
      inFlight.current = true;
      setState({ kind, phase: "requesting", mode });
      const chainId = kind === "evm" ? ENV.EVM_CHAIN_ID : ENV.STELLAR_CHAIN_ID;
      const stale = () =>
        readSession()?.token !== sessionToken ||
        latest.current.connected?.kind !== kind ||
        latest.current.connected?.address !== wallet.address;
      const finish = (phase: SettlementPhase) => {
        inFlight.current = false;
        setState(phase === "idle" ? IDLE : { kind, phase, mode });
      };
      const failureTitle =
        mode === "other"
          ? "This address could not be linked."
          : "Your wallet could not be linked.";
      const fail = async (error: unknown) => {
        if (stale()) return finish("idle");
        if (error instanceof ApiError && error.status === 422)
          return finish("proofFailed");
        latest.current.toast?.show({
          tone: "danger",
          title:
            error instanceof ApiError && error.message
              ? error.message
              : failureTitle,
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
        try {
          const refreshed = await getMyLp();
          if (stale()) return finish("idle");
          latest.current.onLp(refreshed);
        } catch {
          if (stale()) return finish("idle");
        }
        finish("error");
      };
      void (async () => {
        let message: string;
        try {
          ({ message } = await getLinkAddressChallenge(
            chainId,
            target.address,
            target.signer,
          ));
        } catch (error) {
          return fail(error);
        }
        if (stale()) return finish("idle");
        setState({ kind, phase: "signing", mode });
        let signature: string;
        try {
          const signer =
            kind === "evm" ? latest.current.evmSigner : latest.current.stellar;
          ({ signature } = await signer.signMessage(message, wallet.address));
        } catch {
          return finish(stale() ? "idle" : "declined");
        }
        if (stale()) return finish("idle");
        setState({ kind, phase: "verifying", mode });
        try {
          const linked = await verifyLinkAddress({
            chain_id: chainId,
            address: target.address,
            ...(target.signer ? { signer_address: target.signer } : {}),
            signature,
          });
          if (stale()) return finish("idle");
          latest.current.onLp(linked);
          finish("idle");
        } catch (error) {
          return fail(error);
        }
      })();
    },
    [],
  );

  const link = useCallback(
    (kind: SettlementKind) => {
      const {
        token: sessionToken,
        lp: current,
        lpLoaded: loaded,
        connected: wallet,
      } = latest.current;
      if (inFlight.current || !sessionToken || !loaded || !current) return;
      if (!wallet || baseAction(current, kind, wallet) === null) return;
      const address =
        kind === "evm" ? wallet.address.toLowerCase() : wallet.address;
      run(kind, "wallet", { address, signer: null }, wallet, sessionToken);
    },
    [run],
  );

  useEffect(() => {
    if (pendingConnect.current === null) return;
    if (pendingConnect.current !== token) {
      pendingConnect.current = null;
      return;
    }
    if (!connected || !lpLoaded || !lp) return;
    pendingConnect.current = null;
    const action = baseAction(lp, connected.kind, connected);
    if (action === "link") link(connected.kind);
    else if (action === "change") beginChange(connected.kind);
  }, [token, lpLoaded, lp, connected, link, beginChange]);

  const beginOther = useCallback((kind: SettlementKind) => {
    const { lp: current, connected: wallet } = latest.current;
    if (inFlight.current || !otherAllowed(current, kind, wallet)) return;
    setState({ kind, phase: "editing", mode: "other" });
  }, []);

  const linkOther = useCallback(
    (kind: SettlementKind, raw: string) => {
      const {
        token: sessionToken,
        lp: current,
        lpLoaded: loaded,
        connected: wallet,
      } = latest.current;
      if (inFlight.current || !sessionToken || !loaded || !current) return;
      if (!wallet || !otherAllowed(current, kind, wallet)) return;
      const parsed = parseSettlementInput(kind, raw);
      if (!parsed.ok) return;
      run(
        kind,
        "other",
        otherTarget(kind, parsed.address, wallet),
        wallet,
        sessionToken,
      );
    },
    [run],
  );

  return {
    state,
    connected,
    armConnectLink,
    link,
    beginChange,
    cancelChange,
    beginOther,
    linkOther,
  };
}
