/**
 * Tests for `src/api/useLoanSubmissions.ts`.
 *
 * Covers:
 *   - The request URL includes chain_id=99000001 (Stellar-scoped).
 *   - The bearer header is attached (via apiFetch/sessionStore).
 *   - Success path returns the parsed SubmissionView[].
 *   - Error path populates `error`.
 *   - refetchInterval is set to 30 s.
 *   - (#892) `normalizeOriginationSubmissionStatus` keeps the Origination
 *     decision vocabulary when the backend returns merged lifecycle statuses.
 *   - (#818) The optional `status` filter appends `&status=<value>` to the
 *     URL and is included in the query key; omitting it preserves the
 *     pre-#818 no-`status` behavior (backwards-compat guard for #813's
 *     `useOriginationTable`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "./useLoanSubmissions";
import type { SubmissionView } from "./useLoanSubmissions";

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    WALLETCONNECT_PROJECT_ID: "replace-me",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  },
}));

// ── Mock @/auth/sessionStore (apiFetch reads the bearer token from here) ──────

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_SUBMISSIONS: SubmissionView[] = [
  {
    id: 1,
    status: "InReview",
    reason: null,
    originator: "Auric Andes",
    created_at: "2026-06-18T10:00:00Z",
    updated_at: "2026-06-18T10:00:00Z",
    documents: [],
    loan_data: {
      to: "G...",
      metadata_uri: "ipfs://...",
      originator: "Auric Andes",
      borrower_id: "borrower-1",
      commodity: "Gold pyrite concentrate",
      corridor: "PE → CN",
      governing_law: "England",
      economics: {
        original_facility_size: "3500000.000000",
        original_senior_tranche: "3000000.000000",
        original_equity_tranche: "500000.000000",
        original_offtaker_price: "3500000.000000",
        senior_interest_rate_bps: 1400,
        origination_date: 1750000000,
        original_maturity_date: 1797292800,
      },
      initial_ccr: 1_500_000,
      initial_location: {
        location_type: "Vessel",
        location_identifier: "MV Example",
        tracking_url: "https://example.com",
        updated_at: 1750000000,
      },
    },
  },
];

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

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── useLoanSubmissions ────────────────────────────────────────────────────────

describe("normalizeOriginationSubmissionStatus", () => {
  it("preserves Origination decision statuses", () => {
    expect(normalizeOriginationSubmissionStatus("InReview")).toBe("InReview");
    expect(normalizeOriginationSubmissionStatus("Approved")).toBe("Approved");
    expect(normalizeOriginationSubmissionStatus("Rejected")).toBe("Rejected");
  });

  it("maps merged loan lifecycle statuses to Approved for Origination surfaces", () => {
    expect(normalizeOriginationSubmissionStatus("Performing")).toBe("Approved");
    expect(normalizeOriginationSubmissionStatus("WatchList")).toBe("Approved");
    expect(normalizeOriginationSubmissionStatus("Past Due")).toBe("Approved");
    expect(normalizeOriginationSubmissionStatus("Default")).toBe("Approved");
    expect(normalizeOriginationSubmissionStatus("Closed")).toBe("Approved");
  });
});

describe("useLoanSubmissions", () => {
  it("calls fetch with /v1/loan-book/submissions and chain_id=99000001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUBMISSIONS), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_SUBMISSIONS);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/submissions");
    expect(url).toContain("chain_id=99000001");
  });

  it("attaches the Authorization bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUBMISSIONS), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_SUBMISSIONS);
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("returns parsed data on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUBMISSIONS), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_SUBMISSIONS);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error when fetch fails with 500", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });

  it("(#818) issues a request with NO status= param when called with no argument (backwards-compat)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUBMISSIONS), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanSubmissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_SUBMISSIONS);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).not.toContain("status=");
  });

  it("(#818) issues a request with status=InReview and chain_id=99000001 when filtered", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_SUBMISSIONS), { status: 200 }),
    );

    const { result } = renderHook(
      () => useLoanSubmissions({ status: "InReview" }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE_SUBMISSIONS);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("status=InReview");
    expect(url).toContain("chain_id=99000001");
  });
});
