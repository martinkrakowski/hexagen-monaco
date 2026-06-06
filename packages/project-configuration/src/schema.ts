import { z } from "zod";

import type {
  WorkspaceTemplateId,
  WorkspaceTemplate,
  WorkspaceTemplateRule,
} from "./domain/model/workspace-templates/workspace-templates.js";

export type { WorkspaceTemplateId, WorkspaceTemplate, WorkspaceTemplateRule };
export {
  workspaceTemplates,
  getWorkspaceTemplate,
} from "./domain/model/workspace-templates/workspace-templates.js";

// --- 1. Workspace Governance (Updated with workspaceTemplate) ---
export const WorkspaceGovernanceSchema = z.object({
  workspaceName: z.string().min(1, "Workspace name is required"),
  workspaceTemplate: z
    .enum(["modular-monolith", "strict-enterprise", "micro-frontend"])
    .default("modular-monolith"),
  workspaceDescription: z.string().optional(),
  packageManager: z.enum(["yarn", "pnpm", "bun"]).default("yarn"),
  topologyStrictness: z.enum(["strict", "flexible"]).default("flexible"),
  namespacePrefix: z.string().default("@hexagen"),
  namingConventions: z
    .object({
      contextDirectoryPattern: z.string().default("packages/"),
      adapterSuffix: z.string().default(".adapter.ts"),
    })
    .default({
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".adapter.ts",
    }),
});

// --- 2. Port Configurations (New) ---
export const PortConfigurationSchema = z.object({
  inboundPorts: z
    .array(
      z.enum([
        "rest-controller",
        "graphql-resolver",
        "event-listener",
        "cli-command",
      ]),
    )
    .default([]),
  outboundPorts: z
    .array(
      z.enum([
        "relational-db",
        "document-db",
        "external-service-client",
        "message-publisher",
      ]),
    )
    .default([]),
});

// --- 3. Peer Context Mapping (New) ---
export const PeerContextMappingSchema = z.object({
  consumerContext: z.string(),
  providerContext: z.string(),
  integrationPattern: z.enum(["open-host", "acl"]),
  communicationBoundary: z.enum(["in-process", "networked"]),
});

// --- 4. Enhanced Bounded Context (New with backward compatibility) ---
export const BoundedContextSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .min(
      1,
      "Please enter a name for this bounded context (e.g., 'UserService', 'OrderProcessing')",
    ),
  description: z.string().optional(),
  infrastructureTarget: z
    .enum(["nestjs", "express", "serverless", "plain-ts", "nitro"])
    .optional(),
  coreDomainEntities: z.array(z.string()).default([]),
  valueObjects: z.array(z.string()).default([]),
  domainEvents: z.array(z.string()).default([]),
  portConfiguration: PortConfigurationSchema,
  // Backward compatibility: support legacy fields
  apiFramework: z.enum(["Fastify", "Express", "NestJS"]).optional(),
  uiFramework: z
    .enum(["", "Next.js", "React Router", "Remix", "Angular", "Vue.js"])
    .optional()
    .default(""),
  persistenceAdapter: z
    .enum(["", "Prisma", "TypeORM", "Mongoose", "Drizzle"])
    .optional()
    .default(""),
  messagingAdapter: z
    .enum(["", "BullMQ", "Temporal", "RabbitMQ"])
    .optional()
    .default(""),
  telemetryProvider: z
    .enum(["", "OpenTelemetry", "None", "Prometheus", "Winston"])
    .optional()
    .default(""),
  externalApiPorts: z.array(z.string()).optional(),
  llmProviders: z.array(z.string()).optional(),
  blockchainNetworks: z.array(z.string()).optional(),
  authenticationProvider: z.string().optional(),
  emailService: z.string().optional(),
  paymentGateway: z.string().optional(),
  storageProvider: z.string().optional(),
  searchService: z.string().optional(),
  webhookEndpoints: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  useCases: z.array(z.string()).optional(),
});

// --- 5. External Context (Peer Context) (New with backward compatibility) ---
export const ExternalContextSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Peer context name is required"),
  relationshipType: z.enum(["U", "D", "ACL", "SK", "P", "OHS"]),
  isEventDriven: z.boolean().optional(),
  entityNames: z.array(z.string()).optional(),
  useCaseNames: z.array(z.string()).optional(),
});

// --- 6. The Root Aggregate: Project Spec (Workspace Templates) ---
export const ProjectSpecSchema = z.object({
  boundedContexts: z.array(BoundedContextSchema).default([]),
  externalContexts: z.array(ExternalContextSchema).default([]),
  governance: WorkspaceGovernanceSchema.default({
    workspaceName: "@hexagen",
    workspaceTemplate: "modular-monolith",
    packageManager: "yarn",
    topologyStrictness: "flexible",
    namespacePrefix: "@hexagen",
    namingConventions: {
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".adapter.ts",
    },
  }),
  peerMappings: z.array(PeerContextMappingSchema).default([]),
  /**
   * Per-template install-time answers collected by the wizard. Keyed by
   * template id; each value is a record of question-id → answer. The CLI
   * use case consumes this via its `overrideAnswers` parameter, so the
   * wizard can feed answers gathered in the UI directly into a non-
   * interactive install. Defaults to an empty object for projects that
   * are scaffolded without the per-template questions step.
   */
  addOnsAnswers: z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.union([z.string(), z.boolean(), z.array(z.string())]),
      ),
    )
    .default({}),
});

// --- Type Exports for Apps/Web & Orchestration ---
export type WorkspaceGovernance = z.infer<typeof WorkspaceGovernanceSchema>;
export type PortConfiguration = z.infer<typeof PortConfigurationSchema>;
export type PeerContextMapping = z.infer<typeof PeerContextMappingSchema>;
export type BoundedContext = z.infer<typeof BoundedContextSchema>;
export type ExternalContext = z.infer<typeof ExternalContextSchema>;
export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;

// Legacy exports for backward compatibility
export const boundedContextSchema = BoundedContextSchema;
export const externalContextSchema = ExternalContextSchema;
export const projectConfigSchema = ProjectSpecSchema;
export type ProjectConfig = ProjectSpec;
export type BoundedContextInput = BoundedContext;
export type ExternalContextInput = ExternalContext;

// --- Wizard domain aliases (for migration from @hexagen/shared) ---
// These are semantic aliases to support consolidated schema management
export type WizardData = ProjectSpec;
export type WizardGovernance = WorkspaceGovernance;
export type ContextRelationshipType = ExternalContext["relationshipType"];

// Domain event reference type
export interface DomainEventRef {
  id: string;
  label: string;
}

// Peer mapping alias
export type PeerMapping = PeerContextMapping;
