import next from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import hexagenUi from "@hexagen/eslint-plugin-ui";

/** @type {import('eslint').Linter.Config} */
export default [
  {
    ignores: [
      ".next/**",
      "out/**",
      "node_modules/**",
      "dist/**",
      ".turbo/**",
      "src/types/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "*.config.mjs"],
    plugins: {
      "@next": next,
      "hexagen-ui": hexagenUi,
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: '^_' }],
      "hexagen-ui/no-children-wrapper-type-swap": "error",
    },
    settings: {
      next: {
        rootDir: ["app", "components", "lib", "hooks"],
      },
    },
  },
  {
    files: ["features/**/*.{ts,tsx}"],
    plugins: {
      "hexagen-ui": hexagenUi,
    },
    rules: {
      "hexagen-ui/no-feature-slice-imports": "error",
      "hexagen-ui/no-arbitrary-tailwind-values": "error",
      "hexagen-ui/rhf-stable-array-keys": "error",
      "hexagen-ui/no-children-wrapper-type-swap": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hexagen/local-llm",
              importNames: ["LLMMessage", "LocalLLMProviderPort"],
              allowTypeImports: true,
              message:
                'LLMMessage and LocalLLMProviderPort are @internal. Use SendStructuredRequestPort, ModelLifecyclePort, or LLMRequest["messages"] instead. See ADR 0021.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hexagen/local-llm",
              importNames: ["LLMMessage", "LocalLLMProviderPort"],
              allowTypeImports: true,
              message:
                'LLMMessage and LocalLLMProviderPort are @internal. Use SendStructuredRequestPort, ModelLifecyclePort, or LLMRequest["messages"] instead. See ADR 0021.',
            },
          ],
        },
      ],
    },
  },
  {
    // Item 6.2 (HEX-003, HEX-034): the manifest-generation family and the LLM
    // governance-context route are transport only — `app/lib/wire.server.ts` is
    // their single composition root. This ratchet is what stops the next edit
    // from re-introducing an inline `new EnvironmentSecretVaultAdapter()` /
    // `new InMemoryTransactionManager()` / `mergeSplitManifest(...)`; the route
    // suites can only catch a regression in a path they happen to exercise.
    //
    // Flat config replaces (not merges) `no-restricted-imports` for these files,
    // so the app-wide @internal local-llm entry above is repeated here.
    files: ["app/api/manifest/generate/**/*.ts", "app/api/llm/context/**/*.ts"],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hexagen/local-llm",
              importNames: ["LLMMessage", "LocalLLMProviderPort"],
              allowTypeImports: true,
              message:
                'LLMMessage and LocalLLMProviderPort are @internal. Use SendStructuredRequestPort, ModelLifecyclePort, or LLMRequest["messages"] instead. See ADR 0021.',
            },
            {
              name: "@hexagen/agentic-interaction",
              importNames: [
                "LLMProviderSelectorAdapter",
                "EnvironmentSecretVaultAdapter",
                "CloudLLMPipelineAdapter",
                "ServerLLMAdapter",
                "StaticProviderCatalogAdapter",
              ],
              allowTypeImports: true,
              message:
                "Adapters are composed in app/lib/wire.server.ts, not in a route (HEX-003). Import the use case here and take its collaborators from a wire.server factory.",
            },
          ],
          patterns: [
            {
              group: [
                "@hexagen/transaction-system",
                "@hexagen/transaction-system/*",
              ],
              allowTypeImports: true,
              message:
                "Transaction infrastructure is composed in app/lib/wire.server.ts (createGenerationTransactionManager), not in a route (HEX-003).",
            },
            {
              group: ["@hexagen/local-llm", "@hexagen/local-llm/*"],
              allowTypeImports: true,
              message:
                "The WebLLM adapter is loaded by app/lib/wire.server.ts (createWebLLMAdapter), not in a route (HEX-003).",
            },
            {
              group: [
                "@hexagen/project-configuration/server",
                "@hexagen/sync",
                "fs",
                "fs/promises",
                "node:fs",
                "node:fs/promises",
              ],
              allowTypeImports: true,
              message:
                "Workspace discovery and manifest merging belong to a wire.server-provided adapter, not to an HTTP handler (HEX-034).",
            },
          ],
        },
      ],
    },
  },
];
