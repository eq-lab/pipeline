import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/routeTree.gen.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Access import.meta.env via @/lib/env instead of directly, so env access
    // stays centralized. Mirrors packages/frontend/eslint.config.js.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/lib/env.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.property.name='meta'][property.name='env']",
          message:
            "Access import.meta.env via @/lib/env instead of directly. This keeps env access centralized.",
        },
      ],
    },
  },
  {
    // TD-33 (reinstated by #791): wallet SDKs (wagmi/viem/AppKit/react-query/
    // Stellar SDK/wallets-kit) must only be imported via the
    // `@pipeline/wallet-connect` package boundary — never directly. This app
    // has no `src/wallet/**` module of its own (unlike the LP frontend); all
    // wallet code lives in the shared package, so the restriction applies
    // everywhere in this app with no carve-out.
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "wagmi",
            "wagmi/*",
            "viem",
            "viem/*",
            "@reown/appkit",
            "@reown/appkit/*",
            "@reown/appkit-adapter-wagmi",
            "@reown/appkit-adapter-wagmi/*",
            "@creit.tech/stellar-wallets-kit",
            "@creit.tech/stellar-wallets-kit/*",
            "@stellar/stellar-sdk",
            "@stellar/stellar-sdk/*",
          ],
        },
      ],
    },
  },
  {
    // TD-33 (reinstated by #791): forbid bare `fetch(...)` outside `src/api/`.
    // All Pipeline backend calls must go through `apiFetch` in
    // `src/api/client.ts`, which injects the bearer token.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/api/**", "src/test-setup.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Call fetch only via @/api (src/api/client.ts).",
        },
      ],
    },
  },
);
