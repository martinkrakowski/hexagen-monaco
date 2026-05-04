import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkspaceFileProviderPort, WorkspaceFileInfo } from "../../application/ports/out/workspace-file-provider.port.js";

export class FileSystemWorkspaceAdapter implements WorkspaceFileProviderPort {
  constructor(private readonly workspaceRoot: string) {}

  listPackages(): string[] {
    const packagesDir = path.join(this.workspaceRoot, "packages");
    if (!fs.existsSync(packagesDir)) {
      return [];
    }
    return fs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  }

  listApps(): string[] {
    const appsDir = path.join(this.workspaceRoot, "apps");
    if (!fs.existsSync(appsDir)) {
      return [];
    }
    return fs
      .readdirSync(appsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  }

  getSourceFiles(dir: string): WorkspaceFileInfo[] {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.map((entry) => ({
      path: path.join(dir, entry.name),
      isDirectory: entry.isDirectory(),
    }));
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}