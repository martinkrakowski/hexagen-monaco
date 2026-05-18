import { FileSystemPort } from "../../application/ports/out/file-system.port.js";
import fs from "node:fs/promises";
import { mergeSplitManifest } from "./manifest-merge-loader.js";

export class NodeFileSystemAdapter implements FileSystemPort {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  async mergeManifests(...files: string[]): Promise<string> {
    if (files.length !== 2) {
      throw new Error(
        `mergeManifests expects exactly 2 arguments, got ${files.length}`,
      );
    }
    const [workspaceRoot, manifestPath] = files;
    if (typeof workspaceRoot !== "string" || workspaceRoot === undefined) {
      throw new Error("mergeManifests: workspaceRoot must be a defined string");
    }
    if (typeof manifestPath !== "string" || manifestPath === undefined) {
      throw new Error("mergeManifests: manifestPath must be a defined string");
    }
    const manifest = await mergeSplitManifest(workspaceRoot, manifestPath);
    return JSON.stringify(manifest);
  }
}
