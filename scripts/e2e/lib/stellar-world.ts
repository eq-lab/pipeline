// Shared world of the Stellar journeys: funded accounts and USDC, an onboarded LP, operators and KYC; see docs/e2e.md "Stellar world".

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postSumsubWebhook } from "../fakes";
import { PORTS } from "./env";
import { STELLAR_CHAIN_ID } from "./guard";
import type { Recorded } from "./journey";
import { readJson, stackDir } from "./stack";
import { addr, Asset, classic, friendbot, Keypair, pay, read, stackKey, trust } from "./stellar";

export const API = `http://localhost:${PORTS.api}`;
export const CHAIN = `chain_id=${STELLAR_CHAIN_ID}`;
export const ONE = 10_000_000n;
const LP_USDC = 1_000n * ONE;

export interface World {
  tag: string;
  env: Record<string, string>;
  lp: Keypair;
  lpToken: string;
  trusteeToken: string;
  deployer: Keypair;
  capital: Keypair;
  usdc: Asset;
  plusd: Asset;
}

export interface Reply {
  status: number;
  body: any;
}

export async function http(method: string, path: string, opts: { body?: unknown; token?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body };
}

export function ok(r: Reply, what: string): any {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== undefined) return v;
    } catch (e) {
      last = e;
    }
    await sleep(1000);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}${last ? ` (last error: ${last instanceof Error ? last.message : last})` : ""}`);
}

/** SEP-53: ed25519 over SHA-256("Stellar Signed Message:\n" + message), base64; what the wallets' signMessage returns. */
export const signMessage = (kp: Keypair, message: string) =>
  kp.sign(createHash("sha256").update(`Stellar Signed Message:\n${message}`, "utf8").digest()).toString("base64");

export function psql(tag: string, sql: string): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=pipeline-e2e.tag=${tag}`, "--filter", "label=com.docker.compose.service=postgres"], { encoding: "utf8" }).trim();
  if (!id) throw new Error(`no postgres container for stack ${tag}`);
  return execFileSync("docker", ["exec", "-i", id, "psql", "-U", "pipeline", "-d", "pipeline_e2e", "-tAq", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}

/** The latest email passcode the API logged for `email` (EMAIL_DEV_LOG=true); it never leaves this process. */
function passcodeFor(tag: string, email: string): string | undefined {
  const log = readFileSync(join(stackDir(tag), "logs", "api.log"), "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const at = log.lastIndexOf(`to=${email}`);
  return at < 0 ? undefined : /verification code is (\d{6})/.exec(log.slice(at))?.[1];
}

async function signupLp(tag: string, lp: Keypair, recorded: Recorded): Promise<string> {
  const email = `lp-${Date.now()}@example.com`;
  const password = `E2e-${randomBytes(8).toString("hex")}!1`;
  ok(await http("POST", "/v1/auth/signup", { body: { email, password, captcha_token: "e2e" } }), "signup");
  const code = await until("the signup passcode in logs/api.log", async () => passcodeFor(tag, email), 30_000);
  const { token } = ok(await http("POST", "/v1/auth/verify-otp", { body: { email, code } }), "verify-otp");
  ok(await http("POST", "/v1/lps/me", { token, body: { legal_name: "E2E Lender", contact_email: email, country: "CH" } }), "create LP");
  const q = `${CHAIN}&address=${lp.publicKey()}`;
  const { message } = ok(await http("GET", `/v1/lps/me/link-address/challenge?${q}`, { token }), "link-address challenge");
  const linked = ok(
    await http("POST", "/v1/lps/me/link-address/verify", {
      token,
      body: { chain_id: Number(STELLAR_CHAIN_ID), address: lp.publicKey(), signature: signMessage(lp, message) },
    }),
    "link-address verify",
  );
  recorded["world.lp"] = { address: lp.publicKey(), emailVerified: true, linkedAddress: linked.stellar_address ?? null };
  return token;
}

async function operators(tag: string, trustee: Keypair, recorded: Recorded): Promise<string> {
  // shortcut: there is no `team` role in the API (only trustee and originator), so the team member is an operator row without roles; give it one when the API grows it.
  const rows: [string, string][] = [
    [trustee.publicKey(), "{trustee}"],
    [Keypair.random().publicKey(), "{originator}"],
    [Keypair.random().publicKey(), "{}"],
  ];
  for (const [address, roles] of rows)
    psql(
      tag,
      `WITH a AS (INSERT INTO accounts (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM auth_users WHERE chain_id=${STELLAR_CHAIN_ID} AND address='${address}') RETURNING id)
       INSERT INTO auth_users (chain_id, address, roles, account_id) SELECT ${STELLAR_CHAIN_ID}, '${address}', '${roles}', id FROM a;`,
    );
  const { message } = ok(await http("GET", `/v1/auth/challenge?${CHAIN}&address=${trustee.publicKey()}`), "operator challenge");
  const { token } = ok(
    await http("POST", "/v1/auth/verify", { body: { chain_id: Number(STELLAR_CHAIN_ID), address: trustee.publicKey(), signature: signMessage(trustee, message) } }),
    "operator verify",
  );
  recorded["world.operators"] = { rows: rows.length, trusteeLogin: true };
  return token;
}

export async function setupWorld(tag: string, recorded: Recorded): Promise<World> {
  const env = readJson<Record<string, string>>(join(stackDir(tag), "env.json"));
  if (!env) throw new Error(`no env.json in ${stackDir(tag)}`);
  const deployer = stackKey(tag, "deployer");
  const capital = stackKey(tag, "capital");
  const usdcIssuer = stackKey(tag, "usdc-issuer");
  const usdc = new Asset("USDC", usdcIssuer.publicKey());
  const plusd = new Asset("PLUSD", env.VITE_STELLAR_PLUSD_ISSUER_ID);
  // The deposit custodian (deployer) receives USDC as a classic holder; an existing trustline is left as it is.
  await classic(deployer, [trust(usdc)]);

  const lp = Keypair.random();
  await friendbot(lp.publicKey());
  await classic(lp, [trust(usdc), trust(plusd)]);
  await classic(usdcIssuer, [pay(lp.publicKey(), usdc, LP_USDC)]);
  recorded["world.accounts"] = { lp: lp.publicKey(), usdc: LP_USDC.toString() };

  const lpToken = await signupLp(tag, lp, recorded);
  const trusteeToken = await operators(tag, stackKey(tag, "trustee"), recorded);
  return { tag, env, lp, lpToken, trusteeToken, deployer, capital, usdc, plusd };
}

/** Sumsub through the stub and a signed GREEN webhook, then waits until the relayer has whitelisted the LP on PLUSD. */
export async function passKyc(w: World, recorded: Recorded): Promise<void> {
  const wallet = w.lp.publicKey();
  // The API creates the applicant only once the relayer has a profile for the wallet, i.e. after its first DepositRequested.
  const { applicant_id } = await until("the LP's KYC profile", async () => {
    const r = await http("POST", `/v1/kyc/applicants?${CHAIN}`, { body: { wallet_address: wallet } });
    return r.status === 403 ? undefined : ok(r, "kyc applicant");
  });
  const hook = await postSumsubWebhook(API, w.env.SUMSUB_WEBHOOK_SECRET_KEY, {
    applicantId: applicant_id,
    type: "applicantReviewed",
    externalUserId: wallet,
    sandboxMode: true,
    reviewStatus: "completed",
    reviewResult: { reviewAnswer: "GREEN" },
  });
  if (!hook.ok) throw new Error(`sumsub webhook: HTTP ${hook.status} ${await hook.text()}`);
  const status = ok(await http("GET", `/v1/kyc/status/${wallet}?${CHAIN}`), "kyc status");
  await until("the relayer to whitelist the LP on PLUSD", async () =>
    (await read<boolean>(wallet, w.env.CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID, "authorized", [addr(wallet)])) || undefined,
  );
  recorded["world.kyc"] = { ...status, whitelisted: true };
}
