// Secret redaction for the e2e result and log artifacts; see docs/e2e.md.

import { readFileSync, writeFileSync } from "node:fs";

const STELLAR_SECRET = /\bS[A-Z2-7]{55}\b/g;
const NAMED =
  /(?<![A-Za-z])((?:private[_-]?key|secret(?:[_-]?key)?|seed|mnemonic|password|passcode|otp|token|verification code)["']?\s*(?:[:=]|\bis\b)\s*["']?)[^\s"'&,;}]+/gi;
const SECRET_ENV = /KEY|SECRET|SEED|MNEMONIC|PASSWORD|PASSCODE|OTP|TOKEN/i;

export function envSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV.test(name) && value && value.length >= 6)
    .map(([, value]) => value!);
}

export function redact(text: string, secrets: string[] = envSecrets()): string {
  let out = text.replace(STELLAR_SECRET, "***").replace(NAMED, "$1***");
  for (const s of secrets) out = out.split(s).join("***");
  return out;
}

export function redactFile(path: string, secrets: string[] = envSecrets()): void {
  const text = readFileSync(path, "utf8");
  const out = redact(text, secrets);
  if (out !== text) writeFileSync(path, out);
}
