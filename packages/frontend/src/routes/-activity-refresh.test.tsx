// spec: docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "./transactions";
import { RecentActivityCard } from "@/components/RecentActivityCard";
import {
  addExpectation,
  resetExpectationsForTests,
} from "@/api/activityRefresh";
import type { RequestItem, RequestsResponse } from "@/api";
import { ENV } from "@/lib/env";

const WALLET = "0x1234000000000000000000000000000000000001";

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api")>();
  return {
    ...actual,
    useChainServed: () => ({
      kind: "evm" as const,
      chainId: 560048,
      chainName: "Hoodi",
      served: true,
    }),
  };
});

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useEvmWallet: () => ({
      isConnected: true,
      address: WALLET,
      connect: vi.fn(),
    }),
    useStellarWallet: () => ({ isConnected: false, address: undefined }),
    useWalletView: () => ({ kind: "evm" as const }),
    useEvmStakeDecimals: () => ({ plusd: 6, splusd: 6 }),
    useConnectModal: () => ({ open: vi.fn(), close: vi.fn() }),
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/transactions"),
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function item(over: Partial<RequestItem>): RequestItem {
  return {
    type: "Deposit",
    chain_id: ENV.EVM_CHAIN_ID,
    amount: "5000000",
    request_id: "1",
    status: "PendingClaim",
    created_at: "2026-05-15T12:00:00Z",
    ...over,
  };
}

let body: RequestsResponse;

const sellRows = () =>
  screen
    .getAllByTestId(/^transactions-row-/)
    .filter((r) => r.textContent?.includes("Sell"));

function mount(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expect_(over: Record<string, unknown>) {
  addExpectation({
    wallet: WALLET,
    chainId: ENV.EVM_CHAIN_ID,
    type: "Deposit",
    deadline: Date.now() + 60_000,
    ...over,
  } as Parameters<typeof addExpectation>[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetExpectationsForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  resetExpectationsForTests();
});

describe("Activity refresh after a confirmed action (#1810)", () => {
  it("the Transactions page shows the new Sell row without a remount", async () => {
    body = { requests: [item({ request_id: "1", status: "Completed" })] };
    expect_({ type: "Withdraw", requestId: "9" });
    const Page = Route.options.component as React.ComponentType;
    mount(<Page />);
    await advance(0);
    await vi.waitFor(() =>
      expect(screen.getAllByTestId(/^transactions-row-/)).toHaveLength(1),
    );
    expect(sellRows()).toHaveLength(0);

    body = {
      requests: [
        item({ request_id: "1", status: "Completed" }),
        item({
          type: "Withdraw",
          request_id: "9",
          status: "PendingVerification",
        }),
      ],
    };
    await advance(3_000);
    await vi.waitFor(() =>
      expect(screen.getAllByTestId(/^transactions-row-/)).toHaveLength(2),
    );
    expect(sellRows()).toHaveLength(1);
  });

  it("Home Recent activity flips a claimed deposit from Pending to Completed", async () => {
    body = { requests: [item({ request_id: "4", status: "PendingClaim" })] };
    expect_({ type: "Deposit", requestId: "4", status: "Completed" });
    mount(<RecentActivityCard />);
    await advance(0);
    await vi.waitFor(() =>
      expect(screen.getByText("Pending")).toBeInTheDocument(),
    );

    body = { requests: [item({ request_id: "4", status: "Completed" })] };
    await advance(3_000);
    await vi.waitFor(() =>
      expect(screen.queryByText("Pending")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("+5.00 PLUSD")).toBeInTheDocument();
  });
});
