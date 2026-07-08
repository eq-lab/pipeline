/**
 * Typed wrappers around the backend signature-auth endpoints (#791).
 *
 * Contract source of truth: `packages/api/src/routes/auth.rs` and
 * `docs/product-specs/api-authorization.md`.
 */
import { apiFetch } from "./client";

export interface ChallengeResponse {
  /** The exact message the wallet must sign (raw UTF-8 bytes). */
  message: string;
  /** The single-use nonce embedded in `message`. */
  nonce: string;
}

export interface VerifyRequest {
  /** Chain id — optional; the server defaults to `DEFAULT_CHAIN_ID` when omitted. */
  chainId?: number;
  address: string;
  /** EVM: hex (optional `0x`). Stellar: base64 (Stellar-native) or hex. */
  signature: string;
}

export interface VerifyResponse {
  /** Signed JWT to send as `Authorization: Bearer <token>`. */
  token: string;
  /** Token lifetime in seconds (24h = 86400). */
  expiresIn: number;
}

/**
 * `GET /v1/auth/challenge?address=<0x…|G…>&chain_id=<optional>`.
 *
 * 401 (`ApiUnauthorizedError`, see `./client`) means the address is not on
 * the server allow-list — the sign-in flow renders that as "not authorized".
 */
export async function getAuthChallenge(
  address: string,
  chainId: number,
): Promise<ChallengeResponse> {
  const params = new URLSearchParams({
    address,
    chain_id: String(chainId),
  });
  return apiFetch<ChallengeResponse>(`/v1/auth/challenge?${params}`);
}

/**
 * `POST /v1/auth/verify` — exchanges a signed challenge for a bearer JWT.
 *
 * 401 (`ApiUnauthorizedError`) means an unknown address, no outstanding
 * challenge, or a bad signature (rare on the happy path — usually a nonce
 * that expired or was already consumed).
 */
export async function postAuthVerify(
  req: VerifyRequest,
): Promise<VerifyResponse> {
  const response = await apiFetch<{ token: string; expires_in: number }>(
    "/v1/auth/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain_id: req.chainId,
        address: req.address,
        signature: req.signature,
      }),
    },
  );
  return { token: response.token, expiresIn: response.expires_in };
}
