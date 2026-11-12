// spec: docs/frontend/trustee-flows.md#loan-detail (per-loan identity (chain_id, loan_id), Stellar-only action gate, #1537).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { LoanBookEntry } from "@/api/useLoanBook";

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useLoanSecurity", () => ({ useLoanSecurity: vi.fn() }));
vi.mock("@/api/useLoanFinancials", () => ({ useLoanFinancials: vi.fn() }));
vi.mock("@/api/useDealToken", () => ({ useDeal: vi.fn() }));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useDeal } from "@/api/useDealToken";
import { useLoanDetail } from "./-useLoanDetail";
import { securityResult } from "./-riskCouncilFixtures";

const mockUseLoanBook = vi.mocked(useLoanBook);
const mockUseLoanSecurity = vi.mocked(useLoanSecurity);
const mockUseLoanFinancials = vi.mocked(useLoanFinancials);
const mockUseDeal = vi.mocked(useDeal);

function entry(overrides: Partial<LoanBookEntry>): LoanBookEntry {
  return {
    loan_id: "4",
    chain_id: 99_000_001,
    originator: "Helios Metals",
    borrower: "b",
    commodity: "Lithium",
    principal: "1000.000000",
    senior_outstanding: "800.000000",
    original_senior_tranche: "800.000000",
    maturity: 1_782_777_600,
    next_payment_timestamp: 1_782_777_600,
    days_overdue: null,
    duration_days: 180,
    rate: "0.13",
    protection: null,
    status: "Performing",
    onchain_status: "Performing",
    documents: [],
    repaid_to_date: "0",
    disbursed: true,
    days_on_watchlist: null,
    watchlist_entered_at: null,
    ...overrides,
  };
}

const IDLE = {
  data: undefined,
  isLoading: false,
  error: null,
  refetch: () => {},
};

beforeEach(() => {
  mockUseLoanBook.mockReturnValue({
    ...IDLE,
    data: {
      summary: {} as never,
      loans: [
        entry({ chain_id: 99_000_001, loan_id: "4", originator: "Stellar Co" }),
        entry({ chain_id: 560048, loan_id: "4", originator: "Hoodi Co" }),
      ],
    },
  });
  mockUseDeal.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  } as never);
  mockUseLoanSecurity.mockReturnValue(securityResult());
  mockUseLoanFinancials.mockReturnValue(IDLE);
});

describe("useLoanDetail (#1537)", () => {
  it("passes the chain to every per-loan hook and matches the row on (chain_id, loan_id)", () => {
    const { result } = renderHook(() => useLoanDetail(560048, "4"));
    expect(mockUseLoanSecurity).toHaveBeenCalledWith(560048, "4");
    expect(mockUseLoanFinancials).toHaveBeenCalledWith(560048, "4");
    expect(result.current.hero.title).toBe("Hoodi Co · Lithium");
  });

  it("reports the Stellar-only gate for a non-Stellar loan and nothing for a Stellar one", () => {
    const evm = renderHook(() => useLoanDetail(560048, "4"));
    expect(evm.result.current.onChainBlockedReason).toContain("lives on Hoodi");

    const stellar = renderHook(() => useLoanDetail(99_000_001, "4"));
    expect(stellar.result.current.hero.title).toBe("Stellar Co · Lithium");
    expect(stellar.result.current.onChainBlockedReason).toBeNull();
  });

  it("reports no gate while the row is unknown", () => {
    const { result } = renderHook(() => useLoanDetail(99_000_001, "999"));
    expect(result.current.hero.title).toBe("Loan #999");
    expect(result.current.onChainBlockedReason).toBeNull();
  });

  it("builds the security card for a Stellar loan and hides it when not configured", () => {
    const ready = renderHook(() => useLoanDetail(99_000_001, "4"));
    expect(ready.result.current.security.state).toBe("ready");
    expect(ready.result.current.security.ltv).toBe("81.2%");

    mockUseLoanSecurity.mockReturnValue(
      securityResult({ data: undefined, notConfigured: true }),
    );
    const evm = renderHook(() => useLoanDetail(560048, "4"));
    expect(evm.result.current.security.state).toBe("hidden");
  });
});
