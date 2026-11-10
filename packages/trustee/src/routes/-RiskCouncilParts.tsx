// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { InlineError } from "@pipeline/ui";
import type { ActionView, LabelValue, PageState } from "./-risk-council-shared";

export const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
export const INK = "#262524";
export const INK_MUTED = "rgba(56,55,53,0.6)";
export const BRAND = "var(--color-pipeline-brand)";

export const MAIN_CLASS =
  "mx-auto flex w-full max-w-[1180px] flex-col gap-[8px] px-[56px] pt-[39px] pb-[105px]";

export function BackLink() {
  return (
    <Link
      to="/risk-council"
      className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
    >
      ‹ Risk Council
    </Link>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
      {children}
    </h2>
  );
}

export function Card({
  testId,
  title,
  children,
}: {
  testId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex w-full flex-1 flex-col gap-[12px] rounded-[4px] bg-white px-[26px] py-[24px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <CardTitle>{title}</CardTitle>
      {children}
    </div>
  );
}

export function Row({
  label,
  value,
  valueColor,
  isLast,
  testId,
}: {
  label: string;
  value: ReactNode;
  valueColor?: string;
  isLast?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-end justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        {label}
      </span>
      <span
        className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]"
        style={{ color: valueColor ?? INK }}
      >
        {value}
      </span>
    </div>
  );
}

export function ChainStateRows({
  rows,
  testId,
}: {
  rows: LabelValue[];
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      {rows.map((row, index) => (
        <Row
          key={row.label}
          label={row.label}
          value={row.value}
          isLast={index === rows.length - 1}
        />
      ))}
    </div>
  );
}

export function Chip({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center rounded-[4px] px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
      style={{ backgroundColor: "rgba(191,189,187,0.12)", color: INK_MUTED }}
    >
      {children}
    </span>
  );
}

export function Muted({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
      style={{ color: INK_MUTED }}
    >
      {children}
    </p>
  );
}

export const FIELD_CLASS =
  "w-full rounded-[4px] border border-solid px-[13px] py-[10px] font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[#262524] outline-none disabled:cursor-not-allowed disabled:opacity-70";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span
        className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
        style={{ color: INK_MUTED }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export function PageGate({
  state,
  errorMessage,
  errorDetails,
  prefix,
  children,
}: {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  prefix: string;
  children: ReactNode;
}) {
  if (state === "error") {
    return (
      <main className={MAIN_CLASS}>
        <BackLink />
        <div
          data-testid={`${prefix}-error`}
          className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
        >
          <InlineError
            message={errorMessage ?? "Failed to load the loan."}
            details={errorDetails ?? undefined}
          />
        </div>
      </main>
    );
  }
  if (state === "loading") {
    return (
      <main className={MAIN_CLASS}>
        <div
          data-testid={`${prefix}-loading`}
          className="flex w-full flex-col gap-3"
          aria-busy="true"
          aria-label="Loading loan"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[120px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
            />
          ))}
        </div>
      </main>
    );
  }
  if (state === "not-found") {
    return (
      <main className={MAIN_CLASS}>
        <p
          data-testid={`${prefix}-not-found`}
          className="font-[family-name:var(--font-body)] text-[16px]"
          style={{ color: INK_MUTED }}
        >
          Loan not found.{" "}
          <Link to="/risk-council" className="text-[#000080] underline">
            Back to Risk Council
          </Link>
        </p>
      </main>
    );
  }
  return <>{children}</>;
}

function ConfirmDialog({
  testId,
  text,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  testId: string;
  text: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pending, onCancel]);

  return (
    <div
      data-testid={`${testId}-backdrop`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={() => !pending && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        className="flex w-[460px] max-w-[calc(100vw-32px)] flex-col gap-[8px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={`${testId}-title`}
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          {text}
        </h2>
        <div className="flex items-start justify-end gap-[12px] pt-[16px]">
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
            disabled={pending}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid={`${testId}-confirm`}
            onClick={onConfirm}
            disabled={pending}
            className="h-[40px] rounded-[4px] px-[17px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActionControls({
  prefix,
  view,
  confirmText,
  extraDisabled,
}: {
  prefix: string;
  view: ActionView;
  confirmText?: string;
  extraDisabled?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disabled = view.disabled || extraDisabled === true;
  const onClick = confirmText ? () => setConfirmOpen(true) : view.run;

  return (
    <div className="flex flex-col gap-[10px]">
      <Muted testId={`${prefix}-role`}>{view.roleLine}</Muted>
      {view.noLongerScheduled && (
        <Muted testId={`${prefix}-no-longer`}>{view.noLongerScheduled}</Muted>
      )}
      <button
        type="button"
        data-testid={`${prefix}-button`}
        onClick={onClick}
        disabled={disabled}
        className="flex h-[48px] items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-70"
        style={{ backgroundColor: BRAND }}
      >
        {view.buttonLabel}
      </button>
      {view.notice && <Muted testId={`${prefix}-notice`}>{view.notice}</Muted>}
      {view.stageText && (
        <Muted testId={`${prefix}-stage`}>{view.stageText}</Muted>
      )}
      {view.error && (
        <div data-testid={`${prefix}-error`}>
          <InlineError
            message={view.error.message}
            details={view.error.details}
            className="block text-[13px]"
          />
        </div>
      )}
      {view.hash && (
        <Muted testId={`${prefix}-hash`}>Submitted · {view.hash}</Muted>
      )}
      {confirmOpen && confirmText && (
        <ConfirmDialog
          testId={`${prefix}-confirm-dialog`}
          text={confirmText}
          confirmLabel={view.buttonLabel}
          pending={view.pending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            view.run();
          }}
        />
      )}
    </div>
  );
}
