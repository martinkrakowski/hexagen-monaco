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
  { value: "nitro", label: "Nitro" },
  { value: "nestjs", label: "NestJS" },
  { value: "express", label: "Express" },
  { value: "serverless", label: "Serverless" },
  { value: "plain-ts", label: "Plain TypeScript" },
  // No separate API backend (UI-only). deriveApps emits no `api` app.
  { value: "none", label: "None (No API backend)" },
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
  governance: {
    workspaceName: "@hexagen",
    workspaceTemplate: "modular-monolith",
    workspaceDescription: undefined,
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
      infrastructureTarget: "nitro",
      coreDomainEntities: [],
      valueObjects: [],
      domainEvents: [],
      entities: [],
      useCases: [],
      portConfiguration: {
        inboundPorts: [],
        outboundPorts: [],
      },
      // ADR-0041 single-app preset: a fresh project defaults to one Next.js web
      // app. The Applications step fans this out across contexts; a loaded
      // headless project (all uiFramework "") is preserved, not flipped.
      uiFramework: "Next.js",
      persistenceAdapter: "",
      messagingAdapter: "",
      telemetryProvider: "",
    },
  ],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
};

export const wizardSteps = [
  {
    id: "workspace_governance",
    title: "Workspace Governance",
    description: "Define workspace name, package manager, and topology.",
    fields: ["governance"],
  },
  {
    // ADR-0041: project-level Applications (UI framework + API backend), placed
    // before Bounded Contexts so the choice frames domain modelling and new
    // contexts inherit it at creation. Writes the per-context fields via fan-out.
    id: "applications",
    title: "Applications",
    description: "Choose the UI framework and API backend for your project.",
    fields: ["boundedContexts"],
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
    id: "add_ons",
    title: "Add-On Templates",
    description: "Select production add-ons to apply after project generation.",
    fields: [],
  },
  {
    id: "template_questions",
    title: "Template Questions",
    description:
      "Answer the questions for the add-on templates you selected. Skipped automatically when no template needs answers.",
    fields: ["addOnsAnswers"],
  },
  {
    id: "summary",
    title: "Project Summary",
    description: "Review your project configuration.",
    fields: [],
  },
];

/**
 * Resolve a wizard step's index by its stable `id`. Step-index-dependent logic
 * (validation gates, navigation side effects, the router) looks steps up by id
 * rather than hardcoding numeric positions, so inserting/reordering a step (e.g.
 * the ADR-0041 Applications step) can't silently shift those checks.
 */
export function stepIndexById(id: string): number {
  return wizardSteps.findIndex((step) => step.id === id);
}
