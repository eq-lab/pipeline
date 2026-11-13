/**
 * Submit a loan — /origination/new (#1100).
 * spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useOriginationNewForm } from "./-origination-new";
import { ImportJsonDialog } from "./-ImportJsonDialog";
import {
  ATTENTION_FILL,
  LINE_COLOR,
  SECONDARY_BUTTON_CLASS,
  SubmissionForm,
} from "./-SubmissionForm";
import { useServedTargetChains } from "@/api/useChains";
import { useSubmitLoan } from "@/api/useSubmitLoan";
import { toUserError } from "@/utils/userError";

function OriginationNew() {
  const targetChains = useServedTargetChains();
  const form = useOriginationNewForm(targetChains);
  const submit = useSubmitLoan();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);

  const submitError = submit.error
    ? toUserError(submit.error, "Failed to submit the loan.")
    : null;

  const onSubmit = () => {
    const variables = form.buildForSubmit();
    if (variables == null) return;
    submit.reset();
    void submit
      .mutateAsync(variables)
      .then(() => navigate({ to: "/origination" }))
      .catch(() => undefined);
  };

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[24px] px-4 py-12 md:px-8">
      <div className="flex flex-col gap-[8px]">
        <Link
          to="/origination"
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          ‹ Origination
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-[16px]">
          <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
            Submit a loan
          </h1>
          <button
            type="button"
            data-testid="submit-loan-import-open"
            onClick={() => setImportOpen(true)}
            className={SECONDARY_BUTTON_CLASS}
          >
            Import from JSON
          </button>
        </div>
      </div>

      <div
        data-testid="submit-loan-uri-banner"
        className="w-full rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#262524]"
        style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
      >
        Each submission needs a unique <code>metadata_uri</code> — reusing one
        from an earlier submission is rejected by the API.
      </div>

      {form.importWarning && (
        <div
          data-testid="submit-loan-import-warning"
          className="w-full rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#262524]"
          style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
        >
          Imported with missing fields — fill these in by hand:{" "}
          <span className="font-mono text-[13px]">
            {form.importWarning.join(", ")}
          </span>
        </div>
      )}

      <SubmissionForm
        form={form}
        targetChainDisabled={
          targetChains.isLoading || form.targetChainOptions.length === 0
        }
        error={submitError}
        isPending={submit.isPending}
        submitLabel="Submit loan"
        pendingLabel="Submitting…"
        onSubmit={onSubmit}
      />

      <ImportJsonDialog
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onImport={(text) => {
          const error = form.importFromJson(text);
          if (error == null) setImportOpen(false);
          return error;
        }}
      />
    </main>
  );
}

export const Route = createFileRoute("/origination/new")({
  component: OriginationNew,
});
