// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { createFileRoute } from "@tanstack/react-router";
import { Button, InlineError } from "@pipeline/ui";
import { DocumentIcon } from "@/components/DocumentIcon";
import { DetailHero } from "@/components/detail/DetailHero";
import { CardTitle, DetailCard } from "@/components/detail/DetailCard";
import { KeyValueRow } from "@/components/detail/KeyValueRow";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  INK_MUTED,
  LINE_COLOR,
  NEGATIVE_RED,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import {
  lpHeroMeta,
  useLpCounterpartyDetail,
} from "./-useLpCounterpartyDetail";
import { mapKybStatus } from "./-useLpCounterpartiesTable";
import { LpReviewDialog } from "./-LpReviewDialog";
import { LpBankDepositsSection } from "./-LpBankDepositsSection";
import { formatIsoDateUtc } from "@/utils/formatDate";

const NOTE_CLASS =
  "font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]";
const BODY_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";
const SUB_CLASS =
  "font-[family-name:var(--font-body)] text-[12.5px] leading-[17.5px]";

function orDash(value: string | null | undefined) {
  return value || "—";
}

function LpCounterpartyDetailContent({ id }: { id: string }) {
  const detail = useLpCounterpartyDetail(id);
  const { lp } = detail;
  const status = lp ? mapKybStatus(lp.kyb_status) : null;
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[80px]">
      <DetailHero
        backTo="/lp-counterparties"
        backLabel="‹ LP Counterparties"
        title={lp?.legal_name ?? `LP ${id}`}
        status={status}
        meta={lp ? lpHeroMeta(lp) : ""}
        statusTestId="lp-detail-status-chip"
        metaTestId="lp-detail-meta"
      />
      {!detail.validId && (
        <p role="alert" className={BODY_CLASS} style={{ color: INK_MUTED }}>
          This LP identifier is invalid.
        </p>
      )}
      {detail.validId && detail.query.isPending && (
        <p role="status" className={BODY_CLASS} style={{ color: INK_MUTED }}>
          Loading LP counterparty…
        </p>
      )}
      {detail.error && (
        <DetailCard className="gap-[12px] p-[26px]" testId="lp-detail-error">
          <div role="alert" className="flex flex-col gap-[12px]">
            <InlineError
              message={detail.error.message}
              details={detail.error.details}
            />
            <Button
              variant="secondary"
              size="m"
              className={`w-fit ${DETAIL_SECONDARY_BUTTON_CLASS}`}
              style={detailSecondaryButtonStyle()}
              onClick={detail.refresh}
              disabled={detail.query.isFetching}
            >
              Retry
            </Button>
          </div>
        </DetailCard>
      )}
      {lp && (
        <>
          <DetailCard className="gap-[8px] p-[26px]" ariaLabel="LP profile">
            <CardTitle>LP profile</CardTitle>
            <div className="flex flex-col">
              <KeyValueRow label="Jurisdiction">
                {orDash(lp.country)}
              </KeyValueRow>
              <KeyValueRow label="Contact email">
                <span className="break-all">{orDash(lp.contact_email)}</span>
              </KeyValueRow>
              <KeyValueRow label="First registration date">
                {formatIsoDateUtc(lp.created_at)}
              </KeyValueRow>
              <KeyValueRow label="Submitted for review">
                {formatIsoDateUtc(lp.kyb_submitted_at)}
              </KeyValueRow>
              <KeyValueRow label="Latest decision date">
                {formatIsoDateUtc(lp.kyb_decided_at)}
              </KeyValueRow>
              <KeyValueRow label="Settlement address">
                <span className="break-all">{orDash(lp.stellar_address)}</span>
              </KeyValueRow>
              <KeyValueRow label="Latest decision reason" isLast>
                <span className="break-words whitespace-pre-wrap">
                  {orDash(lp.kyb_decision_reason)}
                </span>
              </KeyValueRow>
            </div>
          </DetailCard>

          <DetailCard
            className="gap-[8px] p-[26px]"
            ariaLabelledBy="lp-documents-heading"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
              <CardTitle id="lp-documents-heading">KYB documents</CardTitle>
              <Button
                variant="secondary"
                size="m"
                className={DETAIL_SECONDARY_BUTTON_CLASS}
                style={detailSecondaryButtonStyle()}
                onClick={detail.refresh}
                disabled={detail.query.isFetching || detail.busy}
              >
                Refresh
              </Button>
            </div>
            {lp.documents.length === 0 ? (
              <p
                className={`py-[8px] ${BODY_CLASS}`}
                style={{ color: INK_MUTED }}
              >
                No documents submitted.
              </p>
            ) : (
              <ul className="flex flex-col">
                {lp.documents.map((document, index) => (
                  <li
                    key={document.id}
                    className="flex flex-col gap-[8px] py-[12px]"
                    style={
                      index === lp.documents.length - 1
                        ? undefined
                        : { borderBottom: `1px solid ${LINE_COLOR}` }
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-[12px]">
                      <div className="flex min-w-0 items-center gap-[12px]">
                        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[4px] bg-[rgba(0,0,128,0.06)] text-[#000080]">
                          <DocumentIcon />
                        </span>
                        <div className="min-w-0">
                          <p
                            className={`${BODY_CLASS} break-all text-[#262524]`}
                          >
                            {document.original_filename}
                          </p>
                          <p className={SUB_CLASS} style={{ color: INK_MUTED }}>
                            {document.size_bytes.toLocaleString()} bytes ·{" "}
                            {document.content_type} · {document.status}
                          </p>
                        </div>
                      </div>
                      {document.download_url ? (
                        <a
                          href={document.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${BODY_CLASS} text-[color:var(--color-pipeline-brand)]`}
                          aria-label={`Download ${document.original_filename}`}
                        >
                          Download
                        </a>
                      ) : (
                        <span
                          className={SUB_CLASS}
                          style={{ color: INK_MUTED }}
                        >
                          Download unavailable. Refresh to retry.
                        </span>
                      )}
                    </div>
                    <p className={SUB_CLASS} style={{ color: INK_MUTED }}>
                      Uploaded {formatIsoDateUtc(document.created_at)} ·
                      Reviewed {formatIsoDateUtc(document.reviewed_at)} ·
                      Reviewer {document.reviewed_by ?? "—"}
                    </p>
                    {document.reject_reason && (
                      <p
                        className={`${NOTE_CLASS} break-words whitespace-pre-wrap`}
                        style={{ color: NEGATIVE_RED }}
                      >
                        Rejection reason: {document.reject_reason}
                      </p>
                    )}
                    {detail.canReview && document.status === "Provided" && (
                      <div className="flex flex-wrap gap-[12px]">
                        <Button
                          variant="secondary"
                          size="m"
                          className={DETAIL_SECONDARY_BUTTON_CLASS}
                          style={detailSecondaryButtonStyle()}
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
                          size="m"
                          className={DETAIL_SECONDARY_BUTTON_CLASS}
                          style={detailSecondaryButtonStyle()}
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
            )}
          </DetailCard>

          <DetailCard className="gap-[16px] p-[26px]" ariaLabel="KYB decision">
            <CardTitle>KYB decision</CardTitle>
            {detail.canReview ? (
              <>
                {!detail.canPass && (
                  <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
                    Verify every submitted document before confirming KYB
                    passed.
                  </p>
                )}
                <div className="flex flex-wrap gap-[12px]">
                  <Button
                    variant="secondary"
                    size="m"
                    className={DETAIL_SECONDARY_BUTTON_CLASS}
                    style={detailSecondaryButtonStyle()}
                    disabled={detail.busy}
                    onClick={() => detail.open({ decision: "Failed" })}
                  >
                    Reject account
                  </Button>
                  <Button
                    variant="secondary"
                    size="m"
                    className={DETAIL_SECONDARY_BUTTON_CLASS}
                    style={detailSecondaryButtonStyle()}
                    disabled={detail.busy}
                    onClick={() =>
                      detail.open({ decision: "ChangesRequested" })
                    }
                  >
                    Request changes
                  </Button>
                  {detail.canPass && (
                    <Button
                      variant="primary-blue"
                      size="m"
                      disabled={detail.busy}
                      onClick={() => detail.open({ decision: "Passed" })}
                    >
                      Confirm KYB passed
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
                Review actions are available only while the LP is UnderReview.
              </p>
            )}
          </DetailCard>

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

function LpCounterpartyDetail() {
  const { id } = Route.useParams();
  return <LpCounterpartyDetailContent key={id} id={id} />;
}

export const Route = createFileRoute("/lp-counterparties/$id")({
  component: LpCounterpartyDetail,
});
