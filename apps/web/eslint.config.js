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
              // `no-restricted-imports` matches the import STRING, not the
              // resolved file, so every spelling of a target has to be listed.
              // tsconfig maps `@/*` onto `app/*`, which makes `@/lib/wire`
              // and `@/lib/adapters/*` live import forms — and the alias is
              // the dominant idiom in `features/`. `wire*` rather than
              // `wire.client` because `app/lib/wire.ts` is a barrel that does
              // `export * from "./wire.client"`; fencing only the latter left
              // the container reachable one re-export away.
              group: ["**/wire", "**/wire.*", "**/adapters/*", "**/adapters/*/*"],
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
  {
    // HEX-016 boundary guard. `governance/refresh` owned a shell-out to
    // `yarn lint:arch`, its own temp-file handling, and a copy of the
    // `ServerLLMAdapter` + `GenerateSuggestionUseCase` wiring that
    // `governance/suggestions` also carried. Those concerns are now behind
    // `ManifestLintPort` / `SuggestionPort`, whose adapters are constructed in
    // `app/lib/wire.server.ts`.
    //
    // This block is the enforcement: re-inlining process, filesystem or LLM
    // construction in a governance route fails `turbo lint` in CI. It lives
    // here rather than in a test because a lint rule cannot be satisfied by
    // deleting an assertion.
    //
    // Scoped to the route files themselves — `app/lib/governance/adapters/**`
    // is exactly where these imports belong.
    files: ["app/api/governance/**/*.ts"],
    ignores: ["app/api/governance/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hexagen/agentic-interaction",
              importNames: ["ServerLLMAdapter", "GenerateSuggestionUseCase"],
              message:
                "Governance routes must not construct the LLM stack. Depend on SuggestionPort (app/lib/governance/ports.ts); the adapter is wired in app/lib/wire.server.ts. See HEX-016.",
            },
          ],
          patterns: [
            {
              group: [
                "child_process",
                "node:child_process",
                "fs",
                "fs/promises",
                "node:fs",
                "node:fs/promises",
                "os",
                "node:os",
              ],
              message:
                "Governance routes must not perform process or filesystem I/O. Depend on ManifestLintPort (app/lib/governance/ports.ts); the adapter owns the subprocess and the temp file. See HEX-016.",
            },
          ],
        },
      ],
    },
  },
];
