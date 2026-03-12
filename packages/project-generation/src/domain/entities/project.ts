export class Project {
  private _files: Map<string, string>;

  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly rootName: string,
    files: Map<string, string> = new Map(),
    public readonly createdAt: Date = new Date(),
    public readonly updatedAt: Date = new Date(),
  ) {
    this._files = new Map(files);
  }

  get files(): ReadonlyMap<string, string> {
    return this._files;
  }

  static create(props: {
    id: string;
    name: string;
    rootName: string;
    files?: Map<string, string>;
  }): Project {
    if (!props.id) throw new Error("Project ID is required");
    if (!props.name.trim()) throw new Error("Project name is required");
    if (!props.rootName.trim())
      throw new Error("Root name (kebab-case identifier) is required");

    return new Project(
      props.id,
      props.name.trim(),
      props.rootName.trim().toLowerCase().replace(/\s+/g, "-"),
      props.files,
    );
  }

  withUpdate(props: Partial<{ name: string; rootName: string }>): Project {
    return new Project(
      this.id,
      props.name?.trim() ?? this.name,
      props.rootName?.trim().toLowerCase().replace(/\s+/g, "-") ??
        this.rootName,
      this._files,
      this.createdAt,
      new Date(),
    );
  }

  equals(other: Project): boolean {
    return this.id === other.id;
  }
}
