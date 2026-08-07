/**
 * Trustee-local message-mapping layer for user-facing errors (#1037) — the
 * trustee counterpart of #1034's `packages/frontend/src/utils/userError.ts`.
 * Not hoisted to `@pipeline/wallet-connect` or `@pipeline/ui`: see
 * docs/frontend/error-handling.md#trustee-mapping-layer for why (D1).
 * spec: docs/frontend/error-handling.md
 */
import { ApiError } from "@/api/client";

export interface UserFacingError {
  /** Short human copy. Safe to render inline — never raw. */
  message: string;
  /** Normalized raw text for `ErrorDetailsDialog`. Never rendered inline. */
  details: string;
  /** True when a known shape matched — callers may use `message` as a toast title. */
  isSpecific: boolean;
}

/** spec: docs/frontend/error-handling.md#trustee-mapping-layer */
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Normalizes unknown thrown values into readable `Error`s. Ported verbatim
 * from the LP's `toError` (#1024 / #1034) — this half of the module is
 * chain-generic, not trustee-specific (D1).
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return new Error((err as { message: string }).message);
  }
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

/**
 * Matches the Soroban simulation error shape `Error(Contract, #N)` and
 * returns the numeric code, or `null` when the text doesn't contain one.
 * When the text contains multiple occurrences, the first one wins.
 */
export function parseSorobanContractErrorCode(raw: string): number | null {
  const match = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
}

// ── Wallet / user-rejection detection ──────────────────────────────────────
// Checked FIRST in `toUserError` — a rejection can arrive wrapped inside a
// simulation/revert string. Ported verbatim from the LP module (D1).

const REJECTION_PATTERNS: RegExp[] = [
  /user rejected/i,
  /user declined/i,
  /declined by user/i,
  /user cancell?ed/i,
  /request rejected/i,
  /action_rejected/i,
  // toError JSON-stringifies bare `{ code: 4001 }` / `{ code: -4001 }`
  // objects (EIP-1193 user-rejection code) into `'{"code":4001}'`.
  /"code":\s*-?4001\b/,
];

function isWalletRejection(raw: string): boolean {
  return REJECTION_PATTERNS.some((pattern) => pattern.test(raw));
}

// ── Trustee preflight guards ────────────────────────────────────────────────
// The five on-chain hooks (useDrawLoan/useRollover/useUpdateLifecycle/
// useRecordPayment/useCloseLoan) throw these BEFORE any RPC call, and their
// text is already a short, hook-specific, human sentence — not a diagnostic
// dump — so "not configured" is rendered as-is; "not connected" is
// translated to the same copy `mapMintError` already ships for that case.

function matchPreflightGuard(raw: string): string | null {
  if (/not configured for this environment/i.test(raw)) return raw;
  if (/wallet not connected/i.test(raw)) {
    return "Connect your trustee wallet to approve on-chain.";
  }
  return null;
}

// ── Soroban contract-error → human copy ────────────────────────────────────
// Empty for now — no trustee-side `#[contracterror]` code has been confirmed
// against a live contract yet (unlike the LP's #3/#11/#13, D2). The lookup
// stays wired so a confirmed code can be added without a match-order change.

const SOROBAN_ERROR_COPY: Record<number, string> = {};

/** spec: docs/frontend/error-handling.md#trustee-mapping-layer */
function isSimulationErrorShape(raw: string): boolean {
  return /simulation error/i.test(raw);
}

// ── ApiError.status → human copy ───────────────────────────────────────────
// Seeded with exactly the copy `-useOriginationReview.ts`'s `mapReviewError`
// already ships (D3) — the only existing trustee-side status-driven mapping.

function matchApiStatus(error: ApiError): string | null {
  switch (error.status) {
    case 401:
      return "Your session has expired or is not authorized. Please sign in again.";
    case 409:
      return "This submission has already been reviewed. Refresh to see the latest status.";
    case 403:
      return "You are not authorized to review submissions.";
    case 400:
      return "This request was invalid.";
    case 404:
      return "That request could not be found. It may have already been processed.";
    default:
      return error.status >= 500
        ? "The service is temporarily unavailable. Please try again."
        : null;
  }
}

/**
 * Maps an unknown thrown value to a `UserFacingError`: a short human
 * `message` (specific where the shape is recognised, `fallback` otherwise)
 * plus the normalized raw `details` text for `ErrorDetailsDialog`. `details`
 * is always the full normalized text — never truncated — regardless of
 * whether a specific mapping matched.
 *
 * Match order (spec: docs/frontend/error-handling.md#trustee-match-order):
 * wallet/user rejection → trustee preflight guard → Soroban contract error →
 * simulation-error shape → `ApiError.status` → `fallback`.
 */
export function toUserError(
  err: unknown,
  fallback: string = GENERIC_MESSAGE,
): UserFacingError {
  const details = toError(err).message;

  if (isWalletRejection(details)) {
    return {
      message: "You cancelled the transaction in your wallet.",
      details,
      isSpecific: true,
    };
  }

  const guardCopy = matchPreflightGuard(details);
  if (guardCopy !== null) {
    return { message: guardCopy, details, isSpecific: true };
  }

  const contractCode = parseSorobanContractErrorCode(details);
  if (contractCode !== null) {
    const copy = SOROBAN_ERROR_COPY[contractCode];
    if (copy !== undefined) {
      return { message: copy, details, isSpecific: true };
    }
  }

  if (isSimulationErrorShape(details)) {
    return {
      message:
        "Could not verify this action on-chain. No signature was requested — safe to retry.",
      details,
      isSpecific: true,
    };
  }

  if (err instanceof ApiError) {
    const statusCopy = matchApiStatus(err);
    if (statusCopy !== null) {
      return { message: statusCopy, details, isSpecific: true };
    }
  }

  return { message: fallback, details, isSpecific: false };
}

/**
 * Maps a `/waterfall` query error to friendly, user-facing copy — never the
 * raw backend message, and no numbers (#916). Consolidated from the two
 * byte-identical copies in `-record-coupon.ts` / `-record-repayment.ts`.
 * The 4xx branch is the EXPECTED user-input case ("amount exceeds what's
 * left") and deliberately carries no `details` — no "View details" trigger —
 * since there is no diagnostic payload worth disclosing (D5). The
 * unexpected/non-4xx branch keeps its full details.
 */
export function mapWaterfallError(error: Error | null): UserFacingError | null {
  if (error == null) return null;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return {
      message: "This amount is too high for this loan. Enter a smaller amount.",
      details: "",
      isSpecific: true,
    };
  }
  return {
    message: "Couldn't preview this payment. Please try again.",
    details: error.message,
    isSpecific: false,
  };
}
