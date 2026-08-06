/**
 * Cross-deployment network switcher (issue #1032).
 *
 * Each deployment is single-network (existing flat env vars); switching
 * networks means navigating to a sibling deployment at a different origin,
 * not swapping runtime config. See `docs/frontend/wallet-flows.md` for the
 * full design (Design §1–4 of the issue-1032 exec plan).
 *
 * `networkIdFromPassphrase` derives the deployment's OWN network identity
 * from its existing Stellar network passphrase config — no new env var
 * needed for that half. `parseNetworkLinks` reads the new `VITE_NETWORK_LINKS`
 * var to find the sibling deployments' URLs. `navigateToNetworkLink` performs
 * the actual cross-origin navigation, with a confirm step for mainnet.
 */

// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
// (passphrase → identity mapping and the "unknown passphrase" fallback rule).
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** A network's canonical id + display label. */
export interface NetworkIdentity {
  id: string;
  label: string;
}

/** A sibling deployment offered by `VITE_NETWORK_LINKS`. */
export interface NetworkLink extends NetworkIdentity {
  url: string;
}

const KNOWN_LABELS: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

/** `"futurenet"` → `"Futurenet"`; known ids use their canonical label. */
function labelForId(id: string): string {
  return KNOWN_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Derives the deployment's own network identity from its Stellar network
 * passphrase. Unknown passphrases (futurenet, standalone, …) are treated as
 * testnet-styled (no real-funds affordance) but keep the raw passphrase as
 * the visible label, since there is no canonical short name for them.
 */
export function networkIdFromPassphrase(passphrase: string): NetworkIdentity {
  if (passphrase === TESTNET_PASSPHRASE) {
    return { id: "testnet", label: "Testnet" };
  }
  if (passphrase === MAINNET_PASSPHRASE) {
    return { id: "mainnet", label: "Mainnet" };
  }
  return { id: "testnet", label: passphrase };
}

/**
 * Parses `VITE_NETWORK_LINKS` (`"mainnet=https://…,testnet=https://…"`) into
 * an ordered list of sibling-deployment links. Malformed entries (missing
 * `=`, empty id/url, or a URL that fails to parse as absolute http(s)) are
 * dropped rather than throwing — an operator typo should degrade the
 * switcher, not break the app. Order is preserved from the source string.
 */
export function parseNetworkLinks(raw: string | undefined): NetworkLink[] {
  if (!raw) return [];

  const links: NetworkLink[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;

    const id = trimmed.slice(0, eqIdx).trim();
    const url = trimmed.slice(eqIdx + 1).trim();
    if (!id || !url) continue;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;

    links.push({ id, label: labelForId(id), url });
  }
  return links;
}

/** Copy for the mainnet-bound confirm (real funds; Design §4, resolved Q7). */
export const MAINNET_CONFIRM_MESSAGE =
  "Switch to Mainnet? You'll leave this testnet environment.";

/**
 * Navigates to a sibling deployment. Mainnet links ask for confirmation
 * first (real funds); confirmed elsewhere is a full-page, cross-origin
 * navigation — no in-app state carries over by design.
 */
export function navigateToNetworkLink(link: NetworkLink): void {
  if (link.id === "mainnet" && !window.confirm(MAINNET_CONFIRM_MESSAGE)) {
    return;
  }
  window.location.assign(link.url);
}
