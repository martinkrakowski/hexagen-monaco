import type { WizardData, BoundedContext } from "@hexagen/shared";
import type { Manifest } from "@hexagen/sync";

const getInboundPortName = (type: string) => `${type}.in-port.ts`;
const getOutboundPortName = (type: string) => `${type}.out-port.ts`;
const getAdapterName = (type: string) => `${type}.adapter.ts`;

// Framework derivation for the manifest `apps[]` section.
// Reused by `wizardToManifest` to satisfy Wave 4 of the unified-scaffolding
// plan (`docs/sync-engine-unified-scaffolding-plan.md` §Sub-agent 4b).
//
// Only `"next.js"`, `"fastify"`, and `"plain-ts"` have built-in generator
// fallbacks (`packages/sync/src/generators/apps.ts`
// `BUILTIN_FRAMEWORK_TEMPLATES`); `"express"` entries with no manifest
// template are skipped by the generator. Wizard choices not covered by those
// three are therefore mapped to `"plain-ts"` so the generator always emits a
// buildable scaffold for every app it sees.
type AppEntryFramework = NonNullable<
  NonNullable<Manifest["apps"]>[number]["framework"]
>;

function mapUiFramework(ui: BoundedContext["uiFramework"]): AppEntryFramework {
  return ui === "Next.js" ? "next.js" : "plain-ts";
}

function mapApiFramework(
  api: BoundedContext["apiFramework"],
): AppEntryFramework {
  if (api === "Fastify") return "fastify";
  // Express and NestJS have no built-in template in the generator; fall
  // through to plain-ts so the app is scaffolded rather than skipped.
  return "plain-ts";
}

/**
 * Pick a single framework to represent all of `apps[].web` (or `.api`) across
 * multiple bounded contexts. Preference order mirrors the generator's
 * built-in fallbacks, preferring the most specific framework that any context
 * requested. Ties are broken deterministically by the order below.
 */
function pickPreferredFramework(
  frameworks: readonly AppEntryFramework[],
  preferenceOrder: readonly AppEntryFramework[],
): AppEntryFramework {
  for (const candidate of preferenceOrder) {
    if (frameworks.includes(candidate)) return candidate;
  }
  // `frameworks` is always non-empty at call sites, so this is unreachable;
  // fall back to plain-ts for total safety rather than throwing.
  return "plain-ts";
}

export function wizardToManifest(
  wizardData: WizardData,
): Record<string, unknown> {
  const governance = wizardData.governance;
  const systemName = governance?.workspaceName || "hexagen-project";
  const namespace = governance?.namespacePrefix || "@hexagen";
  const template = governance?.workspaceTemplate || "modular-monolith";
  const packageManagerId = governance?.packageManager || "yarn";
  const isStrictTemplate =
    template === "strict-enterprise" || template === "micro-frontend";

  // Each package manager has its own versioning — do not append yarn's version
  const packageManagerVersions: Record<string, string> = {
    yarn: "yarn@4.12.0",
    pnpm: "pnpm@9.0.0",
    bun: "bun@1.1.0",
  };
  const packageManager =
    packageManagerVersions[packageManagerId] ?? packageManagerId;

  const boundedContexts = wizardData.boundedContexts
    ? [...wizardData.boundedContexts]
    : [];

  // Enforce Shared Context
  const hasShared = boundedContexts.some(
    (bc) => bc.name.toLowerCase() === "shared",
  );
  if (!hasShared) {
    boundedContexts.unshift({
      id: "shared-auto",
      name: "shared",
      description: "Shared primitives, custom errors, base classes, utilities",
      infrastructureTarget: "plain-ts",
      coreDomainEntities: [],
      valueObjects: ["CustomError", "Identifier"],
      domainEvents: [],
      useCases: [],
      portConfiguration: { inboundPorts: [], outboundPorts: [] },
      apiFramework: "Express",
      uiFramework: "Next.js",
      persistenceAdapter: "Prisma",
      messagingAdapter: "BullMQ",
      telemetryProvider: "None",
      externalApiPorts: [],
      llmProviders: [],
      blockchainNetworks: [],
      authenticationProvider: "",
      emailService: "",
      paymentGateway: "",
      storageProvider: "",
      searchService: "",
      webhookEndpoints: [],
      publishedEvents: [],
      subscribedEvents: [],
    } as unknown as WizardData["boundedContexts"] extends (infer T)[]
      ? T
      : never);
  }

  return {
    system: systemName,
    scope: namespace,
    architecture: template,
    workspaceTemplate: template,
    monorepo: {
      packageManager,
      linker: "node-modules",
      buildTool: "turbo",
      workspaces: ["apps/*", "packages/*"],
      workspaceDefaults: {
        tsConfig: {
          extends: "../../tsconfig.base.json",
          compilerOptions: {
            rootDir: "src",
            outDir: "dist",
            composite: true,
            declaration: true,
            emitDeclarationOnly: true,
            declarationMap: true,
            tsBuildInfoFile: "./dist/.tsbuildinfo",
          },
        },
        packageJson: {
          scripts: {
            build: "tsc",
            lint: "eslint src --ext .ts,.tsx",
            typecheck: "tsc --noEmit",
          },
          devDependencies: {
            typescript: "^5.5.4",
            eslint: "^9.0.0",
            "@typescript-eslint/parser": "^8.0.0",
            "@typescript-eslint/eslint-plugin": "^8.0.0",
          },
        },
      },
      turboConfig: {
        globalDependencies: ["**/.env.*"],
        pipeline: {
          build: { dependsOn: ["^build"], outputs: ["dist/**"] },
          lint: { dependsOn: ["^build"] },
          test: { dependsOn: ["^build"] },
          typecheck: { outputs: [], cache: true },
        },
      },
    },
    generator: {
      version: "0.2.0",
      sync: {
        idempotent: true,
        createOnlyIfMissing: true,
        nonDestructive: true,
        layers: {
          domain: {
            folder: "src/domain",
            subfolders: ["entities", "value_objects"],
          },
          application: {
            folder: "src/application",
            subfolders: ["use-cases", "ports/in", "ports/out"],
          },
          infrastructure: {
            folder: "src/infrastructure",
            subfolders: ["adapters"],
          },
        },
        packageJson: {
          mergeStrategy: "preserveExisting",
          injectIfMissing: {
            scripts: {
              build: "tsc",
              lint: "eslint src --ext .ts,.tsx",
              typecheck: "tsc --noEmit",
            },
          },
        },
        // Stub generation is required for UI-generated projects — they start
        // from zero and need `@generated` entity/VO/port/adapter/use-case
        // stubs so every barrel has something to re-export. Templates and
        // naming conventions fall through to the generator's built-in
        // defaults (`generateStubs`); the UI does not customise those.
        // See `docs/sync-engine-unified-scaffolding-plan.md` §Sub-agent 4b.
        stubs: { enabled: true },
        // Apps generation is also required for UI-generated projects. The
        // generator is opt-in by design (self-regen of monorepos with
        // hand-written apps like hexagen-monaco must leave it disabled) —
        // the UI explicitly opts in because it always generates app
        // scaffolding from scratch into a fresh target directory.
        apps: { enabled: true },
      },
    },
    apps: deriveApps(boundedContexts),
    bounded_contexts: boundedContexts.map((bc) => {
      const isShared = bc.name.toLowerCase().includes("shared");

      const inPorts = (bc.portConfiguration?.inboundPorts || []).map(
        getInboundPortName,
      );
      const outPorts = (bc.portConfiguration?.outboundPorts || []).map(
        getOutboundPortName,
      );
      const adapters = [
        ...(bc.persistenceAdapter
          ? [getAdapterName(bc.persistenceAdapter)]
          : []),
        ...(bc.messagingAdapter ? [getAdapterName(bc.messagingAdapter)] : []),
      ];

      const dependsOn = new Set<string>();
      if (!isShared) dependsOn.add("shared");

      // For strict templates (strict-enterprise, micro-frontend), peer context
      // dependencies are NOT added to depends_on. Cross-context communication
      // must go through event-bus or network boundaries, not direct imports.
      if (!isStrictTemplate) {
        wizardData.peerMappings
          ?.filter((m) => m.consumerContext === bc.id)
          ?.forEach((m) => {
            const provider = boundedContexts.find(
              (p) => p.id === m.providerContext,
            );
            if (provider) dependsOn.add(provider.name);
          });
      }

      return {
        name: bc.name,
        type: isShared ? "shared-kernel" : "core",
        description: bc.description || "",
        depends_on: Array.from(dependsOn),
        uiFramework: bc.uiFramework || "Next.js",
        apiFramework: bc.apiFramework || "Express",
        layers: {
          domain: {
            entities: bc.coreDomainEntities || [],
            value_objects: bc.valueObjects || [],
            domain_services: [],
          },
          application: {
            use_cases: bc.useCases || [],
            ports: { in: inPorts, out: outPorts },
          },
          infrastructure: {
            adapters: adapters,
          },
        },
      };
    }),
  };
}

/**
 * Derive the manifest `apps[]` array from the wizard's per-BC framework
 * choices. Produces at most two apps — a `web` and an `api` — aggregating
 * every non-shared bounded context as a dependency, so the generator knows
 * which packages each app may import.
 *
 * Returns `[]` when there are no non-shared bounded contexts; callers should
 * keep the key present (not absent) so downstream schema validation sees an
 * explicit empty list.
 *
 * Output is deterministic: `depends_on` is sorted, and apps appear in a
 * fixed `web`-then-`api` order.
 */
function deriveApps(
  boundedContexts: readonly BoundedContext[],
): NonNullable<Manifest["apps"]> {
  const nonShared = boundedContexts.filter(
    (bc) => !bc.name.toLowerCase().includes("shared"),
  );
  if (nonShared.length === 0) return [];

  const dependsOn = [...new Set(nonShared.map((bc) => bc.name))].sort();

  const uiFrameworks = nonShared.map((bc) => mapUiFramework(bc.uiFramework));
  const apiFrameworks = nonShared.map((bc) => mapApiFramework(bc.apiFramework));

  // Preference order places frameworks with built-in generator templates
  // ahead of `plain-ts`, so a project mixing Next.js and Remix contexts
  // still emits a Next.js web app (template available) rather than
  // degrading to plain-ts.
  const webFramework = pickPreferredFramework(uiFrameworks, [
    "next.js",
    "plain-ts",
  ]);
  const apiFramework = pickPreferredFramework(apiFrameworks, [
    "fastify",
    "plain-ts",
  ]);

  return [
    { name: "web", framework: webFramework, depends_on: dependsOn },
    { name: "api", framework: apiFramework, depends_on: dependsOn },
  ];
}
