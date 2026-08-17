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
    // REA-001 / REA-002 / REA-006 — the governance assistant's `view/` tree is
    // presentational: it renders what the boundary hands it and raises intents.
    // `GovernanceAssistantPanel.tsx` is the boundary that owns the local-engine
    // subscription, the cloud transport, the secret vault and the single
    // capability probe.
    //
    // The fence is on the DIRECTORY, so a view added to `view/` later inherits
    // it instead of quietly escaping a hand-kept file list — and it is in the
    // shipped lint config rather than a test, because a lint rule cannot be
    // satisfied by deleting an assertion.
    //
    // Note there is deliberately no `allowTypeImports` escape hatch on the
    // hooks pattern: the two transport-shaped types the views legitimately need
    // (`CloudChatMessage`, `ConnectionState`) are re-exported from
    // `GovernanceAssistantPanel/types.ts`, which is outside the fence. A type
    // re-export erases at build time; an allowance would have to be trusted.
    //
    // Flat config replaces (does not merge) a rule's options, so the
    // `@hexagen/local-llm` ACL entry from the `features/**` block above is
    // repeated here — dropping it would silently exempt this directory from
    // ADR-0021.
    files: [
      "features/governance-assistant/GovernanceAssistantPanel/view/**/*.{ts,tsx}",
    ],
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
              // `no-restricted-imports` matches the import STRING, not the
              // resolved module, so every spelling has to be listed. tsconfig
              // maps `@/*` onto `app/*` among others, and the alias form is the
              // dominant idiom in `features/`. `wire*` rather than
              // `wire.client` because `app/lib/wire.ts` is a barrel that
              // re-exports it.
              group: [
                "**/wire",
                "**/wire.*",
                "@/lib/wire",
                "@/lib/wire.*",
                "**/adapters/*",
                "**/adapters/*/*",
              ],
              message:
                "REA-001: a governance view must not reach the client DI container or an adapter. Read it in GovernanceAssistantPanel and pass the result down as props.",
            },
            {
              group: [
                "**/local-llm-context",
                "**/vault-context",
                "@/lib/local-llm-context",
                "@/lib/vault-context",
              ],
              message:
                "REA-001: engine state and the secret vault are subscribed to once in GovernanceAssistantPanel. Take them as props (`lifecycle`, `vault`) instead of reading the context here.",
            },
            {
              group: [
                "**/lib/manifest-generation",
                "**/lib/manifest-generation/*",
                "@/lib/manifest-generation",
                "@/lib/manifest-generation/*",
              ],
              message:
                "REA-006: getCapabilities() runs once per panel mount, in useServerCapabilities. Take the names as the `capabilities` prop.",
            },
            {
              group: [
                "../../hooks/*",
                "../../../hooks/*",
                "**/governance-assistant/hooks/*",
                "@/governance-assistant/hooks/*",
              ],
              message:
                "REA-001: the governance-assistant hooks are transports (engine, cloud chat, capability probe, Q&A thread). They belong to the boundary; import the types you need from GovernanceAssistantPanel/types.",
            },
          ],
        },
      ],
    },
  },
  {
    // GOD-007 (item 8.6) — the plan-phase session directory. `usePlanningSession`
    // owned the proposer⇄critic loop, the layer-turn persistence, the session
    // control plane AND the finalize/distill view-model. The last of those is
    // now `usePlanningFinalize`, and `./distill` (prompt builder + fence
    // stripper) is its private collaborator.
    //
    // Fenced on the DIRECTORY rather than a file list, so a new module dropped
    // into `session/` inherits the constraint instead of quietly escaping it.
    // `usePlanningFinalize.ts` is the single exemption — it IS the distill's
    // owner. It lives here rather than in a test because a lint rule cannot be
    // satisfied by deleting an assertion; the companion type-level lock is the
    // `?: never` finalize surface on `UsePlanningSessionReturn`.
    //
    // Flat config REPLACES (does not merge) a rule's options, so the app-wide
    // `@hexagen/local-llm` ACL entry from the `features/**` block above is
    // repeated here — dropping it would silently exempt this directory from
    // ADR-0021.
    files: ["features/workspace-shell/plan-phase/session/**/*.{ts,tsx}"],
    ignores: [
      "features/workspace-shell/plan-phase/session/usePlanningFinalize.ts",
    ],
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
              // `no-restricted-imports` matches the import STRING, not the
              // resolved file, so every spelling of a target has to be listed.
              // `**/plan-phase/session/<mod>` is the load-bearing one: it covers
              // the deep-relative form AND every `@/…` alias depth. The
              // `@/*/plan-phase/session/<mod>` entry is a redundant belt (it
              // matches only the single-segment alias root). All five legal
              // spellings are pinned by
              // `__tests__/planning-session-finalize-fence.guard.test.ts` — do
              // not narrow this list without running it.
              group: [
                "./distill",
                "../distill",
                "**/plan-phase/session/distill",
                "@/*/plan-phase/session/distill",
                "./usePlanningFinalize",
                "../usePlanningFinalize",
                "**/plan-phase/session/usePlanningFinalize",
                "@/*/plan-phase/session/usePlanningFinalize",
              ],
              message:
                "GOD-007: the finalize/distill view-model belongs to usePlanningFinalize, not to the planning loop. Compose the two hooks at the plan host (PlanPhaseView) — the loop's only outbound seam is readSession + discardEpoch.",
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
              // Subsumed TODAY by the `@hexagen/local-llm` pattern below, which
              // bans the package outright. Kept anyway: that pattern enforces
              // HEX-003 (adapter construction belongs to wire.server) and this
              // entry enforces ADR-0021 (two @internal names). Different rules,
              // different owners, different reasons to change — dropping this
              // one would make the family's ADR-0021 standing depend on an
              // unrelated rule staying maximally broad.
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
            {
              // The pattern below fences `@hexagen/project-configuration/server`,
              // which is where `mergeSplitManifest` is exported from today. Name
              // it on the package ROOT as well so the ratchet survives a future
              // re-export from the root barrel — a barrel change must not
              // silently hand these handlers the manifest loader back.
              name: "@hexagen/project-configuration",
              importNames: ["mergeSplitManifest"],
              allowTypeImports: true,
              message:
                "Workspace discovery and manifest merging belong to a wire.server-provided adapter, not to an HTTP handler (HEX-034). Use getMergedManifestProvider().",
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
              // Flat config REPLACES `no-restricted-imports` rather than
              // merging it, so the app-wide @internal local-llm ACL above does
              // not apply to these files unless it is repeated here. Omitting
              // it silently exempts every governance route from ADR-0021.
              name: "@hexagen/local-llm",
              importNames: ["LLMMessage", "LocalLLMProviderPort"],
              allowTypeImports: true,
              message:
                'LLMMessage and LocalLLMProviderPort are @internal. Use SendStructuredRequestPort, ModelLifecyclePort, or LLMRequest["messages"] instead. See ADR 0021.',
            },
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
