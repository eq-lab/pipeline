// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import { useState, type ReactNode } from "react";
import { Button, InlineError } from "@pipeline/ui";
import {
  INSPECTION_KINDS,
  inspectionMeasuresQuantity,
  type InspectionKind,
} from "@pipeline/wallet-connect";
import { useRecordInspection } from "@/api/useSecurityInspections";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { stageLabel } from "@/lib/accessManagerAction";
import {
  ENTER_HELP,
  emptyInspectionForm,
  inspectionErrorCopy,
  inspectionFormError,
  toNewInspection,
  type InspectionFormInput,
} from "@/lib/securityInspections";
import { truncateAddress } from "@/lib/truncateAddress";
import { todayUtcDateInput } from "@/lib/wireOut";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { DIALOG_CLASS, HINT_CLASS, INPUT_CLASS } from "./-WireOutsSection";
import type { InspectionTarget } from "./-loanSecurityRecords";

export interface InspectionEntered {
  recordId: number;
  hash: string;
  inspectionId: number | null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

export function InspectionDialog({
  chainId,
  target,
  panel,
  onClose,
  onDone,
}: {
  chainId: number | null | undefined;
  target: InspectionTarget;
  panel: string[];
  onClose: () => void;
  onDone: (result: InspectionEntered) => void;
}) {
  const record = useRecordInspection();
  const { seed } = target;
  const [form, setForm] = useState<InspectionFormInput>(() =>
    emptyInspectionForm(seed),
  );
  const pending = record.isPending;
  const dialogRef = useLpReviewDialog<HTMLDivElement>(onClose, pending);
  const formError = inspectionFormError(form, panel, todayUtcDateInput());
  const measures = form.kind === "" || inspectionMeasuresQuantity(form.kind);
  const error = record.error
    ? inspectionErrorCopy(
        record.error,
        "Could not enter this inspection. Please try again.",
      )
    : null;
  const quantityLabel = seed.unit
    ? `Quantity found (${seed.unit})`
    : "Quantity found";

  function set<K extends keyof InspectionFormInput>(
    key: K,
    value: InspectionFormInput[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (formError !== null || pending) return;
    try {
      const done = await record.mutateAsync({
        chainId,
        recordId: seed.recordId,
        inspection: toNewInspection(form),
      });
      onDone({
        recordId: seed.recordId,
        hash: done.hash,
        inspectionId: done.inspectionId,
      });
    } catch {
      return;
    }
  }

  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="inspection-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-title"
        tabIndex={-1}
        data-testid="inspection-dialog"
        className={`${DIALOG_CLASS} max-h-[90vh] overflow-y-auto`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="inspection-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Enter inspection for {target.title}
        </h2>
        <div data-testid="inspection-context">
          {target.rows.map((row, i) => (
            <KeyValueRow
              key={row.label}
              label={row.label}
              isLast={i === target.rows.length - 1}
            >
              {row.value}
            </KeyValueRow>
          ))}
        </div>
        <p className={HINT_CLASS}>{ENTER_HELP}</p>
        <Field label="Inspector">
          <select
            data-testid="inspection-inspector"
            className={INPUT_CLASS}
            value={form.inspector}
            disabled={pending}
            onChange={(event) => set("inspector", event.target.value)}
          >
            <option value="">Select an inspector</option>
            {panel.map((address) => (
              <option key={address} value={address}>
                {truncateAddress(address)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select
            data-testid="inspection-kind"
            className={INPUT_CLASS}
            value={form.kind}
            disabled={pending}
            onChange={(event) =>
              set("kind", event.target.value as InspectionKind | "")
            }
          >
            <option value="">Select a kind</option>
            {INSPECTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inspection date (UTC)">
          <input
            type="date"
            data-testid="inspection-date"
            className={INPUT_CLASS}
            value={form.dateInput}
            max={todayUtcDateInput()}
            disabled={pending}
            onChange={(event) => set("dateInput", event.target.value)}
          />
        </Field>
        <Field label={quantityLabel}>
          <input
            type="text"
            inputMode="decimal"
            data-testid="inspection-quantity"
            className={INPUT_CLASS}
            value={measures ? form.quantity : ""}
            disabled={pending || !measures}
            onChange={(event) => set("quantity", event.target.value)}
          />
          {!measures && (
            <span className={HINT_CLASS}>Not measured by a sampling assay</span>
          )}
        </Field>
        <Field label="Grade">
          <input
            type="text"
            inputMode="decimal"
            data-testid="inspection-grade"
            className={INPUT_CLASS}
            value={form.grade}
            disabled={pending}
            onChange={(event) => set("grade", event.target.value)}
          />
          <span className={HINT_CLASS}>Leave empty if not measured</span>
        </Field>
        <Field label="Region">
          <input
            type="text"
            data-testid="inspection-region"
            className={INPUT_CLASS}
            value={form.region}
            disabled={pending}
            onChange={(event) => set("region", event.target.value)}
          />
        </Field>
        <Field label="Site hash">
          <input
            type="text"
            data-testid="inspection-site-hash"
            className={`${INPUT_CLASS} font-mono`}
            value={form.siteHash}
            disabled={pending}
            onChange={(event) => set("siteHash", event.target.value)}
          />
          <span className={HINT_CLASS}>Prefilled from the record</span>
        </Field>
        <Field label="Certificate no">
          <input
            type="text"
            data-testid="inspection-certificate-no"
            className={INPUT_CLASS}
            value={form.certificateNo}
            disabled={pending}
            onChange={(event) => set("certificateNo", event.target.value)}
          />
        </Field>
        <Field label="Certificate hash">
          <input
            type="text"
            data-testid="inspection-certificate-hash"
            className={`${INPUT_CLASS} font-mono`}
            value={form.certificateHash}
            disabled={pending}
            onChange={(event) => set("certificateHash", event.target.value)}
          />
          <span className={HINT_CLASS}>
            Salted sha256 of the certificate as received, 64 hex characters
          </span>
        </Field>
        {formError && (
          <p
            role="alert"
            data-testid="inspection-validation"
            className={HINT_CLASS}
          >
            {formError}
          </p>
        )}
        {error && (
          <div role="alert" data-testid="inspection-error">
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
            data-testid="inspection-confirm"
            disabled={formError !== null || pending}
            onClick={() => void submit()}
          >
            {stageLabel(record.stage, "Enter inspection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
