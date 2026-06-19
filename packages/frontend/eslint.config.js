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
    // Enforce that wagmi / viem / AppKit / TanStack Query are only imported
    // from within the EVM wallet module (src/wallet/evm/**), the Stellar wallet
    // module (src/wallet/stellar/**), the api module (src/api/**), or the env
    // accessor (src/lib/env.ts).
    // All other source files must go through @/wallet or @/api.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "src/wallet/evm/**",
      "src/wallet/stellar/**",
      "src/api/**",
      "src/lib/env.ts",
    ],
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
            "@tanstack/react-query",
            "@tanstack/react-query/*",
          ],
        },
      ],
    },
  },
  {
    // Enforce that @creit.tech/stellar-wallets-kit and @stellar/stellar-sdk are
    // only imported from within the Stellar wallet module
    // (src/wallet/stellar/**) or the env accessor (src/lib/env.ts).
    // All other source files must go through @/wallet.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/wallet/stellar/**", "src/lib/env.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
    // Forbid bare `fetch(...)` calls outside `src/api/`.
    // All HTTP calls must go through `apiFetch` in `src/api/client.ts`.
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
