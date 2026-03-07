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
export declare const createProjectSpecification: (props: Partial<ProjectSpecification> & Pick<ProjectSpecification, "rootName" | "workspaceScope" | "contextName">) => ProjectSpecification;
//# sourceMappingURL=project-specification.d.ts.map