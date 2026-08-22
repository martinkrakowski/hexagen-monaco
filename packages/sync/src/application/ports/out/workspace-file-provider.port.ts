export interface WorkspaceFileInfo {
  path: string;
  content?: string;
  isDirectory: boolean;
}

export interface WorkspaceFileProviderPort {
  listPackages(): string[];
  listApps(): string[];
  getSourceFiles(dir: string): WorkspaceFileInfo[];
  fileExists(path: string): boolean;
  readFile(path: string): string | null;
  getWorkspaceRoot(): string;
}
