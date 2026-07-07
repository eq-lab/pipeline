/**
 * Typed env accessor — the ONLY place in the codebase that reads
 * `import.meta.env` directly. All other modules must import from here.
 *
 * ESLint's `no-restricted-syntax` rule already enforces this: direct
 * `import.meta.env` access is forbidden outside this file.
 *
 * The trustee app's env surface is intentionally minimal at scaffold time
 * (Issue #777): only the Relayer API base URL. It grows as flow sub-issues
 * of epic #775 land (see docs/exec-plans/tech-debt-tracker.md).
 */

function readString(key: string, defaultValue?: string): string {
  // vite-plugin-runtime-env exposes values via window.__ENV__ at runtime,
  // falling back to import.meta.env at build time.
  const raw: unknown =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof window !== "undefined" && (window as any).__ENV__?.[key]) ||
    import.meta.env[key];

  if (raw !== undefined && raw !== "") return String(raw);
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(
    `Missing required env variable "${key}". Set it in .env or provide it at runtime.`,
  );
}

export const ENV = Object.freeze({
  /** Base URL for the Pipeline Relayer REST API. Defaults to the API crate's default port. */
  API_BASE_URL: readString("VITE_API_BASE_URL", "http://localhost:8080"),
});

/**
 * Test helper — swaps the exported ENV object for the duration of `fn` and
 * restores it afterwards. Only modifiable in test environments.
 */
export function withEnvOverride(
  overrides: Partial<typeof ENV>,
  fn: () => void,
): void {
  const original = { ...ENV };
  Object.assign(ENV, overrides);
  try {
    fn();
  } finally {
    Object.assign(ENV, original);
  }
}
