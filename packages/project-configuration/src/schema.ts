import { z } from "zod";

const externalContextSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  relationshipType: z.enum(["U", "D", "ACL", "SK", "P", "OHS"]).optional(),
  isEventDriven: z.boolean().optional(),
  entityNames: z.array(z.string()).optional(),
  useCaseNames: z.array(z.string()).optional(),
});

const boundedContextSchema = z.object({
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

export const projectConfigSchema = z.object({
  withLlm: z.boolean().default(false),
  withBlockchain: z.boolean().default(false),
  workspaceScope: z.string().min(1).default("@hexagen"),
  boundedContexts: z.array(boundedContextSchema).min(1),
  externalContexts: z.array(externalContextSchema).default([]),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ExternalContextInput = z.infer<typeof externalContextSchema>;
export type BoundedContextInput = z.infer<typeof boundedContextSchema>;
