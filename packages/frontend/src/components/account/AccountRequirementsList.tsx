// spec: docs/frontend/account-page.md#accountrequirementslist
import {
  KYB_DOCUMENT_REQUIREMENTS,
  KYB_UBO_SUB_REQUIREMENTS,
  REQUIREMENTS_LEAD_LINE,
} from "@/components/kybDocumentRequirements";

export interface AccountRequirementsListProps {
  dataNodeId?: string;
  testId?: string;
  className?: string;
}

export function AccountRequirementsList({
  dataNodeId = "6701:98158",
  testId = "account-requirements-list",
  className = "px-2 pb-6",
}: AccountRequirementsListProps = {}) {
  const topLevel = KYB_DOCUMENT_REQUIREMENTS.slice(0, -1);
  const uboHeading =
    KYB_DOCUMENT_REQUIREMENTS[KYB_DOCUMENT_REQUIREMENTS.length - 1];

  return (
    <div
      className={[
        "w-full",
        className,
        "font-[family-name:var(--font-body)]",
        "text-[length:var(--text-pipeline-body-s)]",
        "leading-[var(--text-pipeline-body-s--line-height)]",
        "text-[color:var(--color-pipeline-ink-muted)]",
      ].join(" ")}
      data-testid={testId}
      data-node-id={dataNodeId}
    >
      <p>{REQUIREMENTS_LEAD_LINE}</p>
      <ul className="list-disc pl-[21px]">
        {topLevel.map((item) => (
          <li key={item}>{item}</li>
        ))}
        <li>
          {uboHeading}
          <ol className="list-[lower-alpha] pl-[42px]">
            {KYB_UBO_SUB_REQUIREMENTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </li>
      </ul>
    </div>
  );
}

export default AccountRequirementsList;
