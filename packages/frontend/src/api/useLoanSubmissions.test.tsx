// spec: docs/frontend/hooks.md
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanSubmissions } from "./useLoanSubmissions";
import { mapSubmissionToRow } from "@/components/dashboard/originationRow";

// ── Mock @/wallet (client.ts dependency) ─────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseJson: (value: string) => JSON.parse(value) as unknown,
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

describe("useLoanSubmissions — no chain scoping", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("requests all submissions without chain_id", async () => {
    renderHook(() => useLoanSubmissions(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/submissions");
    expect(url).not.toContain("chain_id");
  });

  it("still returns and maps a legacy submission that carries initial_ccr", async () => {
    const legacy = {
      id: 1,
      status: "InReview",
      reason: null,
      originator: "0xabc",
      target_chain_id: 560048,
      chain_id: null,
      loan_id: null,
      created_at: "2026-06-18T10:00:00Z",
      updated_at: "2026-06-18T10:00:00Z",
      loan_data: {
        to: "0xdef",
        metadata_uri: "ipfs://meta",
        originator: "Auric Andes",
        borrower_id: "borrower-1",
        commodity: "Gold pyrite concentrate",
        corridor: "PE-CN",
        governing_law: "England",
        economics: {
          original_facility_size: "3500000.000000",
          original_senior_tranche: "3000000.000000",
          original_equity_tranche: "500000.000000",
          original_offtaker_price: "3500000.000000",
          senior_interest_rate_bps: 1400,
          origination_date: 1_750_000_000,
          original_maturity_date: 1_797_292_800,
        },
        initial_ccr: 1_500_000,
        initial_location: {
          location_type: "Vessel",
          location_identifier: "MV Example",
          tracking_url: "https://example.com",
          updated_at: 1_750_000_000,
        },
      },
    };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book/submissions",
      JSON.stringify([legacy]),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    const row = mapSubmissionToRow(result.current.data![0]!);
    expect(row.commodity).toBe("Gold pyrite concentrate");
    expect(row.facility).toBe("$3.5M");
  });
});
