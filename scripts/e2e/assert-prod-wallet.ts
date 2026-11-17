// Builds the LP app in production mode with the e2e test wallets' flag and dummy keys set; fails if the bundle holds a wallet's marker or key. See packages/frontend/src/wallet/README.md "E2E test wallet".

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SECRET = "SDUMMYE2EWALLETSECRETTHATMUSTNEVERSHIPINAPRODUCTIONBUNDLE";
const EVM_KEY = `0x${"e2e0".repeat(16)}`;
const NEEDLES: Record<string, string> = {
  "pipeline-e2e-wallet": 'marker "pipeline-e2e-wallet"',
  "pipeline-e2e-evm-wallet": 'marker "pipeline-e2e-evm-wallet"',
  [SECRET]: "the dummy Stellar secret",
  [EVM_KEY.slice(2)]: "the dummy EVM key",
};

const out = mkdtempSync(join(tmpdir(), "lp-prod-wallet-"));
try {
  execFileSync(process.execPath, [join(REPO, "node_modules/.bin/vite"), "build", "--mode", "production", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: join(REPO, "packages/frontend"),
    env: { ...process.env, NODE_ENV: "production", VITE_E2E_WALLET: "1", VITE_EVM_CHAIN_ID: "31337", E2E_WALLET_SECRET: SECRET, E2E_EVM_WALLET_KEY: EVM_KEY },
    stdio: "inherit",
  });
  const files = readdirSync(out, { recursive: true, encoding: "utf8" }).map((f) => join(out, f)).filter((f) => statSync(f).isFile());
  const hits = files.flatMap((f) => {
    const text = readFileSync(f, "latin1");
    return Object.keys(NEEDLES).filter((s) => text.includes(s)).map((s) => `${f.slice(out.length + 1)}: ${NEEDLES[s]}`);
  });
  if (hits.length) {
    console.error(`❌ the production LP bundle carries an e2e test wallet:\n  ${hits.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log(`✅ no e2e test wallet in the production LP bundle (${files.length} files)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
