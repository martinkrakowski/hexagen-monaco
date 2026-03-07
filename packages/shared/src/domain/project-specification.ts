export interface ProjectSpecification {
  readonly id?: string;
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
  props: Partial<ProjectSpecification> &
    Pick<ProjectSpecification, 'rootName' | 'workspaceScope' | 'contextName'>
): ProjectSpecification => ({
  id: props.id,
  rootName: props.rootName,
  workspaceScope: props.workspaceScope,
  contextName: props.contextName,
  entities: props.entities ?? [],
  useCases: props.useCases ?? [],
  persistenceAdapter: props.persistenceAdapter ?? 'Prisma',
  messagingAdapter: props.messagingAdapter ?? 'BullMQ',
  blockchainNetworks: props.blockchainNetworks ?? [],
  description: props.description ?? '',
  boundedContexts: props.boundedContexts ?? [],
  techStack: props.techStack ?? {},
  version: props.version ?? '2.0.0',
});
