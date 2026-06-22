const ACCOUNT_NOT_FOUND_RE = /account not found/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "string" ? next : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const next = value[key];
  return typeof next === "number" ? next : undefined;
}

export function isStellarAccountNotFoundError(err: unknown): boolean {
  if (err instanceof Error && ACCOUNT_NOT_FOUND_RE.test(err.message)) {
    return true;
  }

  if (typeof err === "string" && ACCOUNT_NOT_FOUND_RE.test(err)) {
    return true;
  }

  if (!isRecord(err)) return false;

  if (readNumber(err, "status") === 404) return true;

  const message = readString(err, "message");
  if (message && ACCOUNT_NOT_FOUND_RE.test(message)) return true;

  const response = err.response;
  if (isRecord(response) && readNumber(response, "status") === 404) {
    return true;
  }

  const data = isRecord(response) ? response.data : undefined;
  const title = readString(data, "title");
  const detail = readString(data, "detail");

  return [title, detail].some(
    (part) => part !== undefined && ACCOUNT_NOT_FOUND_RE.test(part),
  );
}

export function normalizeStellarActionError(
  err: unknown,
  address?: string,
): Error {
  if (isStellarAccountNotFoundError(err)) {
    const suffix = address ? ` (${address})` : "";
    return new Error(
      `Stellar account is not funded on this network${suffix}. Add XLM to create it, then try again.`,
    );
  }

  return err instanceof Error ? err : new Error(String(err));
}
