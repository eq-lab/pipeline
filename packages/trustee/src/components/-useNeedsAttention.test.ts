import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  loanAttentionLabel,
  mapLoanToNeedsAttentionRow,
  mapSubmissionToNeedsAttentionRow,
  useNeedsAttention,
} from "./useNeedsAttention";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import type { LoanBookEntry, LoanBookResponse } from "@/api/useLoanBook";

const IN_REVIEW_SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "0xSubmitterAddress",
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [],
  loan_data: {
    metadata_uri: "ipfs://...",
    originator: "Open Mineral",
    borrower_id: "borrower-1",
    commodity: "Copper Concentrate",
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
  },
};

const CHANGES_REQUESTED_SUBMISSION: SubmissionView = {
  ...IN_REVIEW_SUBMISSION,
  id: 7,
  status: "ChangesRequested",
  reason: "Missing insurance certificate",
};

describe("mapSubmissionToNeedsAttentionRow", () => {
  it("builds the title from loan_data.originator (friendly name) + loan_data.commodity", () => {
    const row = mapSubmissionToNeedsAttentionRow(IN_REVIEW_SUBMISSION);
    expect(row.title).toBe("Open Mineral — Copper Concentrate: new request");
  });

  it("titles a ChangesRequested submission '…: changes requested' (#1046)", () => {
    const row = mapSubmissionToNeedsAttentionRow(CHANGES_REQUESTED_SUBMISSION);
    expect(row.title).toBe(
      "Open Mineral — Copper Concentrate: changes requested",
    );
  });

  it("keeps the standard subtitle for a ChangesRequested row — the reason is NOT inlined (#1046)", () => {
    const row = mapSubmissionToNeedsAttentionRow(CHANGES_REQUESTED_SUBMISSION);
    expect(row.subtitle).toBe(
      "Copper Concentrate · PE → CN · submitted 18 Jun",
    );
    expect(row.subtitle).not.toContain("Missing insurance certificate");
  });

  it("does NOT use the top-level SubmissionView.originator (submitter address) for the title", () => {
    const row = mapSubmissionToNeedsAttentionRow(IN_REVIEW_SUBMISSION);
    expect(row.title).not.toContain("0xSubmitterAddress");
  });

  it("builds the subtitle as commodity · corridor (arrow) · submitted <date>", () => {
    const row = mapSubmissionToNeedsAttentionRow(IN_REVIEW_SUBMISSION);
    expect(row.subtitle).toBe(
      "Copper Concentrate · PE → CN · submitted 18 Jun",
    );
  });

  it("omits the valuation-mode/documents text (unbacked) from the subtitle", () => {
    const row = mapSubmissionToNeedsAttentionRow(IN_REVIEW_SUBMISSION);
    expect(row.subtitle).not.toContain("NSR");
    expect(row.subtitle).not.toContain("docs attached");
  });

  it("degrades a missing loan_data.originator to '—' in the title, never throwing", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      loan_data: { ...IN_REVIEW_SUBMISSION.loan_data, originator: "" },
    };
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.title).toBe("— — Copper Concentrate: new request");
  });

  it("degrades a missing loan_data.commodity to '—' in the title", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      loan_data: { ...IN_REVIEW_SUBMISSION.loan_data, commodity: "" },
    };
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.title).toBe("Open Mineral — —: new request");
  });

  it("omits the corridor segment cleanly (no bare '—') when corridor is missing", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      loan_data: { ...IN_REVIEW_SUBMISSION.loan_data, corridor: "" },
    };
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.subtitle).toBe("Copper Concentrate · submitted 18 Jun");
  });

  it("degrades commodity to '—' in the subtitle when missing (kept, not dropped)", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      loan_data: { ...IN_REVIEW_SUBMISSION.loan_data, commodity: "" },
    };
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.subtitle).toBe("— · PE → CN · submitted 18 Jun");
  });

  it("renders '—' for an unparseable created_at date, never throwing", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      created_at: "not-a-date",
    };
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.subtitle).toBe("Copper Concentrate · PE → CN · submitted —");
  });

  it("does not throw on an entirely missing loan_data", () => {
    const submission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      // @ts-expect-error — intentionally malformed for the defensive-read test
      loan_data: undefined,
    };
    expect(() => mapSubmissionToNeedsAttentionRow(submission)).not.toThrow();
    const row = mapSubmissionToNeedsAttentionRow(submission);
    expect(row.title).toBe("— — —: new request");
  });
});

// ── useNeedsAttention state derivation ───────────────────────────────────────

vi.mock("@/api/useLoanSubmissions", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/useLoanSubmissions")
  >("@/api/useLoanSubmissions");
  return {
    ...actual,
    useLoanSubmissions: vi.fn(),
  };
});

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));

import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import { useLoanBook } from "@/api/useLoanBook";

function makeLoanEntry(overrides: Partial<LoanBookEntry> = {}): LoanBookEntry {
  return {
    loan_id: "4488",
    chain_id: 99_000_001,
    originator: "Helios Metals",
    borrower: "b1",
    commodity: "Lithium",
    principal: "0",
    senior_outstanding: "0",
    original_senior_tranche: "0",
    maturity: 1_782_777_600,
    next_payment_timestamp: 1_782_777_600,
    days_overdue: null,
    duration_days: 180,
    rate: "0.130000",
    protection: null,
    status: "WatchList",
    onchain_status: "WatchList",
    documents: [],
    repaid_to_date: "0",
    disbursed: true,
    days_on_watchlist: 18,
    watchlist_entered_at: 1_781_222_400,
    ...overrides,
  };
}
function bookResult(loans: LoanBookEntry[]) {
  return {
    data: { loans } as unknown as LoanBookResponse,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe("loanAttentionLabel / mapLoanToNeedsAttentionRow (#867)", () => {
  it("maps Watchlist / past-maturity statuses to labels; others to null", () => {
    expect(loanAttentionLabel("WatchList")).toBe("Watchlist");
    expect(loanAttentionLabel("Past Due")).toBe("Matured");
    expect(loanAttentionLabel("Matured")).toBe("Matured");
    expect(loanAttentionLabel("Performing")).toBeNull();
    expect(loanAttentionLabel("Disbursing")).toBeNull();
    expect(loanAttentionLabel("Closed")).toBeNull();
  });

  it("includes an open margin call, once per loan", () => {
    expect(loanAttentionLabel("Performing", true)).toBe("Margin call open");
    expect(loanAttentionLabel("WatchList", true)).toBe(
      "Watchlist · margin call open",
    );
    expect(loanAttentionLabel("Past Due", true)).toBe(
      "Matured · margin call open",
    );
    expect(loanAttentionLabel("Closed", true)).toBeNull();
    expect(loanAttentionLabel("Default", true)).toBeNull();
    expect(loanAttentionLabel("Performing", null)).toBeNull();
    expect(loanAttentionLabel("Performing", false)).toBeNull();
    expect(loanAttentionLabel("Performing")).toBeNull();
  });

  it("maps a loan to a Loans-group row (title + subtitle + loanId)", () => {
    const row = mapLoanToNeedsAttentionRow(
      makeLoanEntry({
        loan_id: "4471",
        originator: "Delta",
        commodity: "Coffee",
      }),
      "Watchlist",
    );
    expect(row).toEqual({
      key: "99000001:4471",
      loanId: "4471",
      chainId: 99_000_001,
      title: "Delta · Coffee",
      subtitle: "Watchlist · loan #4471 · Stellar",
    });
  });
});

describe("useNeedsAttention", () => {
  beforeEach(() => {
    vi.mocked(useLoanBook).mockReturnValue(bookResult([]));
  });
  it("returns 'loading' while the query is loading", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("loading");
    expect(result.current.rows).toEqual([]);
  });

  it("returns 'error' with the message when the query errors", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network down"),
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("error");
    expect(result.current.errorMessage).toBe("network down");
  });

  it("returns 'empty' when data is an empty array", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
  });

  it("returns 'empty' when data is undefined", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
  });

  it("returns 'ready' with mapped rows when in-review data is present", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [IN_REVIEW_SUBMISSION],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.title).toBe(
      "Open Mineral — Copper Concentrate: new request",
    );
  });

  it("lists a margin-call loan with the margin-call label, once, and skips Closed / Default", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useLoanBook).mockReturnValue(
      bookResult([
        makeLoanEntry({
          loan_id: "1",
          status: "Performing",
          margin_call_open: true,
        }),
        makeLoanEntry({
          loan_id: "2",
          status: "WatchList",
          margin_call_open: true,
        }),
        makeLoanEntry({
          loan_id: "3",
          status: "Closed",
          margin_call_open: true,
        }),
        makeLoanEntry({
          loan_id: "4",
          status: "Default",
          margin_call_open: true,
        }),
        makeLoanEntry({
          loan_id: "5",
          status: "Performing",
          margin_call_open: null,
        }),
      ]),
    );
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.loanRows.map((r) => r.loanId)).toEqual(["1", "2"]);
    expect(result.current.loanRows[0]?.subtitle).toBe(
      "Margin call open · loan #1 · Stellar",
    );
    expect(result.current.loanRows[1]?.subtitle).toBe(
      "Watchlist · margin call open · loan #2 · Stellar",
    );
  });

  it("fetches submissions UNFILTERED — no server-side status option (#1046)", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderHook(() => useNeedsAttention());
    expect(vi.mocked(useLoanSubmissions)).toHaveBeenCalledWith();
  });

  it("keeps exactly InReview + ChangesRequested in served order; Approved and Rejected are excluded (#1046)", () => {
    const approved: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      id: 2,
      status: "Approved",
    };
    const rejected: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      id: 3,
      status: "Rejected",
      reason: "Not eligible",
    };
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [
        CHANGES_REQUESTED_SUBMISSION,
        approved,
        IN_REVIEW_SUBMISSION,
        rejected,
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows.map((r) => r.id)).toEqual([7, 1]);
    expect(result.current.rows[0]?.title).toContain("changes requested");
  });

  it("returns 'ready' on ChangesRequested rows alone (#1046)", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [CHANGES_REQUESTED_SUBMISSION],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
  });

  it("returns 'empty' when every submission is a non-attention status", () => {
    const approved: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      status: "Approved",
    };
    const rejected: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      id: 3,
      status: "Rejected",
      reason: "Not eligible",
    };
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [approved, rejected],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
  });

  it("does not treat backend lifecycle statuses as actionable Origination work (#892)", () => {
    const lifecycleSubmission: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      status: "WatchList",
    };
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [lifecycleSubmission],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
    expect(result.current.rows).toEqual([]);
  });

  it("surfaces Watchlist + Matured loans as Loans-group rows, excluding others (#867)", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useLoanBook).mockReturnValue(
      bookResult([
        makeLoanEntry({ loan_id: "1", status: "WatchList" }),
        makeLoanEntry({ loan_id: "2", status: "Past Due" }),
        makeLoanEntry({ loan_id: "3", status: "Performing" }),
        makeLoanEntry({ loan_id: "4", status: "Closed" }),
      ]),
    );
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows).toEqual([]);
    expect(result.current.loanRows.map((r) => r.loanId)).toEqual(["1", "2"]);
    expect(result.current.loanRows[0]?.subtitle).toContain("Watchlist");
    expect(result.current.loanRows[1]?.subtitle).toContain("Matured");
  });

  it("returns 'empty' only when BOTH groups are empty", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    vi.mocked(useLoanBook).mockReturnValue(
      bookResult([makeLoanEntry({ status: "Performing" })]),
    );
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
  });
});
