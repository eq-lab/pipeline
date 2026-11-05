// spec: docs/frontend/account-page.md#settlement-address
import { useEffect, useId, useRef, useState } from "react";
import { Button, TextField } from "@pipeline/ui";
import { truncateAddress } from "@/utils/truncateAddress";
import { AccountListRow } from "./AccountListRow";
import {
  SETTLEMENT_ACTION_LABELS,
  SETTLEMENT_FORM_COPY,
  parseSettlementInput,
  type SettlementControls,
  type SettlementRowView,
} from "./settlementAddress";

type RowHandlers = Pick<
  SettlementControls,
  "onLink" | "onChange" | "onCancel" | "onOther" | "onLinkOther"
>;

const BODY_S = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body-s)]",
  "leading-[var(--text-pipeline-body-s--line-height)]",
];

const MUTED = "text-[color:var(--color-pipeline-ink-muted)]";
const INK = "text-[color:var(--color-pipeline-ink)]";

function CaptionText({
  caption,
  tone,
}: Pick<SettlementRowView, "caption" | "tone">) {
  if (!caption) return null;
  return (
    <p
      role={tone === "negative" ? "alert" : undefined}
      className={[
        "px-2",
        ...BODY_S,
        tone === "negative"
          ? "text-[color:var(--color-pipeline-negative-strong)]"
          : "text-[color:var(--color-pipeline-ink-subtle)]",
      ].join(" ")}
    >
      {caption}
    </p>
  );
}

function SettlementOtherForm({
  kind,
  form,
  caption,
  tone,
  onLinkOther,
  onCancel,
}: {
  kind: NonNullable<SettlementRowView["kind"]>;
  form: NonNullable<SettlementRowView["form"]>;
  caption: string | null;
  tone: SettlementRowView["tone"];
  onLinkOther: RowHandlers["onLinkOther"];
  onCancel: RowHandlers["onCancel"];
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const parsed = parseSettlementInput(kind, draft);
  const error = touched && !parsed.ok ? parsed.error : null;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (form.busy) return;
    if (!parsed.ok) {
      setTouched(true);
      return;
    }
    onLinkOther(kind, draft);
  };
  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-2 px-2 pt-2"
      data-testid="settlement-other-form"
    >
      {form.current !== null && (
        <p className={["break-all", ...BODY_S, INK].join(" ")}>
          <span className={MUTED}>{SETTLEMENT_FORM_COPY.current}</span>{" "}
          {form.current}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className={[...BODY_S, INK].join(" ")}>
          {SETTLEMENT_FORM_COPY.label}
        </label>
        <TextField
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setTouched(false);
          }}
          onBlur={() => setTouched(true)}
          placeholder={SETTLEMENT_FORM_COPY.placeholder[kind]}
          autoComplete="off"
          spellCheck={false}
          invalid={error !== null}
          error={error ?? undefined}
          disabled={form.busy}
          className="[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]"
        />
      </div>
      <p
        className={["break-all", ...BODY_S, INK].join(" ")}
        title={form.signer}
        data-testid="settlement-other-signer"
      >
        <span className={MUTED}>{SETTLEMENT_FORM_COPY.signer}</span>{" "}
        {truncateAddress(form.signer)}
      </p>
      <CaptionText caption={caption} tone={tone} />
      {!form.busy && (
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary-dark"
            size="compact"
            disabled={draft.trim() === ""}
          >
            {SETTLEMENT_FORM_COPY.submit}
          </Button>
          <Button variant="secondary" size="compact" onClick={onCancel}>
            {SETTLEMENT_FORM_COPY.cancel}
          </Button>
        </div>
      )}
    </form>
  );
}

export function SettlementAddressRow({
  kind,
  label,
  address,
  caption,
  tone,
  action,
  confirm,
  busy,
  signer,
  other,
  form,
  onLink,
  onChange,
  onCancel,
  onOther,
  onLinkOther,
}: SettlementRowView & RowHandlers) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirming = confirm !== null;
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  return (
    <div
      className="flex w-full flex-col"
      data-testid="settlement-address-row"
      data-kind={kind ?? "none"}
      aria-busy={busy || undefined}
    >
      <AccountListRow
        variant="plain"
        leading={null}
        caption={label}
        title={address ? truncateAddress(address) : "—"}
        titleAttr={address ?? undefined}
        trailing={
          action !== null && kind !== null ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() =>
                action === "change" ? onChange(kind) : onLink(kind)
              }
            >
              {SETTLEMENT_ACTION_LABELS[action]}
            </Button>
          ) : undefined
        }
      />
      {signer !== null && (
        <p
          className={["px-2", ...BODY_S, INK].join(" ")}
          title={signer}
          data-testid="settlement-signer"
        >
          <span className={MUTED}>{SETTLEMENT_FORM_COPY.signer}</span>{" "}
          {truncateAddress(signer)}
        </p>
      )}
      {form === null && <CaptionText caption={caption} tone={tone} />}
      {other && kind !== null && (
        <button
          type="button"
          onClick={() => onOther(kind)}
          data-testid="settlement-other-entry"
          className={[
            "cursor-pointer self-start bg-transparent px-2 text-left hover:underline",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            "focus-visible:outline-[color:var(--color-pipeline-ink)]",
            ...BODY_S,
            INK,
          ].join(" ")}
        >
          {SETTLEMENT_FORM_COPY.entry}
        </button>
      )}
      {form !== null && kind !== null && (
        <SettlementOtherForm
          kind={kind}
          form={form}
          caption={caption}
          tone={tone}
          onLinkOther={onLinkOther}
          onCancel={onCancel}
        />
      )}
      {confirm !== null && kind !== null && (
        <div
          className="flex flex-col gap-2 px-2 pt-2"
          data-testid="settlement-change-confirm"
        >
          {(
            [
              ["From", confirm.from],
              ["To", confirm.to],
            ] as const
          ).map(([name, value]) => (
            <p
              key={name}
              className={[
                "break-all",
                ...BODY_S,
                "text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              <span className="text-[color:var(--color-pipeline-ink-muted)]">
                {name}
              </span>{" "}
              {value}
            </p>
          ))}
          <div className="flex gap-2">
            <Button
              ref={confirmRef}
              variant="primary-dark"
              size="compact"
              onClick={() => onLink(kind)}
            >
              Confirm change
            </Button>
            <Button variant="secondary" size="compact" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettlementAddressRows({
  settlement,
}: {
  settlement: SettlementControls;
}) {
  return (
    <div className="flex flex-col gap-2">
      {settlement.rows.map((row) => (
        <SettlementAddressRow
          key={row.kind ?? "none"}
          {...row}
          onLink={settlement.onLink}
          onChange={settlement.onChange}
          onCancel={settlement.onCancel}
          onOther={settlement.onOther}
          onLinkOther={settlement.onLinkOther}
        />
      ))}
    </div>
  );
}
