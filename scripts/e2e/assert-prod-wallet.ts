// Builds the LP app in production mode with the e2e test wallet's flag and a dummy secret set; fails if the bundle holds the module's marker or the secret. See packages/frontend/src/wallet/README.md "E2E test wallet".

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKER = "pipeline-e2e-wallet";
const SECRET = "SDUMMYE2EWALLETSECRETTHATMUSTNEVERSHIPINAPRODUCTIONBUNDLE";

const out = mkdtempSync(join(tmpdir(), "lp-prod-wallet-"));
try {
  execFileSync(process.execPath, [join(REPO, "node_modules/.bin/vite"), "build", "--mode", "production", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: join(REPO, "packages/frontend"),
    env: { ...process.env, NODE_ENV: "production", VITE_E2E_WALLET: "1", E2E_WALLET_SECRET: SECRET },
    stdio: "inherit",
  });
  const files = readdirSync(out, { recursive: true, encoding: "utf8" }).map((f) => join(out, f)).filter((f) => statSync(f).isFile());
  const hits = files.flatMap((f) => {
    const text = readFileSync(f, "latin1");
    return [MARKER, SECRET].filter((s) => text.includes(s)).map((s) => `${f.slice(out.length + 1)}: ${s === SECRET ? "the dummy secret" : `marker "${s}"`}`);
  });
  if (hits.length) {
    console.error(`❌ the production LP bundle carries the e2e test wallet:\n  ${hits.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log(`✅ no e2e test wallet in the production LP bundle (${files.length} files)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
