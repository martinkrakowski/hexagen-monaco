export class ProjectSpec {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string = '',
    public readonly boundedContexts: string[] = [],
    public readonly techStack: Record<string, string> = {},
    public readonly version: string = '2.0.0'
  ) {}
}
