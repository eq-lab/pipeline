// spec: docs/frontend/trustee-flows.md#disburse-1898
import { useEffect, useState, type ReactNode } from "react";
import { Button, InlineError } from "@pipeline/ui";
import {
  bankReferenceRefHash,
  parseUsdDollarsToI128,
  useStellarWallet,
} from "@pipeline/wallet-connect";
import {
  disburseConfigured,
  useDebtTrustline,
  useDisburse,
  useDisburseAccess,
  useLoanDisbursementState,
} from "@/api/useDisburse";
import { useDeal } from "@/api/useDealToken";
import { useMinterPaused, useMinterPoolState } from "@/api/useConversions";
import { CardTitle } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  BRAND,
  CARD_CLASS,
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  cardStyle,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import { stageLabel } from "@/lib/accessManagerAction";
import {
  disburseErrorCopy,
  disburseFormError,
  disburseView,
} from "@/lib/disburse";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import {
  rawToDecimal7,
  todayUtcDateInput,
  valueDateSeconds,
} from "@/lib/wireOut";
import { formatUsdExact } from "@/utils/formatUsd";
import { useLpReviewDialog } from "./-useLpReviewDialog";
import { DIALOG_CLASS, HINT_CLASS, INPUT_CLASS } from "./-WireOutsSection";

const BUTTON_CLASS =
  "inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50";
const NOTE_CLASS =
  "font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]";

interface DisburseResult {
  amount: string;
  valueDate: string;
  hash: string;
}

function usd(raw: string | undefined): string {
  return raw === undefined ? "—" : formatUsdExact(rawToDecimal7(raw));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

export function DisburseAction({
  chainId,
  loanId,
  loanName,
}: {
  chainId: number | null | undefined;
  loanId: number | null;
  loanName: string;
}) {
  const { address, isConnected } = useStellarWallet();
  const loan = useLoanDisbursementState(chainId, loanId);
  const deal = useDeal(chainId, loanId);
  const trustline = useDebtTrustline(chainId, loanId, deal.data?.debt);
  const stellar = stellarOnlyActionReason(chainId) === null;
  const poolState = useMinterPoolState(stellar && disburseConfigured());
  const paused = useMinterPaused(stellar && disburseConfigured());
  const access = useDisburseAccess(stellar);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<DisburseResult | null>(null);

  const view = disburseView({
    chainId,
    configured: disburseConfigured(),
    connected: isConnected && !!address,
    loan,
    deal,
    trustline,
    paused,
    access,
  });

  if (view.kind === "hidden" && !result) return null;

  const bankCash = poolState.data?.bankCash;
  const approved = loan.data?.status === "Approved";

  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-disburse"
    >
      <CardTitle>Disbursement</CardTitle>
      <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
        {approved
          ? "This loan is drawn but not disbursed on-chain. Book the wire to the borrower to move it to Performing."
          : "Book a further disbursement against this loan's senior tranche."}
      </p>
      <div>
        <KeyValueRow label="Senior tranche">
          {usd(loan.data?.originalSeniorTranche)}
        </KeyValueRow>
        <KeyValueRow label="Disbursed on-chain">
          {usd(loan.data?.disbursed)}
        </KeyValueRow>
        <KeyValueRow label="Booked bank cash" isLast>
          {usd(bankCash)}
        </KeyValueRow>
      </div>
      {view.kind === "blocked" && (
        <p
          data-testid="loan-detail-disburse-blocked"
          className={NOTE_CLASS}
          style={{ color: INK_MUTED }}
        >
          {view.reason}
        </p>
      )}
      {result && (
        <p
          data-testid="loan-detail-disburse-result"
          className={`${NOTE_CLASS} break-all`}
        >
          Disbursed {result.amount} on-chain, value date {result.valueDate}.
          Transaction {result.hash}. The loan book updates once indexed.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setResult(null)}
          >
            Dismiss
          </button>
        </p>
      )}
      {view.kind !== "hidden" && (
        <button
          type="button"
          data-testid="loan-detail-disburse-button"
          disabled={view.kind !== "ready"}
          onClick={() => setOpen(true)}
          className={BUTTON_CLASS}
          style={{ backgroundColor: BRAND }}
        >
          Disburse
        </button>
      )}
      {open && loanId !== null && (
        <DisburseDialog
          chainId={chainId}
          loanId={loanId}
          loanName={loanName}
          bankCash={bankCash ?? null}
          tranche={loan.data?.originalSeniorTranche}
          disbursed={loan.data?.disbursed}
          onClose={() => setOpen(false)}
          onDone={(done) => {
            setResult(done);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DisburseDialog({
  chainId,
  loanId,
  loanName,
  bankCash,
  tranche,
  disbursed,
  onClose,
  onDone,
}: {
  chainId: number | null | undefined;
  loanId: number;
  loanName: string;
  bankCash: string | null;
  tranche: string | undefined;
  disbursed: string | undefined;
  onClose: () => void;
  onDone: (result: DisburseResult) => void;
}) {
  const disburse = useDisburse();
  const today = todayUtcDateInput();
  const [amountInput, setAmountInput] = useState("");
  const [valueDateInput, setValueDateInput] = useState(today);
  const [reference, setReference] = useState("");
  const [refHash, setRefHash] = useState<string | null>(null);
  const pending = disburse.isPending;
  const dialogRef = useLpReviewDialog<HTMLDivElement>(onClose, pending);

  useEffect(() => {
    let cancelled = false;
    if (reference.trim() === "") {
      setRefHash(null);
      return;
    }
    void bankReferenceRefHash(reference).then((hash) => {
      if (!cancelled) setRefHash(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const formError = disburseFormError({
    amountInput,
    bankCashRaw: bankCash,
    valueDateInput,
    today,
    reference,
  });
  const error = disburse.error
    ? disburseErrorCopy(disburse.error, {
        disbursed,
        originalSeniorTranche: tranche,
      })
    : null;

  async function submit() {
    if (formError !== null || pending) return;
    const amountRaw = parseUsdDollarsToI128(amountInput).toString();
    try {
      const { hash } = await disburse.mutateAsync({
        chainId,
        loanId,
        amountRaw,
        valueDate: valueDateSeconds(valueDateInput),
        reference,
      });
      onDone({
        amount: formatUsdExact(rawToDecimal7(amountRaw)),
        valueDate: valueDateInput,
        hash,
      });
    } catch {
      return;
    }
  }

  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      data-testid="disburse-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disburse-title"
        tabIndex={-1}
        data-testid="disburse-dialog"
        className={DIALOG_CLASS}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="disburse-title"
          className="font-display text-[26px] leading-[36px]"
        >
          Disburse {loanName}
        </h2>
        <div>
          <KeyValueRow label="Senior tranche">{usd(tranche)}</KeyValueRow>
          <KeyValueRow label="Disbursed on-chain">{usd(disbursed)}</KeyValueRow>
          <KeyValueRow label="Booked bank cash" isLast>
            {usd(bankCash ?? undefined)}
          </KeyValueRow>
        </div>
        <Field label="Amount (USD)">
          <input
            type="text"
            inputMode="decimal"
            data-testid="disburse-amount"
            className={INPUT_CLASS}
            value={amountInput}
            disabled={pending}
            onChange={(event) => setAmountInput(event.target.value)}
          />
        </Field>
        <Field label="Value date (UTC)">
          <input
            type="date"
            data-testid="disburse-value-date"
            className={INPUT_CLASS}
            value={valueDateInput}
            max={today}
            disabled={pending}
            onChange={(event) => setValueDateInput(event.target.value)}
          />
        </Field>
        <Field label="Bank reference">
          <input
            type="text"
            data-testid="disburse-reference"
            className={INPUT_CLASS}
            value={reference}
            disabled={pending}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        {formError && (
          <p
            role="alert"
            data-testid="disburse-validation"
            className={HINT_CLASS}
          >
            {formError}
          </p>
        )}
        {refHash && (
          <KeyValueRow label="Reference hash" isLast>
            <span
              data-testid="disburse-hash"
              className="font-mono text-[13px] leading-[18px] break-all"
            >
              {refHash}
            </span>
          </KeyValueRow>
        )}
        {error && (
          <div role="alert" data-testid="disburse-error">
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
            data-testid="disburse-confirm"
            disabled={formError !== null || pending}
            onClick={() => void submit()}
          >
            {stageLabel(disburse.stage, "Disburse")}
          </Button>
        </div>
      </div>
    </div>
  );
}
