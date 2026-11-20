// spec: docs/frontend/trustee-flows.md#security-records-card
import { useState } from "react";
import { useStellarWallet } from "@pipeline/wallet-connect";
import {
  securityMarksConfigured,
  useSecurityRegistryAccess,
} from "@/api/useSecurityMarks";
import { AddressText } from "@/components/detail/AddressText";
import { CardTitle } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  BRAND,
  CARD_CLASS,
  INK,
  INK_MUTED,
  LINE_COLOR,
  cardStyle,
  chipStyle,
} from "@/components/detail/detailTokens";
import {
  REVALUE_NO_ROLE,
  accessState,
  type AccessState,
} from "@/lib/securityMarks";
import { stellarOnlyActionReason } from "@/lib/targetChains";
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

function InspectionsTable({ rows }: { rows: SecurityInspectionRow[] }) {
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REVALUE_CONNECT_WALLET = "Connect a Stellar wallet to set a price mark.";

function RecordBlock({
  record,
  revalueNote,
  revalueReady,
  onRevalue,
}: {
  record: SecurityRecordView;
  revalueNote: string | null;
  revalueReady: boolean | null;
  onRevalue: (record: SecurityRecordView) => void;
}) {
  const lastIndex = record.rows.length - 1;
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
            isLast={i === lastIndex && record.attestedBy == null}
          >
            {row.value}
          </KeyValueRow>
        ))}
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
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        Inspections
      </span>
      <InspectionsTable rows={record.inspections} />
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

export function SecurityRecordsCard({
  view,
  chainId,
}: {
  view: SecurityRecordsView;
  chainId: number | null | undefined;
}) {
  const { address, isConnected } = useStellarWallet();
  const stellar = stellarOnlyActionReason(chainId) === null;
  const available = stellar && securityMarksConfigured();
  const connected = isConnected && !!address;
  const access = useSecurityRegistryAccess("revalue", available);
  const state = accessState(access.data);
  const [editing, setEditing] = useState<SecurityRecordView | null>(null);
  const [result, setResult] = useState<RevalueResult | null>(null);
  if (view.state === "hidden") return null;
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
            revalueNote={revalueNoteFor(connected, state)}
            revalueReady={available ? connected && state === "ok" : null}
            onRevalue={setEditing}
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
    </div>
  );
}
