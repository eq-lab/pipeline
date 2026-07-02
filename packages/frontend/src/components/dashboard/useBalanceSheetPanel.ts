/**
 * Co-located hook for `BalanceSheetPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Blends REST `GET /v1/financial-position` + Horizon on-chain reads:
 *   - PLUSD outstanding  → `useStellarPlusdTotalSupply()`   (Horizon decimal string)
 *   - USDC reserve       → `useStellarUsdcReserveBalance()` (Horizon decimal string)
 *   - Deployed / Junior  → REST base-6 decimal strings
 *   - USYC stub          → `convertUsycToUsdc` seam → `—` (no holding in v1)
 *   - Off-chain USD      → `—` (off-chain, no source)
 *
 * Decimal discipline
 * ------------------
 * All numeric values are "human-decimal strings" — standard Stellar/REST display
 * format (e.g. `"10000711.9961018"`). Call `parseFloat(str)` then
 * `formatCompactUsd(str)` directly. No SAC bigint scaling is applied here.
 *
 * Section totals are CLIENT-RECOMPUTED (the REST roll-up excludes on-chain
 * leaves). Only sourced rows contribute to the total. Unsourced rows (`—`)
 * are excluded — a muted footnote is shown when any row is unsourced.
 *
 * Panel state
 * -----------
 *   - `loading` → REST is still in flight.
 *   - `error`   → REST fetch failed (provides `refetch` for retry).
 *   - `ready`   → REST has data; rows render best-effort with Horizon fills.
 */
import { useFinancialPosition } from "@/api/useFinancialPosition";
import {
  useStellarPlusdTotalSupply,
  useStellarUsdcReserveBalance,
} from "@/wallet/stellar/useStellarFinancialPositionReads";
import { formatCompactUsd } from "@/utils/formatCompactUsd";
import { convertUsycToUsdc } from "./usycNav";
import type { PanelState } from "./PanelContainer";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One row in the balance sheet. */
export interface BalanceSheetRow {
  /** Display label (e.g. "Secured loans outstanding"). */
  label: string;
  /**
   * Optional caption displayed below the label (e.g. "1:1 redeemable").
   * Only present for the PLUSD outstanding row.
   */
  caption?: string;
  /** Formatted value string (e.g. "$8.0M") or `"—"` when unavailable. */
  value: string;
  /** Stable test id for automated tests. */
  testId: string;
}

/** Assets sub-section. */
export interface BalanceSheetAssetsSection {
  liquid: BalanceSheetRow[];
  deployed: BalanceSheetRow[];
  /** Client-recomputed total across all sourced asset rows. */
  total: string;
}

/** Liabilities sub-section. */
export interface BalanceSheetLiabilitiesSection {
  seniorClaims: BalanceSheetRow[];
  subordinatedCapital: BalanceSheetRow[];
  /** Client-recomputed total across all sourced liability rows. */
  total: string;
}

/** Full view model returned by `useBalanceSheetPanel`. */
export interface BalanceSheetPanelState {
  state: PanelState;
  assets: BalanceSheetAssetsSection;
  liabilities: BalanceSheetLiabilitiesSection;
  errorMessage: string | undefined;
  refetch: () => void;
  /**
   * When `true` the section totals may not balance because some rows are
   * unsourced. A muted footnote should be shown.
   */
  showTotalsDisclaimer: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses a human-decimal string to a number.
 * Returns `undefined` for null / undefined / non-finite values.
 */
function parseHuman(str: string | undefined | null): number | undefined {
  if (str == null) return undefined;
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : undefined;
}

/** Formats a human-unit number as compact USD, or `"—"` when undefined. */
function fmtHuman(num: number | undefined | null): string {
  if (num == null || !Number.isFinite(num)) return "—";
  return formatCompactUsd(num.toFixed(6));
}

/** Sums an array of optional human-unit numbers. Returns the total and whether
 * any row was unsourced (undefined/null). */
function sumRows(values: (number | undefined | null)[]): {
  total: number;
  hasUnsourced: boolean;
} {
  let total = 0;
  let hasUnsourced = false;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) {
      hasUnsourced = true;
    } else {
      total += v;
    }
  }
  return { total, hasUnsourced };
}

// ── Empty fallbacks ───────────────────────────────────────────────────────────

function emptyAssets(): BalanceSheetAssetsSection {
  return {
    liquid: [
      {
        label: "Cash — stablecoins (USDC)",
        value: "—",
        testId: "bs-cash-usdc",
      },
      { label: "Tokenized T-bills (USYC)", value: "—", testId: "bs-usyc" },
      {
        label: "Off-chain USD (trust company account)",
        value: "—",
        testId: "bs-offchain-usd",
      },
    ],
    deployed: [
      {
        label: "Secured loans outstanding",
        value: "—",
        testId: "bs-secured-loans",
      },
      {
        label: "Accrued interest receivable",
        value: "—",
        testId: "bs-accrued-interest",
      },
    ],
    total: "—",
  };
}

function emptyLiabilities(): BalanceSheetLiabilitiesSection {
  return {
    seniorClaims: [
      {
        label: "PLUSD outstanding",
        caption: "1:1 redeemable",
        value: "—",
        testId: "bs-plusd-outstanding",
      },
    ],
    subordinatedCapital: [
      { label: "Junior tranche", value: "—", testId: "bs-junior-tranche" },
    ],
    total: "—",
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Drives `BalanceSheetPanel` (Panel A — Statement of Financial Position).
 *
 * - `loading` → while the REST fetch is in flight.
 * - `error`   → REST fetch failed; Horizon reads don't cause a whole-panel error.
 * - `ready`   → REST has data; rows are best-effort blended with Horizon reads.
 *
 * Horizon reads that are unconfigured or still loading surface as per-row `—`,
 * never as a whole-panel error state.
 */
export function useBalanceSheetPanel(): BalanceSheetPanelState {
  const {
    data: rest,
    isLoading: restLoading,
    error: restError,
    refetch,
  } = useFinancialPosition();
  const { data: plusdSupplyStr } = useStellarPlusdTotalSupply();
  const { data: usdcReserveStr } = useStellarUsdcReserveBalance();

  // ── Panel-level state ─────────────────────────────────────────────────────
  if (restLoading) {
    return {
      state: "loading",
      assets: emptyAssets(),
      liabilities: emptyLiabilities(),
      errorMessage: undefined,
      refetch,
      showTotalsDisclaimer: false,
    };
  }

  if (restError) {
    return {
      state: "error",
      assets: emptyAssets(),
      liabilities: emptyLiabilities(),
      errorMessage: restError.message,
      refetch,
      showTotalsDisclaimer: false,
    };
  }

  // ── Ready: blend REST + Horizon ───────────────────────────────────────────

  // REST rows (base-6 decimal strings → parseFloat → human numbers).
  const securedLoans = parseHuman(
    rest?.assets.deployed.secured_loans_outstanding,
  );
  const accruedInterest = parseHuman(
    rest?.assets.deployed.accrued_interest_receivable,
  );
  const juniorTranche = parseHuman(
    rest?.liabilities.subordinated_capital.junior_tranche,
  );

  // Horizon rows (already human-decimal strings → parseFloat).
  const usdcReserveHuman = parseHuman(usdcReserveStr);
  const plusdOutstandingHuman = parseHuman(plusdSupplyStr);

  // USYC stub — no holding in v1 → always —.
  void convertUsycToUsdc; // seam imported; swappable when real NAV is available
  const usycHuman: number | undefined = undefined;

  // Off-chain USD — always —.
  const offchainHuman: number | undefined = undefined;

  // ── Section totals (client-recomputed) ───────────────────────────────────
  const assetValues = [
    usdcReserveHuman,
    usycHuman,
    offchainHuman,
    securedLoans,
    accruedInterest,
  ];
  const { total: assetsTotal, hasUnsourced: assetsHasUnsourced } =
    sumRows(assetValues);

  const liabilityValues = [plusdOutstandingHuman, juniorTranche];
  const { total: liabilitiesTotal, hasUnsourced: liabilitiesHasUnsourced } =
    sumRows(liabilityValues);

  const showTotalsDisclaimer = assetsHasUnsourced || liabilitiesHasUnsourced;

  // ── Build view model ──────────────────────────────────────────────────────
  const assets: BalanceSheetAssetsSection = {
    liquid: [
      {
        label: "Cash — stablecoins (USDC)",
        value: fmtHuman(usdcReserveHuman),
        testId: "bs-cash-usdc",
      },
      {
        label: "Tokenized T-bills (USYC)",
        value: "—",
        testId: "bs-usyc",
      },
      {
        label: "Off-chain USD (trust company account)",
        value: "—",
        testId: "bs-offchain-usd",
      },
    ],
    deployed: [
      {
        label: "Secured loans outstanding",
        value:
          securedLoans !== undefined
            ? formatCompactUsd(rest!.assets.deployed.secured_loans_outstanding!)
            : "—",
        testId: "bs-secured-loans",
      },
      {
        label: "Accrued interest receivable",
        value:
          accruedInterest !== undefined
            ? formatCompactUsd(
                rest!.assets.deployed.accrued_interest_receivable!,
              )
            : "—",
        testId: "bs-accrued-interest",
      },
    ],
    total:
      assetsTotal > 0
        ? formatCompactUsd(assetsTotal.toFixed(6))
        : assetsHasUnsourced
          ? "—"
          : "$0",
  };

  const liabilities: BalanceSheetLiabilitiesSection = {
    seniorClaims: [
      {
        label: "PLUSD outstanding",
        caption: "1:1 redeemable",
        value: fmtHuman(plusdOutstandingHuman),
        testId: "bs-plusd-outstanding",
      },
    ],
    subordinatedCapital: [
      {
        label: "Junior tranche",
        value:
          juniorTranche !== undefined
            ? formatCompactUsd(
                rest!.liabilities.subordinated_capital.junior_tranche!,
              )
            : "—",
        testId: "bs-junior-tranche",
      },
    ],
    total:
      liabilitiesTotal > 0
        ? formatCompactUsd(liabilitiesTotal.toFixed(6))
        : liabilitiesHasUnsourced
          ? "—"
          : "$0",
  };

  return {
    state: "ready",
    assets,
    liabilities,
    errorMessage: undefined,
    refetch,
    showTotalsDisclaimer,
  };
}
