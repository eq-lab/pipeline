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
const mockClearInflightEvm = vi.hoisted(() => vi.fn());

const SIG_BYTES = new Uint8Array(64).fill(0xab);

const EVM_ADDRESS = "0x1111111111111111111111111111111111111111";

const mockXlmState = vi.hoisted(() => ({
  kind: "stellar" as "stellar" | "evm",
  xlmBalance: "100" as string | undefined,
  accountExists: true as boolean | undefined,
}));

const ctl = vi.hoisted(() => ({
  evmConnected: false,
  approveError: null as Error | null,
  isApprovePending: false,
  isApproveSuccess: false,
  evmDepositInflight: undefined as
    | { requestId: string; amount: string; txHash: string; createdAt: number }
    | undefined,
  evmRequestDeposit: {
    data: undefined as { hash: string; requestId?: string } | undefined,
    isSuccess: false,
  },
  stellarRequestDepositSuccess: false,
  stellarMinDeposit: 10_000_000_000n as bigint | undefined,
  requests: undefined as
    | {
        type: string;
        request_id: string;
        amount: string;
        status: string;
        created_at: string;
      }[]
    | undefined,
  invalidate: vi.fn(),
  stellarClaimError: null as Error | null,
  stellarClaimReset: vi.fn(),
  voucherInvalidate: vi.fn(),
  refetchIntervalFn: undefined as
    | ((data: unknown) => number | false)
    | undefined,
}));

const defaultStellarRequests = () => [
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
];

vi.mock("@/wallet", async () => ({
  formatUnits: (await import("viem")).formatUnits,
  useWalletView: () => ({ kind: mockXlmState.kind }),

  useEvmNetworkGuard: () => ({ wrongNetwork: undefined }),
  // EVM (unused on the Stellar path, but called unconditionally)
  useEvmWallet: () => ({
    address: ctl.evmConnected ? EVM_ADDRESS : undefined,
    isConnected: ctl.evmConnected,
    connect: vi.fn(),
  }),
  useDepositManagerAddresses: () => ({ plusd: undefined, usdc: undefined }),
  useDepositManagerMinDeposit: () => ({
    minDeposit: ctl.evmConnected ? 1_000_000_000n : undefined,
  }),
  useEvmToken: () => ({
    decimals: ctl.evmConnected ? 6 : undefined,
    balance: ctl.evmConnected ? 5_000_000_000n : undefined,
    formattedBalance: undefined,
    allowance: 0n,
    approve: vi.fn(),
    isApprovePending: ctl.isApprovePending,
    isApproveSuccess: ctl.isApproveSuccess,
    approveError: ctl.approveError,
    refetchBalance: vi.fn(),
    isLoading: false,
  }),
  useRequestDeposit: () => ({
    data: ctl.evmRequestDeposit.data,
    isPending: false,
    isSuccess: ctl.evmRequestDeposit.isSuccess,
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
    isSuccess: ctl.stellarRequestDepositSuccess,
    error: null,
    write: vi.fn(),
    reset: vi.fn(),
  }),
  useStellarClaim: () => ({
    write: mockStellarClaimWrite,
    isPending: false,
    isSuccess: false,
    error: ctl.stellarClaimError,
    reset: ctl.stellarClaimReset,
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
  readInflightEvmRequest: (kind: string) =>
    kind === "deposit" ? ctl.evmDepositInflight : undefined,
  clearInflightEvmRequest: mockClearInflightEvm,
  useStellarDepositManagerMinDeposit: () => ({
    minDeposit: ctl.stellarMinDeposit,
  }),
  useStellarNetworkFeeEstimate: () => ({ feeXlm: undefined }),
}));

// ── Mock @/api (entire barrel) ───────────────────────────────────────────────────

let mockStellarDepositVoucherData: { deadline?: string } | undefined =
  undefined;
let mockStellarWithdrawVoucherData: { deadline?: string } | undefined =
  undefined;

vi.mock("@/api", () => ({
  useRequests: (opts?: {
    refetchInterval?: (data: unknown) => number | false;
  }) => {
    ctl.refetchIntervalFn = opts?.refetchInterval;
    return {
      data: { requests: ctl.requests ?? defaultStellarRequests() },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useInvalidateRequests: () => ctl.invalidate,
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
    invalidate: ctl.voucherInvalidate,
  }),
  useStellarWithdrawalVoucher: () => ({
    data: mockStellarWithdrawVoucherData,
    signatureBytes: SIG_BYTES,
    status: "ready",
    error: null,
    refetch: vi.fn(),
  }),
}));

const queue = vi.hoisted(() => ({
  totalQueued: undefined as bigint | undefined,
  totalClaimed: undefined as bigint | undefined,
  rate: undefined as bigint | undefined,
  paused: undefined as boolean | undefined,
  position: undefined as bigint | undefined,
  claimable: undefined as boolean | undefined,
  payout: undefined as bigint | undefined,
}));

vi.mock("./stellar/useStellarWithdrawalQueueReads", () => ({
  useStellarWithdrawalQueueTotals: () => ({
    totalQueued: queue.totalQueued,
    totalClaimed: queue.totalClaimed,
    rate: queue.rate,
    paused: queue.paused,
    isLoading: false,
    error: null,
  }),
  useStellarWithdrawalRequestQueueState: () => ({
    position: queue.position,
    claimable: queue.claimable,
    isLoading: false,
    error: null,
  }),
  useStellarClaimPayout: () => ({
    data: queue.payout,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./evm/useEvmWithdrawalQueueReads", () => ({
  useEvmWithdrawalQueueTotals: () => ({
    totalQueued: undefined,
    totalClaimed: undefined,
    payoutPerPlusd: undefined,
    paused: undefined,
    plusdDecimals: undefined,
    usdcDecimals: undefined,
    isLoading: false,
    error: null,
  }),
  useEvmWithdrawalRequestQueueState: () => ({
    position: undefined,
    claimable: undefined,
    isLoading: false,
    error: null,
  }),
  useEvmClaimPayout: () => ({ data: undefined, isLoading: false, error: null }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

function resetCtl() {
  Object.assign(queue, {
    totalQueued: undefined,
    totalClaimed: undefined,
    rate: undefined,
    paused: undefined,
    position: undefined,
    claimable: undefined,
    payout: undefined,
  });
  ctl.evmConnected = false;
  ctl.approveError = null;
  ctl.isApprovePending = false;
  ctl.isApproveSuccess = false;
  ctl.evmDepositInflight = undefined;
  ctl.evmRequestDeposit = { data: undefined, isSuccess: false };
  ctl.stellarRequestDepositSuccess = false;
  ctl.stellarMinDeposit = 10_000_000_000n;
  ctl.requests = undefined;
  ctl.stellarClaimError = null;
  ctl.refetchIntervalFn = undefined;
}

describe("useDepositFlow — needsXlmFunding (#1196/#1130)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
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
    resetCtl();
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

describe("useDepositFlow — EVM approve errors (#1658)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
    mockXlmState.kind = "evm";
    ctl.evmConnected = true;
    ctl.requests = [];
  });

  it("an approve error puts step 1 in the error state with mapped copy", () => {
    ctl.approveError = new Error("User rejected the request.");
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.step1.state).toBe("error");
    expect(result.current.step1.errorMessage).toBeTruthy();
    expect(result.current.step1.errorDetails).toContain("User rejected");
    expect(result.current.step1Tx.error).toBe(ctl.approveError);
    expect(result.current.step1Tx.userError).toBeDefined();
  });

  it("applies to the withdraw direction too", () => {
    ctl.approveError = new Error("User rejected the request.");
    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.step1.state).toBe("error");
    expect(result.current.step1Tx.error).toBe(ctl.approveError);
  });

  it("a pending approve is not an error", () => {
    ctl.approveError = new Error("stale");
    ctl.isApprovePending = true;
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.step1.state).toBe("idle");
    expect(result.current.step1.errorMessage).toBeUndefined();
  });

  it("a confirmed request wins over a lingering approve error", () => {
    ctl.approveError = new Error("stale");
    ctl.evmRequestDeposit = {
      data: { hash: "0xabc", requestId: "7" },
      isSuccess: true,
    };
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.step1.state).toBe("success");
    expect(result.current.step1.errorMessage).toBeUndefined();
  });

  it("no error leaves step 1 idle", () => {
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.step1.state).toBe("idle");
    expect(result.current.step1Tx.error).toBeNull();
  });
});

describe("useDepositFlow — EVM in-flight reload guard (#1658)", () => {
  const inflight = {
    requestId: "9",
    amount: "2000000000",
    txHash: "0xdead",
    createdAt: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
    mockXlmState.kind = "evm";
    ctl.evmConnected = true;
    ctl.requests = [];
  });

  it("locks the form and disables approve/confirm while the API has not listed the request", () => {
    ctl.evmDepositInflight = inflight;
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 2_000_000_000n, vi.fn()),
    );
    expect(result.current.requestIsConfirmed).toBe(true);
    expect(result.current.requestId).toBe("9");
    expect(result.current.step1.disabled).toBe(true);
    expect(result.current.step2.disabled).toBe(true);
    expect(result.current.isAmountLocked).toBe(true);
    expect(result.current.lockedAmountRaw).toBe(2_000_000_000n);
    expect(result.current.step2.loading).toBe(true);
    expect(result.current.isPendingVerification).toBe(true);
    expect(result.current.exceedsBalance).toBe(false);
  });

  it("hands over to the API and clears the record once the id is listed", () => {
    ctl.evmDepositInflight = inflight;
    ctl.requests = [
      {
        type: "Deposit",
        request_id: "9",
        amount: "2000000000",
        status: "PendingVerification",
        created_at: new Date().toISOString(),
      },
    ];
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(mockClearInflightEvm).toHaveBeenCalledWith(
      "deposit",
      expect.any(Number),
      EVM_ADDRESS,
    );
    expect(result.current.isPendingVerification).toBe(true);
    expect(result.current.lockedAmountRaw).toBe(2_000_000_000n);
  });

  it("a Completed listing ends the guard", () => {
    ctl.evmDepositInflight = inflight;
    ctl.requests = [
      {
        type: "Deposit",
        request_id: "9",
        amount: "2000000000",
        status: "Completed",
        created_at: new Date().toISOString(),
      },
    ];
    const { result } = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(result.current.isAmountLocked).toBe(false);
    expect(result.current.requestIsConfirmed).toBe(false);
  });

  it("polls fast while a known id is unlisted and slow once listed", () => {
    ctl.evmDepositInflight = inflight;
    renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    const fn = ctl.refetchIntervalFn!;
    expect(fn({ requests: [] })).toBe(5_000);
    expect(
      fn({
        requests: [
          { type: "Deposit", request_id: "9", status: "PendingVerification" },
        ],
      }),
    ).toBe(60_000);
  });

  it("polls slowly with no known ids", () => {
    renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(ctl.refetchIntervalFn!({ requests: [] })).toBe(60_000);
  });
});

describe("useDepositFlow — requests invalidation (#1658)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
  });

  it("invalidates once when the EVM request mutation succeeds", () => {
    mockXlmState.kind = "evm";
    ctl.evmConnected = true;
    ctl.requests = [];
    const { rerender } = renderHook(() =>
      useDepositFlow("deposit", 0n, vi.fn()),
    );
    expect(ctl.invalidate).not.toHaveBeenCalled();
    ctl.evmRequestDeposit = {
      data: { hash: "0xabc", requestId: "7" },
      isSuccess: true,
    };
    rerender();
    rerender();
    expect(ctl.invalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates once when the Stellar request mutation succeeds", () => {
    mockXlmState.kind = "stellar";
    const { rerender } = renderHook(() =>
      useDepositFlow("deposit", 0n, vi.fn()),
    );
    expect(ctl.invalidate).not.toHaveBeenCalled();
    ctl.stellarRequestDepositSuccess = true;
    rerender();
    rerender();
    expect(ctl.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useDepositFlow — Stellar min deposit from the contract (#1658)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
    mockXlmState.kind = "stellar";
    ctl.requests = [];
  });

  it("follows the hook value for the chip, minDeposit and meetsMin", () => {
    ctl.stellarMinDeposit = 500n * 10n ** 7n;
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 600n * 10n ** 7n, vi.fn()),
    );
    expect(result.current.minDeposit).toBe(500n * 10n ** 7n);
    expect(result.current.minChipLabel).toContain("500");
    expect(result.current.meetsMin).toBe(true);
  });

  it("an amount below the contract minimum does not meet it", () => {
    ctl.stellarMinDeposit = 500n * 10n ** 7n;
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 400n * 10n ** 7n, vi.fn()),
    );
    expect(result.current.meetsMin).toBe(false);
  });

  it("while undefined: not ready, confirm disabled, chip reads Min and is a no-op", () => {
    ctl.stellarMinDeposit = undefined;
    const setAmount = vi.fn();
    const { result } = renderHook(() =>
      useDepositFlow("deposit", 5_000n * 10n ** 7n, setAmount),
    );
    expect(result.current.minDeposit).toBeUndefined();
    expect(result.current.minChipLabel).toBe("Min");
    expect(result.current.isReady).toBe(false);
    expect(result.current.hasBalance).toBeUndefined();
    expect(result.current.meetsMin).toBe(false);
    expect(result.current.step2.disabled).toBe(true);
    act(() => {
      result.current.onQuickAmount(0);
    });
    expect(setAmount).not.toHaveBeenCalled();
  });
});

describe("useDepositFlow — expired voucher claim retry (#1760)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
    mockXlmState.kind = "stellar";
    mockXlmState.xlmBalance = "100";
    mockXlmState.accountExists = true;
    mockStellarDepositVoucherData = { deadline: "1800000000" };
  });

  it("refetches the voucher once and clears the claim error on a deadline-expired claim", () => {
    ctl.stellarClaimError = new Error("HostError: Error(Contract, #4)");

    const { rerender } = renderHook(() =>
      useDepositFlow("deposit", 0n, vi.fn()),
    );

    expect(ctl.voucherInvalidate).toHaveBeenCalledTimes(1);
    expect(ctl.stellarClaimReset).toHaveBeenCalledTimes(1);

    rerender();
    expect(ctl.voucherInvalidate).toHaveBeenCalledTimes(1);
    expect(ctl.stellarClaimReset).toHaveBeenCalledTimes(1);
  });

  it("shows the docs copy and does not retry a second time for the same request", () => {
    ctl.stellarClaimError = new Error("HostError: Error(Contract, #4)");

    const { result, rerender } = renderHook(() =>
      useDepositFlow("deposit", 0n, vi.fn()),
    );
    rerender();

    expect(result.current.step3.state).toBe("error");
    expect(result.current.step3.errorMessage).toBe(
      "The voucher expired or did not match the request. Your app fetches a fresh voucher.",
    );
    expect(ctl.voucherInvalidate).toHaveBeenCalledTimes(1);
  });

  it("does not retry on other contract errors or a bad-signature host error", () => {
    ctl.stellarClaimError = new Error("HostError: Error(Crypto, InvalidInput)");
    const { rerender } = renderHook(() =>
      useDepositFlow("deposit", 0n, vi.fn()),
    );
    ctl.stellarClaimError = new Error("HostError: Error(Contract, #11)");
    rerender();

    expect(ctl.voucherInvalidate).not.toHaveBeenCalled();
    expect(ctl.stellarClaimReset).not.toHaveBeenCalled();
  });
});

describe("useDepositFlow — withdraw queue state (#1759)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCtl();
    mockXlmState.kind = "stellar";
    mockXlmState.xlmBalance = "100";
    mockXlmState.accountExists = true;
    mockStellarWithdrawVoucherData = { deadline: "1800000000" };
  });

  it("keeps Claim enabled with no hint while payable and paused are unknown", () => {
    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );
    expect(result.current.step3.disabled).toBe(false);
    expect(result.current.step3.hint).toBeUndefined();
  });

  it("disables Claim and shows the custody-short hint when not payable", () => {
    queue.claimable = false;
    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );
    expect(result.current.step3.disabled).toBe(true);
    expect(result.current.step3.hint).toBe(
      "The withdrawal custody account is short. Claims for your position wait until it is funded.",
    );
  });

  it("paused disables Claim and wins over not payable", () => {
    queue.paused = true;
    queue.claimable = false;
    const { result } = renderHook(() =>
      useDepositFlow("withdraw", 0n, vi.fn()),
    );
    expect(result.current.step3.disabled).toBe(true);
    expect(result.current.step3.hint).toBe(
      "The withdrawal queue is paused. Check the status page before retrying.",
    );
  });

  it("shows the request hint on the idle withdraw step 2 only", () => {
    ctl.requests = [];
    const withdraw = renderHook(() => useDepositFlow("withdraw", 0n, vi.fn()));
    expect(withdraw.result.current.step2.hint).toBe(
      "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed.",
    );
    const deposit = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(deposit.result.current.step2.hint).toBeUndefined();
  });

  it("exposes raw queue values on withdraw and nothing on deposit", () => {
    queue.position = 25_000_000_000n;
    queue.claimable = true;
    const withdraw = renderHook(() => useDepositFlow("withdraw", 0n, vi.fn()));
    expect(withdraw.result.current.withdrawQueue).toMatchObject({
      requestAmount: 10_000_000_000n,
      position: 25_000_000_000n,
      payableNow: true,
      recoveryActive: false,
    });
    const deposit = renderHook(() => useDepositFlow("deposit", 0n, vi.fn()));
    expect(deposit.result.current.withdrawQueue).toBeUndefined();
    expect(deposit.result.current.step3.hint).toBeUndefined();
  });

  it("shows the contract payout in the recovery hint and — until it resolves", () => {
    queue.claimable = true;
    queue.rate = 950_000n;
    const pending = renderHook(() => useDepositFlow("withdraw", 0n, vi.fn()));
    expect(pending.result.current.withdrawQueue?.recoveryActive).toBe(true);
    expect(pending.result.current.step3.hint).toBe(
      "Pays — USDC = 1,000.00 PLUSD × 0.95",
    );
    queue.payout = 9_500_000_000n;
    const resolved = renderHook(() => useDepositFlow("withdraw", 0n, vi.fn()));
    expect(resolved.result.current.step3.hint).toBe(
      "Pays 950.00 USDC = 1,000.00 PLUSD × 0.95",
    );
  });
});
