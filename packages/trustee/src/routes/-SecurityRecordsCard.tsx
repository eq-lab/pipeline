// spec: docs/frontend/trustee-flows.md#security-records-card
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStellarWallet } from "@pipeline/wallet-connect";
import {
  checkCoverageConfigured,
  securityMarksConfigured,
  useSecurityRegistryAccess,
} from "@/api/useSecurityMarks";
import { AddressText } from "@/components/detail/AddressText";
import { CardTitle } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  BRAND,
  CARD_CLASS,
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK,
  INK_MUTED,
  LINE_COLOR,
  cardStyle,
  chipStyle,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import {
  REVALUE_NO_ROLE,
  accessState,
  type AccessState,
} from "@/lib/securityMarks";
import {
  APPROVE_NO_ROLE,
  CONNECT_TO_APPROVE,
  CONNECT_TO_ENTER,
  ENTERED_BY_THIS_WALLET,
  ENTER_NO_ROLE,
  NO_PANEL,
  NO_PANEL_CARD,
  REGISTRY_PAUSED_INSPECTIONS,
  canOfferApprove,
} from "@/lib/securityInspections";
import {
  DEFAULT_TARGET_CHAIN_ID,
  stellarOnlyActionReason,
} from "@/lib/targetChains";
import {
  ApproveInspectionDialog,
  type InspectionApproved,
} from "./-ApproveInspectionDialog";
import { InspectionDialog, type InspectionEntered } from "./-InspectionDialog";
import { RevalueDialog, type RevalueResult } from "./-RevalueDialog";
import {
  AWAITING_APPROVAL_TEXT,
  NO_RECORDS_TEXT,
  type SecurityActor,
  type SecurityInspectionRow,
  type SecurityRecordView,
  type SecurityRecordsView,
} from "./-loanSecurityRecords";

const HEADERS = [
  "Inspection",
  "Inspector",
  "Certificate",
  "Kind",
  "Inspected",
  "Quantity",
  "Grade",
  "Entered",
  "Approved",
  "Variance ref",
  "Variance prev",
  "Variance grade",
  "Flag",
  "Resolution",
  "",
];

const CELL = "px-[10px] py-[10px] align-top whitespace-nowrap";

function Actor({ actor }: { actor: SecurityActor }) {
  return (
    <div className="flex flex-col gap-[2px]">
      {actor.address ? <AddressText value={actor.address} /> : <span>—</span>}
      <span style={{ color: INK_MUTED }}>{actor.date}</span>
    </div>
  );
}

function ApprovedCell({
  approved,
}: {
  approved: SecurityInspectionRow["approved"];
}) {
  if (approved === "awaiting") return <span>{AWAITING_APPROVAL_TEXT}</span>;
  if (approved == null) return <span>—</span>;
  return <Actor actor={approved} />;
}

interface ApproveControl {
  wallet: string | null;
  ready: boolean;
  note: string | null;
  onApprove: (row: SecurityInspectionRow) => void;
}

function ApproveCell({
  row,
  approve,
}: {
  row: SecurityInspectionRow;
  approve: ApproveControl | null;
}) {
  if (approve == null) return null;
  if (canOfferApprove(row, approve.wallet)) {
    return (
      <div className="flex flex-col gap-[4px]">
        <button
          type="button"
          data-testid="loan-detail-approve-inspection"
          data-inspection-id={row.id}
          disabled={!approve.ready}
          onClick={() => approve.onApprove(row)}
          className="inline-flex h-[32px] w-fit items-center rounded-[4px] px-[12px] font-[family-name:var(--font-body)] text-[14px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          Approve
        </button>
        {approve.note && (
          <span
            data-testid="loan-detail-inspection-note"
            className="text-[12px] leading-[16.8px] whitespace-normal"
            style={{ color: INK_MUTED }}
          >
            {approve.note}
          </span>
        )}
      </div>
    );
  }
  if (row.awaitingApproval && row.enteredBy === approve.wallet) {
    return (
      <span
        className="text-[12px] leading-[16.8px] whitespace-normal"
        style={{ color: INK_MUTED }}
      >
        {ENTERED_BY_THIS_WALLET}
      </span>
    );
  }
  return null;
}

function InspectionsTable({
  rows,
  approve,
}: {
  rows: SecurityInspectionRow[];
  approve: ApproveControl | null;
}) {
  if (rows.length === 0) {
    return (
      <p
        className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
        style={{ color: INK_MUTED }}
      >
        No inspections.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]">
        <thead>
          <tr style={{ borderBottom: `1px solid ${LINE_COLOR}` }}>
            {HEADERS.map((h) => (
              <th
                key={h}
                className={`${CELL} text-[13px] font-normal`}
                style={{ color: INK_MUTED }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ color: INK }}>
          {rows.map((row, i) => (
            <tr
              key={`${row.id}-${i}`}
              data-testid="loan-detail-security-inspection"
              style={{ borderBottom: `1px solid ${LINE_COLOR}` }}
            >
              <td className={CELL}>
                #{row.id}
                {row.latest && (
                  <span
                    className="ml-[6px] text-[12px]"
                    style={{ color: INK_MUTED }}
                  >
                    latest
                  </span>
                )}
              </td>
              <td className={CELL}>
                {row.inspector ? <AddressText value={row.inspector} /> : "—"}
              </td>
              <td className={CELL}>{row.certificateNo}</td>
              <td className={CELL}>{row.kind}</td>
              <td className={CELL}>{row.inspected}</td>
              <td className={CELL}>{row.quantity}</td>
              <td className={CELL}>{row.grade}</td>
              <td className={CELL}>
                <Actor actor={row.entered} />
              </td>
              <td className={CELL}>
                <ApprovedCell approved={row.approved} />
              </td>
              <td className={CELL}>{row.varianceReference}</td>
              <td className={CELL}>{row.variancePrevious}</td>
              <td className={CELL}>{row.varianceGrade}</td>
              <td className={CELL}>
                {row.flagged ? (
                  <span
                    className="rounded-[4px] border border-solid px-[8px] py-[2px] text-[12px]"
                    style={chipStyle("negative")}
                  >
                    Flagged
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className={CELL}>{row.resolution}</td>
              <td className={CELL}>
                <ApproveCell row={row} approve={approve} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REVALUE_CONNECT_WALLET = "Connect a Stellar wallet to set a price mark.";

interface EnterControl {
  ready: boolean;
  note: string | null;
  onEnter: (record: SecurityRecordView) => void;
}

function RecordBlock({
  record,
  loanId,
  chain,
  revalueNote,
  revalueReady,
  onRevalue,
  enter,
  approve,
}: {
  record: SecurityRecordView;
  loanId: string;
  chain: number;
  revalueNote: string | null;
  revalueReady: boolean | null;
  onRevalue: (record: SecurityRecordView) => void;
  enter: EnterControl | null;
  approve: ApproveControl | null;
}) {
  const lastIndex = record.rows.length - 1;
  const trailing = record.openFlag != null || record.attestedBy != null;
  return (
    <div
      data-testid="loan-detail-security-record"
      data-record-id={record.recordId}
      className="flex flex-col gap-[12px] border-t border-solid pt-[16px] first:border-t-0 first:pt-0"
      style={{ borderColor: LINE_COLOR }}
    >
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
        <span
          className="font-[family-name:var(--font-body)] text-[16px] leading-[22.4px]"
          style={{ color: INK }}
        >
          {record.title}
        </span>
        <span
          className="font-[family-name:var(--font-body)] text-[14px]"
          style={{ color: INK_MUTED }}
        >
          {record.status}
        </span>
        {record.chips.map((chip) => (
          <span
            key={chip.label}
            data-testid="loan-detail-security-record-chip"
            className="rounded-[4px] border border-solid px-[8px] py-[2px] text-[12px]"
            style={chipStyle(chip.tone)}
          >
            {chip.label}
          </span>
        ))}
      </div>
      <div>
        {record.rows.map((row, i) => (
          <KeyValueRow
            key={row.label}
            label={row.label}
            isLast={i === lastIndex && !trailing}
          >
            {row.value}
            {row.note && (
              <span
                className="mt-[2px] block text-[13px] leading-[18.2px]"
                style={{ color: INK_MUTED }}
              >
                {row.note}
              </span>
            )}
          </KeyValueRow>
        ))}
        {record.openFlag && (
          <KeyValueRow label="Open flag" isLast={record.attestedBy == null}>
            <span data-testid="loan-detail-open-flag">
              Inspection #{record.openFlag.inspectionId}. The Risk Council
              settles it.{" "}
              <Link
                to="/risk-council/security/$id"
                params={{ id: loanId }}
                search={{ chain }}
                className="text-[#000080] underline"
              >
                Open
              </Link>
            </span>
          </KeyValueRow>
        )}
        {record.attestedBy && (
          <KeyValueRow label="Attested by" isLast>
            <AddressText value={record.attestedBy} />
          </KeyValueRow>
        )}
      </div>
      {record.revalue && revalueReady !== null && (
        <div className="flex flex-wrap items-center gap-[12px]">
          <button
            type="button"
            data-testid="loan-detail-revalue-button"
            disabled={!revalueReady}
            onClick={() => onRevalue(record)}
            className="inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            Set price
          </button>
          {revalueNote && (
            <span
              data-testid="loan-detail-revalue-note"
              className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
              style={{ color: INK_MUTED }}
            >
              {revalueNote}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[12px]">
        <span
          className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
          style={{ color: INK_MUTED }}
        >
          Inspections
        </span>
        {record.inspect && enter && (
          <>
            <button
              type="button"
              data-testid="loan-detail-enter-inspection"
              disabled={!enter.ready}
              onClick={() => enter.onEnter(record)}
              className={DETAIL_SECONDARY_BUTTON_CLASS}
              style={detailSecondaryButtonStyle()}
            >
              Enter inspection
            </button>
            {enter.note && (
              <span
                data-testid="loan-detail-inspection-note"
                className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
                style={{ color: INK_MUTED }}
              >
                {enter.note}
              </span>
            )}
          </>
        )}
      </div>
      <InspectionsTable rows={record.inspections} approve={approve} />
    </div>
  );
}

function revalueNoteFor(
  connected: boolean,
  access: AccessState,
): string | null {
  if (!connected) return REVALUE_CONNECT_WALLET;
  return access === "no-role" ? REVALUE_NO_ROLE : null;
}

function PanelBlock({ panel }: { panel: string[] | null }) {
  return (
    <div data-testid="loan-detail-inspector-panel" className="flex flex-col">
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        Inspector panel
      </span>
      {panel == null ? (
        <p
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          —
        </p>
      ) : panel.length === 0 ? (
        <p
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          {NO_PANEL_CARD}
        </p>
      ) : (
        panel.map((address, i) => (
          <KeyValueRow
            key={address}
            label={`Inspector ${i + 1}`}
            isLast={i === panel.length - 1}
          >
            <AddressText value={address} />
          </KeyValueRow>
        ))
      )}
      <Link
        to="/risk-council/inspectors"
        className="self-start pt-[8px] font-[family-name:var(--font-body)] text-[14px] text-[#000080] underline"
      >
        Inspector panel
      </Link>
    </div>
  );
}

function inspectionNote(
  connected: boolean,
  state: AccessState,
  paused: boolean,
  noWallet: string,
  noRole: string,
): string | null {
  if (paused) return REGISTRY_PAUSED_INSPECTIONS;
  if (!connected) return noWallet;
  return state === "no-role" ? noRole : null;
}

type InspectionResultLine =
  | ({ kind: "entered" } & InspectionEntered)
  | ({ kind: "approved" } & InspectionApproved);

function InspectionResult({
  result,
  onDismiss,
}: {
  result: InspectionResultLine;
  onDismiss: () => void;
}) {
  return (
    <p
      data-testid="loan-detail-inspection-result"
      className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] break-all"
      style={{ color: INK }}
    >
      {result.kind === "entered"
        ? `${result.inspectionId == null ? "Inspection" : `Inspection #${result.inspectionId}`} entered on record #${result.recordId}. Transaction ${result.hash}. It counts once a second operator approves it.`
        : `Inspection #${result.inspectionId} approved. Transaction ${result.hash}. Variances and any flag show once indexed.`}{" "}
      <button type="button" className="underline" onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  );
}

export function SecurityRecordsCard({
  view,
  chainId,
  loanId,
}: {
  view: SecurityRecordsView;
  chainId: number | null | undefined;
  loanId: string;
}) {
  const { address, isConnected } = useStellarWallet();
  const stellar = stellarOnlyActionReason(chainId) === null;
  const available = stellar && securityMarksConfigured();
  const panelReady = (view.panel?.length ?? 0) > 0;
  const inspectionsAvailable =
    stellar && checkCoverageConfigured() && securityMarksConfigured();
  const connected = isConnected && !!address;
  const access = useSecurityRegistryAccess("revalue", available);
  const enterAccess = useSecurityRegistryAccess(
    "record_inspection",
    inspectionsAvailable,
  );
  const approveAccess = useSecurityRegistryAccess(
    "approve_inspection",
    inspectionsAvailable,
  );
  const state = accessState(access.data);
  const enterState = accessState(enterAccess.data);
  const approveState = accessState(approveAccess.data);
  const [editing, setEditing] = useState<SecurityRecordView | null>(null);
  const [entering, setEntering] = useState<SecurityRecordView | null>(null);
  const [approving, setApproving] = useState<SecurityInspectionRow | null>(
    null,
  );
  const [result, setResult] = useState<RevalueResult | null>(null);
  const [inspectionResult, setInspectionResult] =
    useState<InspectionResultLine | null>(null);
  if (view.state === "hidden") return null;
  const chain = chainId ?? DEFAULT_TARGET_CHAIN_ID;
  const enter: EnterControl | null = inspectionsAvailable
    ? {
        ready: connected && enterState === "ok" && !view.paused && panelReady,
        note:
          inspectionNote(
            connected,
            enterState,
            view.paused,
            CONNECT_TO_ENTER,
            ENTER_NO_ROLE,
          ) ?? (panelReady ? null : NO_PANEL),
        onEnter: setEntering,
      }
    : null;
  const approve: ApproveControl | null = inspectionsAvailable
    ? {
        wallet: connected ? address! : null,
        ready: connected && approveState === "ok" && !view.paused,
        note: inspectionNote(
          connected,
          approveState,
          view.paused,
          CONNECT_TO_APPROVE,
          APPROVE_NO_ROLE,
        ),
        onApprove: setApproving,
      }
    : null;
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-security-records"
    >
      <CardTitle>Security records</CardTitle>
      {result && (
        <p
          data-testid="loan-detail-revalue-result"
          className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] break-all"
          style={{ color: INK }}
        >
          Price set for record #{result.recordId}. Transaction {result.hash}.
          The records update once indexed.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setResult(null)}
          >
            Dismiss
          </button>
        </p>
      )}
      {inspectionResult && (
        <InspectionResult
          result={inspectionResult}
          onDismiss={() => setInspectionResult(null)}
        />
      )}
      <PanelBlock panel={view.panel} />
      {view.state === "empty" ? (
        <p
          data-testid="loan-detail-security-records-empty"
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          {NO_RECORDS_TEXT}
        </p>
      ) : (
        view.records.map((record) => (
          <RecordBlock
            key={record.key}
            record={record}
            loanId={loanId}
            chain={chain}
            revalueNote={revalueNoteFor(connected, state)}
            revalueReady={available ? connected && state === "ok" : null}
            onRevalue={setEditing}
            enter={enter}
            approve={approve}
          />
        ))
      )}
      {editing?.revalue && (
        <RevalueDialog
          chainId={chainId}
          seed={editing.revalue}
          rows={editing.revalueRows}
          onClose={() => setEditing(null)}
          onDone={(done) => {
            setResult(done);
            setEditing(null);
          }}
        />
      )}
      {entering?.inspect && view.panel && (
        <InspectionDialog
          chainId={chainId}
          target={entering.inspect}
          panel={view.panel}
          onClose={() => setEntering(null)}
          onDone={(done) => {
            setInspectionResult({ kind: "entered", ...done });
            setEntering(null);
          }}
        />
      )}
      {approving && (
        <ApproveInspectionDialog
          chainId={chainId}
          row={approving}
          tolerances={view.tolerances}
          onClose={() => setApproving(null)}
          onDone={(done) => {
            setInspectionResult({ kind: "approved", ...done });
            setApproving(null);
          }}
        />
      )}
    </div>
  );
}
