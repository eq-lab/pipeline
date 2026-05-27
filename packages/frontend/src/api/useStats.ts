/**
 * React Query hook — fetches protocol vault statistics from the Pipeline API
 * (`GET /v1/stats`).
 *
 * The hook is always enabled (no wallet connection required — these are
 * protocol-level stats visible to everyone).
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/stats`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultStatsItem {
  vault_address: string;
  /** Current share price (assets per 1 share). */
  share_price: string;
  /**
   * APY as a decimal fraction string (e.g. "0.0725" = 7.25%).
   * Absent or null when there is insufficient price history.
   */
  apy?: string | null;
}

export interface StatsResponse {
  vaults: VaultStatsItem[];
}

export interface UseStatsResult {
  data: StatsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns protocol vault statistics including the current APY.
 *
 * - Always enabled — no wallet connection required.
 * - Reactive to `pipeline.mock.api.*` localStorage key changes (DevTools mock
 *   bridge).
 *
 * To read the APY for display, use `formatApy(data?.vaults[0]?.apy)`.
 */
export function useStats(): UseStatsResult {
  const query = useQuery<StatsResponse, Error>({
    queryKey: ["stats"],
    queryFn: () => apiFetch<StatsResponse>("/v1/stats"),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

// ── Formatting helper ─────────────────────────────────────────────────────────

/**
 * Formats an APY decimal fraction string as a percentage string.
 *
 * - `"0.0842"` → `"8.42%"`
 * - `null | undefined` → `"—"` (em-dash fallback for missing data)
 *
 * @param apy  APY as a decimal fraction string (e.g. "0.0842"), or null/undefined.
 */
export function formatApy(apy: string | null | undefined): string {
  if (apy == null) return "—";
  const num = parseFloat(apy);
  if (!Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(2)}%`;
}
