/**
 * Tests for `-origination-detail.ts` — the Origination details page's
 * submission resolution + field mapping (issue #821). Supersedes the closed
 * #816's version of this test — NO collateral-valuation cases here;
 * `useCollateralValuation` must not be imported or mocked in this file.
 *
 * Covers:
 *   - A full `SubmissionView` maps to the expected display strings
 *     (facility/senior/equity/offtaker via `formatFullUsd`, rate via
 *     `formatBpsRate` + " p.a.", start + maturity dates via
 *     `formatMaturityDate`, corridor arrow, originator = `loan_data.originator`
 *     (friendly name, NOT the submitter address), commodity, governing law,
 *     documents list).
 *   - Missing/malformed `loan_data` fields render "—", never throw.
 *   - Router state present, list not yet resolved a match → uses router
 *     state directly (no loading flash on initial render).
 *   - Router state present AND the list has a fresher match → the LIVE list
 *     copy wins (issue #829 — load-bearing so a post-Approve/Reject refetch
 *     actually flips the footer; see `-origination-detail.ts`'s "Resolution
 *     precedence" docs).
 *   - No router state → refetch fallback selects the submission by matching
 *     `String(s.id) === id`; absent id → `not-found`; refetch in flight →
 *     `loading`.
 *   - Each status (`InReview`, `Approved`, `Rejected`, unknown) → correct
 *     `statusChip`.
 *   - Edge cases: empty `documents`, corridor without a hyphen, zero-value
 *     economics (`"$0"` not `—`), unknown status string.
 *   - Issue #823: `statusKind`/`reviewedDate`/`rejectionReason` fields that
 *     drive the status-conditional detail footer.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOriginationDetail } from "./-origination-detail";
import type { SubmissionView } from "@/api/useLoanSubmissions";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_SUBMISSION: SubmissionView = {
  id: 7,
  status: "InReview",
  reason: null,
  originator: "GAMF...", // authenticated submitter address (#813 field)
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [{ name: "Offtake agreement.pdf", uri: "ipfs://doc1" }],
  loan_data: {
    to: "G...",
    metadata_uri: "ipfs://...",
    originator: "Auric Andes S.A.C.", // human name — the heading/Deal-Details source
    borrower_id: "borrower-1",
    commodity: "Gold pyrite concentrate",
    corridor: "PE-CN",
    governing_law: "England & Wales",
    economics: {
      original_facility_size: "3500000.000000",
      original_senior_tranche: "2800000.000000",
      original_equity_tranche: "700000.000000",
      original_offtaker_price: "3750000.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_783_929_600,
      original_maturity_date: 1_765_756_800,
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

function mockSubmissions(
  data: SubmissionView[] | undefined,
  isLoading = false,
) {
  vi.mocked(useLoanSubmissions).mockReturnValue({
    data,
    isLoading,
    error: null,
    refetch: vi.fn(),
  });
}

// ── Happy path: router-state submission ─────────────────────────────────────

describe("useOriginationDetail — ready state with router-state submission", () => {
  it("maps loan terms, deal details, and heading from loan_data", () => {
    mockSubmissions([FULL_SUBMISSION]);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.state).toBe("ready");
    expect(result.current.heading).toBe(
      "Auric Andes S.A.C. — Gold pyrite concentrate",
    );
    expect(result.current.breadcrumb).toBe(
      "Auric Andes S.A.C. — Gold pyrite concentrate",
    );
    expect(result.current.loanTerms.facility).toBe("$3,500,000");
    expect(result.current.loanTerms.senior).toBe("$2,800,000");
    expect(result.current.loanTerms.equity).toBe("$700,000");
    expect(result.current.loanTerms.offtakerPrice).toBe("$3,750,000");
    expect(result.current.loanTerms.rate).toBe("14.0% p.a.");
    expect(result.current.loanTerms.startDate).not.toBe("—");
    expect(result.current.loanTerms.maturityDate).not.toBe("—");
    expect(result.current.dealDetails.originator).toBe("Auric Andes S.A.C.");
    expect(result.current.dealDetails.commodity).toBe(
      "Gold pyrite concentrate",
    );
    expect(result.current.dealDetails.corridor).toBe("PE → CN");
    expect(result.current.dealDetails.governingLaw).toBe("England & Wales");
    expect(result.current.dealDetails.documents).toEqual([
      { name: "Offtake agreement.pdf", uri: "ipfs://doc1" },
    ]);
  });

  it("does NOT use the top-level SubmissionView.originator (submitter address) for the heading", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    expect(result.current.heading).not.toContain("GAMF...");
    expect(result.current.dealDetails.originator).not.toBe("GAMF...");
  });

  it("does not expose a `valuation` field on the result at all", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    expect(result.current).not.toHaveProperty("valuation");
  });
});

// ── Status chip mapping ──────────────────────────────────────────────────────

describe("useOriginationDetail — status chip", () => {
  it("maps InReview to 'Awaiting your review'", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    expect(result.current.statusChip).toEqual({
      kind: "in-review",
      label: "Awaiting your review",
    });
  });

  it("maps Approved to 'Approved'", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Approved",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusChip).toEqual({
      kind: "approved",
      label: "Approved",
    });
  });

  it("maps Rejected to 'Rejected'", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Rejected",
      reason: "Missing export permit",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusChip).toEqual({
      kind: "rejected",
      label: "Rejected",
    });
  });

  it("maps an unknown status string to a neutral fallback, never throwing", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "SomethingNew",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusChip).toEqual({
      kind: "unknown",
      label: "SomethingNew",
    });
  });
});

// ── Status-conditional footer fields (issue #823) ──────────────────────────

describe("useOriginationDetail — footer fields (statusKind/reviewedDate/rejectionReason)", () => {
  it("exposes statusKind mirroring statusChip.kind, and reviewedDate from updated_at, for InReview", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    expect(result.current.statusKind).toBe("in-review");
    expect(result.current.reviewedDate).toBe("18 Jun");
    expect(result.current.rejectionReason).toBe("—");
  });

  it("exposes statusKind 'approved' and the formatted updated_at date", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Approved",
      updated_at: "2026-01-02T00:00:00Z",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusKind).toBe("approved");
    expect(result.current.reviewedDate).toBe("2 Jan");
    expect(result.current.rejectionReason).toBe("—");
  });

  it("exposes statusKind 'rejected', the formatted updated_at date, and the reason", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Rejected",
      reason: "Missing export permit",
      updated_at: "2026-05-05T00:00:00Z",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusKind).toBe("rejected");
    expect(result.current.reviewedDate).toBe("5 May");
    expect(result.current.rejectionReason).toBe("Missing export permit");
  });

  it("renders rejectionReason as '—' when Rejected but reason is null", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Rejected",
      reason: null,
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.rejectionReason).toBe("—");
  });

  it("exposes statusKind 'unknown' for an unrecognized status string", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "SomethingNew",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusKind).toBe("unknown");
  });

  it("gives safe '—' defaults for statusKind/reviewedDate/rejectionReason in the not-found state", async () => {
    mockSubmissions([FULL_SUBMISSION], false);
    const { result } = renderHook(() => useOriginationDetail("999", undefined));
    await waitFor(() => {
      expect(result.current.state).toBe("not-found");
    });
    expect(result.current.statusKind).toBe("unknown");
    expect(result.current.reviewedDate).toBe("—");
    expect(result.current.rejectionReason).toBe("—");
  });
});

// ── Missing/malformed loan_data fields — never throw, never fabricate ──────

describe("useOriginationDetail — defensive reads", () => {
  it("renders '—' for missing economics/loan_data fields", () => {
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
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.commodity).toBe("—");
    expect(result.current.dealDetails.corridor).toBe("—");
    expect(result.current.loanTerms.facility).toBe("—");
    expect(result.current.loanTerms.rate).toBe("—");
    expect(result.current.loanTerms.startDate).toBe("—");
    expect(result.current.loanTerms.maturityDate).toBe("—");
  });

  it("renders an empty documents state gracefully when documents is []", () => {
    const submission: SubmissionView = { ...FULL_SUBMISSION, documents: [] };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.documents).toEqual([]);
  });

  it("never throws for an entirely missing loan_data", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      // @ts-expect-error — intentionally malformed for the defensive-read test
      loan_data: undefined,
    };
    mockSubmissions([submission]);

    expect(() =>
      renderHook(() => useOriginationDetail("7", submission)),
    ).not.toThrow();
  });

  it("renders the corridor as-is (no arrow inserted) when it has no hyphen", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: { ...FULL_SUBMISSION.loan_data, corridor: "Global" },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.corridor).toBe("Global");
  });

  it("renders '$0' (not '—') for a zero-value facility size", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          original_facility_size: "0.000000",
        },
      },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.loanTerms.facility).toBe("$0");
  });
});

// ── Direct-URL / refresh fallback (no router state) ─────────────────────────

describe("useOriginationDetail — refetch fallback (no router state)", () => {
  it("selects the matching submission by id from the list when state is absent", () => {
    mockSubmissions([FULL_SUBMISSION]);

    const { result } = renderHook(() => useOriginationDetail("7", undefined));

    expect(result.current.state).toBe("ready");
    expect(result.current.dealDetails.originator).toBe("Auric Andes S.A.C.");
  });

  it("renders 'loading' while the fallback list query is loading", () => {
    mockSubmissions(undefined, true);

    const { result } = renderHook(() => useOriginationDetail("7", undefined));
    expect(result.current.state).toBe("loading");
  });

  it("renders 'not-found' when no submission matches the id", async () => {
    mockSubmissions([FULL_SUBMISSION], false);

    const { result } = renderHook(() => useOriginationDetail("999", undefined));

    await waitFor(() => {
      expect(result.current.state).toBe("not-found");
    });
  });

  // ── Resolution precedence (issue #829 — load-bearing for Approve/Reject) ──

  it("prefers router state on initial render, before the list query has resolved a match", () => {
    const stateSubmission: SubmissionView = {
      ...FULL_SUBMISSION,
      id: 7,
      loan_data: { ...FULL_SUBMISSION.loan_data, originator: "From state" },
    };
    // The list query hasn't produced data yet (still loading) — router
    // state renders immediately, no loading flash.
    mockSubmissions(undefined, true);

    const { result } = renderHook(() =>
      useOriginationDetail("7", stateSubmission),
    );
    expect(result.current.state).toBe("ready");
    expect(result.current.dealDetails.originator).toBe("From state");
  });

  it("prefers the LIVE list copy over router state once the list contains a fresher match (drives the post-review footer flip)", () => {
    const stateSubmission: SubmissionView = {
      ...FULL_SUBMISSION,
      id: 7,
      status: "InReview",
      loan_data: { ...FULL_SUBMISSION.loan_data, originator: "From state" },
    };
    const listSubmission: SubmissionView = {
      ...FULL_SUBMISSION,
      id: 7,
      status: "Approved",
      loan_data: { ...FULL_SUBMISSION.loan_data, originator: "From list" },
    };
    mockSubmissions([listSubmission]);

    const { result } = renderHook(() =>
      useOriginationDetail("7", stateSubmission),
    );
    // The list's fresher copy wins — both the mapped field and the status
    // that drives the Approved/Rejected banner.
    expect(result.current.dealDetails.originator).toBe("From list");
    expect(result.current.statusKind).toBe("approved");
  });
});
