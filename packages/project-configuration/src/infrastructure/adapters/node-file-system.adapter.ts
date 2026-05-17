import { FileSystemPort } from "../../application/ports/out/file-system.port.js";
import fs from "node:fs/promises";
import { mergeSplitManifest } from "./manifest-merge-loader.js";

export class NodeFileSystemAdapter implements FileSystemPort {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  async mergeManifests(...files: string[]): Promise<string> {
    const [workspaceRoot, manifestPath] = files;
    const manifest = await mergeSplitManifest(workspaceRoot, manifestPath);
    return JSON.stringify(manifest);
  }
}
