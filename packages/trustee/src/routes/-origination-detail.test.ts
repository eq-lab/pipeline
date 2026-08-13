/**
 * Tests for `-origination-detail.ts` — the Origination details page's
 * submission resolution + field mapping (issue #821). Supersedes the closed
 * #816's version of this test — NO collateral-valuation cases here;
 * `useCollateralValuation` must not be imported or mocked in this file.
 *
 * Covers:
 *   - A full `SubmissionView` maps to the expected display strings
 *     (facility/senior/equity/offtaker — served at the on-chain 7-decimal
 *     base-unit scale, normalized ÷10^7 before `formatFullUsd`, issue #912 —
 *     rate via `formatBpsRate` + " p.a.", start + maturity dates via
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
 *   - Each Origination decision status (`InReview`, `Approved`, `Rejected`)
 *     → correct `statusChip`; backend merged/lifecycle statuses normalize to
 *     Approved for this Origination surface (#892).
 *   - Edge cases: empty `documents`, corridor without a hyphen, zero-value
 *     economics (`"$0"` not `—`), merged lifecycle status string.
 *   - Issue #823: `statusKind`/`reviewedDate`/`rejectionReason` fields that
 *     drive the status-conditional detail footer.
 *   - Issue #838: `transactionPreview` — the Approve & mint dialog's
 *     transaction-preview code-block rows, formatted from real `loan_data`,
 *     with `—` fallbacks and no fabrication.
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
      // 7-decimal on-chain base-unit strings (issue #912) — senior + equity
      // = facility (8e9 + 2e9 = 10e9), same convention as the observed live
      // payload. Displayed ÷10^7: facility $1,000 / senior $800 / equity
      // $200 / offtaker $1,550.
      original_facility_size: "10000000000.000000",
      original_senior_tranche: "8000000000.000000",
      original_equity_tranche: "2000000000.000000",
      original_offtaker_price: "15500000000.000000",
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
    protection: "LC at sight",
  },
};

function mockSubmissions(
  data: SubmissionView[] | undefined,
  isLoading = false,
  error: Error | null = null,
) {
  vi.mocked(useLoanSubmissions).mockReturnValue({
    data,
    isLoading,
    error,
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
    expect(result.current.loanTerms.facility).toBe("$1,000");
    expect(result.current.loanTerms.senior).toBe("$800");
    expect(result.current.loanTerms.equity).toBe("$200");
    expect(result.current.loanTerms.offtakerPrice).toBe("$1,550");
    expect(result.current.loanTerms.rate).toBe("14.0% p.a.");
    expect(result.current.loanTerms.startDate).not.toBe("—");
    expect(result.current.loanTerms.maturityDate).not.toBe("—");
    expect(result.current.dealDetails.originator).toBe("Auric Andes S.A.C.");
    expect(result.current.dealDetails.commodity).toBe(
      "Gold pyrite concentrate",
    );
    expect(result.current.dealDetails.corridor).toBe("PE → CN");
    expect(result.current.dealDetails.governingLaw).toBe("England & Wales");
    expect(result.current.dealDetails.protection).toBe("LC at sight");
    expect(result.current.dealDetails.location).toBe("Vessel — MV Example");
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

  it("maps ChangesRequested to its chip + exposes the reason (#950)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "ChangesRequested",
      reason: "Attach the amended offtake agreement",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusChip).toEqual({
      kind: "changes-requested",
      label: "Changes requested",
    });
    expect(result.current.statusKind).toBe("changes-requested");
    expect(result.current.rejectionReason).toBe(
      "Attach the amended offtake agreement",
    );
  });

  it("maps a backend lifecycle status to Approved for Origination display (#892)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "WatchList",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusChip).toEqual({
      kind: "approved",
      label: "Approved",
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

  it("exposes statusKind 'approved' for a backend lifecycle status (#892)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      status: "Default",
    };
    mockSubmissions([submission]);
    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.statusKind).toBe("approved");
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

  it("renders '—' for a missing protection and a malformed initial_location (#1014)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        protection: undefined,
        // @ts-expect-error — intentionally malformed for the defensive-read test
        initial_location: undefined,
      },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.protection).toBe("—");
    expect(result.current.dealDetails.location).toBe("—");
  });

  it("renders a lone location half alone — no dash fabricated (#1014)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        initial_location: {
          ...FULL_SUBMISSION.loan_data.initial_location,
          location_type: "",
          location_identifier: "SGS bonded stockpile, Callao, Peru",
        },
      },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.location).toBe(
      "SGS bonded stockpile, Callao, Peru",
    );
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

  it("divides economics by the FULL 10^7 (issue #912 regression) — 10000000000 base units -> $1,000, not $1,000,000", () => {
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
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    // 10000000000 / 10^7 = 1000 -> formatFullUsd("1000.0000000") = "$1,000".
    // A partial (e.g. 10^4) divisor would wrongly produce "$1,000,000".
    expect(result.current.loanTerms.facility).toBe("$1,000");
  });
});

// ── Transaction preview (issue #838) ─────────────────────────────────────────

describe("useOriginationDetail — transactionPreview", () => {
  it("formats all rows from a full loan_data payload", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.transactionPreview.keyword).toBe(
      "LoanRegistry.mintLoan",
    );
    const rows = result.current.transactionPreview.rows;
    expect(rows.find((r) => r.label === "originator")?.value).toBe(
      "Auric Andes S.A.C.",
    );
    const economics = rows.find((r) => r.label === "economics")?.value;
    expect(economics).toContain("$1,000");
    expect(economics).toContain("$800");
    expect(economics).toContain("$200");
    expect(economics).toContain("$1,550");
    expect(economics).toContain("14.0%");
    expect(rows.find((r) => r.label === "metadataURI")?.value).toBe(
      "ipfs://...",
    );
    expect(rows.find((r) => r.label === "initialLocation")?.value).toBe(
      "MV Example",
    );
  });

  it("renders '—' for missing/malformed loan_data fields, never throws", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        metadata_uri: "",
        // @ts-expect-error — intentionally malformed for the defensive-read test
        economics: undefined,
        // @ts-expect-error — intentionally malformed for the defensive-read test
        initial_location: undefined,
      },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    const rows = result.current.transactionPreview.rows;
    expect(rows.find((r) => r.label === "metadataURI")?.value).toBe("—");
    expect(rows.find((r) => r.label === "initialLocation")?.value).toBe("—");
    const economics = rows.find((r) => r.label === "economics")?.value;
    expect(economics).toContain("—");
  });

  it("initialLocation is location_identifier ALONE (no country suffix)", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    const location = result.current.transactionPreview.rows.find(
      (r) => r.label === "initialLocation",
    )?.value;
    expect(location).toBe("MV Example");
    expect(location).not.toContain(",");
  });

  it("gives a safe empty-dash transactionPreview in the not-found state", async () => {
    mockSubmissions([FULL_SUBMISSION], false);
    const { result } = renderHook(() => useOriginationDetail("999", undefined));
    await waitFor(() => {
      expect(result.current.state).toBe("not-found");
    });
    expect(
      result.current.transactionPreview.rows.every((r) => r.value === "—"),
    ).toBe(true);
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

  it("renders 'error' — NOT 'not-found' — when the fallback list query failed (#1065)", () => {
    mockSubmissions(undefined, false, new Error("fetch failed: 500"));

    const { result } = renderHook(() => useOriginationDetail("7", undefined));

    expect(result.current.state).toBe("error");
    expect(result.current.errorMessage).toBe("Failed to load the submission.");
    expect(result.current.errorDetails).toContain("fetch failed: 500");
  });

  it("stays 'ready' from router state even when the list query failed (#1065)", () => {
    mockSubmissions(undefined, false, new Error("fetch failed: 500"));

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.state).toBe("ready");
    expect(result.current.errorMessage).toBeNull();
  });

  it("renders 'loading' while the fallback query is in flight, even with a stale error", () => {
    mockSubmissions(undefined, true, new Error("previous failure"));

    const { result } = renderHook(() => useOriginationDetail("7", undefined));
    expect(result.current.state).toBe("loading");
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
