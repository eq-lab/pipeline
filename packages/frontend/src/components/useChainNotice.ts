// spec: docs/frontend/wallet-flows.md#wrong-network
import { useEffect } from "react";
import type { StepsCardNotice } from "@pipeline/ui";
import type { WrongNetworkInfo } from "@/wallet";
import { useToast } from "@/lib/toast";
import { toUserError } from "@/utils/userError";

const TOAST_ID = "evm-switch-chain";

export function useChainNotice(
  wrongNetwork: WrongNetworkInfo | undefined,
): StepsCardNotice | undefined {
  const toast = useToast();
  const switchError = wrongNetwork?.switchError ?? null;

  useEffect(() => {
    if (!switchError) return;
    const mapped = toUserError(switchError);
    toast.show({
      id: TOAST_ID,
      tone: "danger",
      title: mapped.isSpecific ? mapped.message : "Could not switch network",
    });
  }, [switchError, toast]);

  if (!wrongNetwork) return undefined;
  return {
    label: `Switch your wallet to ${wrongNetwork.chainName}`,
    actionLabel: "Switch",
    onAction: wrongNetwork.switchNetwork,
    loading: wrongNetwork.isSwitching,
  };
}
