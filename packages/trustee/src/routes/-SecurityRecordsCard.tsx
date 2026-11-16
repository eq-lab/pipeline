// spec: docs/frontend/trustee-flows.md#security-records-card
import { AddressText } from "@/components/detail/AddressText";
import { CardTitle } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  CARD_CLASS,
  INK,
  INK_MUTED,
  LINE_COLOR,
  cardStyle,
  chipStyle,
} from "@/components/detail/detailTokens";
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

function RecordBlock({ record }: { record: SecurityRecordView }) {
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

export function SecurityRecordsCard({ view }: { view: SecurityRecordsView }) {
  if (view.state === "hidden") return null;
  return (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="loan-detail-security-records"
    >
      <CardTitle>Security records</CardTitle>
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
          <RecordBlock key={record.key} record={record} />
        ))
      )}
    </div>
  );
}
