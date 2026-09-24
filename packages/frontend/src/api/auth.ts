// spec: docs/product-specs/api-authorization-email.md#frontend
import { apiFetch } from "./client";

export interface TokenResponse {
  token: string;
  expires_in: number;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function signup(params: {
  email: string;
  password: string;
  captchaToken: string;
}): Promise<void> {
  await apiFetch<undefined>("/v1/auth/signup", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email: params.email,
      password: params.password,
      captcha_token: params.captchaToken,
    }),
  });
}

export async function verifyOtp(params: {
  email: string;
  code: string;
}): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/v1/auth/verify-otp", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: params.email, code: params.code }),
  });
}

export async function resendOtp(params: {
  email: string;
  captchaToken: string;
}): Promise<void> {
  await apiFetch<undefined>("/v1/auth/resend-otp", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email: params.email,
      captcha_token: params.captchaToken,
    }),
  });
}

export async function login(params: {
  email: string;
  password: string;
}): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/v1/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: params.email, password: params.password }),
  });
}
