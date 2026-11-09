// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { createFileRoute, Link } from "@tanstack/react-router";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";
import {
  HUB_EMPTY,
  HUB_FOOTNOTE,
  useRiskCouncilHub,
  type HubRoute,
  type LoanIndexRow,
  type ScheduledRow,
} from "./-risk-council-hub";
import { INK_MUTED, LINE_COLOR, Muted } from "./-RiskCouncilParts";

const navItem = TRUSTEE_NAV_ITEMS.find((t) => t.path === "/risk-council")!;

const HEADER_CELL_CLASS =
  "px-[14px] pb-[12px] text-left font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] font-normal text-[color:var(--color-pipeline-ink-muted)] whitespace-nowrap";
const BODY_CELL_CLASS =
  "px-[14px] py-[16px] align-top font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[color:var(--color-pipeline-ink)]";

const ROUTE_PATHS = {
  escalate: "/risk-council/escalate/$id",
  reterm: "/risk-council/reterm/$id",
  writedown: "/risk-council/writedown/$id",
} as const satisfies Record<HubRoute, string>;

function ActionLink({
  route,
  loanId,
  chain,
  children,
}: {
  route: HubRoute;
  loanId: string;
  chain: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={ROUTE_PATHS[route]}
      params={{ id: loanId }}
      search={{ chain }}
      className="text-[#000080] underline"
    >
      {children}
    </Link>
  );
}

function ScheduledTable({
  rows,
  noRole,
  chain,
}: {
  rows: ScheduledRow[];
  noRole: boolean;
  chain: number;
}) {
  const headers = ["Loan", "Action", "Arguments", "Executable from", "State"];
  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
        Scheduled operations
      </h2>
      <div
        className="overflow-x-auto rounded-[4px] bg-white pt-[16px]"
        style={{ border: `1px solid ${LINE_COLOR}` }}
      >
        <table data-testid="risk-council-scheduled" className="w-full">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className={HEADER_CELL_CLASS}>
                  {h}
                </th>
              ))}
              <th className={HEADER_CELL_CLASS} />
            </tr>
          </thead>
          <tbody>
            {noRole && (
              <tr data-testid="risk-council-scheduled-no-role">
                {headers.map((h) => (
                  <td key={h} className={BODY_CELL_CLASS}>
                    —
                  </td>
                ))}
                <td className={BODY_CELL_CLASS} />
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.key}
                data-testid="risk-council-scheduled-row"
                style={{ borderTop: `1px solid ${LINE_COLOR}` }}
              >
                <td className={BODY_CELL_CLASS}>{row.loanLabel}</td>
                <td className={BODY_CELL_CLASS}>{row.action}</td>
                <td className={BODY_CELL_CLASS}>{row.args}</td>
                <td className={BODY_CELL_CLASS}>{row.executableFrom}</td>
                <td className={BODY_CELL_CLASS}>{row.state}</td>
                <td className={BODY_CELL_CLASS}>
                  <ActionLink
                    route={row.link.route}
                    loanId={row.link.loanId}
                    chain={chain}
                  >
                    Open
                  </ActionLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !noRole && (
          <p
            data-testid="risk-council-scheduled-empty"
            className="px-[14px] pb-[16px] font-[family-name:var(--font-body)] text-[15px]"
            style={{ color: INK_MUTED }}
          >
            {HUB_EMPTY}
          </p>
        )}
      </div>
      <Muted testId="risk-council-scheduled-footnote">{HUB_FOOTNOTE}</Muted>
    </section>
  );
}

function LoansTable({
  loans,
  chain,
}: {
  loans: LoanIndexRow[];
  chain: number;
}) {
  return (
    <section className="flex flex-col gap-[8px]">
      <h2 className="font-[family-name:var(--font-display)] text-[26px] leading-[35.84px] text-[#262524]">
        Loans
      </h2>
      <div
        className="overflow-x-auto rounded-[4px] bg-white pt-[16px]"
        style={{ border: `1px solid ${LINE_COLOR}` }}
      >
        <table data-testid="risk-council-loans" className="w-full">
          <thead>
            <tr>
              {["Loan", "On-chain status", "Actions"].map((h) => (
                <th key={h} className={HEADER_CELL_CLASS}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => (
              <tr
                key={loan.loanId}
                data-testid="risk-council-loan-row"
                style={{ borderTop: `1px solid ${LINE_COLOR}` }}
              >
                <td className={BODY_CELL_CLASS}>
                  {loan.loanLabel} (#{loan.loanId})
                </td>
                <td className={BODY_CELL_CLASS}>{loan.status}</td>
                <td className={BODY_CELL_CLASS}>
                  <span className="flex flex-wrap gap-[16px]">
                    {loan.links.length === 0
                      ? "—"
                      : loan.links.map((link) => (
                          <ActionLink
                            key={link.label}
                            route={link.route}
                            loanId={loan.loanId}
                            chain={chain}
                          >
                            {link.label}
                          </ActionLink>
                        ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loans.length === 0 && (
          <p
            className="px-[14px] pb-[16px] font-[family-name:var(--font-body)] text-[15px]"
            style={{ color: INK_MUTED }}
          >
            No loans.
          </p>
        )}
      </div>
    </section>
  );
}

function RiskCouncilIndex() {
  const view = useRiskCouncilHub();

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[16px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-m)] leading-[var(--text-pipeline-heading-m--line-height)] text-[color:var(--color-pipeline-ink)]">
        {navItem.heading}
      </h1>
      {view.blockedReason ? (
        <Muted testId="risk-council-blocked">{view.blockedReason}</Muted>
      ) : (
        <>
          <p
            data-testid="risk-council-intro"
            className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]"
          >
            {view.intro}
          </p>
          {view.roleLine && (
            <Muted testId="risk-council-role">{view.roleLine}</Muted>
          )}
          <ScheduledTable
            rows={view.rows}
            noRole={view.noRole}
            chain={view.chainId}
          />
          <LoansTable loans={view.loans} chain={view.chainId} />
        </>
      )}
    </main>
  );
}

export const Route = createFileRoute("/risk-council/")({
  component: RiskCouncilIndex,
});
