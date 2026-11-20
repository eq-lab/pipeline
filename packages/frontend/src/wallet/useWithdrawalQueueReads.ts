// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { SAC_DECIMALS } from "./stellar/useStellarSacToken";
import {
  useStellarWithdrawalQueueTotals,
  useStellarWithdrawalRequestQueueState,
} from "./stellar/useStellarWithdrawalQueueReads";
import {
  useEvmWithdrawalQueueTotals,
  useEvmWithdrawalRequestQueueState,
} from "./evm/useEvmWithdrawalQueueReads";
import type { WalletViewKind } from "./WalletViewContext";

export const STELLAR_RATE_DECIMALS = 6;

export interface WithdrawalQueueTotals {
  totalQueued: bigint | undefined;
  totalClaimed: bigint | undefined;
  rateRaw: bigint | undefined;
  rateDecimals: number | undefined;
  paused: boolean | undefined;
  plusdDecimals: number | undefined;
  usdcDecimals: number | undefined;
}

export interface WithdrawalRequestQueueState {
  position: bigint | undefined;
  payableNow: boolean | undefined;
}

export function useWithdrawalQueueTotals(
  kind: WalletViewKind,
  enabled = true,
): WithdrawalQueueTotals {
  const stellar = useStellarWithdrawalQueueTotals({
    enabled: enabled && kind === "stellar",
  });
  const evm = useEvmWithdrawalQueueTotals({
    enabled: enabled && kind === "evm",
  });

  if (kind === "stellar") {
    return {
      totalQueued: stellar.totalQueued,
      totalClaimed: stellar.totalClaimed,
      rateRaw: stellar.rate,
      rateDecimals: STELLAR_RATE_DECIMALS,
      paused: stellar.paused,
      plusdDecimals: SAC_DECIMALS,
      usdcDecimals: SAC_DECIMALS,
    };
  }
  return {
    totalQueued: evm.totalQueued,
    totalClaimed: evm.totalClaimed,
    rateRaw: evm.payoutPerPlusd,
    rateDecimals: evm.usdcDecimals,
    paused: evm.paused,
    plusdDecimals: evm.plusdDecimals,
    usdcDecimals: evm.usdcDecimals,
  };
}

export function useWithdrawalRequestQueueState(
  kind: WalletViewKind,
  requestId: bigint | undefined,
  enabled = true,
): WithdrawalRequestQueueState {
  const stellar = useStellarWithdrawalRequestQueueState(requestId, {
    enabled: enabled && kind === "stellar",
  });
  const evm = useEvmWithdrawalRequestQueueState(requestId, {
    enabled: enabled && kind === "evm",
  });
  const active = kind === "stellar" ? stellar : evm;
  return { position: active.position, payableNow: active.claimable };
}

export function isRecoveryRateActive(
  totals: Pick<WithdrawalQueueTotals, "rateRaw" | "rateDecimals"> | undefined,
): boolean {
  if (
    totals === undefined ||
    totals.rateRaw === undefined ||
    totals.rateDecimals === undefined
  ) {
    return false;
  }
  return totals.rateRaw < 10n ** BigInt(totals.rateDecimals);
}
