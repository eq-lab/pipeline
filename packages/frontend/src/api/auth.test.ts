import { describe, it, expect, beforeEach, vi } from "vitest";
import { signup, verifyOtp, resendOtp, login } from "./auth";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});

describe("signup", () => {
  it("POSTs snake_case body and resolves on 202 with no body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      signup({
        email: "lp@example.com",
        password: "hunter2!A",
        captchaToken: "tok",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/auth/signup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "lp@example.com",
          password: "hunter2!A",
          captcha_token: "tok",
        }),
      }),
    );
  });
});

describe("verifyOtp", () => {
  it("POSTs { email, code } and returns the TokenResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 86400 }), {
        status: 200,
      }),
    );

    const result = await verifyOtp({ email: "lp@example.com", code: "123456" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/auth/verify-otp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "lp@example.com", code: "123456" }),
      }),
    );
    expect(result).toEqual({ token: "jwt", expires_in: 86400 });
  });
});

describe("resendOtp", () => {
  it("POSTs snake_case body and resolves on 202", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(
      resendOtp({ email: "lp@example.com", captchaToken: "tok" }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/auth/resend-otp",
      expect.objectContaining({
        body: JSON.stringify({ email: "lp@example.com", captcha_token: "tok" }),
      }),
    );
  });
});

describe("login", () => {
  it("POSTs { email, password } and returns the TokenResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "jwt", expires_in: 86400 }), {
        status: 200,
      }),
    );

    const result = await login({
      email: "lp@example.com",
      password: "hunter2!A",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/auth/login",
      expect.objectContaining({
        body: JSON.stringify({
          email: "lp@example.com",
          password: "hunter2!A",
        }),
      }),
    );
    expect(result).toEqual({ token: "jwt", expires_in: 86400 });
  });

  it("propagates ApiError with status on a rejected login", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid credentials" }), {
        status: 401,
      }),
    );

    await expect(
      login({ email: "lp@example.com", password: "wrong" }),
    ).rejects.toMatchObject({ status: 401, message: "invalid credentials" });
  });
});
