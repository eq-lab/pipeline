// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { useState, type ReactNode } from "react";
import { Button, InlineError } from "@pipeline/ui";
import { securityReasonHash, useStellarWallet } from "@pipeline/wallet-connect";
import {
  checkCoverageConfigured,
  securityMarksConfigured,
  useCheckCoverage,
  useRecordExtensionConsent,
  useSecurityRegistryAccess,
} from "@/api/useSecurityMarks";
import { CardTitle } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  BRAND,
  CARD_CLASS,
  INK,
  INK_MUTED,
  cardStyle,
} from "@/components/detail/detailTokens";
import { stageLabel } from "@/lib/accessManagerAction";
import {
  CHECK_COVERAGE_CONNECT_WALLET,
  CHECK_COVERAGE_HELP,
  CONSENT_HELP,
  CONSENT_NO_ROLE,
  accessState,
  consentFormError,
  newMaturitySeconds,
  securityMarksErrorCopy,
} from "@/lib/securityMarks";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { todayUtcDateInput } from "@/lib/wireOut";
import { useTextHash } from "./-risk-council-shared";
import { HINT_CLASS, INPUT_CLASS, shortHash } from "./-WireOutsSection";
import {
  NO_CONSENTS_TEXT,
  type ExtensionConsentRow,
  type SecurityActionsView,
} from "./-securityActions";

const BUTTON_CLASS =
  "inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50";
const NOTE_CLASS =
  "font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]";
const SUBTITLE_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

function ConsentList({ rows }: { rows: ExtensionConsentRow[] }) {
  if (rows.length === 0) {
    return (
      <p
        data-testid="loan-detail-extension-consents-empty"
        className={NOTE_CLASS}
        style={{ color: INK_MUTED }}
      >
        {NO_CONSENTS_TEXT}
      </p>
    );
  }
  return (
    <div data-testid="loan-detail-extension-consents">
      {rows.map((row, i) => (
        <KeyValueRow
          key={row.key}
          label={`Consent ${row.position}`}
          isLast={i === rows.length - 1}
        >
          <span
            data-testid="loan-detail-extension-consent"
            className="flex flex-wrap justify-end gap-x-[12px]"
          >
            <span>Extend to {row.newMaturity}</span>
            <span title={row.consentHash} className="font-mono text-[13px]">
              {row.consentHash === "—"
                ? row.consentHash
                : shortHash(row.consentHash)}
            </span>
            <span style={{ color: INK_MUTED }}>Recorded {row.recordedAt}</span>
          </span>
        </KeyValueRow>
      ))}
    </div>
  );
}

function CheckCoverage({
  chainId,
  loanId,
}: {
  chainId: number | null | undefined;
  loanId: number;
}) {
  const { address, isConnected } = useStellarWallet();
  const coverage = useCheckCoverage();
  const [hash, setHash] = useState<string | null>(null);
  const connected = isConnected && !!address;
  const error = coverage.error
    ? securityMarksErrorCopy(
        coverage.error,
        "Could not check coverage. Please try again.",
      )
    : null;

  async function run() {
    setHash(null);
    try {
      const done = await coverage.mutateAsync({ chainId, loanId });
      setHash(done.hash);
    } catch {
      return;
    }
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <span className={SUBTITLE_CLASS} style={{ color: INK_MUTED }}>
        Check coverage
      </span>
      <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
        {CHECK_COVERAGE_HELP}
      </p>
      {!connected && (
        <p
          data-testid="check-coverage-connect"
          className={NOTE_CLASS}
          style={{ color: INK_MUTED }}
        >
          {CHECK_COVERAGE_CONNECT_WALLET}
        </p>
      )}
      {hash && (
        <p
          data-testid="check-coverage-result"
          className={`${NOTE_CLASS} break-all`}
          style={{ color: INK }}
        >
          Coverage checked. Transaction {hash}. The card updates once indexed.
        </p>
      )}
      {error && (
        <div role="alert" data-testid="check-coverage-error">
          <InlineError message={error.message} details={error.details} />
        </div>
      )}
      <button
        type="button"
        data-testid="check-coverage-button"
        disabled={!connected || coverage.isPending}
        onClick={() => void run()}
        className={BUTTON_CLASS}
        style={{ backgroundColor: BRAND }}
      >
        {stageLabel(coverage.stage, "Check coverage")}
      </button>
    </div>
  );
}

function ConsentForm({
  chainId,
  loanId,
  available,
}: {
  chainId: number | null | undefined;
  loanId: number;
  available: boolean;
}) {
  const { address, isConnected } = useStellarWallet();
  const access = useSecurityRegistryAccess(
    "record_extension_consent",
    available,
  );
  const consent = useRecordExtensionConsent();
  const today = todayUtcDateInput();
  const [dateInput, setDateInput] = useState("");
  const [reference, setReference] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const consentHash = useTextHash(reference, securityReasonHash);
  const connected = isConnected && !!address;
  const state = accessState(access.data);
  const formError = consentFormError({ dateInput, reference }, today);
  const pending = consent.isPending;
  const error = consent.error
    ? securityMarksErrorCopy(
        consent.error,
        "Could not record this consent. Please try again.",
      )
    : null;
  const blocked = !connected || state === "no-role";

  async function submit() {
    if (formError !== null || consentHash === null || pending) return;
    setHash(null);
    try {
      const done = await consent.mutateAsync({
        chainId,
        loanId,
        newMaturity: newMaturitySeconds(dateInput),
        consentHash,
      });
      setHash(done.hash);
      setDateInput("");
      setReference("");
    } catch {
      return;
    }
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <span className={SUBTITLE_CLASS} style={{ color: INK_MUTED }}>
        Record buyer consent
      </span>
      <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
        {CONSENT_HELP}
      </p>
      {state === "no-role" && connected && (
        <p
          data-testid="extension-consent-no-role"
          className={NOTE_CLASS}
          style={{ color: INK_MUTED }}
        >
          {CONSENT_NO_ROLE}
        </p>
      )}
      <Field label="New maturity (UTC)">
        <input
          type="date"
          data-testid="extension-consent-date"
          className={INPUT_CLASS}
          value={dateInput}
          min={today}
          disabled={pending || blocked}
          onChange={(event) => setDateInput(event.target.value)}
        />
      </Field>
      <Field label="Buyer consent reference">
        <input
          type="text"
          data-testid="extension-consent-reference"
          className={INPUT_CLASS}
          value={reference}
          disabled={pending || blocked}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      {formError && !blocked && (dateInput !== "" || reference !== "") && (
        <p
          role="alert"
          data-testid="extension-consent-validation"
          className={HINT_CLASS}
        >
          {formError}
        </p>
      )}
      {consentHash && (
        <KeyValueRow label="Consent hash" isLast>
          <span
            data-testid="extension-consent-hash"
            className="font-mono text-[13px] leading-[18px] break-all"
          >
            {consentHash}
          </span>
        </KeyValueRow>
      )}
      {hash && (
        <p
          data-testid="extension-consent-result"
          className={`${NOTE_CLASS} break-all`}
          style={{ color: INK }}
        >
          Consent recorded. Transaction {hash}. The list updates once indexed.
        </p>
      )}
      {error && (
        <div role="alert" data-testid="extension-consent-error">
          <InlineError message={error.message} details={error.details} />
        </div>
      )}
      <Button
        type="button"
        variant="primary-blue"
        size="m"
        data-testid="extension-consent-submit"
        disabled={
          blocked || formError !== null || consentHash === null || pending
        }
        onClick={() => void submit()}
      >
        {stageLabel(consent.stage, "Record consent")}
      </Button>
    </div>
  );
}

export function SecurityActionsCard({
  view,
  chainId,
  loanId,
}: {
  view: SecurityActionsView;
  chainId: number | null | undefined;
  loanId: number | null;
}) {
  const stellar = stellarOnlyActionReason(chainId) === null;
  if (view.state === "hidden" || !stellar || loanId === null) return null;
  const coverage = checkCoverageConfigured();
  const marks = securityMarksConfigured();
  if (!coverage && !marks) return null;
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-security-actions"
    >
      <CardTitle>Security actions</CardTitle>
      {view.notes.map((note) => (
        <p
          key={note}
          data-testid="loan-detail-security-actions-note"
          className={NOTE_CLASS}
          style={{ color: INK_MUTED }}
        >
          {note}
        </p>
      ))}
      {coverage && <CheckCoverage chainId={chainId} loanId={loanId} />}
      <span className={SUBTITLE_CLASS} style={{ color: INK_MUTED }}>
        Extension consents
      </span>
      <ConsentList rows={view.consents} />
      {marks && (
        <ConsentForm chainId={chainId} loanId={loanId} available={marks} />
      )}
    </div>
  );
}
