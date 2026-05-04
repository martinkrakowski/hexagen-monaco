/**
 * Atomic File System Adapter
 *
 * Implements FileSystemPort using Node.js fs module with atomic write
 * semantics (write to temp file, then rename).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { FileSystemPort } from "../../application/ports/out/file-system.port.js";

export class AtomicFileSystemAdapter implements FileSystemPort {
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT") {
        return false;
      }
      throw e;
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, content, { encoding: "utf8" });
    try {
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}
