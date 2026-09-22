import { createFileRoute, Link } from "@tanstack/react-router";
import { useLps } from "@/api/useLps";

// spec: docs/frontend/trustee-flows.md#lp-counterparties.
function LpCounterpartyDetail() {
  const { id } = Route.useParams();
  const { data } = useLps();
  const lp = data?.lps.find((candidate) => String(candidate.id) === id);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[26px] px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
        {lp?.legal_name ?? `LP ${id}`}
      </h1>
      <p className="font-[family-name:var(--font-body)] text-[16px] text-[color:var(--color-pipeline-ink-muted)]">
        Document review and KYB confirmation land in issue #1271.
      </p>
      <Link
        to="/lp-counterparties"
        className="w-fit font-[family-name:var(--font-body)] text-[16px] text-[color:var(--color-pipeline-brand)]"
      >
        Back to LP Counterparties
      </Link>
    </main>
  );
}

export const Route = createFileRoute("/lp-counterparties/$id")({
  component: LpCounterpartyDetail,
});
