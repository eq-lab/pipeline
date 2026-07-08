import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
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
    // Mirrors packages/frontend/eslint.config.js (TD-33): wagmi / viem /
    // AppKit / TanStack Query are only importable from the EVM module. All
    // other files in this package (and its consumers) must go through the
    // package barrel (`./index.ts`) or the EVM module itself.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/evm/**"],
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
    // Mirrors packages/frontend/eslint.config.js (TD-33): the Stellar wallet
    // SDKs are only importable from the Stellar module.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/stellar/**"],
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
);
