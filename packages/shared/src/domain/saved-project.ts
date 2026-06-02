export interface GitHubLink {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly lastCommitSha: string | null;
  readonly htmlUrl: string;
}

export interface SavedProject {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly formState: Record<string, unknown>;
  readonly manifestYaml: string;
  readonly githubLink?: GitHubLink;
}
