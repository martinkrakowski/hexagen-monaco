import {
  projectConfigSchema,
  type ProjectConfig,
  type ExternalContextInput,
  type BoundedContextInput,
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
  "OpenTelemetry",
  "Prometheus",
  "Winston",
] as const;
export const apiFrameworkOptions = ["NestJS", "Fastify", "Express"] as const;
export const uiFrameworkOptions = [
  "Next.js",
  "Remix",
  "React Router",
  "Vue.js",
  "Angular",
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
  type ExternalContextInput,
  type BoundedContextInput,
};

export const emptyFormValues: ProjectConfig = {
  withLlm: false,
  withBlockchain: false,
  workspaceScope: "@hexagen",
  boundedContexts: [{ id: crypto.randomUUID(), name: "core" }],
  externalContexts: [],
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
    id: "project_type",
    title: "Project Type",
    description: "Start with a general-purpose project.",
    fields: ["withLlm", "withBlockchain"],
  },
  {
    id: "workspace",
    title: "Workspace",
    description: "Define workspace scope, bounded contexts, and peer contexts.",
    fields: ["workspaceScope", "boundedContexts", "externalContexts"],
  },
  {
    id: "infrastructure_config",
    title: "Infrastructure Configuration",
    description:
      "Configure infrastructure for the active context (API, persistence, messaging).",
    fields: ["boundedContexts"],
  },
  {
    id: "domain_config",
    title: "Domain Configuration",
    description: "Define entities and use cases for the active context.",
    fields: ["boundedContexts"],
  },
];
