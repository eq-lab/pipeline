/**
 * Tests for `-useOriginationTable.ts` — the Origination page's extractor
 * (`mapSubmissionToRow`) and query-state hook (issue #813).
 *
 * Covers:
 *   - A full fixture submission maps to correctly formatted fields.
 *   - Missing/malformed `loan_data`/`economics` fields render "—" (never
 *     throw, never fabricate).
 *   - Status mapping for InReview / Approved / Rejected, plus backend
 *     merged/lifecycle statuses normalized to Approved.
 *   - The valuation sub-line is not part of the row shape at all (resolved
 *     Open Question — omitted entirely).
 *   - `useOriginationTable`'s state derivation (loading/error/empty/ready).
 */
import { describe, it, expect, vi } from "vitest";
import {
  mapSubmissionToRow,
  useOriginationTable,
} from "./-useOriginationTable";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { renderHook } from "@testing-library/react";

const FULL_SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "GABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWX",
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
      // 7-decimal on-chain base-unit strings (issue #912) — displayed ÷10^7,
      // so this facility value renders "$3.5M" (compact, #1015).
      original_facility_size: "35000000000000.000000",
      original_senior_tranche: "30000000000000.000000",
      original_equity_tranche: "5000000000000.000000",
      original_offtaker_price: "35000000000000.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_750_000_000,
      original_maturity_date: 1_797_292_800, // 2026-12-15T00:00:00Z
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

describe("mapSubmissionToRow", () => {
  it("maps a full fixture submission to correctly formatted fields", () => {
    const row = mapSubmissionToRow(FULL_SUBMISSION);
    expect(row.originator).toBe("Auric Andes");
    expect(row.commodity).toBe("Gold pyrite concentrate");
    expect(row.facility).toBe("$3.5M");
    expect(row.corridor).toBe("PE → CN");
    expect(row.rate).toBe("14.0%");
    expect(row.maturity).toBe("15 Dec 2026");
    expect(row.submitted).toBe("18 Jun");
  });

  it("divides the facility by the FULL 10^7 (issue #912 regression) — 10000000000 base units -> $1,000, not $1M", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          original_facility_size: "10000000000.000000",
        },
      },
    };
    const row = mapSubmissionToRow(submission);
    // 10000000000 / 10^7 = 1000 -> formatCompactUsd("1000.0000000") = "$1K".
    // A partial (e.g. 10^4) divisor would wrongly produce "$1M".
    expect(row.facility).toBe("$1K");
  });

  it("does not include a valuation sub-line field on the row (resolved: omitted)", () => {
    const row = mapSubmissionToRow(FULL_SUBMISSION);
    expect(row).not.toHaveProperty("valuation");
  });

  it("renders '—' for missing economics fields, never throwing", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        commodity: "",
        corridor: "",
        // @ts-expect-error — intentionally malformed for the defensive-read test
        economics: undefined,
      },
    };
    const row = mapSubmissionToRow(submission);
    expect(row.commodity).toBe("—");
    expect(row.corridor).toBe("—");
    expect(row.facility).toBe("—");
    expect(row.rate).toBe("—");
    expect(row.maturity).toBe("—");
  });

  it("renders '—' for a non-numeric senior_interest_rate_bps", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          // @ts-expect-error — intentionally malformed for the defensive-read test
          senior_interest_rate_bps: "not-a-number",
        },
      },
    };
    const row = mapSubmissionToRow(submission);
    expect(row.rate).toBe("—");
  });

  it("renders '—' for an entirely missing loan_data", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      // @ts-expect-error — intentionally malformed for the defensive-read test
      loan_data: undefined,
    };
    const row = mapSubmissionToRow(submission);
    expect(row.commodity).toBe("—");
    expect(row.facility).toBe("—");
  });

  it("maps InReview to an inert Review action", () => {
    const row = mapSubmissionToRow({ ...FULL_SUBMISSION, status: "InReview" });
    expect(row.status).toEqual({ kind: "in-review", label: "Review" });
  });

  it("maps Approved to a green pill with the updated_at date", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "Approved",
      updated_at: "2026-01-02T00:00:00Z",
    });
    expect(row.status).toEqual({
      kind: "approved",
      label: "Approved · 2 Jan",
    });
  });

  it("maps Rejected to a red pill carrying the reason", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "Rejected",
      reason: "Missing export permit",
    });
    expect(row.status).toEqual({
      kind: "rejected",
      label: "Rejected",
      reason: "Missing export permit",
    });
  });

  it("maps ChangesRequested to its own pill carrying the reason (#950), not Approved", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "ChangesRequested",
      reason: "Attach the amended offtake agreement",
    });
    expect(row.status).toEqual({
      kind: "changes-requested",
      label: "Changes requested",
      reason: "Attach the amended offtake agreement",
    });
  });

  it("maps Rejected with a null reason gracefully", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "Rejected",
      reason: null,
    });
    expect(row.status).toEqual({
      kind: "rejected",
      label: "Rejected",
      reason: null,
    });
  });

  it("maps a backend lifecycle status to Approved for Origination display (#892)", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "Performing",
      updated_at: "2026-01-02T00:00:00Z",
    });
    expect(row.status).toEqual({
      kind: "approved",
      label: "Approved · 2 Jan",
    });
  });

  it("maps an unexpected non-decision status to Approved for Origination display (#892)", () => {
    const row = mapSubmissionToRow({
      ...FULL_SUBMISSION,
      status: "SomethingNew",
      updated_at: "2026-01-02T00:00:00Z",
    });
    expect(row.status).toEqual({
      kind: "approved",
      label: "Approved · 2 Jan",
    });
  });
});

// ── useOriginationTable state derivation ─────────────────────────────────────

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

describe("useOriginationTable", () => {
  it("returns 'loading' while the query is loading", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useOriginationTable());
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
    const { result } = renderHook(() => useOriginationTable());
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
    const { result } = renderHook(() => useOriginationTable());
    expect(result.current.state).toBe("empty");
  });

  it("returns 'ready' with mapped rows when data is present", () => {
    vi.mocked(useLoanSubmissions).mockReturnValue({
      data: [FULL_SUBMISSION],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useOriginationTable());
    expect(result.current.state).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.originator).toBe("Auric Andes");
  });
});
