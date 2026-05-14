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
    // from within the wallet module (src/wallet/**) or the env accessor
    // (src/lib/env.ts). All other source files must go through @/wallet.
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/wallet/**", "src/lib/env.ts"],
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
);
