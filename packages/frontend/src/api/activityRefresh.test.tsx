import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RequestItem, RequestsResponse } from "./useRequests";
import {
  ACTIVITY_POLL_CAP_MS,
  addExpectation,
  getExpectations,
  isExpectationMet,
  openExpectationsFor,
  resetExpectationsForTests,
  settleExpectations,
  useActionConfirmedRefresh,
  type ActivityExpectation,
} from "./activityRefresh";

const view = vi.hoisted(() => ({
  kind: "evm" as "evm" | "stellar",
  evm: "0xAbCd000000000000000000000000000000000001" as string | undefined,
  stellar: "GSTELLAR" as string | undefined,
}));

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: view.kind }),
  useEvmWallet: () => ({ address: view.evm, isConnected: !!view.evm }),
  useStellarWallet: () => ({
    address: view.stellar,
    isConnected: !!view.stellar,
  }),
}));

vi.mock("@/lib/env", () => ({
  ENV: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99_000_001 },
}));

const WALLET = "0xabcd000000000000000000000000000000000001";

function row(over: Partial<RequestItem>): RequestItem {
  return {
    type: "Deposit",
    chain_id: 560048,
    amount: "1",
    status: "PendingClaim",
    created_at: "2026-05-15T12:00:00Z",
    ...over,
  };
}

function list(...rows: RequestItem[]): RequestsResponse {
  return { requests: rows };
}

function exp(
  over: Partial<ActivityExpectation> & Record<string, unknown>,
): ActivityExpectation {
  return {
    wallet: WALLET,
    chainId: 560048,
    type: "Deposit",
    deadline: 1_000_000,
    ...over,
  } as ActivityExpectation;
}

beforeEach(() => {
  resetExpectationsForTests();
  view.kind = "evm";
  view.evm = "0xAbCd000000000000000000000000000000000001";
  view.stellar = "GSTELLAR";
});

describe("isExpectationMet", () => {
  it("a request is met once its id is listed in any status", () => {
    const e = exp({ requestId: "7" });
    expect(isExpectationMet(e, undefined)).toBe(false);
    expect(isExpectationMet(e, list())).toBe(false);
    expect(isExpectationMet(e, list(row({ request_id: "8" })))).toBe(false);
    expect(
      isExpectationMet(
        e,
        list(row({ request_id: "7", status: "PendingVerification" })),
      ),
    ).toBe(true);
  });

  it("requires the same type for the id", () => {
    const e = exp({ requestId: "7", type: "Withdraw" });
    expect(isExpectationMet(e, list(row({ request_id: "7" })))).toBe(false);
  });

  it("a claim is met only once the served status is Completed", () => {
    const e = exp({ requestId: "7", status: "Completed" });
    expect(
      isExpectationMet(
        e,
        list(row({ request_id: "7", status: "PendingClaim" })),
      ),
    ).toBe(false);
    expect(
      isExpectationMet(e, list(row({ request_id: "7", status: "Completed" }))),
    ).toBe(true);
  });

  it("a baseline count is met only by more rows of the type", () => {
    const e = exp({ type: "Stake", baselineCount: 2 });
    const stake = row({ type: "Stake", status: "Completed" });
    expect(isExpectationMet(e, list(stake, stake))).toBe(false);
    expect(isExpectationMet(e, list(stake, stake, stake))).toBe(true);
    expect(
      isExpectationMet(
        e,
        list(
          row({ type: "Unstake" }),
          row({ type: "Unstake" }),
          row({ type: "Unstake" }),
        ),
      ),
    ).toBe(false);
  });

  it("an undefined baseline is met by the first row of the type", () => {
    const e = exp({ type: "Stake", baselineCount: undefined });
    expect(isExpectationMet(e, list())).toBe(false);
    expect(isExpectationMet(e, list(row({ type: "Stake" })))).toBe(true);
  });

  it("compares ids as strings", () => {
    const e = exp({ requestId: String(42n) });
    expect(isExpectationMet(e, list(row({ request_id: "42" })))).toBe(true);
  });
});

describe("openExpectationsFor", () => {
  const e = exp({ requestId: "7", deadline: 100 });

  it("matches the wallet case-insensitively and the chain id", () => {
    expect(
      openExpectationsFor([e], WALLET.toUpperCase(), 560048, list(), 0),
    ).toHaveLength(1);
    expect(openExpectationsFor([e], WALLET, 1, list(), 0)).toHaveLength(0);
    expect(openExpectationsFor([e], "0xother", 560048, list(), 0)).toHaveLength(
      0,
    );
    expect(openExpectationsFor([e], undefined, 560048, list(), 0)).toHaveLength(
      0,
    );
  });

  it("drops met and expired expectations", () => {
    expect(
      openExpectationsFor(
        [e],
        WALLET,
        560048,
        list(row({ request_id: "7" })),
        0,
      ),
    ).toHaveLength(0);
    expect(openExpectationsFor([e], WALLET, 560048, list(), 100)).toHaveLength(
      0,
    );
  });
});

describe("settleExpectations", () => {
  it("removes met and expired ones, keeps others, returns true only when one was met", () => {
    addExpectation(exp({ requestId: "7", deadline: 100 }));
    addExpectation(exp({ requestId: "8", deadline: 100 }));
    addExpectation(exp({ requestId: "7", chainId: 1, deadline: 100 }));
    addExpectation(exp({ requestId: "9", deadline: 5 }));
    const served = list(row({ request_id: "7" }), row({ request_id: "9" }));
    expect(settleExpectations(served, WALLET, 560048, 10)).toBe(true);
    const left = getExpectations().map((x) => [
      (x as { requestId: string }).requestId,
      x.chainId,
    ]);
    expect(left).toEqual([
      ["8", 560048],
      ["7", 1],
    ]);
  });

  it("returns false when only expired ones are removed", () => {
    addExpectation(exp({ requestId: "9", deadline: 5 }));
    expect(settleExpectations(list(), WALLET, 560048, 10)).toBe(false);
    expect(getExpectations()).toHaveLength(0);
  });

  it("keeps the same snapshot when nothing changes", () => {
    addExpectation(exp({ requestId: "9", deadline: 100 }));
    const before = getExpectations();
    settleExpectations(list(), WALLET, 560048, 10);
    expect(getExpectations()).toBe(before);
  });
});

describe("useActionConfirmedRefresh", () => {
  function setup() {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useActionConfirmedRefresh(), {
      wrapper,
    });
    return { queryClient, result, rerender };
  }

  const invalidated = (qc: QueryClient, key: readonly unknown[]) =>
    qc.getQueryState(key)?.isInvalidated;

  it("registers a request expectation for the active wallet and chain", () => {
    const { result } = setup();
    result.current({ type: "Withdraw", requestId: 99n });
    const [e] = getExpectations();
    expect(e).toMatchObject({
      wallet: view.evm,
      chainId: 560048,
      type: "Withdraw",
      requestId: "99",
    });
    expect(e).not.toHaveProperty("status");
    expect(e!.deadline).toBeGreaterThan(
      Date.now() + ACTIVITY_POLL_CAP_MS - 1_000,
    );
  });

  it("registers a Completed expectation for a claim", () => {
    const { result } = setup();
    result.current({ type: "Deposit", requestId: "7", claimed: true });
    expect(getExpectations()[0]).toMatchObject({
      requestId: "7",
      status: "Completed",
    });
  });

  it("uses the Stellar wallet and chain in the Stellar view", () => {
    view.kind = "stellar";
    const { result } = setup();
    result.current({ type: "Deposit", requestId: 1n });
    expect(getExpectations()[0]).toMatchObject({
      wallet: "GSTELLAR",
      chainId: 99_000_001,
    });
  });

  it("reads the baseline count of the type from the cached requests", () => {
    const { queryClient, result } = setup();
    queryClient.setQueryData(
      ["requests", "evm", view.evm, 560048, 0],
      list(
        row({ type: "Stake", status: "Completed" }),
        row({ type: "Stake", status: "Completed" }),
        row({ type: "Unstake", status: "Completed" }),
      ),
    );
    result.current({ type: "Stake" });
    expect(getExpectations()[0]).toMatchObject({
      type: "Stake",
      baselineCount: 2,
    });
  });

  it("leaves the baseline undefined when nothing is cached", () => {
    const { result } = setup();
    result.current({ type: "Unstake" });
    expect(getExpectations()[0]).toHaveProperty("baselineCount", undefined);
  });

  it("registers nothing without an address but still invalidates", () => {
    view.evm = undefined;
    const { queryClient, result } = setup();
    queryClient.setQueryData(["requests", "evm", null, 560048, 0], list());
    result.current({ type: "Stake" });
    expect(getExpectations()).toHaveLength(0);
    expect(invalidated(queryClient, ["requests", "evm", null, 560048, 0])).toBe(
      true,
    );
  });

  it("invalidates activity and balance reads only", () => {
    const { queryClient, result } = setup();
    const hit = [
      ["requests", "evm", view.evm, 560048, 0],
      ["pnl", "evm"],
      ["positionsHistory", "x"],
      ["stellarSacToken", "a"],
      ["stellarUsdcBalance", "a"],
      ["stellarStakedPlusdBalance", "a"],
      ["readContract", { functionName: "balanceOf", args: ["0x1"] }],
    ];
    const miss = [
      ["readContract", { functionName: "allowance", args: ["0x1"] }],
      ["readContract"],
      ["other"],
      ["stellarXlmBalance", "a"],
    ];
    for (const k of [...hit, ...miss]) {
      queryClient.setQueryData(k, k[0] === "requests" ? list() : { v: 1 });
    }
    result.current({ type: "Stake" });
    for (const k of hit) expect(invalidated(queryClient, k)).toBe(true);
    for (const k of miss) expect(invalidated(queryClient, k)).toBe(false);
  });

  it("returns a stable callback across rerenders", () => {
    const { result, rerender } = setup();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
