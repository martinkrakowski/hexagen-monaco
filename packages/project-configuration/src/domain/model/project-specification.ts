// packages/project-configuration/src/domain/model/project-specification.ts

export interface ProjectSpecification {
  readonly rootName: string;
  readonly workspaceScope: string;
  readonly contextName: string;
  readonly entities: string[];
  readonly useCases: string[];
  readonly persistenceAdapter: 'Prisma' | 'TypeORM' | 'Mongoose' | 'Drizzle';
  readonly messagingAdapter: 'BullMQ' | 'RabbitMQ' | 'None';
  readonly blockchainNetworks?: string[];
  readonly description?: string;
  readonly boundedContexts?: string[];
  readonly techStack?: Record<string, string>;
  readonly version?: string;
}

export const createProjectSpecification = (
  props: ProjectSpecification
): ProjectSpecification => ({
  ...props,
  description: props.description ?? '',
  boundedContexts: props.boundedContexts ?? [],
  techStack: props.techStack ?? {},
  version: props.version ?? '2.0.0',
});
