/**
 * Tests for `-origination-detail.ts` — the Origination details page's
 * submission resolution + field mapping (issue #821). Supersedes the closed
 * #816's version of this test — NO collateral-valuation cases here;
 * `useCollateralValuation` must not be imported or mocked in this file.
 *
 * Covers:
 *   - A full `SubmissionView` maps to the expected display strings
 *     (facility/senior/equity/offtaker — human-unit USDC strings formatted
 *     as served via `formatFullUsd`, #1620 —
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

const BORROWER_REF =
  "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

const FULL_SUBMISSION: SubmissionView = {
  id: 7,
  status: "InReview",
  reason: null,
  originator: "GAMF...", // authenticated submitter address (#813 field)
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [{ name: "Offtake agreement.pdf", uri: "ipfs://doc1" }],
  loan_data: {
    metadata_uri: "ipfs://...",
    originator: "Auric Andes S.A.C.", // human name — the heading/Deal-Details source
    borrower_id: "borrower-1",
    commodity: "Gold pyrite concentrate",
    corridor: "PE-CN",
    governing_law: "England & Wales",
    economics: {
      // Human-unit USDC strings (#1620) — senior + equity = facility
      // (800 + 200 = 1000). Displayed as served: facility $1,000 / senior $800 / equity
      // $200 / offtaker $1,550.
      original_facility_size: "1000.000000",
      original_senior_tranche: "800.000000",
      original_equity_tranche: "200.000000",
      original_offtaker_price: "1550.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_783_929_600,
      original_maturity_date: 1_765_756_800,
    },
    protection: "LC at sight",
  },
  draw_loan: {
    metadata_uri: "ipfs://...",
    economics: {
      borrower_ref: BORROWER_REF,
      original_facility_size: "10000000000",
      original_senior_tranche: "8000000000",
      original_equity_tranche: "2000000000",
      original_offtaker_price: "15500000000",
      senior_interest_rate: 140000,
      origination_date: 1_783_929_600,
      original_maturity_date: 1_765_756_800,
    },
    missing_inputs: [],
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
    expect(result.current.dealDetails.borrowerRef).toBe("ab12cd…ab12");
    expect(result.current.dealDetails.borrowerRefFull).toBe(BORROWER_REF);
    expect(result.current.dealDetails).not.toHaveProperty("location");
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

  it("renders '—' for a missing protection", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: { ...FULL_SUBMISSION.loan_data, protection: undefined },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.protection).toBe("—");
  });

  it("maps Borrower ref for the missing, null and absent draw_loan states", () => {
    const missing: SubmissionView = {
      ...FULL_SUBMISSION,
      draw_loan: {
        metadata_uri: "ipfs://...",
        economics: {
          ...FULL_SUBMISSION.draw_loan!.economics,
          borrower_ref: null,
        },
        missing_inputs: ["data_room_id"],
      },
    };
    mockSubmissions([missing]);
    const a = renderHook(() => useOriginationDetail("7", missing));
    expect(a.result.current.dealDetails.borrowerRef).toBe(
      "Data room ID missing",
    );
    expect(a.result.current.dealDetails.borrowerRefFull).toBeNull();

    for (const draw_loan of [null, undefined]) {
      const sub: SubmissionView = {
        ...FULL_SUBMISSION,
        loan_data: { ...FULL_SUBMISSION.loan_data, data_room_id: undefined },
        draw_loan,
      };
      mockSubmissions([sub]);
      const b = renderHook(() => useOriginationDetail("7", sub));
      expect(b.result.current.dealDetails.borrowerRef).toBe("—");
      expect(b.result.current.dealDetails.borrowerRefFull).toBeNull();
    }
  });

  it("falls back to the data room id when draw_loan is null (drawn / Rejected)", () => {
    for (const status of ["Approved", "Rejected"]) {
      const sub: SubmissionView = {
        ...FULL_SUBMISSION,
        status,
        loan_data: { ...FULL_SUBMISSION.loan_data, data_room_id: "room-42" },
        draw_loan: null,
      };
      mockSubmissions([sub]);
      const r = renderHook(() => useOriginationDetail("7", sub));
      expect(r.result.current.dealDetails.borrowerRef).toBe(
        "Data room ID room-42",
      );
      expect(r.result.current.dealDetails.borrowerRefFull).toBeNull();
    }
  });

  it("maps a legacy loan_data with to / initial_* keys, and one without, without throwing", () => {
    const legacy = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        to: "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU",
        initial_ccr: 1_500_000,
        initial_location: { location_type: "Vessel", location_identifier: "X" },
      },
    } as SubmissionView;
    for (const submission of [legacy, FULL_SUBMISSION]) {
      mockSubmissions([submission]);
      const { result } = renderHook(() =>
        useOriginationDetail("7", submission),
      );
      expect(result.current.state).toBe("ready");
      expect(result.current.dealDetails.originator).toBe("Auric Andes S.A.C.");
    }
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

  it("renders economics as served human-unit USDC — no base-unit division (#1620 supersedes #912)", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        economics: {
          ...FULL_SUBMISSION.loan_data.economics,
          original_facility_size: "1000.000000",
        },
      },
    };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.loanTerms.facility).toBe("$1,000");
  });
});

// ── Transaction preview (issue #838) ─────────────────────────────────────────

describe("useOriginationDetail — transactionPreview", () => {
  it("shows the served draw_loan values actually signed, in base units", () => {
    mockSubmissions([FULL_SUBMISSION]);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.transactionPreview.keyword).toBe(
      "LoanRegistry.draw_loan",
    );
    const rows = result.current.transactionPreview.rows;
    expect(rows.map((r) => r.label)).toEqual([
      "metadata_uri",
      "borrower_ref",
      "economics",
    ]);
    expect(rows.find((r) => r.label === "metadata_uri")?.value).toBe(
      "ipfs://...",
    );
    expect(rows.find((r) => r.label === "borrower_ref")?.value).toBe(
      "ab12cd…ab12",
    );
    const economics = rows.find((r) => r.label === "economics")?.value;
    expect(economics).toContain("facility 10000000000");
    expect(economics).toContain("senior 8000000000");
    expect(economics).toContain("equity 2000000000");
    expect(economics).toContain("offtaker 15500000000");
    expect(economics).toContain("rate 140000");
    expect(economics).not.toContain("$");
  });

  it("renders '—' for every row when draw_loan is null, never throws", () => {
    const submission: SubmissionView = { ...FULL_SUBMISSION, draw_loan: null };
    mockSubmissions([submission]);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    const rows = result.current.transactionPreview.rows;
    expect(rows.find((r) => r.label === "metadata_uri")?.value).toBe("—");
    expect(rows.find((r) => r.label === "borrower_ref")?.value).toBe("—");
    expect(rows.find((r) => r.label === "economics")?.value).toContain("—");
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

describe("useOriginationDetail — target chain (#1536)", () => {
  it("maps target_chain_id to its label, '—' when absent", () => {
    mockSubmissions([{ ...FULL_SUBMISSION, target_chain_id: 560048 }]);
    const { result } = renderHook(() =>
      useOriginationDetail(String(FULL_SUBMISSION.id), undefined),
    );
    expect(result.current.dealDetails.targetChain).toBe("Hoodi");

    mockSubmissions([FULL_SUBMISSION]);
    const absent = renderHook(() =>
      useOriginationDetail(String(FULL_SUBMISSION.id), undefined),
    );
    expect(absent.result.current.dealDetails.targetChain).toBe("—");
  });
});
