// spec: docs/frontend/account-page.md#settlement-address
import type { LpResponse } from "@/api";
import type { LpReadState } from "@/components/homeState";

export type SettlementKind = "stellar" | "evm";

export interface ConnectedWallet {
  kind: SettlementKind;
  address: string;
}

export type SettlementPhase =
  | "idle"
  | "confirming"
  | "requesting"
  | "signing"
  | "verifying"
  | "declined"
  | "proofFailed"
  | "taken"
  | "error";

export interface SettlementLinkState {
  kind: SettlementKind | null;
  phase: SettlementPhase;
}

export type SettlementAction = "link" | "change" | "retry";

export interface SettlementRowView {
  kind: SettlementKind | null;
  label: string;
  address: string | null;
  caption: string | null;
  tone: "muted" | "negative";
  action: SettlementAction | null;
  confirm: { from: string; to: string } | null;
  busy: boolean;
}

export interface SettlementControls {
  rows: SettlementRowView[];
  onLink(kind: SettlementKind): void;
  onChange(kind: SettlementKind): void;
  onCancel(): void;
}

export const SETTLEMENT_LABELS = {
  stellar: "Stellar settlement address",
  evm: "Ethereum settlement address",
  none: "Settlement address",
} as const;

export const SETTLEMENT_CAPTIONS = {
  linking: "Linking your connected wallet…",
  signing: "Approve the signature request in your wallet.",
  confirm: "Deposits processed after the change are minted to the new address.",
  declined: "Your wallet did not sign. Nothing was changed.",
  proofFailed:
    "The signature could not be verified. Try again to sign a new request.",
  taken:
    "This wallet is already linked to another account. Connect a different wallet.",
  error: "Your wallet could not be linked. Try again.",
  linked: "Linked to your connected wallet.",
  unproven:
    "Linked without a signature. Sign with this wallet to confirm you control it.",
  different: "Your connected wallet is not this address.",
  notLinked: "Link your connected wallet to receive bank deposits to it.",
  needsLp: "Save your company details first, then link this wallet.",
  connect: "Connect a wallet to name your settlement address.",
} as const;

export const SETTLEMENT_ACTION_LABELS: Record<SettlementAction, string> = {
  link: "Link wallet",
  change: "Change wallet",
  retry: "Try again",
};

interface WalletLike {
  isConnected: boolean;
  address: string | undefined;
}

const KINDS: SettlementKind[] = ["stellar", "evm"];

export function connectedWallet(
  evm: WalletLike,
  stellar: WalletLike,
): ConnectedWallet | null {
  if (evm.isConnected && evm.address)
    return { kind: "evm", address: evm.address };
  if (stellar.isConnected && stellar.address)
    return { kind: "stellar", address: stellar.address };
  return null;
}

export function servedAddress(
  lp: LpResponse | null,
  kind: SettlementKind,
): string | null {
  if (!lp) return null;
  return kind === "evm" ? lp.evm_address : lp.stellar_address;
}

export function servedSigner(
  lp: LpResponse | null,
  kind: SettlementKind,
): string | null {
  if (!lp) return null;
  return kind === "evm" ? lp.evm_signer_address : lp.stellar_signer_address;
}

export function sameAddress(
  kind: SettlementKind,
  a: string,
  b: string,
): boolean {
  return kind === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function settlementWritable(lp: LpResponse): boolean {
  return lp.kyb_status !== "Failed";
}

export function baseAction(
  lp: LpResponse | null,
  kind: SettlementKind,
  connected: ConnectedWallet | null,
): "link" | "change" | null {
  if (!lp || !settlementWritable(lp) || connected?.kind !== kind) return null;
  const served = servedAddress(lp, kind);
  if (served === null) return "link";
  if (!sameAddress(kind, served, connected.address)) return "change";
  return servedSigner(lp, kind) === null ? "link" : null;
}

export interface SettlementRowsInput {
  lpRead: LpReadState;
  lp: LpResponse | null;
  connected: ConnectedWallet | null;
  link: SettlementLinkState;
}

export function deriveSettlementRows({
  lpRead,
  lp,
  connected,
  link,
}: SettlementRowsInput): SettlementRowView[] {
  const kinds = KINDS.filter(
    (kind) => servedAddress(lp, kind) !== null || connected?.kind === kind,
  );
  if (kinds.length === 0)
    return [
      {
        kind: null,
        label: SETTLEMENT_LABELS.none,
        address: null,
        caption: SETTLEMENT_CAPTIONS.connect,
        tone: "muted",
        action: null,
        confirm: null,
        busy: false,
      },
    ];
  return kinds.map((kind) => {
    const s = servedAddress(lp, kind);
    const c = connected?.kind === kind ? connected.address : null;
    const base = baseAction(lp, kind, connected);
    const row = (
      caption: string | null,
      tone: "muted" | "negative",
      action: SettlementAction | null,
      extra: Partial<SettlementRowView> = {},
    ): SettlementRowView => ({
      kind,
      label: SETTLEMENT_LABELS[kind],
      address: s,
      caption,
      tone,
      action,
      confirm: null,
      busy: false,
      ...extra,
    });
    if (link.kind === kind) {
      switch (link.phase) {
        case "requesting":
        case "verifying":
          return row(SETTLEMENT_CAPTIONS.linking, "muted", null, {
            busy: true,
          });
        case "signing":
          return row(SETTLEMENT_CAPTIONS.signing, "muted", null, {
            busy: true,
          });
        case "confirming":
          if (base === "change" && s !== null && c !== null)
            return row(SETTLEMENT_CAPTIONS.confirm, "muted", null, {
              confirm: { from: s, to: c },
            });
          break;
        case "declined":
          return row(SETTLEMENT_CAPTIONS.declined, "muted", base);
        case "proofFailed":
          return row(
            SETTLEMENT_CAPTIONS.proofFailed,
            "negative",
            base ? "retry" : null,
          );
        case "taken":
          return row(SETTLEMENT_CAPTIONS.taken, "negative", null);
        case "error":
          return row(
            SETTLEMENT_CAPTIONS.error,
            "negative",
            base ? "retry" : null,
          );
        default:
          break;
      }
    }
    if (s !== null) {
      if (c !== null && sameAddress(kind, s, c))
        return base === "link"
          ? row(SETTLEMENT_CAPTIONS.unproven, "muted", "link")
          : row(SETTLEMENT_CAPTIONS.linked, "muted", null);
      if (base === "change")
        return row(SETTLEMENT_CAPTIONS.different, "muted", "change");
      return row(null, "muted", null);
    }
    if (lp === null && lpRead === "absent")
      return row(SETTLEMENT_CAPTIONS.needsLp, "muted", null);
    if (base === "link")
      return row(SETTLEMENT_CAPTIONS.notLinked, "muted", "link");
    return row(null, "muted", null);
  });
}
