/**
 * Regression tests for `useDepositFlow`'s Stellar claim `onAction` guard (#800).
 *
 * The Stellar claim call site derives `deadline` from the active voucher
 * response's `deadline` string field and requires it to be a well-formed
 * non-negative integer before converting to `bigint` and calling
 * `stellarClaim.write(...)` / `stellarClaimWithdrawal.write(...)`. A missing
 * or malformed `deadline` (e.g. `""` or `"abc"`) must fail safe — no `write`
 * call, no thrown error, no bogus `0n` sent.
 *
 * This test mocks the entire `@/wallet` and `@/api` barrels so `useDepositFlow`
 * can be exercised in isolation via `renderHook`, independent of the route
 * component and its `@/api` mock (see BUG-8 in docs/exec-plans/known-bugs.md —
 * the route-level mock's voucher shape is pre-existing-broken for `signatureBytes`
 * and is out of scope to fix here).
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDepositFlow } from "./useDepositFlow";

// ── Mock @/wallet (entire barrel) ───────────────────────────────────────────────

const mockStellarClaimWrite = vi.fn();
const mockStellarClaimWithdrawalWrite = vi.fn();

const SIG_BYTES = new Uint8Array(64).fill(0xab);

// Mutable per-test state for the no-XLM banner derivation (#1196).
const mockXlmState = vi.hoisted(() => ({
  kind: "stellar" as "stellar" | "evm",
  xlmBalance: "100" as string | undefined,
  accountExists: true as boolean | undefined,
}));

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: mockXlmState.kind }),

  // EVM (unused on the Stellar path, but called unconditionally)
  useEvmWallet: () => ({
    address: undefined,
    isConnected: false,
    connect: vi.fn(),
  }),
  useDepositManagerAddresses: () => ({ plusd: undefined, usdc: undefined }),
  useDepositManagerMinDeposit: () => ({ minDeposit: undefined }),
  useEvmToken: () => ({
    decimals: undefined,
    balance: undefined,
    formattedBalance: undefined,
    allowance: undefined,
    approve: vi.fn(),
    isApprovePending: false,
    isApproveSuccess: false,
    refetchBalance: vi.fn(),
    isLoading: false,
  }),
  useRequestDeposit: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useClaim: () => ({
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useRequestWithdrawal: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useClaimWithdrawal: () => ({
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useNetworkFeeEstimate: () => ({ feeEth: undefined }),

  // Stellar
  useStellarWallet: () => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    isConnected: true,
    connect: vi.fn(),
  }),
  useStellarDepositManagerAddresses: () => ({
    addresses: {
      plusd: "CPLUSDCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      plusdAsset: {
        issuer: "GPLUSDISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    },
  }),
  useStellarSacToken: () => ({
    balance: "1000",
    refetchBalance: vi.fn(),
    isLoading: false,
    isAuthorized: true,
  }),
  useStellarToken: () => ({
    balance: "1000",
    refetchBalance: vi.fn(),
    isLoading: false,
  }),
  useStellarXlmBalance: () => ({
    xlmBalance: mockXlmState.xlmBalance,
    accountExists: mockXlmState.accountExists,
    refetchBalance: vi.fn(),
    isLoading: false,
    error: null,
  }),
  SAC_DECIMALS: 7,
  sacDisplayToRaw: (v: string) => BigInt(Math.round(parseFloat(v) * 1e7)),
  useStellarRequestDeposit: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useStellarClaim: () => ({
    write: mockStellarClaimWrite,
    isPending: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    data: undefined,
  }),
  useStellarDepositRequest: () => ({ request: undefined }),
  useChangeTrust: () => ({
    needsTrustline: false,
    isPending: false,
    isSuccess: false,
    error: null,
    submit: vi.fn(),
  }),
  useStellarRequestWithdrawal: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useStellarClaimWithdrawal: () => ({
    write: mockStellarClaimWithdrawalWrite,
    isPending: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    data: undefined,
  }),
  useStellarWithdrawalRequest: () => ({ request: undefined }),
  useStellarChangeTrustUsdc: () => ({
    needsTrustline: false,
    isPending: false,
    isSuccess: false,
    error: null,
    submit: vi.fn(),
  }),
  readInflightDeposit: () => undefined,
  readInflightWithdrawal: () => undefined,
  clearInflightDeposit: vi.fn(),
  clearInflightWithdrawal: vi.fn(),
  useStellarNetworkFeeEstimate: () => ({ feeXlm: undefined }),
}));

// ── Mock @/api (entire barrel) ───────────────────────────────────────────────────

let mockStellarDepositVoucherData: { deadline?: string } | undefined =
  undefined;
let mockStellarWithdrawVoucherData: { deadline?: string } | undefined =
  undefined;

vi.mock("@/api", () => ({
  useRequests: () => ({
    data: {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "10000000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
        {
          type: "Withdraw",
          request_id: "43",
          amount: "10000000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDepositVoucher: () => ({
    data: undefined,
    status: "idle",
    error: null,
    refetch: vi.fn(),
  }),
  useWithdrawalVoucher: () => ({
    data: undefined,
    status: "idle",
    error: null,
    refetch: vi.fn(),
  }),
  // `signatureBytes` at the top level (matches the real hook contract) +
  // `deadline` nested under `data` (matches the real voucher response shape).
  useStellarDepositVoucher: () => ({
    data: mockStellarDepositVoucherData,
    signatureBytes: SIG_BYTES,
    status: "ready",
    error: null,
    refetch: vi.fn(),
  }),
  useStellarWithdrawalVoucher: () => ({
    data: mockStellarWithdrawVoucherData,
    signatureBytes: SIG_BYTES,
    status: "ready",
    error: null,
    refetch: vi.fn(),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDepositFlow — needsXlmFunding (#1196/#1130)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockXlmState.kind = "stellar";
    mockXlmState.xlmBalance = "100";
    mockXlmState.accountExists = true;
  });

  it("is false when the account holds XLM", () => {
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.needsXlmFunding).toBe(false);
  });

  it("is true when the XLM balance is zero", () => {
    mockXlmState.xlmBalance = "0";
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.needsXlmFunding).toBe(true);
  });

  it("is true when the account is unfunded (Horizon 404)", () => {
    mockXlmState.xlmBalance = "0";
    mockXlmState.accountExists = false;
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.needsXlmFunding).toBe(true);
  });

  it("is false while the balance is still unresolved", () => {
    mockXlmState.xlmBalance = undefined;
    mockXlmState.accountExists = undefined;
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.needsXlmFunding).toBe(false);
  });

  it("is true in the withdraw direction too (direction-independent)", () => {
    mockXlmState.xlmBalance = "0";
    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );
    expect(result.current.needsXlmFunding).toBe(true);
  });

  it("is always false on EVM", () => {
    mockXlmState.kind = "evm";
    mockXlmState.xlmBalance = "0";
    mockXlmState.accountExists = false;
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.needsXlmFunding).toBe(false);
  });
});

describe("useDepositFlow — Stellar claim deadline guard (#800)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockXlmState.kind = "stellar";
    mockXlmState.xlmBalance = "100";
    mockXlmState.accountExists = true;
    mockStellarDepositVoucherData = undefined;
    mockStellarWithdrawVoucherData = undefined;
  });

  it("deposit: well-formed deadline → write is called with the parsed bigint", () => {
    mockStellarDepositVoucherData = { deadline: "1800000000" };

    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));

    act(() => {
      result.current.step3.onAction();
    });

    expect(mockStellarClaimWrite).toHaveBeenCalledWith(
      42n,
      SIG_BYTES,
      1_800_000_000n,
    );
  });

  it("deposit: empty-string deadline → write is NOT called", () => {
    mockStellarDepositVoucherData = { deadline: "" };

    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));

    act(() => {
      result.current.step3.onAction();
    });

    expect(mockStellarClaimWrite).not.toHaveBeenCalled();
  });

  it("deposit: malformed (non-numeric) deadline → write is NOT called, and does not throw", () => {
    mockStellarDepositVoucherData = { deadline: "abc" };

    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));

    expect(() => {
      act(() => {
        result.current.step3.onAction();
      });
    }).not.toThrow();
    expect(mockStellarClaimWrite).not.toHaveBeenCalled();
  });

  it("deposit: missing deadline → write is NOT called", () => {
    mockStellarDepositVoucherData = {};

    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));

    act(() => {
      result.current.step3.onAction();
    });

    expect(mockStellarClaimWrite).not.toHaveBeenCalled();
  });

  it("withdraw: well-formed deadline → write is called with the parsed bigint", () => {
    mockStellarWithdrawVoucherData = { deadline: "1800000000" };

    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );

    act(() => {
      result.current.step3.onAction();
    });

    expect(mockStellarClaimWithdrawalWrite).toHaveBeenCalledWith(
      43n,
      SIG_BYTES,
      1_800_000_000n,
    );
  });

  it("withdraw: malformed deadline → write is NOT called, and does not throw", () => {
    mockStellarWithdrawVoucherData = { deadline: "abc" };

    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );

    expect(() => {
      act(() => {
        result.current.step3.onAction();
      });
    }).not.toThrow();
    expect(mockStellarClaimWithdrawalWrite).not.toHaveBeenCalled();
  });

  it("withdraw: empty-string deadline → write is NOT called", () => {
    mockStellarWithdrawVoucherData = { deadline: "" };

    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );

    act(() => {
      result.current.step3.onAction();
    });

    expect(mockStellarClaimWithdrawalWrite).not.toHaveBeenCalled();
  });
});
