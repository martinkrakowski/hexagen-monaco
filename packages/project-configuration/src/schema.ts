import { z } from "zod";

// Legacy bounded context schema (backward compatibility) - kept for reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _legacyBoundedContextSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  apiFramework: z.enum(["Fastify", "Express", "NestJS"]).optional(),
  uiFramework: z
    .enum(["Next.js", "React Router", "Remix", "Angular", "Vue.js"])
    .optional(),
  persistenceAdapter: z
    .enum(["Prisma", "TypeORM", "Mongoose", "Drizzle"])
    .optional(),
  messagingAdapter: z.enum(["BullMQ", "Temporal", "RabbitMQ"]).optional(),
  telemetryProvider: z
    .enum(["OpenTelemetry", "None", "Prometheus", "Winston"])
    .optional(),
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

// Legacy external context schema (backward compatibility) - kept for reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _legacyExternalContextSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  relationshipType: z.enum(["U", "D", "ACL", "SK", "P", "OHS"]).optional(),
  isEventDriven: z.boolean().optional(),
  entityNames: z.array(z.string()).optional(),
  useCaseNames: z.array(z.string()).optional(),
});

// --- 1. Workspace Governance (New) ---
export const WorkspaceGovernanceSchema = z.object({
  workspaceName: z.string().min(1, "Workspace name is required"),
  packageManager: z.enum(["yarn", "pnpm", "bun"]).optional(),
  topologyStrictness: z.enum(["strict", "flexible"]).optional(),
  namespacePrefix: z.string().optional(),
  namingConventions: z
    .object({
      contextDirectoryPattern: z.string().default("packages/"),
      adapterSuffix: z.string().default(".adapter.ts"),
    })
    .optional(),
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
  name: z.string().min(1, "Context name is required"),
  description: z.string().optional(),
  infrastructureTarget: z
    .enum(["nestjs", "express", "serverless", "plain-ts"])
    .optional(),
  coreDomainEntities: z.array(z.string()).default([]),
  portConfiguration: PortConfigurationSchema.optional(),
  // Backward compatibility: support legacy fields
  apiFramework: z.enum(["Fastify", "Express", "NestJS"]).optional(),
  uiFramework: z
    .enum(["", "Next.js", "React Router", "Remix", "Angular", "Vue.js"])
    .optional()
    .default(""),
  persistenceAdapter: z
    .enum(["Prisma", "TypeORM", "Mongoose", "Drizzle"])
    .optional(),
  messagingAdapter: z.enum(["BullMQ", "Temporal", "RabbitMQ"]).optional(),
  telemetryProvider: z
    .enum(["OpenTelemetry", "None", "Prometheus", "Winston"])
    .optional(),
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

// --- 6. The Root Aggregate: Project Spec (New with backward compatibility) ---
export const ProjectSpecSchema = z.object({
  // Legacy fields (backward compatibility)
  withLlm: z.boolean().default(false),
  withBlockchain: z.boolean().default(false),
  workspaceScope: z.string().min(1).default("@hexagen"),
  boundedContexts: z.array(BoundedContextSchema).default([]),
  externalContexts: z.array(ExternalContextSchema).default([]),
  // New fields
  governance: WorkspaceGovernanceSchema.optional(),
  peerMappings: z.array(PeerContextMappingSchema).default([]),
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
