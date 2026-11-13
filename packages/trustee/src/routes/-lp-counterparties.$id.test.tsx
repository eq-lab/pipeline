import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { LpDetail, LpDocument } from "@/api/useLp";

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("@/api/useLp", () => ({ useLp: vi.fn() }));
vi.mock("@/api/useReviewLp", () => ({ useReviewLp: vi.fn() }));
vi.mock("./-LpBankDepositsSection", () => ({
  LpBankDepositsSection: ({
    legalName,
    initialPaymentDetails,
    onPrefillConsumed,
  }: {
    legalName: string;
    initialPaymentDetails?: string;
    onPrefillConsumed?: () => void;
  }) => (
    <div data-testid="lp-bank-deposits-stub">
      {legalName}
      <span data-testid="lp-prefill">{initialPaymentDetails ?? ""}</span>
      <button onClick={onPrefillConsumed}>consume</button>
    </div>
  ),
}));

import { useLp } from "@/api/useLp";
import { useReviewLp } from "@/api/useReviewLp";
import { Route } from "./lp-counterparties.$id";

const mockUseLp = vi.mocked(useLp);
const mockUseReviewLp = vi.mocked(useReviewLp);
const mutateAsync = vi.fn();
const reset = vi.fn();
const refetch = vi.fn();

const routeSearch: { paymentDetails?: string } = {};
(
  Route as unknown as { useSearch: () => { paymentDetails?: string } }
).useSearch = () => routeSearch;

(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "7",
});

const DOCUMENT: LpDocument = {
  id: 11,
  lp_id: 7,
  original_filename: "certificate-of-incorporation.pdf",
  size_bytes: 20480,
  content_type: "application/pdf",
  status: "Provided",
  reject_reason: null,
  reviewed_by: null,
  reviewed_at: null,
  created_at: "2026-06-19T09:00:00Z",
  download_url: "https://files.example/doc-11",
};

const LP: LpDetail = {
  id: 7,
  legal_name: "Acme Capital LP",
  country: "CH",
  contact_email: "ops@acme.example",
  stellar_address: "GACME00000000000000000000000000000000000000000000000000",
  kyb_status: "UnderReview",
  owner_account_id: "00000000-0000-0000-0000-0000000000aa",
  created_at: "2026-06-18T23:40:00Z",
  address_linked_at: "2026-10-01T10:30:00Z",
  stellar_signer_address:
    "GSIGNER0000000000000000000000000000000000000000000000AB",
  evm_address: null,
  evm_signer_address: null,
  evm_address_linked_at: null,
  writable: true,
  notify_on_review: false,
  kyb_submitted_at: "2026-06-20T10:00:00Z",
  kyb_decided_at: null,
  kyb_decision_reason: null,
  owner_chain_id: null,
  owner_address: null,
  documents: [DOCUMENT],
};

function lp(overrides: Partial<LpDetail> = {}): LpDetail {
  return { ...LP, ...overrides };
}

function served(data: LpDetail | undefined, isPending = false) {
  mockUseLp.mockReturnValue({
    data,
    isPending,
    isError: false,
    isFetching: false,
    error: null,
    refetch,
  } as unknown as ReturnType<typeof useLp>);
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

beforeEach(() => {
  delete routeSearch.paymentDetails;
  mockNavigate.mockReset();
  mockUseLp.mockReset();
  mockUseReviewLp.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(undefined);
  reset.mockReset();
  refetch.mockReset();
  mockUseReviewLp.mockReturnValue({
    mutateAsync,
    reset,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useReviewLp>);
  served(LP);
});

describe("LP counterparty detail — hero", () => {
  it("renders the served legal name as the h1", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: "Acme Capital LP" }),
    ).toBeInTheDocument();
  });

  it("renders the back link to the LP Counterparties list", () => {
    renderRoute();
    expect(
      screen.getByRole("link", { name: "‹ LP Counterparties" }),
    ).toHaveAttribute("href", "/lp-counterparties");
  });

  it("renders the jurisdiction, registration and submission clauses in the meta line", () => {
    renderRoute();
    expect(screen.getByTestId("lp-detail-meta")).toHaveTextContent(
      "CH · Registered 18 Jun 2026 · Submitted 20 Jun 2026",
    );
  });

  it("adds the decision clause once a decision date is served", () => {
    served(lp({ kyb_decided_at: "2026-06-25T08:00:00Z" }));
    renderRoute();
    expect(screen.getByTestId("lp-detail-meta")).toHaveTextContent(
      "Decided 25 Jun 2026",
    );
  });

  it("drops absent clauses instead of printing an em dash", () => {
    served(lp({ country: null, kyb_submitted_at: null, kyb_decided_at: null }));
    renderRoute();
    const meta = screen.getByTestId("lp-detail-meta");
    expect(meta).toHaveTextContent("Registered 18 Jun 2026");
    expect(meta.textContent).not.toContain("Submitted");
    expect(meta.textContent).not.toContain("Decided");
    expect(meta.textContent).not.toContain("—");
  });

  it("falls back to 'LP <id>' while no record is served", () => {
    served(undefined, true);
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: "LP 7" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading LP counterparty…",
    );
  });

  it("renders a long legal name in the h1 without truncating it", () => {
    const longName = `Extraordinarily Long Counterparty Legal Entity Name ${"X".repeat(80)}`;
    served(lp({ legal_name: longName }));
    renderRoute();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      longName,
    );
  });
});

describe("LP counterparty detail — status chip band mapping", () => {
  const CASES = [
    { kybStatus: "NotStarted", label: "New", band: "neutral" },
    { kybStatus: "InProgress", label: "KYB Pending", band: "attention" },
    { kybStatus: "UnderReview", label: "KYB Pending", band: "info" },
    {
      kybStatus: "ChangesRequested",
      label: "Changes requested",
      band: "attention",
    },
    { kybStatus: "Passed", label: "Approved", band: "positive" },
    { kybStatus: "Failed", label: "Rejected", band: "negative" },
    { kybStatus: "Wat", label: "Wat", band: "neutral" },
  ] as const;

  for (const { kybStatus, label, band } of CASES) {
    it(`maps ${kybStatus} to '${label}' on the ${band} band`, () => {
      served(lp({ kyb_status: kybStatus }));
      renderRoute();
      const chip = screen.getByTestId("lp-detail-status-chip");
      expect(chip).toHaveTextContent(label);
      expect(chip).toHaveAttribute("data-band", band);
    });
  }
});

describe("LP counterparty detail — profile and KYB review cards", () => {
  it("renders the two cards in a grid that stacks below 900px", () => {
    renderRoute();
    const profile = screen.getByRole("region", { name: "LP profile" });
    const review = screen.getByRole("region", { name: "KYB review" });
    expect(profile.parentElement).toBe(review.parentElement);
    expect(profile.parentElement).toHaveClass(
      "grid",
      "grid-cols-1",
      "min-[900px]:grid-cols-2",
    );
  });

  it("renders every served profile value", () => {
    renderRoute();
    const card = screen.getByRole("region", { name: "LP profile" });
    expect(card).toHaveTextContent("Acme Capital LP");
    expect(card).toHaveTextContent("Jurisdiction");
    expect(card).toHaveTextContent("CH");
    expect(card).toHaveTextContent("ops@acme.example");
    expect(card).toHaveTextContent("18 Jun 2026");
    expect(within(card).getByTestId("lp-settlement-stellar")).toHaveAttribute(
      "title",
      LP.stellar_address,
    );
    expect(within(card).queryByText("Linked wallet")).not.toBeInTheDocument();
  });

  it("shows a single Settlement address row with a dash when nothing is linked", () => {
    served(lp({ stellar_address: null, address_linked_at: null }));
    renderRoute();
    const card = screen.getByRole("region", { name: "LP profile" });
    expect(card).toHaveTextContent("Settlement address");
    expect(within(card).queryByTestId("lp-settlement-stellar")).toBeNull();
    expect(within(card).queryByTestId("lp-settlement-evm")).toBeNull();
  });

  it("shows the Stellar address with its signer and linked-at", () => {
    renderRoute();
    expect(screen.getByTestId("lp-settlement-stellar-signer")).toHaveAttribute(
      "title",
      LP.stellar_signer_address,
    );
    expect(
      screen.getByTestId("lp-settlement-stellar-linked-at"),
    ).toHaveTextContent("Linked 1 Oct 2026, 10:30 UTC");
    expect(screen.queryByTestId("lp-settlement-stellar-unproven")).toBeNull();
  });

  it("shows a signer that differs from a contract address", () => {
    served(
      lp({
        stellar_address:
          "CCONTRACT00000000000000000000000000000000000000000000AB",
      }),
    );
    renderRoute();
    expect(screen.getByTestId("lp-settlement-stellar")).toHaveAttribute(
      "title",
      "CCONTRACT00000000000000000000000000000000000000000000AB",
    );
    expect(screen.getByTestId("lp-settlement-stellar-signer")).toHaveAttribute(
      "title",
      LP.stellar_signer_address,
    );
  });

  it("flags a legacy Stellar address with no signer as Unproven", () => {
    served(lp({ stellar_signer_address: null }));
    renderRoute();
    expect(
      screen.getByTestId("lp-settlement-stellar-unproven"),
    ).toHaveTextContent("Unproven");
    expect(screen.queryByTestId("lp-settlement-stellar-signer")).toBeNull();
  });

  it("shows an EVM row and dashes a missing linked-at", () => {
    served(
      lp({
        stellar_address: null,
        evm_address: "0xabc0000000000000000000000000000000000001",
        evm_signer_address: "0xabc0000000000000000000000000000000000001",
        evm_address_linked_at: null,
      }),
    );
    renderRoute();
    expect(screen.getByTestId("lp-settlement-evm")).toBeInTheDocument();
    expect(screen.getByTestId("lp-settlement-evm-signer")).toBeInTheDocument();
    expect(screen.getByTestId("lp-settlement-evm-linked-at")).toHaveTextContent(
      "Linked —",
    );
    expect(screen.queryByTestId("lp-settlement-stellar")).toBeNull();
  });

  it("renders both rows, Stellar first", () => {
    served(
      lp({
        evm_address: "0xabc0000000000000000000000000000000000001",
        evm_signer_address: "0xabc0000000000000000000000000000000000001",
        evm_address_linked_at: "2026-09-02T00:00:00Z",
      }),
    );
    renderRoute();
    const stellar = screen.getByTestId("lp-settlement-stellar");
    const evm = screen.getByTestId("lp-settlement-evm");
    expect(
      stellar.compareDocumentPosition(evm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders every served KYB review value", () => {
    served(
      lp({
        kyb_status: "Passed",
        kyb_decided_at: "2026-06-25T08:00:00Z",
        kyb_decision_reason: "All documents verified",
      }),
    );
    renderRoute();
    const card = screen.getByRole("region", { name: "KYB review" });
    expect(within(card).getByTestId("lp-kyb-review-chip")).toHaveTextContent(
      "Approved",
    );
    expect(card).toHaveTextContent("20 Jun 2026");
    expect(card).toHaveTextContent("25 Jun 2026");
    expect(card).toHaveTextContent("All documents verified");
  });

  it("renders an em dash for every absent value in each card", () => {
    served(
      lp({
        country: null,
        contact_email: "",
        stellar_address: null,
        kyb_submitted_at: null,
        kyb_decided_at: null,
        kyb_decision_reason: null,
      }),
    );
    renderRoute();
    expect(
      within(screen.getByRole("region", { name: "LP profile" })).getAllByText(
        "—",
      ),
    ).toHaveLength(3);
    expect(
      within(screen.getByRole("region", { name: "KYB review" })).getAllByText(
        "—",
      ),
    ).toHaveLength(4);
  });

  it("renders the reviewer row as an em dash — the API never serves kyb_decided_by", () => {
    served(
      lp({ kyb_status: "Passed", kyb_decided_at: "2026-06-25T08:00:00Z" }),
    );
    renderRoute();
    const card = screen.getByRole("region", { name: "KYB review" });
    expect(card).toHaveTextContent("Reviewer");
    expect(within(card).getAllByText("—")).toHaveLength(2);
  });

  it("preserves newlines in the latest decision reason", () => {
    served(
      lp({
        kyb_status: "ChangesRequested",
        kyb_decision_reason: "Line one\nLine two",
      }),
    );
    renderRoute();
    const reason = screen.getByText(/Line one/);
    expect(reason).toHaveClass("whitespace-pre-wrap");
    expect(reason.textContent).toContain("\n");
  });

  it("reveals and copies the settlement address on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    renderRoute();
    const chip = screen.getByTestId("lp-settlement-stellar");
    expect(chip).toHaveTextContent("…00000");
    fireEvent.click(chip);
    expect(chip).toHaveTextContent(LP.stellar_address!);
    expect(writeText).toHaveBeenCalledWith(LP.stellar_address);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });
});

describe("LP counterparty detail — documents card", () => {
  it("lists the filename, the byte/type/status line and the review sub-line", () => {
    served(
      lp({
        documents: [
          {
            ...DOCUMENT,
            status: "Verified",
            reviewed_by: "GTRUSTEE",
            reviewed_at: "2026-06-21T12:00:00Z",
          },
        ],
      }),
    );
    renderRoute();
    const card = screen.getByRole("region", { name: "KYB documents" });
    expect(card).toHaveTextContent("certificate-of-incorporation.pdf");
    expect(card).toHaveTextContent("20,480 bytes · application/pdf · Verified");
    expect(card).toHaveTextContent(
      "Uploaded 19 Jun 2026 · Reviewed 21 Jun 2026 · Reviewer",
    );
    expect(
      within(card).getByRole("button", { name: "…USTEE" }),
    ).toHaveAttribute("title", "GTRUSTEE");
  });

  it("renders the rejection reason for a rejected document", () => {
    served(
      lp({
        documents: [
          {
            ...DOCUMENT,
            status: "Rejected",
            reject_reason: "Scan is unreadable",
          },
        ],
      }),
    );
    renderRoute();
    expect(
      screen.getByText("Rejection reason: Scan is unreadable"),
    ).toBeInTheDocument();
  });

  it("links the download icon to the presigned URL", () => {
    renderRoute();
    const link = screen.getByRole("link", {
      name: "Download certificate-of-incorporation.pdf",
    });
    expect(link).toHaveAttribute("href", "https://files.example/doc-11");
    expect(link.querySelector("svg")).toBeInTheDocument();
    expect(link).not.toHaveTextContent("Download");
  });

  it("replaces the download icon with the refresh hint when no URL is served", () => {
    served(lp({ documents: [{ ...DOCUMENT, download_url: null }] }));
    renderRoute();
    expect(
      screen.queryByRole("link", { name: /^Download/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Download unavailable. Refresh to retry."),
    ).toBeInTheDocument();
  });

  it("refreshes from the icon button on the title row", () => {
    served(lp({ documents: [] }));
    renderRoute();
    expect(screen.getByText("No documents submitted.")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Refresh documents" });
    expect(refresh.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the document verify and reject icon-plus-text buttons named after the filename", () => {
    renderRoute();
    const verify = screen.getByRole("button", {
      name: "Verify certificate-of-incorporation.pdf",
    });
    const reject = screen.getByRole("button", {
      name: "Reject certificate-of-incorporation.pdf",
    });
    expect(verify).toHaveAttribute("data-band", "positive");
    expect(reject).toHaveAttribute("data-band", "negative");
    expect(verify).toHaveTextContent("Verify");
    expect(reject).toHaveTextContent("Reject");
    expect(verify.querySelector("svg")).toBeInTheDocument();
    expect(reject.querySelector("svg")).toBeInTheDocument();
  });
});

describe("LP counterparty detail — review actions on the title row", () => {
  it("offers the three decisions on the documents card title row", () => {
    served(lp({ documents: [{ ...DOCUMENT, status: "Verified" }] }));
    renderRoute();
    const card = screen.getByRole("region", { name: "KYB documents" });
    expect(
      within(card).getByRole("button", { name: "Reject account" }),
    ).toHaveAttribute("data-band", "negative");
    expect(
      within(card).getByRole("button", { name: "Request changes" }),
    ).toHaveAttribute("data-band", "attention");
    expect(
      within(card).getByRole("button", { name: "Confirm KYB passed" }),
    ).toHaveAttribute("data-band", "positive");
  });

  it("drops the standalone KYB decision card", () => {
    renderRoute();
    expect(
      screen.queryByRole("region", { name: "KYB decision" }),
    ).not.toBeInTheDocument();
  });

  it("replaces the decisions with the gating note for any other status", () => {
    served(lp({ kyb_status: "Passed" }));
    renderRoute();
    const card = screen.getByRole("region", { name: "KYB documents" });
    expect(card).toHaveTextContent(
      "Review actions are available only while the LP is UnderReview.",
    );
    expect(
      screen.queryByRole("button", { name: "Reject account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Verify / }),
    ).not.toBeInTheDocument();
  });

  it("hides Confirm KYB passed until every document is verified", () => {
    renderRoute();
    expect(
      screen.queryByRole("button", { name: "Confirm KYB passed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Verify every submitted document before confirming KYB passed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows Confirm KYB passed once every document is verified", () => {
    served(lp({ documents: [{ ...DOCUMENT, status: "Verified" }] }));
    renderRoute();
    expect(
      screen.getByRole("button", { name: "Confirm KYB passed" }),
    ).toBeInTheDocument();
  });

  it("disables every review action while a decision is in flight", () => {
    mockUseReviewLp.mockReturnValue({
      mutateAsync,
      reset,
      isPending: true,
      error: null,
    } as unknown as ReturnType<typeof useReviewLp>);
    renderRoute();
    expect(
      screen.getByRole("button", { name: "Reject account" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Request changes" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Refresh documents" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Verify certificate-of-incorporation.pdf",
      }),
    ).toBeDisabled();
  });
});

describe("LP counterparty detail — review dialog wiring", () => {
  it("opens the account-level dialog and submits through useReviewLp", async () => {
    served(lp({ documents: [{ ...DOCUMENT, status: "Verified" }] }));
    renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Confirm KYB passed" }));
    const dialog = screen.getByRole("dialog", {
      name: "Confirm KYB passed — Acme Capital LP",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm KYB passed" }),
    );
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 7,
      documentId: undefined,
      decision: "Passed",
      reason: "",
    });
  });

  it("opens the document dialog with the filename in its title", () => {
    renderRoute();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Verify certificate-of-incorporation.pdf",
      }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "Verify document — certificate-of-incorporation.pdf",
      }),
    ).toBeInTheDocument();
  });

  it("blocks a document rejection until a reason is entered", () => {
    renderRoute();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reject certificate-of-incorporation.pdf",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Reject document" }),
    ).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Scan is unreadable" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject document" }),
    );
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 7,
      documentId: 11,
      decision: "Rejected",
      reason: "Scan is unreadable",
    });
  });
});

describe("LP counterparty detail — non-ready states", () => {
  it("rejects a non-numeric id", () => {
    (Route as unknown as { useParams: () => { id: string } }).useParams =
      () => ({ id: "abc" });
    served(undefined, false);
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This LP identifier is invalid.",
    );
    (Route as unknown as { useParams: () => { id: string } }).useParams =
      () => ({ id: "7" });
  });

  it("renders the load error inside a detail card with a Retry action", () => {
    mockUseLp.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error("boom"),
      refetch,
    } as unknown as ReturnType<typeof useLp>);
    renderRoute();
    expect(screen.getByTestId("lp-detail-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("LP counterparty detail — payment reference prefill", () => {
  it("passes ?paymentDetails to the deposits section and clears it when consumed", () => {
    routeSearch.paymentDetails = "PL-7K3M-Q9TX-2ABC";
    renderRoute();
    expect(screen.getByTestId("lp-prefill")).toHaveTextContent(
      "PL-7K3M-Q9TX-2ABC",
    );
    fireEvent.click(screen.getByRole("button", { name: "consume" }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: ".",
      search: {},
      replace: true,
    });
  });

  it("passes nothing when the param is absent", () => {
    renderRoute();
    expect(screen.getByTestId("lp-prefill")).toHaveTextContent("");
  });

  it("drops blank and non-string values in validateSearch", () => {
    const validate = (
      Route.options as unknown as {
        validateSearch: (s: Record<string, unknown>) => unknown;
      }
    ).validateSearch;
    expect(validate({ paymentDetails: "  " })).toEqual({
      paymentDetails: undefined,
    });
    expect(validate({ paymentDetails: 5 })).toEqual({
      paymentDetails: undefined,
    });
    expect(validate({ paymentDetails: "PL-1" })).toEqual({
      paymentDetails: "PL-1",
    });
  });
});
