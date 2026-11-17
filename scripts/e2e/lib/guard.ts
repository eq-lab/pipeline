// Refuses an e2e environment that could reach anything but this machine's stack; see docs/e2e.md "Guard".

export const STELLAR_CHAIN_ID = "99000001";
export const STANDALONE_PASSPHRASE = "Standalone Network ; February 2017";
export const E2E_DATABASE = "pipeline_e2e";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
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
  const chainIds = /^CHAIN_(\d+)_/.exec(key)?.[1];
  if (chainIds && chainIds !== STELLAR_CHAIN_ID) out.push(`${key}: chain ${chainIds} is not the local Stellar chain`);
  if (/^(CHAINS|DEFAULT_CHAIN_ID|VITE_STELLAR_CHAIN_ID)$/.test(key))
    for (const id of value.split(",").map((s) => s.trim()))
      if (id !== STELLAR_CHAIN_ID) out.push(`${key}: chain ${id} is not the local Stellar chain`);
  return out;
}

export function guard({ env, generated, postgresPort }: GuardInput): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || HOST_KEYS.has(key)) continue;
    if (generated && generated[key] !== value) out.push(`${key}: not from this tag's generated env`);
    out.push(...checkValue(key, value, postgresPort));
  }
  const passphrase = env[`CHAIN_${STELLAR_CHAIN_ID}_STELLAR_NETWORK_PASSPHRASE`];
  if (env.CHAINS !== undefined && passphrase !== STANDALONE_PASSPHRASE)
    out.push(`CHAIN_${STELLAR_CHAIN_ID}_STELLAR_NETWORK_PASSPHRASE: must be set to the standalone passphrase`);
  return out;
}
