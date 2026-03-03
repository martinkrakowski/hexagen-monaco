import { z } from 'zod';

export const projectConfigSchema = z.object({
  rootName: z.string().min(1, 'Project name is required'),
  workspaceScope: z.string().min(1),
  contextName: z.string().min(1),
  entities: z.array(z.string()),
  useCases: z.array(z.string()),
  persistenceAdapter: z.enum(['Prisma', 'TypeORM', 'Mongoose', 'Drizzle']),
  messagingAdapter: z.enum(['BullMQ', 'Kafka', 'RabbitMQ']),
  telemetryProvider: z.enum(['OpenTelemetry', 'Datadog', 'None']),
  apiFramework: z.enum(['Fastify', 'Express', 'NestJS']),
  // Updated to include the specific string Next.js is failing on
  uiFramework: z.enum([
    'Next.js',
    'React',
    'Vue.js',
    'Angular',
    'React Router 7',
  ]),
  externalApiPorts: z.array(z.string()),
  withLlm: z.boolean(),
  withBlockchain: z.boolean(),
  llmProviders: z.array(z.string()),
  blockchainNetworks: z.array(z.string()),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export interface ITelemetryPort {
  recordMetric(name: string, value: number): void;
  trace(name: string, fn: () => Promise<void>): Promise<void>;
}
