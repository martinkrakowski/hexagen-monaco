import { z } from 'zod';

export const projectConfigSchema = z
  .object({
    rootName: z.string().min(1, 'Required'),
    workspaceScope: z.string().min(1).default('@hexagen'),
    contextName: z.string().min(1).default('core'),
    entities: z.array(z.string()).default([]),
    useCases: z.array(z.string()).default([]),
    persistenceAdapter: z
      .enum(['Prisma', 'TypeORM', 'Mongoose', 'Drizzle'])
      .default('Prisma'),
    messagingAdapter: z
      .enum(['BullMQ', 'Temporal', 'RabbitMQ'])
      .default('BullMQ'),
    telemetryProvider: z
      .enum(['OpenTelemetry', 'None'])
      .optional()
      .default('OpenTelemetry'),
    apiFramework: z
      .enum(['Fastify', 'Express', 'NestJS'])
      .optional()
      .default('Fastify'),
    uiFramework: z
      .enum(['Next.js', 'React Router', 'Remix', 'Angular'])
      .optional()
      .default('Next.js'),
    externalApiPorts: z.array(z.string()).default([]),
    withLlm: z.boolean().default(false),
    withBlockchain: z.boolean().default(false),
    llmProviders: z.array(z.string()).default([]),
    blockchainNetworks: z.array(z.string()).default([]),
  })
  .refine((data) => !data.withLlm || data.llmProviders.length > 0, {
    message: 'Select LLM providers',
    path: ['llmProviders'],
  })
  .refine(
    (data) => !data.withBlockchain || data.blockchainNetworks.length > 0,
    {
      message: 'Select blockchain networks',
      path: ['blockchainNetworks'],
    }
  );

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
