// Claude Code PreToolUse hook: refuses a scripts/e2e/* command whose inline env or arguments fail the guard; see docs/e2e.md "Guard".

import { pathToFileURL } from "node:url";
import { checkValue, guard } from "./lib/guard";
import { PORTS } from "./lib/env";
import { readJson, stackDir } from "./lib/stack";

export function review(payload: { tool_name?: string; tool_input?: { command?: string } }): string[] {
  const command = payload.tool_input?.command ?? "";
  if (payload.tool_name !== "Bash" || !/scripts\/e2e\//.test(command)) return [];
  const tag = /--tag[=\s]+([A-Za-z0-9._-]+)/.exec(command)?.[1];
  const generated = (tag && readJson<Record<string, string>>(`${stackDir(tag)}/env.json`)) || {};
  const inline = Object.fromEntries([...command.matchAll(/(?:^|[\s;&|(])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)/g)].map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  const knobs = Object.entries(inline).filter(([k]) => k.startsWith("E2E_"));
  for (const [k] of knobs) delete inline[k];
  return [
    ...guard({ env: inline, generated, postgresPort: PORTS.postgres }),
    ...knobs.flatMap(([k, v]) => checkValue(k, v, PORTS.postgres)),
    ...checkValue("command", command.replace(/(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'[^']*'|\S*)/g, " "), PORTS.postgres),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.on("data", (c) => (input += c)).on("end", () => {
    let violations: string[];
    try {
      violations = review(JSON.parse(input));
    } catch (e) {
      violations = [`unreadable hook payload: ${String(e)}`];
    }
    if (violations.length) {
      process.stderr.write(`e2e guard refused this command:\n  ${violations.join("\n  ")}\n`);
      process.exit(2);
    }
  });
}
