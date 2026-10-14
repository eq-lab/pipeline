import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const PLUSD = "0x00000000000000000000000000000000000000a1";
const USDC = "0x00000000000000000000000000000000000000b2";
const CUSTODIAN = "0x00000000000000000000000000000000000000c3";
const DM = "0x00000000000000000000000000000000000000d4";

const { env, readState, readSpy } = vi.hoisted(() => ({
  env: { DEPOSIT_MANAGER_ADDRESS: "" },
  readState: {
    totalSupply: undefined as bigint | undefined,
    balanceOf: undefined as bigint | undefined,
    decimals: undefined as number | undefined,
    custodian: undefined as string | undefined,
    custodianError: null as Error | null,
  },
  readSpy: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ ENV: env }));

vi.mock("./useDepositManager", () => ({
  useDepositManagerAddresses: () => ({
    plusd: PLUSD,
    usdc: USDC,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("wagmi", () => ({
  useReadContract: (args: {
    functionName: keyof typeof readState;
    query?: { enabled?: boolean };
  }) => {
    readSpy(args);
    const enabled = args.query?.enabled ?? true;
    if (!enabled) return { data: undefined, isLoading: false, error: null };
    if (args.functionName === "custodian") {
      return {
        data: readState.custodian,
        isLoading: false,
        error: readState.custodianError,
      };
    }
    return {
      data: readState[args.functionName],
      isLoading: false,
      error: null,
    };
  },
}));

import {
  useEvmPlusdTotalSupply,
  useEvmUsdcCustodyBalance,
} from "./useEvmFinancialPositionReads";

beforeEach(() => {
  env.DEPOSIT_MANAGER_ADDRESS = DM;
  readState.totalSupply = 9_000_000_000n;
  readState.balanceOf = 10_000_000_000n;
  readState.decimals = 6;
  readState.custodian = CUSTODIAN;
  readState.custodianError = null;
  readSpy.mockClear();
});

describe("useEvmPlusdTotalSupply", () => {
  it("formats totalSupply at the live decimals", () => {
    const { result } = renderHook(() => useEvmPlusdTotalSupply());
    expect(result.current.data).toBe("9000");
  });

  it("does not read when disabled", () => {
    const { result } = renderHook(() =>
      useEvmPlusdTotalSupply({ enabled: false }),
    );
    expect(result.current.data).toBeUndefined();
    expect(readSpy.mock.calls.every(([a]) => a.query?.enabled === false)).toBe(
      true,
    );
  });
});

describe("useEvmUsdcCustodyBalance", () => {
  it("formats the custodian USDC balance at the live decimals", () => {
    const { result } = renderHook(() => useEvmUsdcCustodyBalance());
    expect(result.current.data).toBe("10000");
  });

  it("makes no read when the DepositManager is the zero address", () => {
    env.DEPOSIT_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000000";
    const { result } = renderHook(() => useEvmUsdcCustodyBalance());
    expect(result.current.data).toBeUndefined();
    expect(readSpy.mock.calls.every(([a]) => a.query?.enabled === false)).toBe(
      true,
    );
  });

  it("returns undefined plus the error when custodian() reverts", () => {
    readState.custodian = undefined;
    readState.custodianError = new Error("execution reverted");
    const { result } = renderHook(() => useEvmUsdcCustodyBalance());
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe("execution reverted");
  });
});
