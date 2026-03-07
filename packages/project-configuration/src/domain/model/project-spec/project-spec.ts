export interface ProjectSpecification {
  id: string;
  name: string;
  description?: string;
  boundedContexts?: string[];
  techStack?: Record<string, string>;
  version?: string;
}

export class ProjectSpec implements ProjectSpecification {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string = '',
    public readonly boundedContexts: string[] = [],
    public readonly techStack: Record<string, string> = {},
    public readonly version: string = '2.0.0'
  ) {}
}
