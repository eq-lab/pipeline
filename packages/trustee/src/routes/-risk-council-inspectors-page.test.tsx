// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DELAYED,
  IMMEDIATE,
  NO_ROLE,
  STELLAR,
  accessResult,
  relayResult,
} from "./-riskCouncilFixtures";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("@pipeline/wallet-connect", () => ({
  isInspectorAddress: (value: string) => /^G[A-Z0-9]{3,}$/.test(value),
}));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useRiskCouncil", () => ({
  useRiskCouncilAccess: vi.fn(),
  useRiskCouncilRelay: vi.fn(),
  useSecurityInspectors: vi.fn(),
}));

import { useSessionState } from "@/auth/sessionStore";
import {
  useRiskCouncilAccess,
  useRiskCouncilRelay,
  useSecurityInspectors,
} from "@/api/useRiskCouncil";
import { Route } from "./risk-council.inspectors";

const mockSession = vi.mocked(useSessionState);
const mockAccess = vi.mocked(useRiskCouncilAccess);
const mockRelay = vi.mocked(useRiskCouncilRelay);
const mockInspectors = vi.mocked(useSecurityInspectors);

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

let relay: ReturnType<typeof relayResult>;

function setup(
  access: Parameters<typeof accessResult>[0],
  panel: string[] | undefined = ["GAAAA", "GBBBB"],
  chainId = STELLAR,
) {
  mockSession.mockReturnValue({ chainId } as never);
  mockAccess.mockReturnValue(accessResult(access) as never);
  mockRelay.mockReturnValue(relay as never);
  mockInspectors.mockReturnValue({
    data: panel,
    isLoading: false,
    error: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  relay = relayResult();
});

describe("Inspector panel page", () => {
  it("shows the current panel read on chain and the applies-from-now note", () => {
    setup(DELAYED);
    renderRoute();
    expect(mockInspectors).toHaveBeenCalledWith(STELLAR);
    const rows = screen.getAllByTestId("risk-council-inspectors-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("GAAAA");
    expect(
      screen.getByTestId("risk-council-inspectors-note"),
    ).toHaveTextContent("Applies to inspections entered from now on.");
    expect(
      screen.getByTestId("risk-council-inspectors-no-changes"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("risk-council-inspectors-button")).toBeDisabled();
  });

  it("validates a new address, appends it and schedules the full list", () => {
    setup(DELAYED);
    renderRoute();
    const draft = screen.getByTestId("risk-council-inspectors-draft");
    fireEvent.change(draft, { target: { value: "nope" } });
    expect(
      screen.getByTestId("risk-council-inspectors-draft-error"),
    ).toHaveTextContent("valid Stellar address");
    expect(screen.getByTestId("risk-council-inspectors-add")).toBeDisabled();
    fireEvent.change(draft, { target: { value: "GAAAA" } });
    expect(
      screen.getByTestId("risk-council-inspectors-draft-error"),
    ).toHaveTextContent("already on the panel");
    fireEvent.change(draft, { target: { value: "GCCCC" } });
    fireEvent.click(screen.getByTestId("risk-council-inspectors-add"));
    expect(draft).toHaveValue("");
    expect(
      screen.getByTestId("risk-council-inspectors-resulting"),
    ).toHaveTextContent("Resulting panel (3)");
    const button = screen.getByTestId("risk-council-inspectors-button");
    expect(button).toHaveTextContent("Schedule inspector panel");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith({
      mode: "schedule",
      call: {
        fn: "set_inspectors",
        inspectors: ["GAAAA", "GBBBB", "GCCCC"],
      },
      chainId: STELLAR,
      loanId: undefined,
    });
  });

  it("removes an inspector and warns when the resulting panel is empty", () => {
    setup(IMMEDIATE, ["GAAAA"]);
    renderRoute();
    fireEvent.click(screen.getByTestId("risk-council-inspectors-toggle"));
    expect(
      screen.getByTestId("risk-council-inspectors-empty-warning"),
    ).toHaveTextContent("empty");
    const button = screen.getByTestId("risk-council-inspectors-button");
    expect(button).toHaveTextContent("Set inspectors");
    fireEvent.click(button);
    expect(relay.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "execute",
        call: { fn: "set_inspectors", inspectors: [] },
      }),
    );
  });

  it("clears the edits after an executed change so the refetched panel does not duplicate", async () => {
    setup(IMMEDIATE);
    const { rerender } = renderRoute();
    fireEvent.change(screen.getByTestId("risk-council-inspectors-draft"), {
      target: { value: "GCCCC" },
    });
    fireEvent.click(screen.getByTestId("risk-council-inspectors-add"));
    fireEvent.click(screen.getByTestId("risk-council-inspectors-button"));
    await waitFor(() => expect(relay.mutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByTestId("risk-council-inspectors-no-changes"),
      ).toBeInTheDocument(),
    );
    mockInspectors.mockReturnValue({
      data: ["GAAAA", "GBBBB", "GCCCC"],
      isLoading: false,
      error: null,
    } as never);
    const Page = Route.options.component as React.ComponentType;
    rerender(<Page />);
    expect(screen.getAllByTestId("risk-council-inspectors-row")).toHaveLength(
      3,
    );
    expect(
      screen.getByTestId("risk-council-inspectors-no-changes"),
    ).toBeInTheDocument();
  });

  it("stays disabled until the panel has loaded", () => {
    setup(DELAYED);
    mockInspectors.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-inspectors-loading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("risk-council-inspectors-button")).toBeDisabled();
  });

  it("shows a read error", () => {
    setup(DELAYED);
    mockInspectors.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("rpc down"),
    } as never);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-inspectors-load-error"),
    ).toBeInTheDocument();
  });

  it("is read-only without the role and on a non-Stellar session", () => {
    setup(NO_ROLE);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-inspectors-role"),
    ).toHaveTextContent(
      "Setting the inspector panel belongs to the Risk Council.",
    );
    expect(
      screen.getByTestId("risk-council-inspectors-chip"),
    ).toHaveTextContent("Risk Council only");
  });

  it("shows the Stellar-only reason on another chain", () => {
    setup(undefined, undefined, 1);
    renderRoute();
    expect(
      screen.getByTestId("risk-council-inspectors-role"),
    ).toHaveTextContent(/On-chain actions run on Stellar only/);
    expect(screen.getByTestId("risk-council-inspectors-button")).toBeDisabled();
  });
});
