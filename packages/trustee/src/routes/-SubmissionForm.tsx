// spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100
import {
  FORM_SECTIONS,
  TARGET_CHAIN_FIELD,
  type FieldDef,
  type OriginationNewForm,
} from "./-origination-new";
import type { UserFacingError } from "@/utils/userError";
import { InlineError } from "@pipeline/ui";

export const LINE_COLOR = "rgba(56,55,53,0.18)";
const INK_MUTED = "rgba(56,55,53,0.6)";
const BRAND = "var(--color-pipeline-brand)";
const FIELD_FILL = "rgba(191,189,187,0.12)";
export const ATTENTION_FILL = "rgba(211,235,117,0.16)";

const FIELD_BOX =
  "flex flex-col gap-[3px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[15px] py-[11px]";
const FIELD_LABEL_CLASS =
  "font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]";
const FIELD_INPUT_CLASS =
  "w-full bg-transparent font-[family-name:var(--font-body)] text-[15px] text-[#262524] outline-none placeholder:text-[#9e9c99]";
const SECTION_TITLE_CLASS =
  "font-[family-name:var(--font-display)] text-[22px] leading-[28.6px] text-[#262524]";
export const SECONDARY_BUTTON_CLASS =
  "h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]";

function FieldInput({
  field,
  value,
  error,
  options,
  disabled,
  hint,
  onChange,
}: {
  field: FieldDef;
  value: string;
  error: string | undefined;
  options?: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      <label className={FIELD_BOX} style={{ backgroundColor: FIELD_FILL }}>
        <span className={FIELD_LABEL_CLASS} style={{ color: INK_MUTED }}>
          {field.label}
        </span>
        {field.options ? (
          <select
            data-testid={`submit-loan-field-${field.path}`}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`${FIELD_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {(options ?? field.options).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            inputMode={field.numeric ? "numeric" : undefined}
            data-testid={`submit-loan-field-${field.path}`}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={FIELD_INPUT_CLASS}
          />
        )}
      </label>
      {hint && (
        <p
          data-testid={`submit-loan-field-hint-${field.path}`}
          className="font-[family-name:var(--font-body)] text-[12px]"
          style={{ color: INK_MUTED }}
        >
          {hint}
        </p>
      )}
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

export function SubmissionForm({
  form,
  targetChainDisabled,
  targetChainHint,
  error,
  isPending,
  submitLabel,
  pendingLabel,
  onSubmit,
}: {
  form: OriginationNewForm;
  targetChainDisabled: boolean;
  targetChainHint?: string;
  error: UserFacingError | null;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: () => void;
}) {
  return (
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
                options={
                  field.path === TARGET_CHAIN_FIELD
                    ? form.targetChainOptions
                    : undefined
                }
                disabled={
                  field.path === TARGET_CHAIN_FIELD && targetChainDisabled
                }
                hint={
                  field.path === TARGET_CHAIN_FIELD
                    ? targetChainHint
                    : undefined
                }
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
        {error && (
          <div data-testid="submit-loan-error">
            <InlineError
              message={error.message}
              details={error.details}
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
          disabled={isPending}
          onClick={onSubmit}
          className="flex h-[48px] w-full items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          {isPending ? pendingLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}
