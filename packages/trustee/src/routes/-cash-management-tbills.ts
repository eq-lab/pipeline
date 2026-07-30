/**
 * View-model for the Cash Management **T-Bills** tab's Buy / Sell USYC swap form
 * (`cash-management.tsx`, issue #944, Figma `4116-11802` for styling). Per
 * `docs/FRONTEND.md` rule 2 the `.tsx` is JSX/styling only; this hook owns the
 * data wiring.
 *
 * Balances shown against the shared Capital Allocation section:
 *   - **Buy** spends **USDC** — the real on-chain Capital-Wallet balance
 *     (`useCapitalWalletBalance`).
 *   - **Sell** spends **USYC** — the total T-Bills value at issuer NAV
 *     (`useCapitalAllocation().buckets.tbills`), currently `null` → `"—"` (the
 *     bucket is hardcoded `None` server-side, #931/#944).
 *
 * This is a **UI shell**: buying/selling USYC is a Capital-Wallet MPC action
 * (3-of-5, Type 2, flow 8) with no backend assembly/quote path yet (follow-up
 * filed with #944). So the submit is disabled and the received amount / fee are
 * `"—"` — no USYC price/NAV is served, and it is never fabricated.
 */
import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { useCapitalAllocation } from "@/api/useCapitalAllocation";

/** Plain amount with thousands separators (`"8,400,000"`); `"—"` when unknown. */
export function formatSwapAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value,
  );
}

/** Parses a display-scale decimal string to a finite number, or `null`. */
function toValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface TbillsSwapView {
  /** Capital-Wallet on-chain USDC balance (the Buy side); `null` when unavailable. */
  usdcValue: number | null;
  /** The same balance formatted, or `"—"`. */
  usdcDisplay: string;
  /** Total T-Bills (USYC) value at NAV (the Sell side); `null` until `buckets.tbills` is served. */
  tbillsValue: number | null;
  /** The same value formatted, or `"—"`. */
  tbillsDisplay: string;
}

export function useTbillsSwap(): TbillsSwapView {
  const balance = useCapitalWalletBalance();
  const allocation = useCapitalAllocation();

  const usdcValue = toValue(balance.data);
  const tbillsValue = toValue(allocation.data?.buckets.tbills);

  return {
    usdcValue,
    usdcDisplay: formatSwapAmount(usdcValue),
    tbillsValue,
    tbillsDisplay: formatSwapAmount(tbillsValue),
  };
}
