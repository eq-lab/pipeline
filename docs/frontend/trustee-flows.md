# Trustee flows

Architecture and behavior specs for the Trustee admin panel in `packages/trustee/src/**` —
loan-book data, loan detail, cash movement, and lifecycle actions. This is the home for flow-shape
knowledge that previously lived as inline comments and docblocks — see
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Trustee product intent lives in `docs/product-specs/` (see the Trustee panel note in
[`docs/FRONTEND.md`](../FRONTEND.md#application-structure)); this doc captures the frontend
*implementation* architecture.

> **Status:** scaffold. Sections are filled in as each module's comments are migrated under
> [issue #991](https://github.com/eq-lab/pipeline/issues/991). Do not delete a source comment until
> its content lives in a section below.

## Loan book & tables

_To be migrated from `packages/trustee/src/api/useLoanBook.ts`, `routes/-useLoansTable.ts`._

## Loan detail

_To be migrated from `packages/trustee/src/routes/-useLoanDetail.ts`, `routes/loans.$id.tsx`._

## Cash movement & lifecycle actions

_To be migrated from `packages/trustee/src/routes/-record-*.ts`._

## Session & auth

_To be migrated from `packages/trustee/src/auth/**`._
