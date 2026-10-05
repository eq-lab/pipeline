import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthFlowProvider } from "./AuthFlowProvider";
import { saveSession, clearSession } from "./session";
import { ApiError } from "@/api";

const mockGet = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    getMyLp: (...args: unknown[]) => mockGet(...args),
    upsertMyLp: (...args: unknown[]) => mockUpsert(...args),
  };
});
vi.mock("@/wallet", () => ({ useConnectModal: () => ({ open: vi.fn() }) }));
vi.mock("@/components/EmailAuthFlow", () => ({ EmailAuthFlow: () => null }));
vi.mock("@/components/CompanyDocsModal", () => ({
  CompanyDocsModal: ({
    open,
    onDismiss,
    onSubmitSuccess,
  }: {
    open: boolean;
    onDismiss: () => void;
    onSubmitSuccess: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Finish account setup">
        <button onClick={onDismiss}>Close setup</button>
        <button onClick={onSubmitSuccess}>Submit setup</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  clearSession();
  mockGet.mockReset();
  mockUpsert.mockReset();
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

describe("Account-in-review Notify me", () => {
  const stored = {
    legal_name: "Acme Ltd",
    country: null,
    contact_email: "ops@acme.example",
    notify_on_review: false,
    documents: [],
  };

  async function openReviewModal() {
    mockGet.mockResolvedValueOnce(stored);
    render(
      <AuthFlowProvider>
        <div>App</div>
      </AuthFlowProvider>,
    );
    signIn();
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit setup" }),
    );
    return screen.findByRole("button", { name: "Notify me" });
  }

  it("saves the preference with the stored profile and confirms", async () => {
    mockUpsert.mockResolvedValueOnce({ ...stored, notify_on_review: true });
    fireEvent.click(await openReviewModal());

    expect(mockUpsert).toHaveBeenCalledWith({
      legal_name: "Acme Ltd",
      country: null,
      contact_email: "ops@acme.example",
      notify_on_review: true,
    });
    expect(
      await screen.findByRole("button", { name: "We’ll notify you" }),
    ).toBeInTheDocument();
  });

  it("keeps Notify me and shows an error when the save fails", async () => {
    mockUpsert.mockRejectedValueOnce(new ApiError(409, "frozen"));
    fireEvent.click(await openReviewModal());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t save your preference",
    );
    expect(
      screen.getByRole("button", { name: "Notify me" }),
    ).toBeInTheDocument();
  });
});
