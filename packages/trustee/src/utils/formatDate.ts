// spec: docs/frontend/trustee-flows.md#dates

const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

const DAY_MONTH: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
};

const HOUR_MINUTE_24H: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
};

export function formatMaturityDate(
  unixSeconds: number | null | undefined,
): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return "—";
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH_YEAR).format(date);
}

export function formatSubmittedDate(
  rfc3339: string | null | undefined,
): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH).format(date);
}

export function formatEpochDate(rfc3339: string | null | undefined): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", DAY_MONTH_YEAR).format(date);
}

export function formatIsoDateUtc(rfc3339: string | null | undefined): string {
  return formatEpochDate(rfc3339);
}

export function formatAuditTimestamp(
  rfc3339: string | null | undefined,
): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  const dayMonth = new Intl.DateTimeFormat("en-GB", DAY_MONTH).format(date);
  const time = new Intl.DateTimeFormat("en-GB", HOUR_MINUTE_24H).format(date);
  return `${dayMonth} ${time}`;
}

export function formatIsoDateTimeUtc(
  rfc3339: string | null | undefined,
): string {
  if (rfc3339 == null) return "—";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatIsoDateUtc(rfc3339)}, ${date.toISOString().slice(11, 16)} UTC`;
}

export function nowUtcDateTimeInput(now = new Date()): string {
  return now.toISOString().slice(0, 16);
}

export function utcDateTimeInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
