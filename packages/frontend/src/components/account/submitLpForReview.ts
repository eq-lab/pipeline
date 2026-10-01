// spec: docs/product-specs/kyb-lp-verification.md#kyb-review-lifecycle
import { ApiError, getMyLp, submitMyLp } from "@/api";
import type { LpResponse } from "@/api";
import { readSession } from "@/auth/session";

export function eligibleForReview(lp: LpResponse | null): boolean {
  return Boolean(
    lp?.writable &&
    ["NotStarted", "ChangesRequested"].includes(lp.kyb_status) &&
    lp.documents.length > 0 &&
    lp.documents.every((document) => document.status !== "Rejected"),
  );
}

export interface SubmissionResult {
  lp?: LpResponse;
  error?: string;
  uncertain?: boolean;
  cancelled?: boolean;
}

function current(token: string) {
  return readSession()?.token === token;
}

function submissionMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your session expired. Sign in again to continue.";
    if (error.status === 403)
      return "You are not authorized to submit this account.";
    if (error.status === 404)
      return "Your account was not found. Refresh and try again.";
    return `Your files are saved, but submission failed: ${error.message}`;
  }
  return "Your files are saved, but submission could not be confirmed. Try submitting for review again.";
}

export async function checkLpSubmission(
  token: string,
): Promise<SubmissionResult> {
  if (!current(token)) return { cancelled: true };
  try {
    const lp = await getMyLp();
    if (!current(token)) return { cancelled: true };
    return { lp };
  } catch (error) {
    if (!current(token)) return { cancelled: true };
    return {
      uncertain: true,
      error:
        error instanceof ApiError && [401, 403].includes(error.status)
          ? submissionMessage(error)
          : "Submission status is unknown. Check submission status before making more changes or retrying.",
    };
  }
}

export async function submitLpForReview(
  token: string,
): Promise<SubmissionResult> {
  if (!current(token)) return { cancelled: true };
  try {
    const lp = await submitMyLp();
    if (!current(token)) return { cancelled: true };
    return { lp };
  } catch (error) {
    if (!current(token)) return { cancelled: true };
    if (
      error instanceof ApiError &&
      [400, 401, 403, 404, 413].includes(error.status)
    )
      return { error: submissionMessage(error) };
    const result = await checkLpSubmission(token);
    if (!result.lp) return result;
    if (["UnderReview", "Passed", "Failed"].includes(result.lp.kyb_status))
      return result;
    return {
      lp: result.lp,
      error:
        result.lp.kyb_status === "ChangesRequested"
          ? "Changes are requested. Review the account and documents before submitting again."
          : submissionMessage(error),
    };
  }
}
