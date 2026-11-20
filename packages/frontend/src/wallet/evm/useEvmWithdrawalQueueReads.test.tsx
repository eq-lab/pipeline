// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const QUEUE = "0x00000000000000000000000000000000000000a1";
const PLUSD = "0x00000000000000000000000000000000000000b2";
const USDC = "0x00000000000000000000000000000000000000c3";
const ZERO = "0x0000000000000000000000000000000000000000";

const { env, reads, readSpy } = vi.hoisted(() => ({
  env: { WITHDRAWAL_QUEUE_ADDRESS: "" },
  reads: {} as Record<string, unknown>,
  readSpy: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ ENV: env }));
vi.mock("./useDepositManager", () => ({
  useDepositManagerAddresses: () => ({ plusd: PLUSD, usdc: USDC }),
}));
vi.mock("wagmi", () => ({
  useReadContract: (args: {
    address?: string;
    functionName: string;
    query?: { enabled?: boolean };
  }) => {
    readSpy(args);
    const enabled = args.query?.enabled ?? true;
    if (!enabled) return { data: undefined, isLoading: false, error: null };
    const key =
      args.functionName === "decimals"
        ? `decimals:${args.address}`
        : args.functionName;
    return { data: reads[key], isLoading: false, error: null };
  },
}));

import {
  useEvmClaimPayout,
  useEvmWithdrawalQueueTotals,
  useEvmWithdrawalRequestQueueState,
} from "./useEvmWithdrawalQueueReads";

beforeEach(() => {
  vi.clearAllMocks();
  env.WITHDRAWAL_QUEUE_ADDRESS = QUEUE;
  for (const k of Object.keys(reads)) delete reads[k];
  reads.queueMetadata = [20n, 8n];
  reads.paused = false;
  reads.convertToAssets = 950_000n;
  reads.isClaimable = true;
  reads.withdrawalRequestQueued = 55n;
  reads[`decimals:${PLUSD}`] = 6;
  reads[`decimals:${USDC}`] = 6;
});

describe("useEvmWithdrawalQueueTotals", () => {
  it("maps the queueMetadata tuple and passes values through", () => {
    const { result } = renderHook(() => useEvmWithdrawalQueueTotals());
    expect(result.current).toMatchObject({
      totalQueued: 20n,
      totalClaimed: 8n,
      payoutPerPlusd: 950_000n,
      paused: false,
      plusdDecimals: 6,
      usdcDecimals: 6,
    });
  });

  it("calls convertToAssets with 10^plusdDecimals", () => {
    renderHook(() => useEvmWithdrawalQueueTotals());
    const call = readSpy.mock.calls
      .map(([a]) => a)
      .find((a) => a.functionName === "convertToAssets");
    expect(call.args).toEqual([1_000_000n]);
  });

  it("is idle when disabled or on the zero address", () => {
    const off = renderHook(() =>
      useEvmWithdrawalQueueTotals({ enabled: false }),
    );
    expect(off.result.current.totalQueued).toBeUndefined();
    env.WITHDRAWAL_QUEUE_ADDRESS = ZERO;
    const zero = renderHook(() => useEvmWithdrawalQueueTotals());
    expect(zero.result.current.totalQueued).toBeUndefined();
    expect(zero.result.current.paused).toBeUndefined();
  });
});

describe("useEvmWithdrawalRequestQueueState", () => {
  it("returns position and isClaimable for the request", () => {
    const { result } = renderHook(() => useEvmWithdrawalRequestQueueState(3n));
    expect(result.current.position).toBe(55n);
    expect(result.current.claimable).toBe(true);
  });

  it("is idle without a request id or on the zero address", () => {
    const none = renderHook(() => useEvmWithdrawalRequestQueueState(undefined));
    expect(none.result.current.position).toBeUndefined();
    env.WITHDRAWAL_QUEUE_ADDRESS = ZERO;
    const zero = renderHook(() => useEvmWithdrawalRequestQueueState(3n));
    expect(zero.result.current.claimable).toBeUndefined();
  });
});

describe("useEvmClaimPayout", () => {
  it("returns convertToAssets(amount) and is idle without an amount", () => {
    const ok = renderHook(() => useEvmClaimPayout(2_000_000n));
    expect(ok.result.current.data).toBe(950_000n);
    const none = renderHook(() => useEvmClaimPayout(undefined));
    expect(none.result.current.data).toBeUndefined();
  });
});
