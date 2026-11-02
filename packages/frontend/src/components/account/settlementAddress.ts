// spec: docs/frontend/account-page.md#settlement-address-1813
import type { LpResponse } from "@/api";
import type { LpReadState } from "@/components/homeState";

export type SettlementLinkState = "idle" | "linking" | "taken" | "error";

export interface SettlementRowView {
  address: string | null;
  caption: string | null;
  tone: "muted" | "negative";
}

export const SETTLEMENT_CAPTIONS = {
  linking: "Linking your connected wallet…",
  taken:
    "This wallet is already linked to another account. Connect a different Stellar wallet.",
  error: "Your wallet could not be linked. Reconnect it to try again.",
  fixedNotConnected:
    "Your settlement address is fixed. The connected wallet is not linked.",
  fixed: "Fixed once your entity passed verification.",
  linked: "Linked to your connected wallet.",
  pending: "Linked when you submit your company details.",
  needsStellar:
    "Bank-wire settlement needs a Stellar wallet. Connect one to name your settlement address.",
  connectStellar: "Connect a Stellar wallet to name your settlement address.",
} as const;

export function settlementWritable(lp: LpResponse): boolean {
  if (lp.kyb_status === "Failed") return false;
  return !(lp.kyb_status === "Passed" && lp.stellar_address !== null);
}

export interface SettlementRowInput {
  lpRead: LpReadState;
  lp: LpResponse | null;
  stellarAddress: string | null;
  evmConnected: boolean;
  link: SettlementLinkState;
}

export function deriveSettlementRow({
  lpRead,
  lp,
  stellarAddress,
  evmConnected,
  link,
}: SettlementRowInput): SettlementRowView {
  const served = lp?.stellar_address ?? null;
  if (link === "linking")
    return {
      address: stellarAddress ?? served,
      caption: SETTLEMENT_CAPTIONS.linking,
      tone: "muted",
    };
  if (link === "taken")
    return {
      address: served,
      caption: SETTLEMENT_CAPTIONS.taken,
      tone: "negative",
    };
  if (link === "error")
    return {
      address: served,
      caption: SETTLEMENT_CAPTIONS.error,
      tone: "negative",
    };
  if (served !== null) {
    if (lp?.kyb_status === "Passed")
      return {
        address: served,
        caption:
          stellarAddress !== null && stellarAddress !== served
            ? SETTLEMENT_CAPTIONS.fixedNotConnected
            : SETTLEMENT_CAPTIONS.fixed,
        tone: "muted",
      };
    return {
      address: served,
      caption: stellarAddress === served ? SETTLEMENT_CAPTIONS.linked : null,
      tone: "muted",
    };
  }
  if (lpRead !== "loaded" && stellarAddress !== null)
    return {
      address: stellarAddress,
      caption: SETTLEMENT_CAPTIONS.pending,
      tone: "muted",
    };
  if (stellarAddress !== null)
    return { address: null, caption: null, tone: "muted" };
  return {
    address: null,
    caption: evmConnected
      ? SETTLEMENT_CAPTIONS.needsStellar
      : SETTLEMENT_CAPTIONS.connectStellar,
    tone: "muted",
  };
}
