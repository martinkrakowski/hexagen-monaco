import type { WizardData } from "@hexagen/shared";

const getInboundPortName = (type: string) => `${type}.in-port.ts`;
const getOutboundPortName = (type: string) => `${type}.out-port.ts`;
const getAdapterName = (type: string) => `${type}.adapter.ts`;

export function wizardToManifest(
  wizardData: WizardData,
): Record<string, unknown> {
  const systemName = wizardData.workspaceScope || "hexagen-project";

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
    scope: systemName,
    architecture: "modular-monolith",
    monorepo: {
      packageManager: "yarn@4.12.0",
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
      },
    },
    apps:
      wizardData.externalContexts?.map((ext) => ({
        name: ext.name,
        type: "web",
        depends_on:
          wizardData.peerMappings
            ?.filter((m) => m.consumerContext === ext.id)
            ?.map((m) => m.providerContext) || [],
      })) || [],
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

      wizardData.peerMappings
        ?.filter((m) => m.consumerContext === bc.id)
        ?.forEach((m) => {
          const provider = boundedContexts.find(
            (p) => p.id === m.providerContext,
          );
          if (provider) dependsOn.add(provider.name);
        });

      return {
        name: bc.name,
        type: isShared ? "shared-kernel" : "core",
        description: bc.description || "",
        depends_on: Array.from(dependsOn),
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
