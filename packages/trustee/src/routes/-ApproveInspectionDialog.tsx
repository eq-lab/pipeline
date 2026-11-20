// spec: docs/frontend/trustee-flows.md#security-inspections-1857
import type { ReactNode } from "react";
import { Button, InlineError } from "@pipeline/ui";
import { useApproveInspection } from "@/api/useSecurityInspections";
import { AddressText } from "@/components/detail/AddressText";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { stageLabel } from "@/lib/accessManagerAction";
import { APPROVE_EFFECT, inspectionErrorCopy } from "@/lib/securityInspections";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { DIALOG_CLASS, HINT_CLASS } from "./-WireOutsSection";
import type { SecurityInspectionRow } from "./-loanSecurityRecords";

export interface InspectionApproved {
  inspectionId: number;
  hash: string;
}

export function ApproveInspectionDialog({
  chainId,
  row,
  tolerances,
  onClose,
  onDone,
}: {
  chainId: number | null | undefined;
  row: SecurityInspectionRow;
  tolerances: { quantity: string; grade: string };
  onClose: () => void;
  onDone: (result: InspectionApproved) => void;
}) {
  const approve = useApproveInspection();
  const pending = approve.isPending;
  const dialogRef = useLpReviewDialog<HTMLDivElement>(onClose, pending);
  const error = approve.error
    ? inspectionErrorCopy(
        approve.error,
        "Could not approve this inspection. Please try again.",
      )
    : null;

  async function submit() {
    if (row.inspectionId == null || pending) return;
    try {
      const done = await approve.mutateAsync({
        chainId,
        inspectionId: row.inspectionId,
      });
      onDone({ inspectionId: row.inspectionId, hash: done.hash });
    } catch {
      return;
    }
  }

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Kind", value: row.kind },
    {
      label: "Inspector",
      value: row.inspector ? <AddressText value={row.inspector} /> : "—",
    },
    { label: "Inspected", value: row.inspected },
    { label: "Quantity", value: row.quantity },
    { label: "Grade", value: row.grade },
    { label: "Certificate no", value: row.certificateNo },
    {
      label: "Entered by",
      value: row.entered.address ? (
        <AddressText value={row.entered.address} />
      ) : (
        "—"
      ),
    },
    { label: "Entered", value: row.entered.date },
    { label: "Quantity tolerance", value: tolerances.quantity },
    { label: "Grade tolerance", value: tolerances.grade },
  ];

  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="approve-inspection-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-inspection-title"
        tabIndex={-1}
        data-testid="approve-inspection-dialog"
        className={`${DIALOG_CLASS} max-h-[90vh] overflow-y-auto`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="approve-inspection-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Approve inspection #{row.id}
        </h2>
        <div data-testid="approve-inspection-context">
          {rows.map((r, i) => (
            <KeyValueRow
              key={r.label}
              label={r.label}
              isLast={i === rows.length - 1}
            >
              {r.value}
            </KeyValueRow>
          ))}
        </div>
        <p className={HINT_CLASS}>{APPROVE_EFFECT}</p>
        {error && (
          <div role="alert" data-testid="approve-inspection-error">
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
            data-testid="approve-inspection-confirm"
            disabled={row.inspectionId == null || pending}
            onClick={() => void submit()}
          >
            {stageLabel(approve.stage, "Approve inspection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
