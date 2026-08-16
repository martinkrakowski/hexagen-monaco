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
    // REA-003 — the code-view explorer is presentational: it renders generation
    // results and raises intents, it never starts a generation. The fence is on
    // the DIRECTORY rather than a file list so a new file dropped into
    // `explorer/` inherits it instead of quietly escaping it.
    //
    // Flat config replaces (does not merge) a rule's options, so the
    // `@hexagen/local-llm` ACL entry from the `features/**` block above is
    // repeated here — dropping it would silently exempt this directory from
    // ADR-0021.
    files: ["features/code-view/explorer/**/*.{ts,tsx}"],
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
          patterns: [
            {
              group: [
                "./hooks/*",
                "../hooks/*",
                "**/code-view/hooks/*",
                "@/code-view/hooks/*",
              ],
              message:
                "REA-003: the code-view explorer is presentational. useProjectGeneration / useArchitectureDownload belong in the CodeView boundary; take files, notices and callbacks as props instead.",
            },
            {
              group: [
                "**/wire.client",
                "@/lib/wire.client",
                "**/app/lib/adapters/*",
              ],
              message:
                "REA-003: the code-view explorer must not reach the client DI container or an adapter. Do the I/O in the CodeView boundary and pass the result down.",
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
];
