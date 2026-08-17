import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  FORM_SECTIONS,
  useOriginationNewForm,
  type FieldDef,
} from "./-origination-new";
import { ImportJsonDialog } from "./-ImportJsonDialog";
import { useSubmitLoan } from "@/api/useSubmitLoan";
import { toUserError } from "@/utils/userError";
import { InlineError } from "@pipeline/ui";

/**
 * Submit a loan — full-page route (`/origination/new`, #1100), opened by the
 * "Submit a loan" action on the Origination page. Renders the complete
 * `SubmitLoanRequest` form with the Import-from-JSON dialog. No Figma exists
 * for this screen (product decision) — styling reuses the Record
 * Coupon/Repayment field-box pattern and the origination page shell.
 *
 * spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100.
 */

const LINE_COLOR = "rgba(56,55,53,0.18)";
const INK_MUTED = "rgba(56,55,53,0.6)";
const BRAND = "var(--color-pipeline-brand)";
const FIELD_FILL = "rgba(191,189,187,0.12)";
const ATTENTION_FILL = "rgba(211,235,117,0.16)";

const FIELD_BOX =
  "flex flex-col gap-[3px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[15px] py-[11px]";
const FIELD_LABEL_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]";
const FIELD_INPUT_CLASS =
  "w-full bg-transparent font-[family-name:var(--font-body)] text-[15px] text-[#262524] outline-none placeholder:text-[#9e9c99]";
const SECTION_TITLE_CLASS =
  "font-[family-name:var(--font-display)] text-[22px] leading-[28.6px] text-[#262524]";
const SECONDARY_BUTTON_CLASS =
  "h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]";

function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDef;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      <label className={FIELD_BOX} style={{ backgroundColor: FIELD_FILL }}>
        <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
          {field.label}
        </span>
        <input
          type="text"
          inputMode={field.numeric ? "numeric" : undefined}
          data-testid={`submit-loan-field-${field.path}`}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_INPUT_CLASS}
        />
      </label>
      {error && (
        <p
          data-testid={`submit-loan-field-error-${field.path}`}
          className="font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function OriginationNew() {
  const form = useOriginationNewForm();
  const submit = useSubmitLoan();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);

  const submitError = submit.error
    ? toUserError(submit.error, "Failed to submit the loan.")
    : null;

  const onSubmit = () => {
    const input = form.buildForSubmit();
    if (input == null) return;
    submit.reset();
    void submit
      .mutateAsync(input)
      .then(() => navigate({ to: "/origination" }))
      .catch(() => undefined);
  };

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-[24px] px-4 py-12 md:px-8">
      <div className="flex flex-col gap-[8px]">
        <Link
          to="/origination"
          className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
        >
          ‹ Origination
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-[16px]">
          <h1 className="font-[family-name:var(--font-display)] text-[64px] leading-[64px] text-[rgba(56,55,53,0.3)]">
            Submit a loan
          </h1>
          <button
            type="button"
            data-testid="submit-loan-import-open"
            onClick={() => setImportOpen(true)}
            className={SECONDARY_BUTTON_CLASS}
          >
            Import from JSON
          </button>
        </div>
      </div>

      <div
        data-testid="submit-loan-uri-banner"
        className="w-full rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#262524]"
        style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
      >
        Each submission needs a unique <code>metadata_uri</code> — reusing one
        from an earlier submission is rejected by the API.
      </div>

      {form.importWarning && (
        <div
          data-testid="submit-loan-import-warning"
          className="w-full rounded-[4px] border border-solid px-[18px] py-[14px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[#262524]"
          style={{ backgroundColor: ATTENTION_FILL, borderColor: LINE_COLOR }}
        >
          Imported with missing fields — fill these in by hand:{" "}
          <span className="font-mono text-[13px]">
            {form.importWarning.join(", ")}
          </span>
        </div>
      )}

      <div className="flex w-full flex-col gap-[26px] rounded-[4px] bg-[color:var(--color-pipeline-surface)] p-[32px]">
        {FORM_SECTIONS.map((section) => (
          <section
            key={section.title}
            data-testid={`submit-loan-section-${section.title}`}
            className="flex flex-col gap-[14px]"
          >
            <h2 className={SECTION_TITLE_CLASS}>{section.title}</h2>
            <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
              {section.fields.map((field) => (
                <FieldInput
                  key={field.path}
                  field={field}
                  value={form.values[field.path] ?? ""}
                  error={form.fieldErrors[field.path]}
                  onChange={(value) => form.setValue(field.path, value)}
                />
              ))}
            </div>
          </section>
        ))}

        <section
          data-testid="submit-loan-section-Documents"
          className="flex flex-col gap-[14px]"
        >
          <h2 className={SECTION_TITLE_CLASS}>Documents</h2>
          {form.documents.length === 0 && (
            <p
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: INK_MUTED }}
            >
              No documents attached.
            </p>
          )}
          {form.documents.map((doc, i) => (
            <div key={i} className="flex flex-col gap-[4px]">
              <div className="grid grid-cols-1 gap-[12px] md:grid-cols-[1fr_2fr_auto]">
                <label
                  className={FIELD_BOX}
                  style={{ backgroundColor: FIELD_FILL }}
                >
                  <span
                    className={FIELD_LABEL_CLASS}
                    style={{ color: INK_MUTED }}
                  >
                    Name
                  </span>
                  <input
                    type="text"
                    data-testid={`submit-loan-document-name-${i}`}
                    value={doc.name}
                    onChange={(e) =>
                      form.setDocument(i, { ...doc, name: e.target.value })
                    }
                    className={FIELD_INPUT_CLASS}
                  />
                </label>
                <label
                  className={FIELD_BOX}
                  style={{ backgroundColor: FIELD_FILL }}
                >
                  <span
                    className={FIELD_LABEL_CLASS}
                    style={{ color: INK_MUTED }}
                  >
                    URI
                  </span>
                  <input
                    type="text"
                    data-testid={`submit-loan-document-uri-${i}`}
                    value={doc.uri}
                    onChange={(e) =>
                      form.setDocument(i, { ...doc, uri: e.target.value })
                    }
                    className={FIELD_INPUT_CLASS}
                  />
                </label>
                <button
                  type="button"
                  data-testid={`submit-loan-document-remove-${i}`}
                  onClick={() => form.removeDocument(i)}
                  className={`${SECONDARY_BUTTON_CLASS} self-center`}
                >
                  Remove
                </button>
              </div>
              {form.fieldErrors[`documents.${i}`] && (
                <p
                  data-testid={`submit-loan-field-error-documents.${i}`}
                  className="font-[family-name:var(--font-body)] text-[12px] text-[color:var(--color-pipeline-negative)]"
                >
                  {form.fieldErrors[`documents.${i}`]}
                </p>
              )}
            </div>
          ))}
          <button
            type="button"
            data-testid="submit-loan-document-add"
            onClick={form.addDocument}
            className={`${SECONDARY_BUTTON_CLASS} self-start`}
          >
            Add document
          </button>
        </section>

        <div
          className="flex flex-col gap-[12px] border-t border-solid pt-[20px]"
          style={{ borderColor: LINE_COLOR }}
        >
          {submitError && (
            <div data-testid="submit-loan-error">
              <InlineError
                message={submitError.message}
                details={submitError.details}
                className="block text-[14px] leading-[19.6px]"
              />
            </div>
          )}
          {Object.keys(form.fieldErrors).length > 0 && (
            <p
              data-testid="submit-loan-validation-summary"
              className="font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-negative)]"
            >
              Some fields need attention before submitting.
            </p>
          )}
          <button
            type="button"
            data-testid="submit-loan-submit"
            disabled={submit.isPending}
            onClick={onSubmit}
            className="flex h-[48px] w-full items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {submit.isPending ? "Submitting…" : "Submit loan"}
          </button>
        </div>
      </div>

      <ImportJsonDialog
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onImport={(text) => {
          const error = form.importFromJson(text);
          if (error == null) setImportOpen(false);
          return error;
        }}
      />
    </main>
  );
}

export const Route = createFileRoute("/origination/new")({
  component: OriginationNew,
});
