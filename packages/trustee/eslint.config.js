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
    // stays centralized. Mirrors packages/frontend/eslint.config.js. When
    // #778 extracts the shared wallet/api layer, the corresponding
    // no-restricted-imports blocks return here too.
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
);
