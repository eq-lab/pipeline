// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import React from "react";
import { createPortal } from "react-dom";
import { Button } from "@pipeline/ui";
import { useCopyToClipboard } from "@pipeline/ui";
import { truncateAddress } from "@/utils/truncateAddress";
import { CopyGlyph } from "./FundingDetailsGlyphs";
import { InfoTooltip } from "./InfoTooltip";
import {
  FUNDING_DETAIL_LABELS,
  PAYMENT_REFERENCE_LABEL,
} from "./fundingDetails";
import { useFundingDetailsModal } from "./useFundingDetailsModal";
import type { FundingDetailRow, FundingDetailsView } from "./fundingDetails";

export interface FundingDetailsModalProps {
  open: boolean;
  onDismiss: () => void;
  view?: FundingDetailsView;
  onOpenAccount?: () => void;
  onContactSupport?: () => void;
}

const NOTE_TEXT = "Transfers may take from the same day up to 5 business days";
const INSTRUCTION_TEXT =
  "Add this reference to your transfer’s reference or remittance field. Without it we can’t match your transfer to your account.";
const DESTINATION_TEXT = "Your transfer is credited to this wallet as sPLUSD.";
const NOTE_TOOLTIP_TEXT =
  "Domestic transfers: Same day or within 1 business day\nInternational transfers: 1–5 business days";
const ERROR_NOTICE =
  "Bank details are unavailable right now. Close this window and try again, or contact support.";

const LOADING_VIEW: FundingDetailsView = { status: "loading" };
const LABEL_CLASS = [
  "flex flex-1 items-center gap-1",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");
const VALUE_CLASS = [
  "min-w-0 break-all text-right",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");
const CAPTION_CLASS = [
  "m-0",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const COPY_BUTTON_CLASS = [
  "flex h-8 w-8 shrink-0 items-center justify-center",
  "rounded-[var(--radius-pipeline-card)]",
  "text-[color:var(--color-pipeline-ink)]",
  "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
].join(" ");

function DetailRow({
  label,
  labelAdornment,
  value,
  valueTitle,
  children,
}: {
  label: string;
  labelAdornment?: React.ReactNode;
  value: string;
  valueTitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="flex w-full items-center gap-3"
      data-testid={`funding-details-row-${slug(label)}`}
    >
      <span className={LABEL_CLASS}>
        {label}
        {labelAdornment}
      </span>
      <span className={VALUE_CLASS} title={valueTitle}>
        {value}
      </span>
      {children}
    </div>
  );
}

function CopyIconButton({
  label,
  testId,
  disabled,
  onClick,
}: {
  label: string;
  testId: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={COPY_BUTTON_CLASS}
    >
      <CopyGlyph size={20} />
    </button>
  );
}

export function FundingDetailsModal({
  open,
  onDismiss,
  view = LOADING_VIEW,
  onOpenAccount,
  onContactSupport,
}: FundingDetailsModalProps) {
  const headingId = React.useId();
  const ready = view.status === "ready";
  const rows: FundingDetailRow[] = ready
    ? view.rows
    : [...FUNDING_DETAIL_LABELS, PAYMENT_REFERENCE_LABEL].map((label) => ({
        label,
        value: "—",
      }));
  const bankRows = rows.slice(0, FUNDING_DETAIL_LABELS.length);
  const referenceValue = ready ? view.paymentReference : "—";

  const { copied, copy } = useFundingDetailsModal({
    open,
    rows: ready ? view.rows : null,
    onDismiss,
  });
  const { copied: referenceCopied, copy: copyReference } = useCopyToClipboard();
  const { copied: walletCopied, copy: copyWallet } = useCopyToClipboard();
  const receiverAddress = ready ? view.receiverAddress : "";

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

        {view.status === "unavailable" && (
          <div
            role="alert"
            data-testid="funding-details-notice"
            className={[
              "flex flex-col gap-3 p-4",
              "rounded-[var(--radius-pipeline-card)]",
              "bg-[color:var(--color-pipeline-surface)]",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            <p className="m-0">
              {view.reason === "not-linked"
                ? `Bank details need a ${view.chainName} wallet linked to your account. Link it on your Account page, or switch to a wallet you have already linked.`
                : ERROR_NOTICE}
            </p>
            {view.reason === "not-linked" && (
              <Button variant="secondary" size="m" onClick={onOpenAccount}>
                Go to Account
              </Button>
            )}
          </div>
        )}

        <div
          className="flex w-full flex-col gap-4"
          aria-busy={view.status === "loading"}
        >
          {bankRows.map((row) => (
            <DetailRow key={row.label} label={row.label} value={row.value} />
          ))}
          <DetailRow label={PAYMENT_REFERENCE_LABEL} value={referenceValue}>
            <CopyIconButton
              label="Copy payment reference"
              testId="funding-details-copy-reference"
              disabled={!ready}
              onClick={() => void copyReference(referenceValue)}
            />
            {referenceCopied && ready && (
              <span className={CAPTION_CLASS}>Copied</span>
            )}
          </DetailRow>
          <p className={CAPTION_CLASS}>{INSTRUCTION_TEXT}</p>
          <div
            className="h-px w-full bg-[color:var(--color-pipeline-line)]"
            aria-hidden="true"
          />
          <DetailRow label="Network" value={ready ? view.network : "—"} />
          <DetailRow
            label="Receiving wallet"
            labelAdornment={
              <InfoTooltip
                label="About the receiving wallet"
                text={DESTINATION_TEXT}
                align="start"
                data-testid="funding-details-wallet-info"
              />
            }
            value={ready ? truncateAddress(receiverAddress) : "—"}
            valueTitle={ready ? receiverAddress : undefined}
          >
            <CopyIconButton
              label="Copy receiving wallet address"
              testId="funding-details-copy-wallet"
              disabled={!ready}
              onClick={() => void copyWallet(receiverAddress)}
            />
            {walletCopied && ready && (
              <span className={CAPTION_CLASS}>Copied</span>
            )}
          </DetailRow>
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
          <InfoTooltip
            label="Transfer timing"
            text={NOTE_TOOLTIP_TEXT}
            align="end"
            data-testid="funding-details-note-info"
          />
        </div>

        <Button
          variant="primary-dark"
          onClick={copy}
          disabled={!ready}
          className="flex w-full items-center justify-center gap-2"
        >
          <CopyGlyph size={24} />
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
