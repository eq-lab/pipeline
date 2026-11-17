// up / down / prepare of the local e2e stack (scripts/e2e/up.sh, down.sh); see docs/e2e.md "Local stack".

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { connect } from "node:net";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateEnv, PORTS, SPACES, type Accounts, type Addresses } from "./lib/env";
import { guard, STANDALONE_PASSPHRASE } from "./lib/guard";
import { e2eHome, errorMessage, readJson, stackDir } from "./lib/stack";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const COMPOSE = join(HERE, "compose.yml");
const CONTRACTS_REPO = process.env.E2E_STELLAR_CONTRACTS_REPO || "https://github.com/eq-lab/pipeline-stellar-contracts.git";
const CONTRACTS_REF = process.env.E2E_STELLAR_CONTRACTS_REF || "7646cef";
const LABEL = "pipeline-e2e.tag";
const HEALTH_TIMEOUT_MS = Number(process.env.E2E_HEALTH_TIMEOUT_MS || 180_000);

export class E2EError extends Error {
  constructor(message: string, readonly code = 2) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lockPath = () => join(e2eHome(), "stack.lock");
const sh = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

function logged(log: string, cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const fd = fs.openSync(log, "a");
  const r = spawnSync(cmd, args, { stdio: ["ignore", fd, fd], ...opts });
  fs.closeSync(fd);
  if (r.status !== 0) throw new E2EError(`${cmd} ${args.join(" ")} failed; see ${log}`);
}

export function cleanEnv(generated: Record<string, string>): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/", ...generated };
}

export function startService(tag: string, name: string, cmd: string, args: string[], generated: Record<string, string>, cwd = join(stackDir(tag), "run")) {
  const dir = stackDir(tag);
  for (const d of ["logs", "pids", "run"]) fs.mkdirSync(join(dir, d), { recursive: true });
  // dotenvy loads the first .env walking up from the cwd; this empty one stops it before an ancestor's (e.g. ~/.env).
  fs.writeFileSync(join(dir, "run", ".env"), "# empty on purpose: see docs/e2e.md \"Clean environment\"\n");
  const log = join(dir, "logs", `${name}.log`);
  const fd = fs.openSync(log, "a");
  const child = spawn(cmd, args, { cwd, env: cleanEnv(generated), detached: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  child.unref();
  fs.writeFileSync(join(dir, "pids", `${name}.pid`), String(child.pid));
  return { pid: child.pid!, log };
}

export function acquireStackLock(tag: string, reclaim: boolean): void {
  fs.mkdirSync(e2eHome(), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(lockPath(), tag, { flag: "wx" });
      return;
    } catch {
      const holder = fs.existsSync(lockPath()) ? fs.readFileSync(lockPath(), "utf8").trim() : "";
      if (holder && holder !== tag && !reclaim)
        throw new E2EError(`stack "${holder}" holds ${lockPath()}; tear it down with: scripts/e2e/down.sh --tag ${holder} (or pass --reclaim)`);
      down(holder || tag);
    }
  }
}

function portHolder(port: number): string | undefined {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
  const pid = /^p(\d+)/m.exec(r.stdout ?? "")?.[1];
  return pid ? `pid ${pid} (${/^c(.+)/m.exec(r.stdout)?.[1] ?? "?"})` : undefined;
}

function assertPortsFree() {
  for (const [name, port] of Object.entries(PORTS)) {
    const holder = portHolder(port);
    if (holder) throw new E2EError(`port ${port} (${name}) is taken by ${holder}`);
  }
}

async function waitFor(name: string, log: string, probe: () => Promise<boolean>) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await sleep(1000);
  }
  throw new E2EError(`${name} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s; log: ${log}`);
}

const tcp = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = connect(port, "127.0.0.1", () => (s.end(), ok(true))).on("error", () => ok(false));
  });
const http = async (url: string, init?: RequestInit) => (await fetch(url, init)).status < 500;
const stellarRpc = async <T>(method: string): Promise<T | undefined> => {
  const r = await fetch(`http://localhost:${PORTS.stellar}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
  });
  return ((await r.json()) as { result?: T }).result;
};
const stellarHealthy = async () => (await stellarRpc<{ status?: string }>("getHealth"))?.status === "healthy";

/** The ledger the indexer starts from: the latest one before the deploy, so it sees every deploy and role-grant event. */
export async function deployStartLedger(): Promise<number> {
  const seq = (await stellarRpc<{ sequence?: number }>("getLatestLedger"))?.sequence;
  if (!Number.isInteger(seq) || seq! < 1) throw new E2EError(`stellar getLatestLedger returned no ledger (${seq})`);
  return seq!;
}
const alive = (pid: number) => async () => {
  await sleep(5000);
  process.kill(pid, 0);
  return true;
};

const composeEnv = (tag: string): NodeJS.ProcessEnv => ({
  ...process.env,
  E2E_TAG: tag,
  E2E_PORT_POSTGRES: String(PORTS.postgres),
  E2E_PORT_MINIO: String(PORTS.minio),
  E2E_PORT_STELLAR: String(PORTS.stellar),
  E2E_SPACES_KEY: SPACES.key,
  E2E_SPACES_SECRET: SPACES.secret,
});

export function contractsDir(ref = CONTRACTS_REF) {
  return join(e2eHome(), "contracts", `pipeline-stellar-contracts@${ref}`);
}

const LOCK_GRACE_MS = 60_000;

/** True once the process holding a contracts-cache lock is gone (a killed build), so a waiter may break it. */
export function lockHolderGone(lock: string): boolean {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(join(lock, "pid"), "utf8"));
  } catch {
    // No pid yet (the holder is between mkdir and writing it) or a lock from before pid files: judge by age.
    try {
      return Date.now() - fs.statSync(lock).mtimeMs > LOCK_GRACE_MS;
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export async function ensureContracts(ref = CONTRACTS_REF): Promise<string> {
  const dir = contractsDir(ref);
  const lock = `${dir}.lock`;
  fs.mkdirSync(join(e2eHome(), "contracts"), { recursive: true });
  let announced = false;
  while (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(lock);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (lockHolderGone(lock)) {
        // Rename first: of several waiters only one moves the stale lock away.
        const stale = `${lock}.stale-${process.pid}`;
        try {
          fs.renameSync(lock, stale);
          fs.rmSync(stale, { recursive: true, force: true });
          console.error(`broke the stale contracts lock ${lock} left by a killed build`);
        } catch {
          /* another waiter broke it first */
        }
        continue;
      }
      if (!announced) console.error(`waiting for ${lock}: another invocation is building ${ref}`);
      announced = true;
      await sleep(2000);
      continue;
    }
    try {
      fs.writeFileSync(join(lock, "pid"), String(process.pid));
      if (fs.existsSync(dir)) break;
      const tmp = fs.mkdtempSync(join(e2eHome(), "contracts", ".tmp-"));
      const log = join(e2eHome(), "contracts", `build-${ref}.log`);
      logged(log, "git", ["clone", "--quiet", CONTRACTS_REPO, tmp]);
      logged(log, "git", ["-C", tmp, "checkout", "--quiet", ref]);
      logged(log, "stellar", ["contract", "build"], { cwd: tmp });
      try {
        fs.renameSync(tmp, dir);
      } catch (e) {
        // A lock broken while its holder was still alive lets two builds race; the first rename wins.
        if (!fs.existsSync(dir)) throw e;
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      const mine = (() => {
        try {
          return fs.readFileSync(join(lock, "pid"), "utf8") === String(process.pid);
        } catch {
          return false;
        }
      })();
      if (mine) fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  return dir;
}

export async function prepare() {
  fs.mkdirSync(e2eHome(), { recursive: true });
  logged(join(e2eHome(), "prepare.log"), "docker", ["compose", "-f", COMPOSE, "pull"], { env: composeEnv("prepare") });
  console.log(`contracts: ${await ensureContracts()}`);
}

async function deployContracts(tag: string, contracts: string, startLedger: number): Promise<{ addresses: Addresses; accounts: Accounts }> {
  const dir = stackDir(tag);
  const log = join(dir, "logs", "deploy.log");
  const env = { ...process.env, STELLAR_CONFIG_HOME: join(dir, "stellar"), NETWORK: "e2e", SKIP_BUILD: "1", STEP_DELAY: "0" };
  const stellar = (...args: string[]) => sh("stellar", args, { env });
  stellar("network", "add", "e2e", "--rpc-url", `http://localhost:${PORTS.stellar}/rpc`, "--network-passphrase", STANDALONE_PASSPHRASE);
  const names = ["deployer", "usdc-issuer", "verifier", "relayer", "trustee", "capital", "lp-browser"] as const;
  const addr: Record<string, string> = {};
  for (const n of names) {
    // `keys generate --fund` exits 0 when friendbot is not up yet, so the probe asks Horizon whether the account exists.
    await waitFor(`friendbot (${n})`, log, async () => {
      logged(log, "stellar", ["keys", "generate", n, "--network", "e2e", "--fund", "--overwrite"], { env });
      addr[n] = stellar("keys", "address", n);
      return (await fetch(`http://localhost:${PORTS.stellar}/accounts/${addr[n]}`)).ok;
    });
  }
  // The Minter refuses a custodian without USDC and PLUSD trustlines; one opened before deploy-all's init-asset (AUTH_REQUIRED) is authorized from the start.
  for (const line of [`USDC:${addr["usdc-issuer"]}`, `PLUSD:${addr.deployer}`])
    logged(log, "stellar", ["tx", "new", "change-trust", "--source-account", "capital", "--line", line, "--network", "e2e"], { env });
  const work = join(dir, "contracts");
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(join(contracts, "deployments"), join(work, "deployments"), { recursive: true });
  fs.symlinkSync(join(contracts, "target"), join(work, "target"));
  const net = join(work, "deployments", "networks", "e2e");
  fs.mkdirSync(net, { recursive: true });
  const now = (a: string) => [{ address: a, delay: "0" }];
  const config = {
    account: "deployer",
    asset_code: "PLUSD",
    usdc: "",
    usdc_mock_issuer: "usdc-issuer",
    rpc_url: `http://localhost:${PORTS.stellar}/rpc`,
    allowance_ttl: "518400",
    access_manager: { admin: addr.deployer },
    deposit_manager: { custodian: addr.deployer, verifier: addr.verifier, min_deposit: "10000000", tx_limit: "50000000000000", window_limit: "100000000000000", window: "86400", shift: "0" },
    // No approve_amount: deploy-all's approve-usdc passes --expiration_ledger, but the USDC SAC's approve takes live_until_ledger; the approval follows deploy-all.
    withdrawal_queue: { custodian: addr.deployer, verifier: addr.verifier },
    staked_pl_usd: { name: "Staked Pipeline USD", symbol: "sPLUSD", decimals_offset: "0" },
    loan_registry: { name: "Pipeline Loan Registry", symbol: "PLLR", capital_wallet: addr.capital, max_fee_bps: "5000", max_residual: "1000000000" },
    deal_tokens: { debt_issuer: addr.trustee },
    minter: { treasury: addr.capital, custodians: [addr.capital], tx_limit: "10000000000000", window_limit: "100000000000000", window: "86400", shift: "0" },
    access: {
      whitelist_admin: [...now(addr.deployer), ...now(addr.relayer)],
      trustee: now(addr.trustee),
      risk_council: now(addr.trustee),
      cash_reporter: now(addr.trustee),
      guardian: now(addr.deployer),
      pauser: now(addr.deployer),
      upgrader: now(addr.deployer),
    },
  };
  fs.writeFileSync(join(net, "config.json"), JSON.stringify(config, null, 2));
  logged(log, "just", ["deploy-all"], { cwd: join(work, "deployments"), env });
  const addresses = readJson<Addresses>(join(net, "addresses.json"))!;
  const expiration = startLedger + Number(config.allowance_ttl);
  logged(log, "stellar", ["contract", "invoke", "--id", addresses.usdc, "--source-account", "deployer", "--network", "e2e", "--", "approve", "--from", addr.deployer, "--spender", addresses.withdrawal_queue, "--amount", "100000000000000", "--live_until_ledger", String(expiration)], { env });
  // The LP app's e2e test wallet (lp-browser) starts with 1000 USDC; the app opens the PLUSD trustline itself.
  const usdc = `USDC:${addr["usdc-issuer"]}`;
  logged(log, "stellar", ["tx", "new", "change-trust", "--source-account", "lp-browser", "--line", usdc, "--network", "e2e"], { env });
  logged(log, "stellar", ["tx", "new", "payment", "--source-account", "usdc-issuer", "--destination", addr["lp-browser"], "--asset", usdc, "--amount", "10000000000", "--network", "e2e"], { env });
  const secret = (n: string) => stellar("keys", "secret", n);
  const accounts: Accounts = {
    issuer: addr.deployer,
    verifierSecret: secret("verifier"),
    relayerSecret: secret("relayer"),
    depositCustodian: addr.deployer,
    withdrawalCustodian: addr.deployer,
    capitalWallet: addr.capital,
    browserLpSecret: secret("lp-browser"),
  };
  return { addresses, accounts };
}

function jwtPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function assertGuarded(env: Record<string, string>) {
  const violations = guard({ env, generated: env, postgresPort: PORTS.postgres });
  if (violations.length) throw new E2EError(`guard refused the generated env:\n  ${violations.join("\n  ")}`);
}

export function viteArgs(tag: string, app: "frontend" | "trustee", port: number) {
  return [join(REPO, "node_modules/.bin/vite"), "--config", join(HERE,"vite.e2e.config.mts"), "--port", String(port), "--strictPort", "--mode", `e2e-${app}`];
}

export async function up(tag: string, reclaim: boolean) {
  const t0 = Date.now();
  const dir = stackDir(tag);
  acquireStackLock(tag, reclaim);
  assertPortsFree();
  const contracts = await ensureContracts();
  fs.mkdirSync(join(dir, "logs"), { recursive: true });
  logged(join(dir, "logs", "compose.log"), "docker", ["compose", "-f", COMPOSE, "up", "-d"], { env: composeEnv(tag) });
  const containerLog = (svc: string) => {
    const log = join(dir, "logs", `${svc}.log`);
    spawnSync("sh", ["-c", `docker compose -f "${COMPOSE}" logs ${svc} > "${log}" 2>&1`], { env: composeEnv(tag) });
    return log;
  };
  const infra: [string, () => Promise<boolean>][] = [
    ["postgres", () => tcp(PORTS.postgres)],
    ["minio", () => http(`http://localhost:${PORTS.minio}/minio/health/live`)],
    ["stellar", stellarHealthy],
  ];
  for (const [svc, probe] of infra) await waitFor(svc, join(dir, "logs", `${svc}.log`), probe).catch((e) => (containerLog(svc), Promise.reject(e)));
  sh("docker", ["compose", "-f", COMPOSE, "exec", "-T", "minio", "sh", "-c", `mc alias set l http://localhost:9000 ${SPACES.key} ${SPACES.secret} && mc mb -p l/${SPACES.bucket} && mc anonymous set download l/${SPACES.bucket}/ipfs`], { env: composeEnv(tag) });

  const startLedger = await deployStartLedger();
  const { addresses, accounts } = await deployContracts(tag, contracts, startLedger);
  const env = generateEnv({ ports: PORTS, addresses, accounts, jwt: jwtPair(), startLedger });
  assertGuarded(env);
  fs.writeFileSync(join(dir, "env.json"), JSON.stringify(env, null, 2), { mode: 0o600 });
  const vite = Object.entries(env).filter(([k]) => k.startsWith("VITE_"));
  const envFiles = { frontend: [...vite, ["E2E_WALLET_SECRET", env.E2E_WALLET_SECRET]], trustee: vite };
  for (const [app, vars] of Object.entries(envFiles)) fs.writeFileSync(join(dir, `.env.e2e-${app}`), vars.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.mkdirSync(join(dir, "ipfs"), { recursive: true });

  logged(join(dir, "logs", "build.log"), "cargo", ["build", "-p", "pipeline-api", "-p", "pipeline-worker"], { cwd: REPO });
  const bin = join(REPO, "target", "debug");
  const viteEnv = { ...Object.fromEntries(vite), E2E_VITE_ENV_DIR: dir };
  const services: [string, ReturnType<typeof startService>, () => Promise<boolean>][] = [];
  const start = (name: string, cmd: string, args: string[], e: Record<string, string>, probe: (pid: number) => () => Promise<boolean>, cwd?: string) => {
    const s = startService(tag, name, cmd, args, e, cwd);
    services.push([name, s, probe(s.pid)]);
  };
  start("fakes", process.execPath, [join(REPO, "node_modules/.bin/tsx"), join(HERE,"fakes.ts"), String(PORTS.fakes), join(dir, "ipfs"), `http://localhost:${PORTS.minio}/${SPACES.bucket}/ipfs`], {}, () => () => http(`http://localhost:${PORTS.fakes}/health`));
  start("api", join(bin, "pipeline-api"), [], env, () => () => http(`http://localhost:${PORTS.api}/`));
  start("worker", join(bin, "pipeline-worker"), [], env, alive);
  start("lp", process.execPath, viteArgs(tag, "frontend", PORTS.lp), { ...viteEnv, E2E_VITE_APP: "frontend" }, () => () => http(`http://localhost:${PORTS.lp}/`), join(REPO, "packages/frontend"));
  start("trustee", process.execPath, viteArgs(tag, "trustee", PORTS.trustee), { ...viteEnv, E2E_VITE_APP: "trustee" }, () => () => http(`http://localhost:${PORTS.trustee}/`), join(REPO, "packages/trustee"));
  for (const [name, s, probe] of services) {
    await waitFor(name, s.log, probe);
    console.log(`✅ ${name} healthy`);
  }
  const state = {
    tag,
    chains: ["stellar"],
    contracts: { stellar: CONTRACTS_REF },
    durations: { up: Math.round((Date.now() - t0) / 1000) },
    startedAt: new Date(t0).toISOString(),
    ports: PORTS,
  };
  fs.writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
  console.log(`stack ${tag} up in ${state.durations.up}s: api http://localhost:${PORTS.api}, lp http://localhost:${PORTS.lp}, trustee http://localhost:${PORTS.trustee}`);
}

export function down(tag: string) {
  const dir = stackDir(tag);
  for (const f of fs.existsSync(join(dir, "pids")) ? fs.readdirSync(join(dir, "pids")) : []) {
    const pid = Number(fs.readFileSync(join(dir, "pids", f), "utf8"));
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" }).stdout?.split("\n").filter(Boolean) ?? [];
  const ids = docker("ps", "-aq", "--filter", `label=${LABEL}=${tag}`);
  if (ids.length) docker("rm", "-fv", ...ids);
  const vols = docker("volume", "ls", "-q", "--filter", `label=${LABEL}=${tag}`);
  if (vols.length) docker("volume", "rm", "-f", ...vols);
  const nets = docker("network", "ls", "-q", "--filter", `label=${LABEL}=${tag}`);
  if (nets.length) docker("network", "rm", ...nets);
  fs.rmSync(dir, { recursive: true, force: true });
  if (fs.existsSync(lockPath()) && fs.readFileSync(lockPath(), "utf8").trim() === tag) fs.rmSync(lockPath());
  console.log(`stack ${tag} down`);
}

export function parseArgs(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--") && a !== "--tag"));
  const i = rest.indexOf("--tag");
  const tag = i >= 0 ? rest[i + 1] : undefined;
  const known = new Set(["--reclaim", "--prepare"]);
  for (const f of flags) if (!known.has(f)) throw new E2EError(`unknown flag ${f}`);
  if (cmd !== "up" && cmd !== "down") throw new E2EError("usage: stack.ts up|down [--tag <tag>] [--reclaim] [--prepare]");
  if (!flags.has("--prepare") && !tag) throw new E2EError("--tag <tag> is required");
  return { cmd, tag, reclaim: flags.has("--reclaim"), prepare: flags.has("--prepare") };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.tag) stackDir(a.tag);
  if (a.prepare) return prepare();
  if (a.cmd === "down") return down(a.tag!);
  try {
    await up(a.tag!, a.reclaim);
  } catch (e) {
    if (e instanceof E2EError && /holds|is taken/.test(e.message)) throw e;
    console.error(`up failed; the partial stack is left for inspection — tear it down with: scripts/e2e/down.sh --tag ${a.tag}`);
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(`❌ ${errorMessage(e)}`);
    process.exit(e instanceof E2EError ? e.code : 2);
  });
