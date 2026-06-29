-- Migration: submitted_loans — originator-submitted loan applications awaiting
-- trustee review.
--
-- An originator submits the full set of `draw_loan` inputs (stored verbatim as
-- JSONB in `loan_data`); a trustee then approves or rejects each submission.
-- The on-chain `loan_id` does not exist until the loan is actually drawn, so the
-- surrogate `id` here is the submission identifier used by the review endpoint.
--
-- Lifecycle: InReview (on insert) → Approved | Rejected. A rejection MUST carry
-- a `reason`; an InReview/Approved row MUST NOT.
--
-- Inverse (rollback) SQL — forward-only migrations, provided for reference only:
--   DROP TABLE submitted_loans;

CREATE TABLE submitted_loans (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_data  JSONB       NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'InReview'
                           CHECK (status IN ('InReview', 'Approved', 'Rejected')),
    reason     TEXT,
    originator TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A rejected submission must carry a reason; non-rejected must not.
    CONSTRAINT submitted_loans_reason_ck CHECK (
        (status = 'Rejected' AND reason IS NOT NULL) OR
        (status <> 'Rejected' AND reason IS NULL)
    )
);

CREATE INDEX submitted_loans_status_idx ON submitted_loans (status);
