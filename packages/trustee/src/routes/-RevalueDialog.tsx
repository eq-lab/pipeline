// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { useState, type ReactNode } from "react";
import { Button, InlineError } from "@pipeline/ui";
import { securityReasonHash } from "@pipeline/wallet-connect";
import { useRevalue } from "@/api/useSecurityMarks";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { stageLabel } from "@/lib/accessManagerAction";
import {
  EVIDENCE_HELP,
  reportHashFor,
  revalueFormError,
  revalueNeedsEvidence,
  securityMarksErrorCopy,
  type RevalueSeed,
} from "@/lib/securityMarks";
import { useTextHash } from "./-risk-council-shared";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { DIALOG_CLASS, HINT_CLASS, INPUT_CLASS } from "./-WireOutsSection";
import type { SecurityRow } from "./-loanSecurity";

export interface RevalueResult {
  recordId: number;
  hash: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

export function RevalueDialog({
  chainId,
  seed,
  rows,
  onClose,
  onDone,
}: {
  chainId: number | null | undefined;
  seed: RevalueSeed;
  rows: SecurityRow[];
  onClose: () => void;
  onDone: (result: RevalueResult) => void;
}) {
  const revalue = useRevalue();
  const [value, setValue] = useState(seed.suggestedValue ?? "");
  const [benchmark, setBenchmark] = useState(
    seed.suggestedBenchmark ?? seed.currentBenchmark ?? "",
  );
  const [evidence, setEvidence] = useState("");
  const pending = revalue.isPending;
  const dialogRef = useLpReviewDialog<HTMLDivElement>(onClose, pending);
  const input = { value, benchmark, evidence };
  const needsEvidence = revalueNeedsEvidence(input, seed);
  const evidenceHash = useTextHash(evidence, securityReasonHash);
  const reportHash = reportHashFor(input, seed, evidenceHash);
  const formError = revalueFormError(input, seed);
  const error = revalue.error
    ? securityMarksErrorCopy(
        revalue.error,
        "Could not set this price mark. Please try again.",
      )
    : null;

  async function submit() {
    if (formError !== null || reportHash === null || pending) return;
    try {
      const { hash } = await revalue.mutateAsync({
        chainId,
        recordId: seed.recordId,
        valuePerUnit: value.trim(),
        benchmark: benchmark.trim(),
        reportHash,
      });
      onDone({ recordId: seed.recordId, hash });
    } catch {
      return;
    }
  }

  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="revalue-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revalue-title"
        tabIndex={-1}
        data-testid="revalue-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="revalue-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Set price for {seed.title}
        </h2>
        <div data-testid="revalue-context">
          {rows.map((row, i) => (
            <KeyValueRow
              key={row.label}
              label={row.label}
              isLast={i === rows.length - 1}
            >
              {row.value}
            </KeyValueRow>
          ))}
        </div>
        <Field label="Price per unit (USD)">
          <input
            type="text"
            inputMode="decimal"
            data-testid="revalue-value"
            className={INPUT_CLASS}
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label="Benchmark">
          <input
            type="text"
            data-testid="revalue-benchmark"
            className={INPUT_CLASS}
            value={benchmark}
            disabled={pending}
            onChange={(event) => setBenchmark(event.target.value)}
          />
        </Field>
        {needsEvidence && (
          <Field label="Price evidence">
            <textarea
              data-testid="revalue-evidence"
              className={INPUT_CLASS}
              rows={3}
              value={evidence}
              disabled={pending}
              onChange={(event) => setEvidence(event.target.value)}
            />
            <span className={HINT_CLASS}>{EVIDENCE_HELP}</span>
          </Field>
        )}
        {formError && (
          <p
            role="alert"
            data-testid="revalue-validation"
            className={HINT_CLASS}
          >
            {formError}
          </p>
        )}
        {reportHash && (
          <KeyValueRow label="Report hash" isLast>
            <span
              data-testid="revalue-hash"
              className="font-mono text-[13px] leading-[18px] break-all"
            >
              {reportHash}
            </span>
          </KeyValueRow>
        )}
        {error && (
          <div role="alert" data-testid="revalue-error">
            <InlineError message={error.message} details={error.details} />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            size="m"
            className={DETAIL_SECONDARY_BUTTON_CLASS}
            style={detailSecondaryButtonStyle()}
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary-blue"
            size="m"
            data-testid="revalue-confirm"
            disabled={formError !== null || reportHash === null || pending}
            onClick={() => void submit()}
          >
            {stageLabel(revalue.stage, "Set price")}
          </Button>
        </div>
      </div>
    </div>
  );
}
