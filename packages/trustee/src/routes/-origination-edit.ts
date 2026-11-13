// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  normalizeOriginationSubmissionStatus,
  useLoanSubmissions,
} from "@/api/useLoanSubmissions";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { useResubmitLoan } from "@/api/useResubmitLoan";
import { targetChainLabel } from "@/lib/targetChains";
import { formatSubmittedDate } from "@/utils/formatDate";
import { mapResubmitError, toUserError } from "@/utils/userError";
import type { UserFacingError } from "@/utils/userError";
import { mapHeading, safeString } from "./-origination-detail";
import {
  prefillFromSubmission,
  useOriginationNewForm,
  type OriginationNewForm,
} from "./-origination-new";

export type OriginationEditState =
  | "loading"
  | "error"
  | "not-found"
  | "not-editable"
  | "ready";

export interface OriginationEditResult {
  state: OriginationEditState;
  submission: SubmissionView | undefined;
  errorMessage: string | null;
  errorDetails: string | null;
  reason: string;
  reviewedDate: string;
  heading: string;
}

export function useOriginationEdit(
  id: string,
  stateSubmission: SubmissionView | undefined,
): OriginationEditResult {
  const {
    data: submissions,
    isLoading: submissionsLoading,
    error: submissionsError,
  } = useLoanSubmissions();

  const submission = useMemo<SubmissionView | undefined>(
    () => submissions?.find((s) => String(s.id) === id) ?? stateSubmission,
    [stateSubmission, submissions, id],
  );

  return useMemo<OriginationEditResult>(() => {
    if (!submission) {
      const needsFallback = !stateSubmission;
      const state: OriginationEditState =
        needsFallback && submissionsLoading
          ? "loading"
          : needsFallback && submissionsError != null
            ? "error"
            : "not-found";
      const userError =
        state === "error" && submissionsError != null
          ? toUserError(submissionsError, "Failed to load the submission.")
          : null;
      return {
        state,
        submission: undefined,
        errorMessage: userError?.message ?? null,
        errorDetails: userError?.details ?? null,
        reason: "—",
        reviewedDate: "—",
        heading: "—",
      };
    }
    const editable =
      normalizeOriginationSubmissionStatus(submission.status) ===
      "ChangesRequested";
    return {
      state: editable ? "ready" : "not-editable",
      submission,
      errorMessage: null,
      errorDetails: null,
      reason: safeString(submission.reason),
      reviewedDate: formatSubmittedDate(submission.updated_at),
      heading: mapHeading(submission),
    };
  }, [submission, stateSubmission, submissionsLoading, submissionsError]);
}

export interface ResubmitFormResult {
  form: OriginationNewForm;
  missingFields: string[];
  error: UserFacingError | null;
  isPending: boolean;
  isSuccess: boolean;
  onSubmit: () => void;
}

export function useResubmitForm(
  submission: SubmissionView,
): ResubmitFormResult {
  const navigate = useNavigate();
  const resubmit = useResubmitLoan();
  const chainId = submission.target_chain_id;
  const [prefill] = useState(() => prefillFromSubmission(submission));
  const form = useOriginationNewForm(
    {
      options:
        chainId == null
          ? []
          : [{ id: chainId, label: targetChainLabel(chainId) }],
      defaultChainId: chainId ?? null,
    },
    { values: prefill.values, documents: prefill.documents },
  );

  const onSubmit = () => {
    const built = form.buildForSubmit();
    if (built == null) return;
    resubmit.reset();
    void resubmit
      .mutateAsync({ id: submission.id, input: built.input })
      .then(() =>
        navigate({
          to: "/origination/$id",
          params: { id: String(submission.id) },
        }),
      )
      .catch(() => undefined);
  };

  return {
    form,
    missingFields: prefill.missingFields,
    error: mapResubmitError(resubmit.error),
    isPending: resubmit.isPending,
    isSuccess: resubmit.isSuccess,
    onSubmit,
  };
}
