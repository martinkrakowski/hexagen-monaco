import {
  projectConfigSchema,
  type ProjectConfig,
  type ExternalContext,
  type BoundedContext,
} from "@hexagen/project-configuration";

export const persistenceAdapterOptions = [
  "Prisma",
  "TypeORM",
  "Mongoose",
  "Drizzle",
] as const;
export const messagingAdapterOptions = [
  "BullMQ",
  "Temporal",
  "RabbitMQ",
] as const;
export const telemetryProviderOptions = [
  "None",
  "OpenTelemetry",
  "Prometheus",
  "Winston",
] as const;
export const apiFrameworkOptions = [
  { value: "nestjs", label: "NestJS" },
  { value: "express", label: "Express" },
  { value: "serverless", label: "Serverless" },
  { value: "plain-ts", label: "Plain TypeScript" },
] as const;

export const uiFrameworkOptions = [
  { value: "", label: "None (Headless / API Only)" },
  { value: "Next.js", label: "Next.js" },
  { value: "Remix", label: "Remix" },
  { value: "React Router", label: "React Router" },
  { value: "Vue.js", label: "Vue.js" },
  { value: "Angular", label: "Angular" },
] as const;

export const relationshipTypeOptions = [
  { value: "U", label: "Upstream" },
  { value: "D", label: "Downstream" },
  { value: "ACL", label: "Anticorruption Layer" },
  { value: "SK", label: "Shared Kernel" },
  { value: "P", label: "Partnership" },
  { value: "OHS", label: "Open Host Service" },
] as const;

export {
  projectConfigSchema,
  type ProjectConfig,
  type ExternalContext,
  type BoundedContext,
};

export const emptyFormValues: ProjectConfig = {
  withLlm: false,
  withBlockchain: false,
  workspaceScope: "@hexagen",
  governance: {
    workspaceName: "@hexagen",
    packageManager: "yarn",
    topologyStrictness: "flexible",
    namespacePrefix: "@hexagen",
    namingConventions: {
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".adapter.ts",
    },
  },
  boundedContexts: [
    {
      id: crypto.randomUUID(),
      name: "core",
      description: "",
      infrastructureTarget: "nestjs",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: {
        inboundPorts: [],
        outboundPorts: [],
      },
      uiFramework: "",
    },
  ],
  externalContexts: [],
  peerMappings: [],
};

export const projectAddons = [
  {
    id: "withLlm" as const,
    title: "LLM-Optimized Hexagonal Project",
    description: "Add-on for multi-LLM apps.",
  },
  {
    id: "withBlockchain" as const,
    title: "Blockchain-Optimized Hexagonal Project",
    description: "Add-on for multi-chain apps.",
  },
];

export const wizardSteps = [
  {
    id: "workspace_governance",
    title: "Workspace Governance",
    description: "Define workspace name, package manager, and topology.",
    fields: ["governance"],
  },
  {
    id: "bounded_contexts",
    title: "Bounded Contexts",
    description: "Add and configure bounded contexts for your project.",
    fields: ["boundedContexts"],
  },
  {
    id: "peer_mappings",
    title: "Peer Context Mappings",
    description: "Define how contexts interact with each other.",
    fields: ["peerMappings"],
  },
  {
    id: "ports_configuration",
    title: "Ports Configuration",
    description: "Configure inbound and outbound ports for each context.",
    fields: ["boundedContexts"],
  },
  {
    id: "project_addons",
    title: "Project Add-ons",
    description: "Enable optional features like LLM or blockchain support.",
    fields: ["withLlm", "withBlockchain"],
  },
];
