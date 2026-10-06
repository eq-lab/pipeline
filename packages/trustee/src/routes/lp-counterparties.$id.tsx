// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, InlineError } from "@pipeline/ui";
import { useLpCounterpartyDetail } from "./-useLpCounterpartyDetail";
import { mapKybStatus } from "./-useLpCounterpartiesTable";
import { LpReviewDialog } from "./-LpReviewDialog";
import { LpBankDepositsSection } from "./-LpBankDepositsSection";
import { formatIsoDateUtc } from "@/utils/formatDate";

const statusClasses = {
  neutral: "text-pipeline-ink-muted bg-pipeline-fill-muted",
  attention: "text-pipeline-warning bg-pipeline-promo",
  positive: "text-pipeline-positive-strong bg-pipeline-positive-secondary",
  negative: "text-pipeline-negative-strong bg-pipeline-negative-secondary",
};

function LpCounterpartyDetailContent({ id }: { id: string }) {
  const detail = useLpCounterpartyDetail(id);
  const { lp } = detail;
  const status = lp ? mapKybStatus(lp.kyb_status) : null;
  return (
    <main className="font-body text-pipeline-ink mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-12 md:px-8">
      <Link to="/lp-counterparties" className="text-pipeline-brand w-fit">
        ← Back to LP Counterparties
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[40px] leading-tight break-words md:text-[64px]">
          {lp?.legal_name ?? `LP ${id}`}
        </h1>
        {detail.validId && (
          <Button
            variant="secondary"
            onClick={detail.refresh}
            disabled={detail.query.isFetching || detail.busy}
          >
            Refresh
          </Button>
        )}
      </div>
      {!detail.validId && <p role="alert">This LP identifier is invalid.</p>}
      {detail.validId && detail.query.isPending && (
        <p role="status">Loading LP counterparty…</p>
      )}
      {detail.error && (
        <div role="alert" className="flex flex-col gap-3">
          <InlineError
            message={detail.error.message}
            details={detail.error.details}
          />
          <Button
            variant="secondary"
            onClick={detail.refresh}
            disabled={detail.query.isFetching}
          >
            Retry
          </Button>
        </div>
      )}
      {lp && (
        <>
          <section
            className="rounded-pipeline-card border-pipeline-line bg-pipeline-surface border p-6"
            aria-label="LP profile"
          >
            {status && (
              <span
                className={`rounded-pipeline-pill inline-flex px-3 py-1 text-sm ${statusClasses[status.band]}`}
              >
                {status.label}
              </span>
            )}
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ProfileField label="Jurisdiction" value={lp.country} />
              <ProfileField label="Contact email" value={lp.contact_email} />
              <ProfileField
                label="First registration date"
                value={formatIsoDateUtc(lp.created_at)}
              />
              <ProfileField
                label="Submitted for review"
                value={formatIsoDateUtc(lp.kyb_submitted_at)}
              />
              <ProfileField
                label="Latest decision date"
                value={formatIsoDateUtc(lp.kyb_decided_at)}
              />
              <ProfileField
                label="Settlement address"
                value={lp.stellar_address}
              />
              <ProfileField
                label="Latest decision reason"
                value={lp.kyb_decision_reason}
              />
            </dl>
          </section>
          <section
            className="rounded-pipeline-card border-pipeline-line bg-pipeline-surface flex flex-col gap-4 border p-6"
            aria-labelledby="lp-documents-heading"
          >
            <h2 id="lp-documents-heading" className="font-display text-2xl">
              KYB documents
            </h2>
            {lp.documents.length === 0 && (
              <p className="text-pipeline-ink-muted">No documents submitted.</p>
            )}
            <ul className="divide-pipeline-line flex flex-col divide-y">
              {lp.documents.map((document) => (
                <li key={document.id} className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium break-all">
                        {document.original_filename}
                      </p>
                      <p className="text-pipeline-ink-muted text-sm">
                        {document.size_bytes.toLocaleString()} bytes ·{" "}
                        {document.content_type} · {document.status}
                      </p>
                    </div>
                    {document.download_url ? (
                      <a
                        href={document.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-pipeline-brand"
                        aria-label={`Download ${document.original_filename}`}
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-pipeline-ink-muted text-sm">
                        Download unavailable. Refresh to retry.
                      </span>
                    )}
                  </div>
                  <p className="text-pipeline-ink-muted text-sm">
                    Uploaded {formatIsoDateUtc(document.created_at)} · Reviewed{" "}
                    {formatIsoDateUtc(document.reviewed_at)} · Reviewer{" "}
                    {document.reviewed_by ?? "—"}
                  </p>
                  {document.reject_reason && (
                    <p className="text-pipeline-negative-strong text-sm break-words whitespace-pre-wrap">
                      Rejection reason: {document.reject_reason}
                    </p>
                  )}
                  {detail.canReview && document.status === "Provided" && (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="secondary"
                        disabled={detail.busy}
                        onClick={() =>
                          detail.open({
                            decision: "Verified",
                            documentId: document.id,
                            filename: document.original_filename,
                          })
                        }
                        aria-label={`Verify ${document.original_filename}`}
                      >
                        Verify document
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={detail.busy}
                        onClick={() =>
                          detail.open({
                            decision: "Rejected",
                            documentId: document.id,
                            filename: document.original_filename,
                          })
                        }
                        aria-label={`Reject ${document.original_filename}`}
                      >
                        Reject document
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section
            className="rounded-pipeline-card border-pipeline-line bg-pipeline-surface flex flex-col gap-4 border p-6"
            aria-label="KYB decision"
          >
            <h2 className="font-display text-2xl">KYB decision</h2>
            {detail.canReview ? (
              <>
                {!detail.canPass && (
                  <p className="text-pipeline-ink-muted text-sm">
                    Verify every submitted document before confirming KYB
                    passed.
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    disabled={detail.busy}
                    onClick={() => detail.open({ decision: "Failed" })}
                  >
                    Reject account
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={detail.busy}
                    onClick={() =>
                      detail.open({ decision: "ChangesRequested" })
                    }
                  >
                    Request changes
                  </Button>
                  {detail.canPass && (
                    <Button
                      variant="primary-dark"
                      disabled={detail.busy}
                      onClick={() => detail.open({ decision: "Passed" })}
                    >
                      Confirm KYB passed
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-pipeline-ink-muted text-sm">
                Review actions are available only while the LP is UnderReview.
              </p>
            )}
          </section>
          <LpBankDepositsSection lpId={lp.id} legalName={lp.legal_name} />
          {detail.action && (
            <LpReviewDialog
              action={detail.action}
              legalName={lp.legal_name}
              reason={detail.reason}
              onReasonChange={detail.setReason}
              onCancel={detail.close}
              onSubmit={() => void detail.submit()}
              busy={detail.busy}
              eligible={detail.eligible}
              validationError={detail.validationError}
              error={detail.mutationError}
            />
          )}
        </>
      )}
    </main>
  );
}

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-pipeline-ink-muted text-sm">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{value || "—"}</dd>
    </div>
  );
}

function LpCounterpartyDetail() {
  const { id } = Route.useParams();
  return <LpCounterpartyDetailContent key={id} id={id} />;
}

export const Route = createFileRoute("/lp-counterparties/$id")({
  component: LpCounterpartyDetail,
});
