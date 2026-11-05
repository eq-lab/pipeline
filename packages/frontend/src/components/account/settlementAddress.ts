// spec: docs/frontend/account-page.md#settlement-address
import type { LpResponse } from "@/api";
import type { LpReadState } from "@/components/homeState";
import { isStellarSettlementAddress } from "@/wallet";
import { walletPrecedence } from "@/wallet/walletPrecedence";

export type SettlementKind = "stellar" | "evm";

export interface ConnectedWallet {
  kind: SettlementKind;
  address: string;
}

export type SettlementPhase =
  | "idle"
  | "editing"
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
  mode: "wallet" | "other";
}

export interface SettlementTarget {
  address: string;
  signer: string | null;
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
  signer: string | null;
  other: boolean;
  form: { current: string | null; signer: string; busy: boolean } | null;
}

export interface SettlementControls {
  rows: SettlementRowView[];
  onLink(kind: SettlementKind): void;
  onChange(kind: SettlementKind): void;
  onCancel(): void;
  onOther(kind: SettlementKind): void;
  onLinkOther(kind: SettlementKind, raw: string): void;
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
  linkingAddress: "Linking this address…",
  addressTaken:
    "This address is already linked to another account. Enter a different address.",
  addressError: "This address could not be linked. Try again.",
  linkedSigner: "Linked. Your connected wallet is the signer of this address.",
  otherHint: "Your connected wallet signs to link this address.",
} as const;

export const SETTLEMENT_FORM_COPY = {
  entry: "Use a different address",
  label: "New settlement address",
  current: "Current",
  signer: "Signer",
  submit: "Link address",
  cancel: "Cancel",
  placeholder: { stellar: "G… or C…", evm: "0x…" },
  invalid: {
    stellar: "Enter a Stellar address: G… or C…, 56 characters.",
    evm: "Enter an Ethereum address: 0x followed by 40 hexadecimal characters.",
  },
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
  const kind = walletPrecedence(evm, stellar);
  if (kind === null) return null;
  const address = (kind === "evm" ? evm : stellar).address;
  return address ? { kind, address } : null;
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
  return (
    (kind === "evm" ? lp.evm_signer_address : lp.stellar_signer_address) ?? null
  );
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
  if (!sameAddress(kind, served, connected.address)) {
    const signer = servedSigner(lp, kind);
    return signer !== null && sameAddress(kind, signer, connected.address)
      ? null
      : "change";
  }
  return servedSigner(lp, kind) === null ? "link" : null;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseSettlementInput(
  kind: SettlementKind,
  raw: string,
): { ok: true; address: string } | { ok: false; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: null };
  if (kind === "evm")
    return EVM_ADDRESS.test(trimmed)
      ? { ok: true, address: trimmed }
      : { ok: false, error: SETTLEMENT_FORM_COPY.invalid.evm };
  const address = trimmed.toUpperCase();
  return isStellarSettlementAddress(address)
    ? { ok: true, address }
    : { ok: false, error: SETTLEMENT_FORM_COPY.invalid.stellar };
}

export function otherTarget(
  kind: SettlementKind,
  address: string,
  connected: ConnectedWallet,
): SettlementTarget {
  if (sameAddress(kind, address, connected.address))
    return { address, signer: null };
  return {
    address,
    signer:
      kind === "evm" ? connected.address.toLowerCase() : connected.address,
  };
}

export function otherAllowed(
  lp: LpResponse | null,
  kind: SettlementKind,
  connected: ConnectedWallet | null,
): boolean {
  return lp !== null && settlementWritable(lp) && connected?.kind === kind;
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
        signer: null,
        other: false,
        form: null,
      },
    ];
  return kinds.map((kind) => {
    const s = servedAddress(lp, kind);
    const c = connected?.kind === kind ? connected.address : null;
    const base = baseAction(lp, kind, connected);
    const servedSignerValue = servedSigner(lp, kind);
    const signer =
      s !== null &&
      servedSignerValue !== null &&
      !sameAddress(kind, servedSignerValue, s)
        ? servedSignerValue
        : null;
    const canOther = otherAllowed(lp, kind, connected);
    const row = (
      caption: string | null,
      tone: "muted" | "negative",
      action: SettlementAction | null,
      extra: Partial<SettlementRowView> = {},
    ): SettlementRowView => {
      const view: SettlementRowView = {
        kind,
        label: SETTLEMENT_LABELS[kind],
        address: s,
        caption,
        tone,
        action,
        confirm: null,
        busy: false,
        signer,
        other: false,
        form: null,
        ...extra,
      };
      view.other =
        canOther && !view.busy && view.confirm === null && view.form === null;
      return view;
    };
    if (link.kind === kind && link.mode === "other" && c !== null) {
      const busy =
        link.phase === "requesting" ||
        link.phase === "signing" ||
        link.phase === "verifying";
      const form = { current: s, signer: c, busy };
      const phaseCaption = (
        text: string,
        tone: "muted" | "negative" = "muted",
      ) => row(text, tone, null, { busy, form });
      switch (link.phase) {
        case "requesting":
        case "verifying":
          return phaseCaption(SETTLEMENT_CAPTIONS.linkingAddress);
        case "signing":
          return phaseCaption(SETTLEMENT_CAPTIONS.signing);
        case "declined":
          return phaseCaption(SETTLEMENT_CAPTIONS.declined);
        case "proofFailed":
          return phaseCaption(SETTLEMENT_CAPTIONS.proofFailed, "negative");
        case "taken":
          return phaseCaption(SETTLEMENT_CAPTIONS.addressTaken, "negative");
        case "error":
          return phaseCaption(SETTLEMENT_CAPTIONS.addressError, "negative");
        case "editing":
          return phaseCaption(
            s !== null
              ? SETTLEMENT_CAPTIONS.confirm
              : SETTLEMENT_CAPTIONS.otherHint,
          );
        default:
          break;
      }
    }
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
      if (
        c !== null &&
        servedSignerValue !== null &&
        sameAddress(kind, servedSignerValue, c)
      )
        return row(SETTLEMENT_CAPTIONS.linkedSigner, "muted", null);
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
