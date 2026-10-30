/**
 * Message-mapping layer for user-facing errors (#1034) — maps raw thrown
 * values to a short human line plus the full raw text for the details
 * dialog. Absorbs #1024's `toError` (moved here from
 * `wallet/stellar/useStellarWithdrawalQueue.ts`) as stage 1.
 * spec: docs/frontend/error-handling.md
 */

export interface UserFacingError {
  /** Short human copy. Safe to render inline — never raw. */
  message: string;
  /** Normalized raw text for `ErrorDetailsDialog`. Never rendered inline. */
  details: string;
  /** True when a known shape matched — callers may use `message` as a toast title. */
  isSpecific: boolean;
}

/** spec: docs/frontend/error-handling.md#generic-fallback */
const GENERIC_MESSAGE = "The transaction could not be completed.";

/**
 * Normalizes unknown thrown values into readable `Error`s (#1024).
 * spec: docs/frontend/wallet-flows.md#error-normalization
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
// simulation/revert string (e.g. a Soroban simulation error whose message
// happens to embed "user rejected").

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

// ── Soroban contract-error → human copy ────────────────────────────────────
// Seeded with codes already established empirically elsewhere in this repo.
// spec: docs/frontend/error-handling.md#soroban-contract-error-table

export const SOROBAN_VOUCHER_EXPIRED_CODE = 4;

export const WITHDRAW_CUSTODY_SHORT_MESSAGE =
  "The withdrawal custody account is short. Claims for your position wait until it is funded.";

const SOROBAN_WITHDRAW_CLAIM_TOO_EARLY_CODE = 2;

export interface UserErrorOptions {
  context?: "withdrawClaim" | "wireOut";
}

const WIRE_OUT_NOT_AUTHORISED =
  "Your address must be authorised to hold PLUSD to request a bank wire-out.";
const WIRE_OUT_ZERO_AMOUNT = "Enter an amount greater than zero.";
const WIRE_OUT_INSUFFICIENT_BALANCE = "Insufficient PLUSD balance.";
const WIRE_OUT_PAUSED =
  "Bank wire-outs are paused. Check the status page before retrying.";

const WIRE_OUT_SOROBAN_COPY: Record<number, string> = {
  16: WIRE_OUT_NOT_AUTHORISED,
  6: WIRE_OUT_ZERO_AMOUNT,
  10: WIRE_OUT_INSUFFICIENT_BALANCE,
  1000: WIRE_OUT_PAUSED,
};

const WIRE_OUT_EVM_COPY: Array<[RegExp, string]> = [
  [/EnforcedPause/, WIRE_OUT_PAUSED],
  [/MinterInvalidAmount/, WIRE_OUT_ZERO_AMOUNT],
  [/ERC20InsufficientBalance/, WIRE_OUT_INSUFFICIENT_BALANCE],
];

const SOROBAN_ERROR_COPY: Record<number, string> = {
  // unconfirmed: #3 is presumed to be the $5M per-transaction / per-LP-window
  // deposit-amount guard — circumstantial evidence only (no contract source
  // or `#[contracterror]` enum in this repo). See
  // docs/exec-plans/tech-debt-tracker.md (contract-error-#3 row) and
  // docs/frontend/error-handling.md#soroban-contract-error-table.
  3: "Amount exceeds the deposit limit.",
  [SOROBAN_VOUCHER_EXPIRED_CODE]:
    "The voucher expired or did not match the request. Your app fetches a fresh voucher.",
  11: "Your PLUSD balance is not authorized yet. Try again shortly.",
  13: "A required trustline is missing. Enable the asset and try again.",
};

// ── HTTP / API failure text matching ───────────────────────────────────────
// Narrow on purpose — the four voucher hooks already do their own
// `msg.includes("Not Found")` matching for RETRY control flow
// (api/useDepositVoucher.ts and three siblings); those predicates are
// load-bearing and untouched by this module.

function matchHttp(raw: string): string | null {
  if (/not found/i.test(raw)) {
    return "That request could not be found. It may have already been processed.";
  }
  if (/forbidden/i.test(raw) || /unauthorized/i.test(raw)) {
    return "You are not authorized for this action.";
  }
  if (
    /internal server error/i.test(raw) ||
    /bad gateway/i.test(raw) ||
    /service unavailable/i.test(raw)
  ) {
    return "The service is temporarily unavailable. Please try again.";
  }
  return null;
}

// ── EVM revert / network matching ──────────────────────────────────────────

function matchEvm(raw: string): string | null {
  if (/WithdrawalQueueTooEarly/.test(raw)) {
    return WITHDRAW_CUSTODY_SHORT_MESSAGE;
  }
  if (/execution reverted/i.test(raw)) {
    return "The transaction was rejected by the contract.";
  }
  if (/insufficient funds/i.test(raw) || /insufficient balance/i.test(raw)) {
    return "Insufficient balance for this transaction.";
  }
  if (/timeout/i.test(raw) || /network/i.test(raw)) {
    return "Network problem. Please try again.";
  }
  return null;
}

/**
 * Maps an unknown thrown value to a `UserFacingError`: a short human
 * `message` (specific where the shape is recognised, generic otherwise) plus
 * the normalized raw `details` text for `ErrorDetailsDialog`. `details` is
 * always the full normalized text — never truncated — regardless of whether
 * a specific mapping matched.
 *
 * Match order (spec: docs/frontend/error-handling.md#match-order):
 * wallet/user rejection → Soroban contract error → HTTP/API failure →
 * EVM revert/network → generic fallback.
 */
export function toUserError(
  err: unknown,
  options: UserErrorOptions = {},
): UserFacingError {
  const details = toError(err).message;

  if (isWalletRejection(details)) {
    return {
      message: "You cancelled the transaction in your wallet.",
      details,
      isSpecific: true,
    };
  }

  const contractCode = parseSorobanContractErrorCode(details);
  if (
    options.context === "withdrawClaim" &&
    contractCode === SOROBAN_WITHDRAW_CLAIM_TOO_EARLY_CODE
  ) {
    return {
      message: WITHDRAW_CUSTODY_SHORT_MESSAGE,
      details,
      isSpecific: true,
    };
  }
  if (options.context === "wireOut") {
    const wireOutCopy =
      contractCode !== null
        ? WIRE_OUT_SOROBAN_COPY[contractCode]
        : WIRE_OUT_EVM_COPY.find(([pattern]) => pattern.test(details))?.[1];
    if (wireOutCopy !== undefined) {
      return { message: wireOutCopy, details, isSpecific: true };
    }
  }
  if (contractCode !== null) {
    const copy = SOROBAN_ERROR_COPY[contractCode];
    if (copy !== undefined) {
      return { message: copy, details, isSpecific: true };
    }
  }

  const httpCopy = matchHttp(details);
  if (httpCopy !== null) {
    return { message: httpCopy, details, isSpecific: true };
  }

  const evmCopy = matchEvm(details);
  if (evmCopy !== null) {
    return { message: evmCopy, details, isSpecific: true };
  }

  return { message: GENERIC_MESSAGE, details, isSpecific: false };
}
