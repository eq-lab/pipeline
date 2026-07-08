/**
 * Unit tests for the typed auth wrappers (`getAuthChallenge`, `postAuthVerify`).
 * Mocks `./client`'s `apiFetch` to isolate the request-shaping logic (path,
 * query string, body, response mapping) from network/session concerns
 * (covered separately in `-client.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAuthChallenge, postAuthVerify } from "./auth";

const mockApiFetch = vi.fn();
vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("getAuthChallenge", () => {
  it("issues a GET to /v1/auth/challenge with address and chain_id query params", async () => {
    mockApiFetch.mockResolvedValue({ message: "sign this", nonce: "n1" });

    const result = await getAuthChallenge("0xabc", 560048);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/auth/challenge?address=0xabc&chain_id=560048",
    );
    expect(result).toEqual({ message: "sign this", nonce: "n1" });
  });
});

describe("postAuthVerify", () => {
  it("issues a POST to /v1/auth/verify with the snake_case body and maps the response", async () => {
    mockApiFetch.mockResolvedValue({ token: "jwt", expires_in: 86400 });

    const result = await postAuthVerify({
      chainId: 99000001,
      address: "GABC",
      signature: "base64sig==",
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/v1/auth/verify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain_id: 99000001,
          address: "GABC",
          signature: "base64sig==",
        }),
      }),
    );
    expect(result).toEqual({ token: "jwt", expiresIn: 86400 });
  });

  it("omits chain_id from the body when not provided", async () => {
    mockApiFetch.mockResolvedValue({ token: "jwt", expires_in: 86400 });

    await postAuthVerify({ address: "0xabc", signature: "0xdead" });

    const [, init] = mockApiFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chain_id).toBeUndefined();
    expect(body.address).toBe("0xabc");
  });
});
