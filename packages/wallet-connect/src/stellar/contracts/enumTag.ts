// spec: docs/frontend/trustee-flows.md#disburse-1898
export function enumTag(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}
