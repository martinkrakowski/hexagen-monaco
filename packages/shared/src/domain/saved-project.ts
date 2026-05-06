export interface SavedProject {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly formState: Record<string, unknown>;
  readonly manifestYaml: string;
}
