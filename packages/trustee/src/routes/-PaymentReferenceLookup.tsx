// spec: docs/frontend/trustee-flows.md#match-an-incoming-wire-by-reference
import { Link } from "@tanstack/react-router";
import { Button, InlineError } from "@pipeline/ui";
import { CardTitle, DetailCard } from "@/components/detail/DetailCard";
import {
  DETAIL_INPUT_CLASS,
  INK_MUTED,
} from "@/components/detail/detailTokens";
import { usePaymentReferenceLookup } from "./-usePaymentReferenceLookup";

const BODY_CLASS =
  "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";

export function PaymentReferenceLookup() {
  const lookup = usePaymentReferenceLookup();
  return (
    <DetailCard
      className="gap-[12px] p-[26px]"
      ariaLabelledBy="lp-lookup-heading"
    >
      <CardTitle id="lp-lookup-heading">Match an incoming wire</CardTitle>
      <form
        className="flex flex-wrap items-end gap-[12px]"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void lookup.submit();
        }}
      >
        <label
          className="flex min-w-[260px] flex-1 flex-col gap-2 text-sm"
          htmlFor="lp-lookup-reference"
        >
          LP payment reference
          <input
            id="lp-lookup-reference"
            autoComplete="off"
            placeholder="PL-XXXX-XXXX-XXXX"
            value={lookup.value}
            onChange={(event) => lookup.setValue(event.target.value)}
            className={DETAIL_INPUT_CLASS}
          />
        </label>
        <Button
          type="submit"
          variant="primary-blue"
          size="m"
          data-testid="lp-lookup-submit"
          disabled={!lookup.canSubmit}
        >
          Find LP
        </Button>
      </form>
      {lookup.result === "not-found" && (
        <p
          role="status"
          data-testid="lp-lookup-not-found"
          className={BODY_CLASS}
          style={{ color: INK_MUTED }}
        >
          No LP was issued this reference. The Cash reporter books the wire to
          escrow; assign it to its lender or return it from{" "}
          <Link
            to="/cash-management"
            search={{ tab: "escrow" }}
            className="text-[color:var(--color-pipeline-brand)] underline underline-offset-2"
          >
            Escrowed wires
          </Link>
          .
        </p>
      )}
      {lookup.error && (
        <div role="alert">
          <InlineError
            message={lookup.error.message}
            details={lookup.error.details}
          />
        </div>
      )}
    </DetailCard>
  );
}
