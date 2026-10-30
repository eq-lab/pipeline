// spec: docs/frontend/auth-components.md#authflowprovider
import { useContext, useEffect, useRef, useState } from "react";
import { ApiError, getMyLp, linkMyAddress } from "@/api";
import type { LpResponse } from "@/api";
import {
  settlementWritable,
  type SettlementLinkState,
} from "@/components/account/settlementAddress";
import { ToastContext } from "@/lib/toast/useToast";
import { useStellarWallet } from "@/wallet";
import { readSession } from "./session";

interface Args {
  token: string | undefined;
  lp: LpResponse | null;
  lpLoaded: boolean;
  onLp: (lp: LpResponse) => void;
}

export function useSettlementAddressLink({
  token,
  lp,
  lpLoaded,
  onLp,
}: Args): SettlementLinkState {
  const { address, isConnected } = useStellarWallet();
  const toast = useContext(ToastContext);
  const [state, setState] = useState<SettlementLinkState>("idle");
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);
  const attempted = useRef<{ token: string | undefined; keys: Set<string> }>({
    token,
    keys: new Set(),
  });
  const latest = useRef({ onLp, toast });
  latest.current = { onLp, toast };

  const connected = isConnected && address ? address : null;

  useEffect(() => {
    if (!inFlight.current) setState("idle");
  }, [token, connected]);

  useEffect(() => {
    if (attempted.current.token !== token)
      attempted.current = { token, keys: new Set() };
    if (!token || !lpLoaded || !lp || !connected) return;
    if (lp.stellar_address === connected || !settlementWritable(lp)) return;
    if (inFlight.current) return;
    const key = `${lp.id}:${connected}`;
    if (attempted.current.keys.has(key)) return;
    attempted.current.keys.add(key);
    inFlight.current = true;
    setState("linking");
    const finish = (next: SettlementLinkState) => {
      inFlight.current = false;
      setState(next);
      setTick((value) => value + 1);
    };
    const showError = (error: unknown) => {
      latest.current.toast?.show({
        tone: "danger",
        title:
          error instanceof ApiError && error.message
            ? error.message
            : "Your wallet could not be linked.",
      });
    };
    void (async () => {
      try {
        const linked = await linkMyAddress(connected);
        if (readSession()?.token !== token) return finish("idle");
        latest.current.onLp(linked);
        finish("idle");
      } catch (error) {
        if (readSession()?.token !== token) return finish("idle");
        showError(error);
        if (error instanceof ApiError && error.status === 409) {
          try {
            const refreshed = await getMyLp();
            if (readSession()?.token !== token) return finish("idle");
            latest.current.onLp(refreshed);
            finish(settlementWritable(refreshed) ? "taken" : "idle");
          } catch {
            finish("taken");
          }
          return;
        }
        finish("error");
      }
    })();
  }, [token, lp, lpLoaded, connected, tick]);

  return state;
}
