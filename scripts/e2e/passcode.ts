// Prints the latest signup/login passcode the stack's API logged for an email; see docs/e2e.md.
// npx tsx scripts/e2e/passcode.ts --tag <tag> --email <email> [--wait <seconds>]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { stackDir } from "./lib/stack";

/**
 * The passcode of the last verification email to `email` in an API log (EMAIL_DEV_LOG=true), if any.
 * The code is on the same line as its `to=` field; other mail to the address (duplicate-signup notice,
 * password reset) and codes of other addresses are skipped.
 */
export function findPasscode(log: string, email: string): string | undefined {
  const lines = log.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const to = /\bto=(\S+)/.exec(lines[i])?.[1];
    const code = /verification code is (\d{6})/.exec(lines[i])?.[1];
    if (to === email && code) return code;
  }
  return undefined;
}

export function passcodeFor(tag: string, email: string): string | undefined {
  try {
    return findPasscode(readFileSync(join(stackDir(tag), "logs", "api.log"), "utf8"), email);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; // no log yet
    throw e;
  }
}

async function main() {
  const { tag, email, wait = "10" } = parseArgs({ options: { tag: { type: "string" }, email: { type: "string" }, wait: { type: "string" } } }).values;
  if (!tag || !email) {
    console.error("usage: npx tsx scripts/e2e/passcode.ts --tag <tag> --email <email> [--wait <seconds>]");
    process.exit(2);
  }
  const deadline = Date.now() + Number(wait) * 1000;
  let code = passcodeFor(tag, email);
  while (!code && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    code = passcodeFor(tag, email);
  }
  if (!code) {
    console.error(`no passcode for ${email} in stacks/${tag}/logs/api.log after ${wait}s (was it signed up, and has check.ts redacted the log?)`);
    process.exit(1);
  }
  console.log(code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
