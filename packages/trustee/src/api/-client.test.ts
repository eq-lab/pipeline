/**
 * Unit tests for `src/api/client.ts` (Trustee `apiFetch`).
 *
 * Covers:
 *   - Attaches `Authorization: Bearer <token>` when a session token is present.
 *   - Omits the header entirely when no session token is present.
 *   - Forwards the base URL from `ENV`.
 *   - Maps a 401 response to `ApiUnauthorizedError` (an `ApiError` subclass
 *     with `status === 401`, issue #829).
 *   - Non-401 non-2xx responses throw `ApiError` carrying the numeric
 *     `.status` (issue #829).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiFetch, ApiError, ApiUnauthorizedError } from "./client";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
  },
}));

const mockGetSessionToken = vi.fn<() => string | undefined>();
vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => mockGetSessionToken(),
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockClear();
  mockGetSessionToken.mockReset();
  mockGetSessionToken.mockReturnValue(undefined);
});

describe("apiFetch — bearer token injection", () => {
  it("attaches Authorization: Bearer <token> when a session token is present", async () => {
    mockGetSessionToken.mockReturnValue("jwt-token");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await apiFetch("/v1/loan-book/submissions");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-token");
  });

  it("omits the Authorization header when no session token is present", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "ok" }), { status: 200 }),
    );

    await apiFetch("/v1/auth/challenge?address=0x1");

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("forwards the base URL from ENV", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await apiFetch("/v1/health");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8080/v1/health");
  });
});

describe("apiFetch — 401 handling", () => {
  it("throws ApiUnauthorizedError on a 401 response", async () => {
    const make401 = () =>
      new Response(JSON.stringify({ error: "address is not authorized" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    fetchMock.mockResolvedValueOnce(make401());

    await expect(apiFetch("/v1/auth/challenge?address=0x1")).rejects.toThrow(
      ApiUnauthorizedError,
    );

    fetchMock.mockResolvedValueOnce(make401());
    await expect(apiFetch("/v1/auth/challenge?address=0x1")).rejects.toThrow(
      "address is not authorized",
    );
  });

  it("populates .status = 401 on ApiUnauthorizedError, and it is an instanceof ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "address is not authorized" }), {
        status: 401,
      }),
    );

    await expect(
      apiFetch("/v1/auth/challenge?address=0x1"),
    ).rejects.toMatchObject({ status: 401 });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "address is not authorized" }), {
        status: 401,
      }),
    );
    try {
      await apiFetch("/v1/auth/challenge?address=0x1");
      expect.unreachable("apiFetch should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(ApiUnauthorizedError);
    }
  });

  it("throws ApiError (not ApiUnauthorizedError) carrying .status on other non-2xx statuses", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(apiFetch("/v1/health")).rejects.toThrow("boom");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom again" }), {
        status: 409,
      }),
    );
    try {
      await apiFetch("/v1/health");
      expect.unreachable("apiFetch should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).not.toBeInstanceOf(ApiUnauthorizedError);
      expect((err as ApiError).status).toBe(409);
    }
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(apiFetch("/v1/health")).rejects.toThrow(
      "Internal Server Error",
    );
  });
});

describe("apiFetch — success", () => {
  it("returns the parsed JSON body on a 2xx response", async () => {
    const payload = { message: "sign here", nonce: "abc" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const result = await apiFetch("/v1/auth/challenge?address=0x1");

    expect(result).toEqual(payload);
  });

  it("resolves to undefined (not a JSON-parse throw) on a 2xx response with an empty body (issue #829)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));

    const result = await apiFetch("/v1/loan-book/submissions/7/review");

    expect(result).toBeUndefined();
  });
});
