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
    public readonly license: string | undefined
  ) {}

  static create(props: ProjectSpecificationProps): ProjectSpecification {
    if (!props.name.trim()) {
      throw new Error('Project name is required and cannot be empty');
    }

    const sanitizedRootName = props.rootName
      ? props.rootName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
      : props.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-');

    if (!sanitizedRootName) {
      throw new Error(
        'Root name (kebab-case identifier) cannot be empty after sanitization'
      );
    }

    return new ProjectSpecification(
      props.name.trim(),
      sanitizedRootName,
      props.description?.trim(),
      props.version?.trim() || '0.1.0',
      props.author?.trim(),
      props.license?.trim() || 'MIT'
    );
  }

  equals(other: ProjectSpecification): boolean {
    return (
      this.name === other.name &&
      this.rootName === other.rootName &&
      this.description === other.description &&
      this.version === other.version &&
      this.author === other.author &&
      this.license === other.license
    );
  }

  // Immutable update pattern
  with(props: Partial<ProjectSpecificationProps>): ProjectSpecification {
    return ProjectSpecification.create({
      name: props.name ?? this.name,
      rootName: props.rootName ?? this.rootName,
      description: props.description ?? this.description,
      version: props.version ?? this.version,
      author: props.author ?? this.author,
      license: props.license ?? this.license,
    });
  }
}
