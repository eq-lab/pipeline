import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "./client";

vi.mock("./useLp", () => ({ lpFetch: vi.fn() }));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  apiFetch: vi.fn(),
}));

import { lpFetch } from "./useLp";
import { fetchLpsByPaymentDetails } from "./useLps";

const mockLpFetch = vi.mocked(lpFetch);

beforeEach(() => {
  mockLpFetch.mockReset();
});

describe("fetchLpsByPaymentDetails", () => {
  it("URL-encodes the trimmed value", async () => {
    mockLpFetch.mockResolvedValue({ lps: [] });
    await fetchLpsByPaymentDetails("  pl-7k3m q9tx ");
    expect(mockLpFetch.mock.calls[0]![0]).toBe(
      "/v1/lps?payment_details=pl-7k3m%20q9tx",
    );
  });

  it("refuses a blank value without calling the API", async () => {
    await expect(fetchLpsByPaymentDetails("   ")).rejects.toThrow();
    expect(mockLpFetch).not.toHaveBeenCalled();
  });

  it("surfaces a 400 as an ApiError with the served message", async () => {
    mockLpFetch.mockImplementation(async () => {
      throw new ApiError("malformed reference", 400);
    });
    let error: unknown;
    try {
      await fetchLpsByPaymentDetails("zzz");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe("malformed reference");
  });
});
