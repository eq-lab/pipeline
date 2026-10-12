// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { useToast } from "@/components/ToastProvider";
import { copyAddress, shortAddress } from "./AddressChip";

export function AddressText({
  value,
  testId,
}: {
  value: string;
  testId?: string;
}) {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      data-testid={testId}
      title={value}
      onClick={() =>
        void copyAddress(value).then((ok) => {
          if (ok) showToast("Address copied");
        })
      }
      className="text-left font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] whitespace-nowrap text-[#262524] underline-offset-[3px] hover:underline"
    >
      {shortAddress(value)}
    </button>
  );
}
