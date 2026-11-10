// spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100 (Target chain).
import { ENV } from "@/lib/env";
import { SAC_DECIMALS } from "@/utils/stellarSacUnits";

export interface TargetChainOption {
  id: number;
  label: string;
}

const EVM_CHAIN_NAMES: Readonly<Record<number, string>> = {
  1: "Ethereum",
  560048: "Hoodi",
};

export const TARGET_CHAINS: ReadonlyArray<TargetChainOption> = [
  { id: ENV.STELLAR_CHAIN_ID, label: "Stellar" },
  {
    id: ENV.EVM_CHAIN_ID,
    label: EVM_CHAIN_NAMES[ENV.EVM_CHAIN_ID] ?? `EVM chain ${ENV.EVM_CHAIN_ID}`,
  },
];

export const DEFAULT_TARGET_CHAIN_ID: number = ENV.STELLAR_CHAIN_ID;

export function targetChainLabel(chainId: number | null | undefined): string {
  if (chainId == null) return "—";
  return (
    TARGET_CHAINS.find((chain) => chain.id === chainId)?.label ??
    `Chain ${chainId}`
  );
}

export function isStellarTarget(chainId: number | null | undefined): boolean {
  return chainId == null || chainId === ENV.STELLAR_CHAIN_ID;
}

export function stellarOnlyActionReason(
  chainId: number | null | undefined,
): string | null {
  if (isStellarTarget(chainId)) return null;
  return `On-chain actions run on Stellar only — this loan lives on ${targetChainLabel(chainId)}, and signing them from the Trustee app is not supported yet.`;
}

export const EVM_USDC_DECIMALS = 6;

export function chainAmountDecimals(
  chainId: number | null | undefined,
): number {
  return isStellarTarget(chainId) ? SAC_DECIMALS : EVM_USDC_DECIMALS;
}

export interface ServedTargetChains {
  options: ReadonlyArray<TargetChainOption>;
  defaultChainId: number | null;
  isLoading: boolean;
}

export function servedTargetChains(
  status: "pending" | "error" | "success",
  data:
    | { chains: { chain_id: number }[]; default_chain_id: number }
    | undefined,
): ServedTargetChains {
  if (status === "error") {
    return {
      options: TARGET_CHAINS,
      defaultChainId: DEFAULT_TARGET_CHAIN_ID,
      isLoading: false,
    };
  }
  if (status === "pending" || data === undefined) {
    return { options: [], defaultChainId: null, isLoading: true };
  }
  const options = TARGET_CHAINS.filter((chain) =>
    data.chains.some((served) => served.chain_id === chain.id),
  );
  const defaultChainId = options.some((o) => o.id === data.default_chain_id)
    ? data.default_chain_id
    : (options[0]?.id ?? null);
  return { options, defaultChainId, isLoading: false };
}
