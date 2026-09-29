import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthFlowProvider } from "./AuthFlowProvider";
import { saveSession, clearSession } from "./session";
import { ApiError } from "@/api";

const mockGet = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, getMyLp: (...args: unknown[]) => mockGet(...args) };
});
vi.mock("@/wallet", () => ({ useConnectModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/EmailAuthFlow", () => ({ EmailAuthFlow: () => null }));
vi.mock("@/components/CompanyDocsModal", () => ({
  CompanyDocsModal: ({
    open,
    onDismiss,
  }: {
    open: boolean;
    onDismiss: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Finish account setup">
        <button onClick={onDismiss}>Close setup</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  clearSession();
  mockGet.mockReset();
});

function signIn(token = "jwt") {
  saveSession({ token, expires_in: 3600, email: "user@example.com" });
}

describe("LP setup prompt", () => {
  it("waits for GET and opens only for 404 or empty documents", async () => {
    let resolve!: (lp: unknown) => void;
    mockGet.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <AuthFlowProvider>
        <div>App</div>
      </AuthFlowProvider>,
    );
    signIn();
    await waitFor(() => expect(mockGet).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolve({ documents: [] });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close setup" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledOnce();
  });

  it("opens for a missing LP and prompts again after a new sign-in", async () => {
    mockGet
      .mockRejectedValueOnce(new ApiError(404, "missing"))
      .mockResolvedValueOnce({ documents: [] });
    render(
      <AuthFlowProvider>
        <div>App</div>
      </AuthFlowProvider>,
    );
    signIn();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close setup" }));
    clearSession();
    signIn("next-jwt");
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it.each([
    new ApiError(401, "expired"),
    new Error("offline"),
    { documents: [{ id: 1 }] },
  ])("does not prompt on errors or a persisted document", async (result) => {
    if (result instanceof Error) mockGet.mockRejectedValueOnce(result);
    else mockGet.mockResolvedValueOnce(result);
    render(
      <AuthFlowProvider>
        <div>App</div>
      </AuthFlowProvider>,
    );
    signIn();
    await waitFor(() => expect(mockGet).toHaveBeenCalledOnce());
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a prior account's late result after sign-out", async () => {
    let resolve!: (lp: unknown) => void;
    mockGet.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(
      <AuthFlowProvider>
        <div>App</div>
      </AuthFlowProvider>,
    );
    signIn();
    await waitFor(() => expect(mockGet).toHaveBeenCalledOnce());
    clearSession();
    resolve({ documents: [] });
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
