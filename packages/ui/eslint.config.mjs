/**
 * ESLint configuration for @hexagen/ui
 *
 * Enforces Layer 2 of the 3-layer information state firewall:
 * - Layer 1: TypeScript branded types (forbidden-brand.ts)
 * - Layer 2: ESLint rules (this file)
 * - Layer 3: CI structural check (scripts/validate-ui-boundary.sh)
 *
 * Uses ESLint flat config format. Compatible with ESLint v8.57+ (which
 * auto-detects `eslint.config.js` and enables flat-config mode).
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
      // UI projection firewall: block kernel imports from @hexagen/ui/src/**
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@hexagen/core-domain",
                "@hexagen/core-domain/*",
                "@hexagen/architectural-enforcement",
                "@hexagen/architectural-enforcement/*",
                "@hexagen/local-llm",
                "@hexagen/local-llm/*",
                "@hexagen/agentic-interaction",
                "@hexagen/agentic-interaction/*",
                "@hexagen/intent-compiler",
                "@hexagen/intent-compiler/*",
                "@hexagen/transaction-system",
                "@hexagen/transaction-system/*",
                "@hexagen/reconciliation-engine",
                "@hexagen/reconciliation-engine/*",
                "@hexagen/prompt-compiler",
                "@hexagen/prompt-compiler/*",
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
