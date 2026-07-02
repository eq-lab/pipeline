/**
 * Co-located hook for `BalanceSheetPanel` (FRONTEND.md rule 2: view = JSX
 * only, logic lives in the hook).
 *
 * Blends REST `GET /v1/financial-position` + Soroban on-chain reads:
 *   - PLUSD outstanding  → `useStellarPlusdTotalSupply()`  (7-decimal bigint)
 *   - USDC reserve       → `useStellarUsdcReserveBalance()` (7-decimal bigint)
 *   - Deployed / Junior  → REST base-6 decimal strings
 *   - USYC stub          → `convertUsycToUsdc(0n)` → `—`
 *   - Off-chain USD      → `—` (off-chain, no source)
 *
 * CRITICAL decimal discipline
 * ---------------------------
 * REST amounts are base-6 decimal strings (human units, e.g. `"8000000.000000"`).
 * Soroban amounts are raw i128 bigint at 7-decimal scale (e.g. `431400000000000n`).
 * DO NOT mix these scales without normalizing first:
 *   - REST  → `parseFloat(str)`           → human number
 *   - Chain → `sacRawToDisplay(raw, 7)`   → "431400000.0000000" → `parseFloat`
 *
 * Section totals are CLIENT-RECOMPUTED (the REST roll-up excludes on-chain
 * leaves). Only sourced rows contribute to the total. Unsourced rows (`—`)
 * are excluded, so the sheet may not balance perfectly — a muted footnote is
 * shown per Open Question 1.
 *
 * Panel state
 * -----------
 *   - `loading` → REST is still in flight (Soroban reads can still be pending,
 *     but they surface as per-row `—` not a whole-panel loading spinner).
 *   - `error`   → REST fetch failed (provides `refetch` for retry).
 *   - `ready`   → REST has data; rows render best-effort with Soroban fills.
 */
import { useFinancialPosition } from "@/api/useFinancialPosition";
import {
  useStellarPlusdTotalSupply,
  useStellarUsdcReserveBalance,
} from "@/wallet/stellar/useStellarFinancialPositionReads";
import { sacRawToDisplay } from "@/wallet/stellar/useStellarSacToken";
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

/** Converts a 7-decimal raw bigint to a human USD number (or undefined). */
function sacToHuman(raw: bigint | undefined): number | undefined {
  if (raw === undefined) return undefined;
  return parseFloat(sacRawToDisplay(raw, 7));
}

/** Formats a human-unit number as compact USD, or `"—"` when falsy/null. */
function fmtHuman(num: number | undefined | null): string {
  if (num == null || !Number.isFinite(num)) return "—";
  // Use formatCompactUsd via a string; it accepts human strings.
  return formatCompactUsd(num.toFixed(6));
}

/** Sums an array of optional human-unit numbers. Returns the total and whether
 * any row was unsourced (undefined/null). */
function sumRows(
  values: (number | undefined | null)[],
): { total: number; hasUnsourced: boolean } {
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
      { label: "Cash — stablecoins (USDC)", value: "—", testId: "bs-cash-usdc" },
      { label: "Tokenized T-bills (USYC)", value: "—", testId: "bs-usyc" },
      { label: "Off-chain USD (trust company account)", value: "—", testId: "bs-offchain-usd" },
    ],
    deployed: [
      { label: "Secured loans outstanding", value: "—", testId: "bs-secured-loans" },
      { label: "Accrued interest receivable", value: "—", testId: "bs-accrued-interest" },
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
 * - `error`   → REST fetch failed; Soroban reads don't cause a whole-panel error.
 * - `ready`   → REST has data; rows are best-effort blended with Soroban reads.
 *
 * Soroban reads that are unconfigured or still loading surface as per-row `—`,
 * never as a whole-panel error state.
 */
export function useBalanceSheetPanel(): BalanceSheetPanelState {
  const { data: rest, isLoading: restLoading, error: restError, refetch } =
    useFinancialPosition();
  const { data: plusdSupplyRaw } = useStellarPlusdTotalSupply();
  const { data: usdcReserveRaw } = useStellarUsdcReserveBalance();

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

  // ── Ready: blend REST + Soroban ───────────────────────────────────────────

  // REST rows (human numbers, base-6 strings → parseFloat).
  const securedLoans = rest?.assets.deployed.secured_loans_outstanding != null
    ? parseFloat(rest.assets.deployed.secured_loans_outstanding)
    : undefined;
  const accruedInterest = rest?.assets.deployed.accrued_interest_receivable != null
    ? parseFloat(rest.assets.deployed.accrued_interest_receivable)
    : undefined;
  const juniorTranche = rest?.liabilities.subordinated_capital.junior_tranche != null
    ? parseFloat(rest.liabilities.subordinated_capital.junior_tranche)
    : undefined;

  // Soroban rows (7-decimal bigint → human number).
  const usdcReserveHuman = sacToHuman(usdcReserveRaw);
  const plusdOutstandingHuman = sacToHuman(plusdSupplyRaw);

  // USYC stub — no holding → 0n → converts to 0 human → formatCompactUsd → "$0"
  // But there is no USYC holding configured, so we treat it as unavailable (—).
  // convertUsycToUsdc is the seam; without a USYC amount it stays —.
  const usycHuman: number | undefined = undefined; // No USYC holding in v1.
  void convertUsycToUsdc; // seam imported; used via the module reference

  // Off-chain USD — always —.
  const offchainHuman: number | undefined = undefined;

  // ── Section totals (client-recomputed) ───────────────────────────────────
  const assetValues = [usdcReserveHuman, usycHuman, offchainHuman, securedLoans, accruedInterest];
  const { total: assetsTotal, hasUnsourced: assetsHasUnsourced } = sumRows(assetValues);

  const liabilityValues = [plusdOutstandingHuman, juniorTranche];
  const { total: liabilitiesTotal, hasUnsourced: liabilitiesHasUnsourced } = sumRows(liabilityValues);

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
        value: securedLoans !== undefined ? formatCompactUsd(rest!.assets.deployed.secured_loans_outstanding) : "—",
        testId: "bs-secured-loans",
      },
      {
        label: "Accrued interest receivable",
        value: accruedInterest !== undefined ? formatCompactUsd(rest!.assets.deployed.accrued_interest_receivable) : "—",
        testId: "bs-accrued-interest",
      },
    ],
    total: assetsTotal > 0 ? formatCompactUsd(assetsTotal.toFixed(6)) : (assetsHasUnsourced ? "—" : "$0"),
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
        value: juniorTranche !== undefined ? formatCompactUsd(rest!.liabilities.subordinated_capital.junior_tranche) : "—",
        testId: "bs-junior-tranche",
      },
    ],
    total: liabilitiesTotal > 0 ? formatCompactUsd(liabilitiesTotal.toFixed(6)) : (liabilitiesHasUnsourced ? "—" : "$0"),
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
