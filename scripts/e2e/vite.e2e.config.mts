// Runs an app's own Vite config with envDir moved to the stack directory, so no repository .env loads; see docs/e2e.md "Local stack".

import { defineConfig, mergeConfig } from "vite";
import frontend from "../../packages/frontend/vite.config";
import trustee from "../../packages/trustee/vite.config";

export default defineConfig(() => {
  const base = { frontend, trustee }[process.env.E2E_VITE_APP ?? ""];
  const envDir = process.env.E2E_VITE_ENV_DIR;
  if (!base || !envDir) throw new Error("E2E_VITE_APP (frontend|trustee) and E2E_VITE_ENV_DIR are required");
  return mergeConfig(base, { envDir });
});
