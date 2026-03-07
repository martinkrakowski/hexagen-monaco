export class Project {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly rootName: string,
    public readonly createdAt: Date = new Date(),
    public readonly updatedAt: Date = new Date()
  ) {}

  static create(props: {
    id: string;
    name: string;
    rootName: string;
  }): Project {
    if (!props.id) throw new Error('Project ID is required');
    if (!props.name.trim()) throw new Error('Project name is required');
    if (!props.rootName.trim())
      throw new Error('Root name (kebab-case identifier) is required');

    return new Project(
      props.id,
      props.name.trim(),
      props.rootName.trim().toLowerCase().replace(/\s+/g, '-')
    );
  }

  withUpdate(props: Partial<{ name: string; rootName: string }>): Project {
    return new Project(
      this.id,
      props.name?.trim() ?? this.name,
      props.rootName?.trim().toLowerCase().replace(/\s+/g, '-') ??
        this.rootName,
      this.createdAt,
      new Date()
    );
  }

  equals(other: Project): boolean {
    return this.id === other.id;
  }
}
