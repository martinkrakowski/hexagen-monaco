import type {
  WizardData,
  BoundedContext,
} from "@hexagen/project-configuration";
import {
  getWorkspaceTemplate,
  FALLBACK_RULES,
  CURRENT_MANIFEST_SCHEMA_VERSION,
} from "@hexagen/project-configuration";
import type { Manifest } from "@hexagen/sync";

const getInboundPortName = (type: string) => `${type}.in-port.ts`;
const getOutboundPortName = (type: string) => `${type}.out-port.ts`;
const getAdapterName = (type: string) => `${type}.adapter.ts`;

// Framework derivation for the manifest `apps[]` section.
//
// Each wizard selection maps to a framework with a built-in generator template
// (`packages/sync/src/generators/apps-framework-templates.ts`
// `BUILTIN_FRAMEWORK_TEMPLATES`); an unrecognised value maps to `"plain-ts"` so
// the generator still emits a buildable scaffold.
type AppEntryFramework = NonNullable<
  NonNullable<Manifest["apps"]>[number]["framework"]
>;

function mapUiFramework(ui: BoundedContext["uiFramework"]): AppEntryFramework {
  switch (ui) {
    case "Next.js":
      return "next.js";
    case "Vue.js":
      return "vue";
    case "React Router":
      return "react-router";
    case "Remix":
      return "remix";
    case "Angular":
      return "angular";
    default:
      return "plain-ts";
  }
}

/**
 * The API app framework for a bounded context. The step-1 `infrastructureTarget`
 * selector wins — each value with a built-in generator template
 * (nitro/nestjs/express/serverless) maps straight to it; `"plain-ts"` (and any
 * future value without a template) falls through to the plain-ts scaffold. For
 * legacy/imported manifests that only set the older `apiFramework` field,
 * `"Fastify"` still maps to the fastify template.
 *
 * `deriveApps` reads `infrastructureTarget` (the live selector); the legacy
 * `apiFramework` is only a fallback for manifests that predate it.
 */
function frameworkForContext(bc: BoundedContext): AppEntryFramework {
  // infrastructureTarget wins when set. A value MUST NOT be silently overridden
  // by a legacy apiFramework — unknown/"none" values fall through to plain-ts.
  switch (bc.infrastructureTarget) {
    case "nitro":
      return "nitro";
    case "nestjs":
      return "nestjs";
    case "express":
      return "express";
    case "serverless":
      return "serverless";
    case "plain-ts":
      return "plain-ts";
  }
  // infrastructureTarget is SET but unrecognised (wizard input is shape-filtered,
  // not enum-validated) → plain-ts; it must NOT be overridden by a legacy
  // apiFramework. The apiFramework fallback applies only when infra is ABSENT.
  if (bc.infrastructureTarget) return "plain-ts";
  // Legacy/imported manifests that predate infrastructureTarget carry only the
  // older apiFramework field (enum: Fastify | Express | NestJS) — map each to its
  // now-first-class framework so saved data doesn't degrade to plain-ts.
  switch (bc.apiFramework) {
    case "Fastify":
      return "fastify";
    case "Express":
      return "express";
    case "NestJS":
      return "nestjs";
  }
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

interface CrossContextEdgeBase {
  consumer: string;
  provider: string;
  integrationPattern: "open-host" | "acl";
}
/**
 * A cross-context transport edge, discriminated on `transport`:
 * - `event-bus` (Phase 3a) carries the provider's `events` (Decision D1);
 * - `network` (Phase 3b) carries the provider's `operations` (Decision E1).
 * The dedicated `generateCrossContext` emitter dispatches on `transport`.
 */
type CrossContextEdge =
  | (CrossContextEdgeBase & { transport: "event-bus"; events: string[] })
  | (CrossContextEdgeBase & { transport: "network"; operations: string[] });

/** PascalCase a string into a valid TS identifier (split on non-alphanumerics). */
function toPascalCase(value: string): string {
  const pascal = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  // These names become generated contract/symbol names, so they must be valid TS
  // identifiers. PascalCasing can still start with a digit ("123-billing" ->
  // "123Billing"); prefix so the emitted declaration compiles. Return "" for no
  // tokens so the caller's `|| "Context"` fallback still applies. (The emitter
  // also validates identifiers as defense-in-depth for hand-crafted manifests.)
  if (pascal.length === 0) return "";
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `Context${pascal}`;
}

/**
 * Event-contract names a provider publishes (Decision D1): its declared
 * `domainEvents` (PascalCased verbatim, deduped), or a single `${Provider}Event`
 * fallback derived from the provider context name only when none are declared.
 */
function eventContractsFor(provider: BoundedContext): string[] {
  const declared = [
    ...new Set(
      (provider.domainEvents || [])
        .map(toPascalCase)
        .filter((e) => e.length > 0),
    ),
  ];
  if (declared.length > 0) return declared;
  return [`${toPascalCase(provider.name) || "Context"}Event`];
}

/**
 * Operation-contract base names a provider exposes over the network (Decision
 * E1): its declared `useCases` (PascalCased verbatim, deduped) — each yielding a
 * `<Op>Request`/`<Op>Response` DTO pair and an `<opCamel>` controller/client
 * method — or a single fallback base derived from the provider context name only
 * (`${Provider}` → `${Provider}Request`/`${Provider}Response`) when none are
 * declared. The network analog of `eventContractsFor`; the emitter appends
 * Request/Response and derives the method name from each base.
 */
function operationContractsFor(provider: BoundedContext): string[] {
  const declared = [
    ...new Set(
      (provider.useCases || []).map(toPascalCase).filter((o) => o.length > 0),
    ),
  ];
  if (declared.length > 0) return declared;
  return [toPascalCase(provider.name) || "Context"];
}

/**
 * Phase 3 — for a strict template, materialize cross-context transport from the
 * wizard's peer mappings, one edge per mapping (consumer → provider). The
 * transport ports/adapters/contracts are written by the dedicated
 * `generateCrossContext` emitter (the SOLE writer — declaring them in the manifest
 * layers would let `generateStubs` clobber the bespoke content under the web
 * flow's `forceRoot`); these edges only describe what to emit.
 *
 * - **`event-bus`** (Phase 3a): the PROVIDER publishes its domain events
 *   (`message-publisher` out-port + adapter), the CONSUMER subscribes
 *   (`event-listener` in-port + adapter). The contract is the provider's events
 *   (Decision D1), so the provider is the publisher.
 * - **`network`** (Phase 3b): the PROVIDER exposes a `rest-controller` in-port,
 *   the CONSUMER calls it via an `external-service-client` out-port. The
 *   operations are the provider's use-cases (Decision E1).
 *
 * Empty for `in-process` (modular-monolith), so that output stays unchanged.
 */
function deriveCrossContextEdges(
  boundedContexts: readonly BoundedContext[],
  peerMappings: ReadonlyArray<{
    consumerContext?: string;
    providerContext?: string;
    integrationPattern?: string;
  }>,
  crossContextCalls: string,
): CrossContextEdge[] {
  if (crossContextCalls !== "event-bus" && crossContextCalls !== "network")
    return [];

  const byId = new Map(boundedContexts.map((bc) => [bc.id, bc] as const));
  const edges: CrossContextEdge[] = [];
  for (const m of peerMappings) {
    const consumer = m.consumerContext
      ? byId.get(m.consumerContext)
      : undefined;
    const provider = m.providerContext
      ? byId.get(m.providerContext)
      : undefined;
    if (!consumer || !provider || consumer.id === provider.id) continue;
    const integrationPattern =
      m.integrationPattern === "acl" ? "acl" : "open-host";
    if (crossContextCalls === "network") {
      edges.push({
        consumer: consumer.name,
        provider: provider.name,
        transport: "network",
        operations: operationContractsFor(provider),
        integrationPattern,
      });
    } else {
      edges.push({
        consumer: consumer.name,
        provider: provider.name,
        transport: "event-bus",
        events: eventContractsFor(provider),
        integrationPattern,
      });
    }
  }
  return edges;
}

export function wizardToManifest(
  wizardData: WizardData,
): Record<string, unknown> {
  const governance = wizardData.governance;
  const systemName = governance?.workspaceName || "hexagen-project";
  const namespace = governance?.namespacePrefix || "@hexagen";
  const template = governance?.workspaceTemplate || "modular-monolith";
  const packageManagerId = governance?.packageManager || "yarn";
  // Drive behaviour off the template's *rules*, not a hardcoded id list, so the
  // catalog (@hexagen/project-configuration) stays the single source of truth and
  // a new template needs no edit here. An unknown id — a drifted/legacy saved
  // project, preserved verbatim at the IDB load perimeter — degrades to the
  // flexible fallback rather than throwing. See
  // docs/planning/wire-architectural-template-into-generation.md (Phase 1).
  const templateRules = getWorkspaceTemplate(template)?.rules ?? FALLBACK_RULES;
  // Strict modes route cross-context calls through a boundary (event-bus or
  // network) instead of direct imports, so peer dependencies are omitted from
  // depends_on below.
  const isStrictTemplate = templateRules.crossContextCalls !== "in-process";

  // Each package manager has its own versioning — do not append yarn's version
  const packageManagerVersions: Record<string, string> = {
    yarn: "yarn@4.12.0",
    pnpm: "pnpm@9.0.0",
    bun: "bun@1.1.0",
  };
  const packageManager =
    packageManagerVersions[packageManagerId] ?? packageManagerId;

  // Defensive: a drifted/corrupt saved project (Path 4 preserves these verbatim
  // at the IDB load perimeter) can carry a non-array `boundedContexts`, or entries
  // without a string `name`. A manifest can't be built from those, and
  // `bc.name.toLowerCase()` below would throw → a 500 export. Coerce to a clean
  // array of named contexts; the raw data stays in formState for the form to
  // surface/fix — we just don't crash generation/export.
  const rawBoundedContexts = (wizardData as { boundedContexts?: unknown })
    .boundedContexts;
  const boundedContexts: BoundedContext[] = (
    Array.isArray(rawBoundedContexts) ? rawBoundedContexts : []
  ).filter(
    (bc): bc is BoundedContext =>
      !!bc &&
      typeof bc === "object" &&
      typeof (bc as { name?: unknown }).name === "string",
  );

  // Same defensive coercion for peerMappings (wired into depends_on below): a
  // non-array value would throw on `.filter`, a non-object entry on member access.
  const rawPeerMappings = (wizardData as { peerMappings?: unknown })
    .peerMappings;
  const peerMappings = (
    Array.isArray(rawPeerMappings) ? rawPeerMappings : []
  ).filter(
    (m): m is NonNullable<WizardData["peerMappings"]>[number] =>
      !!m && typeof m === "object",
  );

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

  const crossContext = deriveCrossContextEdges(
    boundedContexts,
    peerMappings,
    templateRules.crossContextCalls,
  );

  return {
    // Every newly scaffolded manifest is stamped at birth (PR-C1) so readers
    // can tell "written by a newer toolchain" from "malformed". First key →
    // first line of the dumped YAML.
    schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    system: systemName,
    scope: namespace,
    architecture: template,
    workspaceTemplate: template,
    // Cross-context transport edges (event-bus or network) for the dedicated
    // transport emitter. Omitted when empty so in-process (modular-monolith)
    // output stays byte-identical.
    ...(crossContext.length > 0 ? { cross_context: crossContext } : {}),
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
    apps: deriveApps(boundedContexts, templateRules.allowSharedUi),
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

      // For strict templates (those whose cross-context calls route through a
      // boundary rather than direct imports), peer context dependencies are NOT
      // added to depends_on — cross-context communication goes through the
      // event-bus or network boundary instead.
      if (!isStrictTemplate) {
        peerMappings
          .filter((m) => m.consumerContext === bc.id)
          .forEach((m) => {
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
 * Slugify a bounded-context name into a filesystem-safe app-directory suffix
 * (`[a-z0-9-]`, collapsing other runs to `-` and trimming). Per-context UI apps
 * live at `apps/web-<slug>`, so the suffix must be path-safe and deterministic —
 * a context name with spaces, separators, or `..` can't produce an unsafe app
 * directory. `@hexagen/sync`'s `generateApps` independently guards against
 * traversal (defense-in-depth); slugifying here keeps the wizard's own output
 * clean. `depends_on` still references the real context/package name, not the slug.
 */
function slugifyContextName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "app";
}

/**
 * Derive the manifest `apps[]` array from the wizard's per-BC framework
 * choices, honouring the template's `allowSharedUi` rule.
 *
 * - `allowSharedUi: true` (flexible templates): a single shared `web` app plus
 *   one `api`, each aggregating every non-shared bounded context as a
 *   dependency — the historical behaviour.
 * - `allowSharedUi: false` (strict templates): one isolated `web-<context>` app
 *   per UI-bearing context (each depending only on its own context), plus the
 *   single aggregated `api`. This makes "UI isolated per context" a real,
 *   visible difference in the generated workspace. See
 *   docs/planning/wire-architectural-template-into-generation.md (Phase 2).
 *
 * Returns `[]` when there are no non-shared bounded contexts; callers keep the
 * key present (not absent) so downstream schema validation sees an explicit
 * empty list.
 *
 * Output is deterministic: `depends_on` is sorted and apps appear in a fixed
 * order (`web`/`web-*` first, then `api`).
 */
function deriveApps(
  boundedContexts: readonly BoundedContext[],
  allowSharedUi: boolean,
): NonNullable<Manifest["apps"]> {
  const nonShared = boundedContexts.filter(
    (bc) => !bc.name.toLowerCase().includes("shared"),
  );
  if (nonShared.length === 0) return [];

  const dependsOn = [...new Set(nonShared.map((bc) => bc.name))].sort();
  // A single aggregated `api` app is emitted under both UI rules — Phase 2
  // isolates only the UI surface, not the API — UNLESS the project opted out of
  // an API backend (every non-shared context has `infrastructureTarget: "none"`,
  // a UI-only project), in which case no `api` app is emitted. Opted-out contexts
  // don't influence the chosen api framework. Preference order is
  // most-specific-first, so if any remaining context picks Nitro the aggregated
  // app is Nitro (then fastify, then the plain-ts fallback).
  //
  // `depends_on` intentionally stays the FULL `dependsOn` (every non-shared
  // context, including `"none"` opt-outs): the single aggregated api serves the
  // whole domain, so a context opting out of its own api hosting does not drop
  // its domain from the backend's dependency graph — only whether/which api app
  // is emitted depends on the opt-out.
  const apiBearing = nonShared.filter(
    (bc) => bc.infrastructureTarget !== "none",
  );
  const apiApp =
    apiBearing.length > 0
      ? {
          name: "api",
          framework: pickPreferredFramework(
            apiBearing.map(frameworkForContext),
            ["nitro", "nestjs", "fastify", "express", "serverless", "plain-ts"],
          ),
          depends_on: dependsOn,
        }
      : null;

  if (!allowSharedUi) {
    // Isolated: one web app per UI-bearing context, each depending only on its
    // own context. Headless contexts (no `uiFramework`) get no web app.
    //
    // Distinct context names can slugify to the same value ("Orders!" / "Orders?"
    // -> "orders"; any name without [a-z0-9] -> "app"), so disambiguate with a
    // deterministic numeric suffix. The generator first-wins-dedupes by app name
    // and would otherwise silently drop a colliding context's app. Suffixes are
    // assigned in context order, then sorted by name for deterministic output.
    const usedNames = new Set<string>();
    const webApps = nonShared
      .filter((bc) => Boolean(bc.uiFramework))
      .map((bc) => {
        const base = `web-${slugifyContextName(bc.name)}`;
        let name = base;
        for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}`;
        usedNames.add(name);
        return {
          name,
          framework: mapUiFramework(bc.uiFramework),
          depends_on: [bc.name],
        };
      })
      // Codepoint comparison (not locale-sensitive `localeCompare`) keeps the
      // ordering deterministic across environments, matching the default `.sort()`
      // used for `depends_on`.
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return apiApp ? [...webApps, apiApp] : webApps;
  }

  // Shared: a single `web` app aggregating every non-shared context. Preference
  // order places frameworks with built-in generator templates ahead of
  // `plain-ts`, so a project mixing Next.js and Remix contexts still emits a
  // Next.js web app rather than degrading to plain-ts.
  const uiFrameworks = nonShared.map((bc) => mapUiFramework(bc.uiFramework));
  const webApp = {
    name: "web",
    framework: pickPreferredFramework(uiFrameworks, [
      "next.js",
      "react-router",
      "remix",
      "vue",
      "angular",
      "plain-ts",
    ]),
    depends_on: dependsOn,
  };
  return apiApp ? [webApp, apiApp] : [webApp];
}
