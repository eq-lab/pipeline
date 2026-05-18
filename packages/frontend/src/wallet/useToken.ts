/**
 * Composing ERC-20 hook: metadata + balance + approval.
 *
 * `useToken({ token, spender? })` bundles three ERC-20 reads for the connected
 * wallet into one return value:
 *   1. Metadata — `decimals()` + `symbol()` read once and cached forever.
 *   2. Balance  — `balanceOf(owner)` where `owner = useWallet().address`.
 *   3. Approval — composed by calling `useApproval({ token, spender })`;
 *      re-exposed under stable names. When `spender` is omitted the approval
 *      fields are `undefined` / no-op.
 *
 * Mock layer (localStorage keys):
 *   - `pipeline.mock.wallet.contract.<token>.decimals` — numeric string (e.g. `"6"`)
 *   - `pipeline.mock.wallet.contract.<token>.symbol`   — string (e.g. `"USDC"`)
 *   - `pipeline.mock.wallet.balance.<token>`           — decimal bigint string
 *   - Approval keys are handled by `useApproval` internally.
 *
 * See `packages/frontend/src/wallet/README.md` for the full mock-key schema
 * and DevTools console snippets.
 */
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { useMock, parseNumber, parseBigInt } from "./mock";
import { useWallet } from "./useWallet";
import { useApproval } from "./useApproval";
import { erc20Abi } from "./abis/erc20";
import { CACHE_FOREVER } from "./cache";

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Mock-key builders ─────────────────────────────────────────────────────────

const MOCK_KEYS = {
  decimals: (token: string) =>
    `pipeline.mock.wallet.contract.${token.toLowerCase()}.decimals`,
  symbol: (token: string) =>
    `pipeline.mock.wallet.contract.${token.toLowerCase()}.symbol`,
  balance: (token: string) =>
    `pipeline.mock.wallet.balance.${token.toLowerCase()}`,
};

/** Identity parser for string mock values (symbol, etc.). */
function parseString(raw: string): string {
  return raw;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseTokenArgs {
  /** ERC-20 token contract address (required). */
  token: `0x${string}`;
  /**
   * Optional spender — enables the approval branch.
   * When omitted, approval fields are `undefined` / no-op.
   */
  spender?: `0x${string}`;
}

export interface UseTokenResult {
  // ── Metadata (always read) ────────────────────────────────────────────────
  /** Token decimals from `decimals()`. `undefined` while loading. */
  decimals: number | undefined;
  /** Token symbol from `symbol()`. `undefined` while loading. */
  symbol: string | undefined;

  // ── Balance (owner = connected wallet) ────────────────────────────────────
  /** Raw `balanceOf(owner)`. `undefined` when disconnected or loading. */
  balance: bigint | undefined;
  /**
   * Formatted balance as a USD currency string (e.g. `"$1,000.00"`).
   * `undefined` while `balance` or `decimals` are loading.
   */
  formattedBalance: string | undefined;
  /** Re-reads `balanceOf(owner)`. Delegates to wagmi `refetch`. */
  refetchBalance: () => void;

  // ── Approval (only when `spender` is provided) ────────────────────────────
  /** Current ERC-20 allowance. `undefined` when spender is omitted. */
  allowance: bigint | undefined;
  /**
   * Convenience check: `allowance >= amount`.
   * `undefined` when spender is omitted.
   */
  isSufficient: ((amount: bigint) => boolean) | undefined;
  /**
   * Triggers `approve(spender, amount)`.
   * `undefined` (no-op) when spender is omitted.
   */
  approve: ((amount: bigint) => void) | undefined;
  /** Populated after approve tx is broadcast. `undefined` when spender is omitted. */
  approveData: { hash: string } | undefined;
  /** `true` while approve tx is in flight. */
  isApprovePending: boolean;
  /** `true` once approve tx is broadcast-accepted. */
  isApproveSuccess: boolean;
  /**
   * Re-reads current allowance.
   * `undefined` when spender is omitted.
   */
  refetchAllowance: (() => void) | undefined;

  // ── Aggregated state ──────────────────────────────────────────────────────
  /** `true` when any underlying read is in flight. */
  isLoading: boolean;
  /** First non-null error across all reads (with spender-gating for approval). */
  error: Error | null;
}

// ── useToken ──────────────────────────────────────────────────────────────────

/**
 * Composes ERC-20 metadata, balance, and approval into one return value.
 *
 * All three reads honour the `pipeline.mock.wallet.*` localStorage mock layer.
 * When mock keys are present no RPC call is issued.
 */
export function useToken({ token, spender }: UseTokenArgs): UseTokenResult {
  const { address, isConnected } = useWallet();

  const walletConnected = isConnected && address !== undefined;
  const tokenIsZero = token === ZERO_ADDRESS;

  // ── Mock reads — metadata ─────────────────────────────────────────────────
  const mockDecimals = useMock(MOCK_KEYS.decimals(token), parseNumber);
  const mockDecimalsSet = mockDecimals !== undefined;

  const mockSymbol = useMock(MOCK_KEYS.symbol(token), parseString);
  const mockSymbolSet = mockSymbol !== undefined;

  // ── Real reads — metadata (CACHE_FOREVER; token metadata is immutable) ────
  const decimalsRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals",
    query: {
      enabled: !mockDecimalsSet && !tokenIsZero,
      ...CACHE_FOREVER,
    },
  });

  const symbolRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "symbol",
    query: {
      enabled: !mockSymbolSet && !tokenIsZero,
      ...CACHE_FOREVER,
    },
  });

  // ── Mock read — balance ───────────────────────────────────────────────────
  const mockBalance = useMock(MOCK_KEYS.balance(token), parseBigInt);
  const mockBalanceSet = mockBalance !== undefined;

  // ── Real read — balance ───────────────────────────────────────────────────
  const balanceRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? (ZERO_ADDRESS as `0x${string}`)],
    query: {
      enabled: !mockBalanceSet && walletConnected && !tokenIsZero,
    },
  });

  // ── Approval — always called (hook rules); mask when spender omitted ───────
  // useApproval already short-circuits on ZERO_ADDRESS spender — no RPC fires.
  const effectiveSpender = spender ?? (ZERO_ADDRESS as `0x${string}`);
  const spenderOmitted = spender === undefined;

  const approval = useApproval({ token, spender: effectiveSpender });

  // ── Derived values ────────────────────────────────────────────────────────

  const decimals: number | undefined = mockDecimalsSet
    ? mockDecimals
    : (decimalsRead.data as number | undefined);

  const symbol: string | undefined = mockSymbolSet
    ? mockSymbol
    : (symbolRead.data as string | undefined);

  const balance: bigint | undefined = mockBalanceSet
    ? mockBalance
    : walletConnected && !tokenIsZero
      ? (balanceRead.data as bigint | undefined)
      : undefined;

  const formattedBalance: string | undefined =
    balance !== undefined && decimals !== undefined
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(parseFloat(formatUnits(balance, decimals)))
      : undefined;

  const refetchBalance = balanceRead.refetch as () => void;

  // ── Aggregated loading / error ────────────────────────────────────────────

  const isLoading =
    (!mockDecimalsSet && decimalsRead.isLoading) ||
    (!mockSymbolSet && symbolRead.isLoading) ||
    (!mockBalanceSet && balanceRead.isLoading) ||
    (!spenderOmitted && approval.isLoading);

  const approvalError = spenderOmitted ? null : approval.error;

  const error: Error | null =
    (decimalsRead.error as Error | null) ??
    (symbolRead.error as Error | null) ??
    (balanceRead.error as Error | null) ??
    approvalError;

  // ── Approval fields — mask when spender omitted ───────────────────────────

  return {
    decimals,
    symbol,
    balance,
    formattedBalance,
    refetchBalance,

    allowance: spenderOmitted ? undefined : approval.allowance,
    isSufficient: spenderOmitted ? undefined : approval.isSufficient,
    approve: spenderOmitted ? undefined : approval.approve,
    approveData: spenderOmitted ? undefined : approval.data,
    isApprovePending: spenderOmitted ? false : approval.isPending,
    isApproveSuccess: spenderOmitted ? false : approval.isSuccess,
    refetchAllowance: spenderOmitted ? undefined : approval.refetch,

    isLoading,
    error,
  };
}
