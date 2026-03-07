export interface ProjectSpecificationProps {
  name: string;
  rootName: string;
  description?: string;
  version?: string;
  author?: string;
  license?: string;
}

export class ProjectSpecification {
  private constructor(
    public readonly name: string,
    public readonly rootName: string,
    public readonly description: string | undefined,
    public readonly version: string,
    public readonly author: string | undefined,
    public readonly license: string | undefined,
  ) {}

  static create(props: ProjectSpecificationProps): ProjectSpecification {
    if (!props.name.trim()) {
      throw new Error('Project name is required and cannot be empty');
    }

    const sanitizedRootName = props.rootName
      ? props.rootName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
      : props.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

    if (!sanitizedRootName) {
      throw new Error('Root name (kebab-case identifier) cannot be empty after sanitization');
    }

    return new ProjectSpecification(
      props.name.trim(),
      sanitizedRootName,
      props.description?.trim(),
      props.version?.trim() || '0.1.0',
      props.author?.trim(),
      props.license?.trim() || 'MIT',
    );
  }
}
