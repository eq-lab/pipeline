/**
 * Tests for `useReviewSubmission` (issue #829). Mocks `apiFetch` so these are
 * pure unit tests of the request shape + invalidation behavior, not network
 * tests.
 *
 * Covers:
 *   - Approve sends `{ decision: "Approved" }` with NO `reason` key at all.
 *   - Reject sends `{ decision: "Rejected", reason }`.
 *   - Request changes sends `{ decision: "ChangesRequested", reason }` (#1017).
 *   - POST method + `Content-Type: application/json` header.
 *   - On success, `invalidateQueries(["loan-submissions"])` fires.
 *   - On error, the thrown `ApiError` (with `.status`) propagates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useReviewSubmission } from "./useReviewSubmission";
import { ApiError } from "./client";

const mockApiFetch = vi.fn();
vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("useReviewSubmission", () => {
  it("sends { decision: 'Approved' } with NO reason key on approve", async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useReviewSubmission(), { wrapper });

    result.current.mutate({ id: 7, decision: "Approved" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockApiFetch.mock.calls[0]!;
    expect(path).toBe("/v1/loan-book/submissions/7/review");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ decision: "Approved" });
    expect(body).not.toHaveProperty("reason");
  });

  it("sends { decision: 'Rejected', reason } on reject", async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useReviewSubmission(), { wrapper });

    result.current.mutate({
      id: 7,
      decision: "Rejected",
      reason: "Missing export permit",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [path, init] = mockApiFetch.mock.calls[0]!;
    expect(path).toBe("/v1/loan-book/submissions/7/review");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      decision: "Rejected",
      reason: "Missing export permit",
    });
  });

  it("sends { decision: 'ChangesRequested', reason } on request changes (#1017)", async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useReviewSubmission(), { wrapper });

    result.current.mutate({
      id: 7,
      decision: "ChangesRequested",
      reason: "Assay certificate missing the moisture figure",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [path, init] = mockApiFetch.mock.calls[0]!;
    expect(path).toBe("/v1/loan-book/submissions/7/review");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      decision: "ChangesRequested",
      reason: "Assay certificate missing the moisture figure",
    });
  });

  it("invalidates the loan-submissions query on success", async () => {
    mockApiFetch.mockResolvedValueOnce(undefined);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useReviewSubmission(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    result.current.mutate({ id: 7, decision: "Approved" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["loan-submissions"],
    });
  });

  it("propagates a thrown ApiError (with .status) on failure", async () => {
    mockApiFetch.mockRejectedValueOnce(new ApiError("Conflict", 409));
    const { result } = renderHook(() => useReviewSubmission(), { wrapper });

    result.current.mutate({ id: 7, decision: "Approved" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(409);
  });
});
