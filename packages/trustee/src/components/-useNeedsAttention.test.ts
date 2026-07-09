/**
 * Tests for `useNeedsAttention.ts` — the Overview page's Needs Attention
 * (Origination group) extractor (`mapSubmissionToNeedsAttentionRow`) and
 * query-state hook (issue #818).
 *
 * Covers:
 *   - Title built from `loan_data.originator` (friendly name) + `loan_data.commodity`.
 *   - Subtitle: commodity · corridor (arrow-formatted) · submitted <date>,
 *     backed fields only.
 *   - Missing/malformed `loan_data` fields degrade to "—"/omitted segments,
 *     never fabricated, never throwing.
 *   - `state` derivation: loading/error/empty/ready.
 *   - Non-InReview submissions (if any slip through) are excluded.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  mapSubmissionToNeedsAttentionRow,
  useNeedsAttention,
} from "./useNeedsAttention";
import type { SubmissionView } from "@/api/useLoanSubmissions";

const IN_REVIEW_SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "0xSubmitterAddress",
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  loan_data: {
    to: "G...",
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
    initial_ccr: 1_500_000,
    initial_location: {
      location_type: "Vessel",
      location_identifier: "MV Example",
      tracking_url: "https://example.com",
      updated_at: 1_750_000_000,
    },
  },
};

describe("mapSubmissionToNeedsAttentionRow", () => {
  it("builds the title from loan_data.originator (friendly name) + loan_data.commodity", () => {
    const row = mapSubmissionToNeedsAttentionRow(IN_REVIEW_SUBMISSION);
    expect(row.title).toBe("Open Mineral — Copper Concentrate: new request");
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

import { useLoanSubmissions } from "@/api/useLoanSubmissions";

describe("useNeedsAttention", () => {
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

  it("excludes non-InReview submissions defensively, even though the server already filters", () => {
    const approved: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      id: 2,
      status: "Approved",
    };
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [IN_REVIEW_SUBMISSION, approved],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.id).toBe(1);
  });

  it("returns 'empty' when all submissions are filtered out as non-InReview", () => {
    const approved: SubmissionView = {
      ...IN_REVIEW_SUBMISSION,
      status: "Approved",
    };
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [approved],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useNeedsAttention());
    expect(result.current.state).toBe("empty");
  });
});
