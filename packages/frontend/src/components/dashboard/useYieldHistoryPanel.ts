/**
 * Co-located hook for `YieldHistoryPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Resolves chain/vault from ENV defaults (no wallet connection on the Protocol
 * Dashboard), fans out API calls, and derives panel state + formatted values
 * for the view layer.
 *
 * Decisions:
 *   - `chainId`      = ENV.EVM_CHAIN_ID   (EVM is the canonical chain for the dashboard).
 *   - `vaultAddress` = ENV.STAKED_PLUSD_ADDRESS.
 *   - When the vault address is the zero-address dev default, the panel shows
 *     the `empty` state and no network calls are made — avoids noise in local/dev.
 *   - "Target Net to sPLUSD" is a static product constant ("8–12%") — no endpoint
 *     serves it yet (#738 backend follow-up). Left as a clearly-labelled seam.
 *   - "Current APY, Net to sPLUSD" maps to `vaults[].apy` from `GET /v1/stats`.
 *   - "Loan Book Yield" maps to `summary.avg_yield` from `GET /v1/loan-book`.
 */
import { useState } from "react";
import { ENV } from "@/lib/env";
import { useStatsYield } from "@/api/useStatsYield";
import { useStatsPrices } from "@/api/useStatsPrices";
import { useStats } from "@/api";
import { useLoanBook } from "@/api";
import { accrualToBars, latestAccrued } from "@/utils/yieldSeries";
import { formatCompactUsd, formatOneDecimalRate } from "@/utils/formatCompactUsd";
import type { PanelState } from "./PanelContainer";
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * "Target Net to sPLUSD" is a static product constant (8–12%).
 * No API endpoint serves this today — filed as backend follow-up #738.
 * The value is fixed in the Figma spec and the product docs.
 */
// TODO(#738): replace with live data once the backend serves decomposed APY.
const TARGET_NET_APY_STATIC = "8–12%";

// ── Output types ──────────────────────────────────────────────────────────────

export interface YieldHistoryMetricCards {
  /** Current APY, Net to sPLUSD — from `GET /v1/stats` vaults[].apy. */
  currentApyNet: string;
  /**
   * Loan Book Yield — from `GET /v1/loan-book` summary.avg_yield.
   * "—" when no active loans or data is unavailable.
   */
  loanBookYield: string;
  /**
   * Target Net to sPLUSD — static product constant (8–12%).
   * No live endpoint today; seam left for #738.
   */
  targetNetApyStatic: string;
}

export interface YieldHistoryPanelState {
  state: PanelState;
  /** Active time-range period id (default "all"). */
  periodId: string;
  setPeriodId: (id: string) => void;
  /** Pre-computed cumulative-accrual bar array, or `null` when empty/loading. */
  cumulativeBars: YieldBarPoint[] | null;
  /** Formatted headline value (e.g. "$2.91M") for the Cumulative Yield card. */
  headlineValue: string;
  /** Pre-computed exchange-rate bar array, or `null` when empty/loading. */
  exchangeRateBars: YieldBarPoint[] | null;
  /** The three metric card values. */
  metricCards: YieldHistoryMetricCards;
  errorMessage: string | undefined;
  /** Refetches all data sources. */
  refetch: () => void;
}

// ── Fallback values ───────────────────────────────────────────────────────────

const EMPTY_METRICS: YieldHistoryMetricCards = {
  currentApyNet: "—",
  loanBookYield: "—",
  targetNetApyStatic: TARGET_NET_APY_STATIC,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drives `YieldHistoryPanel`.
 *
 * - `loading` → panel shows `PanelLoading`.
 * - `error`   → panel shows `PanelError` with a retry action.
 * - `empty`   → vault is zero-address or all series are empty; shows `PanelEmpty`.
 * - `ready`   → derived headline + bar arrays + metric cards are available.
 */
export function useYieldHistoryPanel(): YieldHistoryPanelState {
  const [periodId, setPeriodId] = useState("all");

  const chainId = ENV.EVM_CHAIN_ID;
  const vaultAddress = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroVault = vaultAddress === ZERO_ADDRESS;

  // Guard all queries behind the zero-address check so no requests fire in
  // local dev where the address is the default zero sentinel.
  const queriesEnabled = !isZeroVault;

  const yieldQuery = useStatsYield({
    chainId,
    periodId,
    enabled: queriesEnabled,
  });

  const pricesQuery = useStatsPrices({
    vaultAddress,
    chainId,
    periodId,
    enabled: queriesEnabled,
  });

  const statsQuery = useStats();
  const loanBookQuery = useLoanBook();

  // Combine refetch for all queries
  const refetch = () => {
    yieldQuery.refetch();
    pricesQuery.refetch();
    statsQuery.refetch();
    loanBookQuery.refetch();
  };

  // ── Empty state when vault is zero-address ──────────────────────────────────

  if (isZeroVault) {
    return {
      state: "empty",
      periodId,
      setPeriodId,
      cumulativeBars: null,
      headlineValue: "—",
      exchangeRateBars: null,
      metricCards: EMPTY_METRICS,
      errorMessage: undefined,
      refetch,
    };
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  // Show loading while any primary data source is loading.

  const isLoading = yieldQuery.isLoading || pricesQuery.isLoading;

  if (isLoading) {
    return {
      state: "loading",
      periodId,
      setPeriodId,
      cumulativeBars: null,
      headlineValue: "—",
      exchangeRateBars: null,
      metricCards: EMPTY_METRICS,
      errorMessage: undefined,
      refetch,
    };
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  // Primary error: yield or prices fetch failed.

  const primaryError = yieldQuery.error ?? pricesQuery.error;
  if (primaryError) {
    return {
      state: "error",
      periodId,
      setPeriodId,
      cumulativeBars: null,
      headlineValue: "—",
      exchangeRateBars: null,
      metricCards: EMPTY_METRICS,
      errorMessage: primaryError.message,
      refetch,
    };
  }

  // ── Derive chart data ───────────────────────────────────────────────────────

  const cumulativeBars = accrualToBars(yieldQuery.data);

  // Exchange-rate bars from prices — reuse same bar shape with avg_price
  // mapped as `value` and `height`.
  const exchangeRateBars: YieldBarPoint[] | null = (() => {
    const prices = pricesQuery.data?.prices;
    if (!prices || prices.length === 0) return null;
    const valid = prices
      .map((p) => {
        const value = parseFloat(p.avg_price);
        const timestamp = new Date(p.timestamp).getTime();
        if (!Number.isFinite(value) || value <= 0) return null;
        if (!Number.isFinite(timestamp)) return null;
        return { value, timestamp };
      })
      .filter((p): p is { value: number; timestamp: number } => p !== null)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (valid.length === 0) return null;
    const maxVal = Math.max(...valid.map((p) => p.value));
    if (!Number.isFinite(maxVal) || maxVal <= 0) return null;
    return valid.map((p) => ({
      value: p.value,
      timestamp: p.timestamp,
      height: Math.max(2, (p.value / maxVal) * 100),
    }));
  })();

  // ── Headline value ──────────────────────────────────────────────────────────

  const rawLatest = latestAccrued(yieldQuery.data);
  const headlineValue =
    rawLatest !== null
      ? // accrued is already in human units (6-decimal USDC); formatCompactUsd
        // expects a 6-decimal decimal string.
        formatCompactUsd(String(rawLatest))
      : "—";

  // ── Metric cards ────────────────────────────────────────────────────────────

  // Current APY, Net to sPLUSD — from GET /v1/stats
  const vault = statsQuery.data?.vaults?.[0];
  const currentApyNet = formatOneDecimalRate(vault?.apy ?? null);

  // Loan Book Yield — from GET /v1/loan-book summary.avg_yield
  const loanBookYield = formatOneDecimalRate(
    loanBookQuery.data?.summary?.avg_yield ?? null,
  );

  const metricCards: YieldHistoryMetricCards = {
    currentApyNet,
    loanBookYield,
    // TODO(#738): replace with live decomposed APY when backend endpoint is ready.
    targetNetApyStatic: TARGET_NET_APY_STATIC,
  };

  // ── Empty state when all series are empty ───────────────────────────────────

  if (cumulativeBars === null && exchangeRateBars === null) {
    return {
      state: "empty",
      periodId,
      setPeriodId,
      cumulativeBars: null,
      headlineValue: "—",
      exchangeRateBars: null,
      metricCards,
      errorMessage: undefined,
      refetch,
    };
  }

  // ── Ready ───────────────────────────────────────────────────────────────────

  return {
    state: "ready",
    periodId,
    setPeriodId,
    cumulativeBars,
    headlineValue,
    exchangeRateBars,
    metricCards,
    errorMessage: undefined,
    refetch,
  };
}
