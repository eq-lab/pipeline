// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { createFileRoute } from "@tanstack/react-router";
import { InlineError } from "@pipeline/ui";
import {
  useRiskCouncilInspectors,
  type RiskCouncilInspectorsView,
} from "./-risk-council-inspectors";
import {
  ActionControls,
  BackLink,
  Card,
  Chip,
  FIELD_CLASS,
  Field,
  INK_MUTED,
  LINE_COLOR,
  MAIN_CLASS,
  Muted,
} from "./-RiskCouncilParts";

const STATUS_LABELS = {
  current: "Current",
  new: "New",
  removed: "Removed",
} as const;

function PanelCard({ view }: { view: RiskCouncilInspectorsView }) {
  return (
    <Card testId="risk-council-inspectors-panel" title="Approved inspectors">
      {view.loading && (
        <Muted testId="risk-council-inspectors-loading">Loading…</Muted>
      )}
      {view.loadError && (
        <div data-testid="risk-council-inspectors-load-error">
          <InlineError
            message={view.loadError.message}
            details={view.loadError.details}
            className="block text-[13px]"
          />
        </div>
      )}
      {!view.loading && !view.loadError && view.rows.length === 0 && (
        <Muted testId="risk-council-inspectors-empty">
          No inspection companies are approved.
        </Muted>
      )}
      <ul className="flex flex-col gap-[8px]">
        {view.rows.map((row) => (
          <li
            key={row.address}
            data-testid="risk-council-inspectors-row"
            className="flex items-center justify-between gap-[12px] font-[family-name:var(--font-body)] text-[14px] break-all"
            style={{
              textDecoration:
                row.status === "removed" ? "line-through" : "none",
            }}
          >
            <span>
              {row.address} <Chip>{STATUS_LABELS[row.status]}</Chip>
            </span>
            <button
              type="button"
              data-testid="risk-council-inspectors-toggle"
              onClick={() => view.toggleRemoved(row.address)}
              className="text-[#000080] underline"
            >
              {row.status === "removed" ? "Keep" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EditCard({ view }: { view: RiskCouncilInspectorsView }) {
  return (
    <Card testId="risk-council-inspectors-edit" title="Set the panel">
      <Field label="Add inspector (Stellar address)">
        <input
          type="text"
          data-testid="risk-council-inspectors-draft"
          value={view.draft}
          onChange={(e) => view.setDraft(e.target.value)}
          placeholder="G… or C…"
          className={FIELD_CLASS}
          style={{ borderColor: LINE_COLOR }}
        />
        {view.draftError && (
          <span
            data-testid="risk-council-inspectors-draft-error"
            role="alert"
            className="font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]"
          >
            {view.draftError}
          </span>
        )}
      </Field>
      <button
        type="button"
        data-testid="risk-council-inspectors-add"
        onClick={view.add}
        disabled={!view.canAdd}
        className="self-start rounded-[4px] border border-solid px-[17px] py-[8px] font-[family-name:var(--font-body)] text-[15px] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: LINE_COLOR }}
      >
        Add
      </button>
      <div data-testid="risk-council-inspectors-resulting">
        <span
          className="font-[family-name:var(--font-body)] text-[12px]"
          style={{ color: INK_MUTED }}
        >
          Resulting panel ({view.resulting.length})
        </span>
        <ol className="list-decimal pl-[20px] font-[family-name:var(--font-body)] text-[13px] break-all">
          {view.resulting.map((address) => (
            <li key={address}>{address}</li>
          ))}
        </ol>
      </div>
      {view.emptyWarning && (
        <Muted testId="risk-council-inspectors-empty-warning">
          {view.emptyWarning}
        </Muted>
      )}
      {view.noChanges && (
        <Muted testId="risk-council-inspectors-no-changes">
          {view.noChanges}
        </Muted>
      )}
      <Muted testId="risk-council-inspectors-note">{view.note}</Muted>
      <ActionControls prefix="risk-council-inspectors" view={view.action} />
    </Card>
  );
}

function RiskCouncilInspectors() {
  const view = useRiskCouncilInspectors();
  return (
    <main className={MAIN_CLASS}>
      <BackLink />
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        Inspector panel
      </h1>
      {view.action.chip && (
        <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
          <Chip testId="risk-council-inspectors-chip">{view.action.chip}</Chip>
        </div>
      )}
      <div className="flex w-full flex-col gap-[20px] pt-[16px] lg:flex-row lg:items-start">
        <PanelCard view={view} />
        <EditCard view={view} />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/risk-council/inspectors")({
  component: RiskCouncilInspectors,
});
