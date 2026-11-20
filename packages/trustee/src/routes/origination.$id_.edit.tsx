// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InlineError } from "@pipeline/ui";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import { useOriginationEdit, useResubmitForm } from "./-origination-edit";
import { ATTENTION_FILL, LINE_COLOR, SubmissionForm } from "./-SubmissionForm";

const MAIN_CLASS =
  "mx-auto flex w-full max-w-[1200px] flex-col gap-[24px] px-4 py-12 md:px-8";
const BACK_LINK_CLASS =
  "self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline";
const BANNER_CLASS =
  "w-full rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#262524]";

function ResubmitForm({
  submission,
  heading,
  reviewedDate,
  reason,
  onBusyChange,
}: {
  submission: SubmissionView;
  heading: string;
  reviewedDate: string;
  reason: string;
  onBusyChange: (busy: boolean) => void;
}) {
  const resubmit = useResubmitForm(submission);
  const busy = resubmit.isPending || resubmit.isSuccess;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  return (
    <main className={MAIN_CLASS}>
      <div className="flex flex-col gap-[8px]">
        <Link
          to="/origination/$id"
          params={{ id: String(submission.id) }}
          state={{ submission }}
          className={BACK_LINK_CLASS}
        >
          ‹ {heading}
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
          Amend and resubmit
        </h1>
      </div>

      <div
        data-testid="origination-edit-reason"
        className="w-full rounded-[4px] border border-solid border-[rgba(194,80,10,0.3)] bg-[rgba(194,80,10,0.08)] px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#c2500a]"
      >
        Changes requested · {reviewedDate} — {reason}
      </div>

      <div
        data-testid="origination-edit-uri-banner"
        className={BANNER_CLASS}
        style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
      >
        You can keep this submission&apos;s <code>metadata_uri</code>. A new one
        must not be used by another open submission.
      </div>

      {resubmit.missingFields.length > 0 && (
        <div
          data-testid="origination-edit-prefill-warning"
          className={BANNER_CLASS}
          style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
        >
          This submission was stored without some fields — fill these in before
          resubmitting:{" "}
          <span className="font-mono text-[13px]">
            {resubmit.missingFields.join(", ")}
          </span>
        </div>
      )}

      <SubmissionForm
        form={resubmit.form}
        targetChainDisabled
        targetChainHint="Fixed at submission. To target another chain, submit a new loan."
        error={resubmit.error}
        isPending={resubmit.isPending}
        submitLabel="Resubmit for review"
        pendingLabel="Resubmitting…"
        onSubmit={resubmit.onSubmit}
        compactSubmit
      />
    </main>
  );
}

function OriginationEdit() {
  const { id } = Route.useParams();
  const location = useLocation();
  const edit = useOriginationEdit(id, location.state.submission);
  const [busy, setBusy] = useState(false);

  if (edit.state === "loading") {
    return (
      <main className={MAIN_CLASS}>
        <div
          data-testid="origination-edit-loading"
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading submission"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[60px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }

  if (edit.state === "error") {
    return (
      <main className={MAIN_CLASS}>
        <Link to="/origination" className={BACK_LINK_CLASS}>
          ‹ Origination
        </Link>
        <div
          data-testid="origination-edit-error"
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={edit.errorMessage ?? "Failed to load the submission."}
            details={edit.errorDetails ?? undefined}
          />
        </div>
      </main>
    );
  }

  if (edit.state === "not-found") {
    return (
      <main className={MAIN_CLASS}>
        <p
          data-testid="origination-edit-not-found"
          className="font-[family-name:var(--font-body)] text-[16px] text-[rgba(56,55,53,0.6)]"
        >
          Submission not found.{" "}
          <Link to="/origination" className="text-[#000080] underline">
            Back to Origination
          </Link>
        </p>
      </main>
    );
  }

  if (edit.submission && (edit.state === "ready" || busy)) {
    return (
      <ResubmitForm
        key={edit.submission.id}
        submission={edit.submission}
        heading={edit.heading}
        reviewedDate={edit.reviewedDate}
        reason={edit.reason}
        onBusyChange={setBusy}
      />
    );
  }

  return (
    <main className={MAIN_CLASS}>
      <p
        data-testid="origination-edit-not-editable"
        className="font-[family-name:var(--font-body)] text-[16px] text-[rgba(56,55,53,0.6)]"
      >
        This submission isn&apos;t awaiting changes.{" "}
        <Link
          to="/origination/$id"
          params={{ id }}
          state={{ submission: edit.submission }}
          className="text-[#000080] underline"
        >
          Back to the submission
        </Link>
      </p>
    </main>
  );
}

export const Route = createFileRoute("/origination/$id_/edit")({
  component: OriginationEdit,
});
