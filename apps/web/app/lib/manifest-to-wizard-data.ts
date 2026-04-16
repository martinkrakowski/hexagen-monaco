import type { WizardData } from "@hexagen/shared";

const IN_PORT_SUFFIX = ".in-port.ts";
const OUT_PORT_SUFFIX = ".out-port.ts";

type InboundPortType =
  | "rest-controller"
  | "graphql-resolver"
  | "event-listener"
  | "cli-command";
type OutboundPortType =
  | "relational-db"
  | "document-db"
  | "external-service-client"
  | "message-publisher";

const VALID_INBOUND: InboundPortType[] = [
  "rest-controller",
  "graphql-resolver",
  "event-listener",
  "cli-command",
];
const VALID_OUTBOUND: OutboundPortType[] = [
  "relational-db",
  "document-db",
  "external-service-client",
  "message-publisher",
];

function stripPortSuffix(filename: string): string {
  if (filename.endsWith(IN_PORT_SUFFIX)) {
    return filename.slice(0, -IN_PORT_SUFFIX.length);
  }
  if (filename.endsWith(OUT_PORT_SUFFIX)) {
    return filename.slice(0, -OUT_PORT_SUFFIX.length);
  }
  return filename;
}

interface ManifestBoundedContext {
  name: string;
  type?: string;
  description?: string;
  depends_on?: string[];
  layers?: {
    domain?: {
      entities?: string[];
      value_objects?: string[];
      domain_events?: string[];
    };
    application?: {
      use_cases?: string[];
      ports?: {
        in?: string[];
        out?: string[];
      };
    };
    infrastructure?: {
      adapters?: string[];
    };
  };
}

interface ManifestApp {
  name: string;
  type?: string;
  depends_on?: string[];
}

interface Manifest {
  system?: string;
  scope?: string;
  workspaceTemplate?: string;
  bounded_contexts?: ManifestBoundedContext[];
  apps?: ManifestApp[];
  monorepo?: Record<string, unknown>;
}

function isStrictManifest(template: string | undefined): boolean {
  return template === "strict-enterprise" || template === "micro-frontend";
}

function rebuildPeerMappings(
  contexts: ManifestBoundedContext[],
  template?: string,
): WizardData["peerMappings"] {
  const mappings: NonNullable<WizardData["peerMappings"]> = [];
  const nameToId = new Map<string, string>();

  for (const ctx of contexts) {
    nameToId.set(ctx.name, crypto.randomUUID());
  }

  // For strict templates depends_on contains only "shared" — there are no
  // peer package imports to reconstruct as peer mappings.
  if (isStrictManifest(template)) return mappings;

  for (const ctx of contexts) {
    if (!ctx.depends_on) continue;
    for (const dep of ctx.depends_on) {
      if (dep === "shared") continue;
      if (!nameToId.has(dep)) continue;
      mappings.push({
        consumerContext: nameToId.get(ctx.name)!,
        providerContext: nameToId.get(dep)!,
        integrationPattern: "open-host",
        communicationBoundary: "in-process",
      });
    }
  }

  return mappings;
}

export function manifestToWizardData(manifest: Manifest): WizardData {
  const rawContexts = manifest.bounded_contexts || [];
  const rawApps = manifest.apps || [];
  const template = manifest.workspaceTemplate || "modular-monolith";

  const nameToId = new Map<string, string>();
  for (const ctx of rawContexts) {
    nameToId.set(ctx.name, crypto.randomUUID());
  }

  const boundedContexts = rawContexts
    .filter((bc) => bc.name !== "shared")
    .map((bc) => ({
      id: nameToId.get(bc.name)!,
      name: bc.name,
      description: bc.description || "",
      infrastructureTarget: "nestjs" as const,
      coreDomainEntities: bc.layers?.domain?.entities || [],
      valueObjects: bc.layers?.domain?.value_objects || [],
      domainEvents: bc.layers?.domain?.domain_events || [],
      useCases: bc.layers?.application?.use_cases || [],
      portConfiguration: {
        inboundPorts: (bc.layers?.application?.ports?.in || [])
          .map(stripPortSuffix)
          .filter((p): p is InboundPortType =>
            VALID_INBOUND.includes(p as InboundPortType),
          ),
        outboundPorts: (bc.layers?.application?.ports?.out || [])
          .map(stripPortSuffix)
          .filter((p): p is OutboundPortType =>
            VALID_OUTBOUND.includes(p as OutboundPortType),
          ),
      },
      uiFramework: "Next.js" as const,
      apiFramework: "Express" as const,
      persistenceAdapter: "Prisma" as const,
      messagingAdapter: "BullMQ" as const,
      telemetryProvider: "None" as const,
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
    }));

  const externalContexts = rawApps.map((app) => ({
    id: crypto.randomUUID(),
    name: app.name,
    relationshipType: "U" as const,
    isEventDriven: false,
    entityNames: [],
    useCaseNames: [],
    publishedEvents: [],
    subscribedEvents: [],
  }));

  return {
    boundedContexts,
    externalContexts,
    peerMappings: rebuildPeerMappings(rawContexts, template),
    governance: {
      workspaceName: manifest.scope || manifest.system || "@hexagen",
      workspaceTemplate:
        template as WizardData["governance"]["workspaceTemplate"],
      workspaceDescription: undefined,
      packageManager: "yarn",
      topologyStrictness: isStrictManifest(template) ? "strict" : "flexible",
      namespacePrefix: manifest.scope || "@hexagen",
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
  };
}
