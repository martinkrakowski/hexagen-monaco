/**
 * ESLint configuration for @hexagen/ui
 *
 * Enforces Layer 2 of the 3-layer information state firewall:
 * - Layer 1: TypeScript branded types (forbidden-brand.ts)
 * - Layer 2: ESLint rules (this file)
 * - Layer 3: CI structural check (scripts/validate-ui-boundary.sh)
 *
 * Blocklist source: scripts/firewall-blocklist.yaml
 */

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ["dist/**", "node_modules/**", ".turbo/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "warn",
      "no-console": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@hexagen/core-domain",
                "@hexagen/core-domain/*",
                "@hexagen/local-llm",
                "@hexagen/local-llm/*",
                "@hexagen/agentic-interaction",
                "@hexagen/agentic-interaction/*",
                "@hexagen/transaction-system",
                "@hexagen/transaction-system/*",
                "@hexagen/reconciliation-engine",
                "@hexagen/reconciliation-engine/*",
                "@hexagen/prompt-compiler",
                "@hexagen/prompt-compiler/*",
                "@hexagen/ui-projection-compiler",
                "@hexagen/ui-projection-compiler/*",
                "@hexagen/layout-engine",
                "@hexagen/layout-engine/*",
                "@hexagen/runtime",
                "@hexagen/runtime/*",
                "@hexagen/mcp-server",
                "@hexagen/mcp-server/*",
              ],
              message:
                "UI projection layer cannot import kernel/probabilistic packages. Use controllers + props instead.",
            },
          ],
        },
      ],
    },
  },
];
