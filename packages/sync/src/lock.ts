// packages/sync/src/lock.ts
import fs from "node:fs/promises";
import path from "node:path";

const LOCK_FILE = ".architecture/.sync.lock";

export class LockFile {
  private readonly lockPath: string;
  private readonly fsImpl: typeof fs;
  private readonly logger: typeof console;
  private locked = false;

  constructor(
    private readonly workspaceRoot: string,
    fsImpl: typeof fs = fs,
    logger: typeof console = console,
  ) {
    this.lockPath = path.join(workspaceRoot, LOCK_FILE);
    this.fsImpl = fsImpl;
    this.logger = logger;
  }

  async acquire(): Promise<void> {
    if (this.locked) {
      throw new Error("Lock already acquired");
    }

    try {
      await this.fsImpl.open(this.lockPath, "wx");
      this.locked = true;
      this.logger.debug("[LockFile] Acquired lock");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "EEXIST") {
        throw new Error(
          "Sync already in progress. Wait for other process to complete or remove .architecture/.sync.lock",
        );
      }
      throw err;
    }
  }

  async release(): Promise<void> {
    if (!this.locked) {
      this.logger.warn("[LockFile] Attempted to release unheld lock");
      return;
    }

    try {
      await this.fsImpl.unlink(this.lockPath);
      this.locked = false;
      this.logger.debug("[LockFile] Released lock");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        this.logger.warn("[LockFile] Lock file already removed");
        this.locked = false;
        return;
      }
      throw err;
    }
  }

  async forceRelease(): Promise<void> {
    try {
      await this.fsImpl.unlink(this.lockPath);
      this.locked = false;
      this.logger.debug("[LockFile] Force released lock");
    } catch {
      // Ignore - lock may not exist
      this.locked = false;
    }
  }
}
