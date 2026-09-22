// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import React from "react";
import { createPortal } from "react-dom";
import { Button } from "@pipeline/ui";
import copyUrl from "../assets/copy.svg?url";
import hintUrl from "../assets/hint.svg?url";
import { FUNDING_DETAIL_LABELS } from "./fundingDetails";
import { useFundingDetailsModal } from "./useFundingDetailsModal";
import type { FundingDetailRow } from "./fundingDetails";

export interface FundingDetailsModalProps {
  open: boolean;
  onDismiss: () => void;
  details?: ReadonlyArray<FundingDetailRow>;
  onContactSupport?: () => void;
}

const NOTE_TEXT = "Transfers may take from the same day up to 5 business days";

export function FundingDetailsModal({
  open,
  onDismiss,
  details,
  onContactSupport,
}: FundingDetailsModalProps) {
  const headingId = React.useId();
  const rows: FundingDetailRow[] = FUNDING_DETAIL_LABELS.map((label) => {
    const match = details?.find((row) => row.label === label);
    return { label, value: match?.value ?? "—" };
  });

  const { copied, copy } = useFundingDetailsModal({
    open,
    rows,
    onDismiss,
  });

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(56,55,53,0.6)" }}
      onClick={onDismiss}
      data-testid="funding-details-modal-scrim"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col gap-6 overflow-y-auto"
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(80vh, 90dvh)",
          backgroundColor: "#f8f7f6",
          borderRadius: 4,
          padding: 24,
        }}
        data-node-id="6701:97113"
        data-testid="funding-details-modal"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onDismiss}
          className={[
            "absolute top-4 right-4",
            "flex h-8 w-8 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "text-[color:var(--color-pipeline-ink)]",
            "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
          ].join(" ")}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width={20}
            height={20}
            aria-hidden="true"
          >
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <h2
          id={headingId}
          className={[
            "m-0 text-left",
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-m)]",
            "leading-[var(--text-pipeline-heading-m--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          Funding details
        </h2>

        <div className="flex w-full flex-col gap-4">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex w-full items-center gap-3"
              data-testid={`funding-details-row-${row.label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")}`}
            >
              <span
                className={[
                  "flex-1",
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-body)]",
                  "leading-[var(--text-pipeline-body--line-height)]",
                  "text-[color:var(--color-pipeline-ink-muted)]",
                ].join(" ")}
              >
                {row.label}
              </span>
              <span
                className={[
                  "text-right",
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-body)]",
                  "leading-[var(--text-pipeline-body--line-height)]",
                  "text-[color:var(--color-pipeline-ink)]",
                ].join(" ")}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex w-full items-center gap-2">
          <p
            className={[
              "m-0 flex-1",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {NOTE_TEXT}
          </p>
          <span className="flex shrink-0 items-center p-2" aria-hidden="true">
            <img src={hintUrl} alt="" width={20} height={20} />
          </span>
        </div>

        <Button
          variant="primary-dark"
          onClick={copy}
          className="flex w-full items-center justify-center gap-2"
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 20,
              height: 20,
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${copyUrl})`,
              maskImage: `url(${copyUrl})`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
              WebkitMaskSize: "contain",
              maskSize: "contain",
            }}
          />
          {copied ? "Copied" : "Copy"}
        </Button>

        <p
          className={[
            "m-0 text-center",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          Need help?{" "}
          <button
            type="button"
            onClick={onContactSupport}
            className={[
              "text-[color:var(--color-pipeline-ink)]",
              "underline underline-offset-2",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
            ].join(" ")}
          >
            Contact Support
          </button>
        </p>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default FundingDetailsModal;
