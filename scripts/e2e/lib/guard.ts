// Refuses an e2e environment that could reach anything but this machine's stack; see docs/e2e.md "Guard".

export const STELLAR_CHAIN_ID = "99000001";
export const EVM_CHAIN_ID = "31337";
export const STANDALONE_PASSPHRASE = "Standalone Network ; February 2017";
export const E2E_DATABASE = "pipeline_e2e";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_CHAINS = new Set([STELLAR_CHAIN_ID, EVM_CHAIN_ID]);
const APP_CHAIN_KEYS: Record<string, string> = { VITE_STELLAR_CHAIN_ID: STELLAR_CHAIN_ID, VITE_EVM_CHAIN_ID: EVM_CHAIN_ID };
const HOST_KEYS = new Set(["PATH", "HOME"]);

export interface GuardInput {
  env: Record<string, string | undefined>;
  generated?: Record<string, string>;
  postgresPort: number;
}

export function checkValue(key: string, value: string, postgresPort: number): string[] {
  const out: string[] = [];
  if (value.includes("stage.eqlab.net")) out.push(`${key}: points at stage.eqlab.net`);
  for (const raw of value.match(/[a-z][a-z0-9+.-]*:\/\/[^\s,"']+/gi) ?? []) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      out.push(`${key}: unparsable URL ${raw}`);
      continue;
    }
    if (!LOCAL_HOSTS.has(url.hostname)) out.push(`${key}: ${url.hostname} is not localhost`);
    if (/^postgres(ql)?:$/.test(url.protocol) && (Number(url.port) !== postgresPort || url.pathname !== `/${E2E_DATABASE}`))
      out.push(`${key}: database must be localhost:${postgresPort}/${E2E_DATABASE}`);
  }
  if (/PASSPHRASE$/.test(key) && value !== STANDALONE_PASSPHRASE) out.push(`${key}: not the standalone passphrase`);
  const chainId = /^CHAIN_(\d+)_/.exec(key)?.[1];
  if (chainId && !LOCAL_CHAINS.has(chainId)) out.push(`${key}: chain ${chainId} is not a local chain`);
  if (/^(CHAINS|DEFAULT_CHAIN_ID)$/.test(key))
    for (const id of chainList(value)) if (!LOCAL_CHAINS.has(id)) out.push(`${key}: chain ${id} is not a local chain`);
  if (key in APP_CHAIN_KEYS && value !== APP_CHAIN_KEYS[key]) out.push(`${key}: chain ${value} is not the local chain ${APP_CHAIN_KEYS[key]}`);
  return out;
}

const chainList = (value: string) => value.split(",").map((s) => s.trim());

export function guard({ env, generated, postgresPort }: GuardInput): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || HOST_KEYS.has(key)) continue;
    if (generated && generated[key] !== value) out.push(`${key}: not from this tag's generated env`);
    out.push(...checkValue(key, value, postgresPort));
  }
  const passphrase = env[`CHAIN_${STELLAR_CHAIN_ID}_STELLAR_NETWORK_PASSPHRASE`];
  if (env.CHAINS !== undefined && chainList(env.CHAINS).includes(STELLAR_CHAIN_ID) && passphrase !== STANDALONE_PASSPHRASE)
    out.push(`CHAIN_${STELLAR_CHAIN_ID}_STELLAR_NETWORK_PASSPHRASE: must be set to the standalone passphrase`);
  return out;
}
