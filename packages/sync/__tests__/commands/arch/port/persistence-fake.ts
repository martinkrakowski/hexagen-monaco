import type { Manifest } from "@hexagen/sync";

/**
 * TestDoubleResult — typed result wrapper for fake persistence operations.
 * Matches the SaveResult interface in persistence.ts exactly (test double parity rule).
 */
export interface FakeSaveResult {
  success: boolean;
  error?: Error;
}

/**
 * PersistenceFake — in-memory implementation of file persistence operations.
 * Implements same interface as real adapter for test double parity.
 * Exposes internal state for assertions (read/write counts, error injection).
 */
export class PersistenceFake {
  // In-memory storage: key = path, value = content string
  private store: Map<string, string> = new Map();

  // Test control counters
  private readCount: number = 0;
  private writeCount: number = 0;
  private failWriteOnNext: boolean = false;
  private failReadOnNext: boolean = false;

  /**
   * Read manifest from in-memory store.
   * Simulates file read without disk I/O.
   */
  async readManifest(
    path: string,
  ): Promise<
    { success: true; data: Manifest } | { success: false; error: Error }
  > {
    this.readCount++;

    if (this.failReadOnNext) {
      this.failReadOnNext = false;
      return {
        success: false,
        error: new Error("Injected read failure for testing"),
      };
    }

    const content = this.store.get(path);
    if (!content) {
      return {
        success: false,
        error: new Error(`Manifest not found at ${path}`),
      };
    }

    try {
      const data = JSON.parse(content);
      return { success: true, data };
    } catch (parseErr) {
      // Return typed error per Result pattern - never swallow silently
      return {
        success: false,
        error: new Error(
          `Failed to parse manifest at ${path}: ${(parseErr as Error).message}`,
        ),
      };
    }
  }

  /**
   * Write manifest to in-memory store.
   * Simulates file write without disk I/O.
   */
  async writeManifest(
    path: string,
    content: Manifest,
  ): Promise<FakeSaveResult> {
    this.writeCount++;

    if (this.failWriteOnNext) {
      this.failWriteOnNext = false;
      return {
        success: false,
        error: new Error("Injected write failure for testing"),
      };
    }

    try {
      // Validate manifest structure before "writing"
      if (
        !content.bounded_contexts ||
        !Array.isArray(content.bounded_contexts)
      ) {
        throw new Error(
          "Invalid manifest structure: missing bounded_contexts array",
        );
      }

      this.store.set(path, JSON.stringify(content, null, 2));
      return { success: true };
    } catch (err) {
      // Return typed error per Result pattern - never swallow silently
      return {
        success: false,
        error: err as Error,
      };
    }
  }

  /**
   * Read manifest synchronously.
   * Matches sync interface in persistence.ts for parity.
   */
  readManifestSync(
    path: string,
  ): { success: true; data: Manifest } | { success: false; error: Error } {
    this.readCount++;

    if (this.failReadOnNext) {
      this.failReadOnNext = false;
      return {
        success: false,
        error: new Error("Injected read failure for testing"),
      };
    }

    const content = this.store.get(path);
    if (!content) {
      return {
        success: false,
        error: new Error(`Manifest not found at ${path}`),
      };
    }

    try {
      const data = JSON.parse(content);
      return { success: true, data };
    } catch (parseErr) {
      return {
        success: false,
        error: new Error(
          `Failed to parse manifest at ${path}: ${(parseErr as Error).message}`,
        ),
      };
    }
  }

  /**
   * Write manifest synchronously.
   * Matches sync interface in persistence.ts for parity.
   */
  writeManifestSync(path: string, content: Manifest): FakeSaveResult {
    this.writeCount++;

    if (this.failWriteOnNext) {
      this.failWriteOnNext = false;
      return {
        success: false,
        error: new Error("Injected write failure for testing"),
      };
    }

    try {
      // Validate manifest structure before "writing"
      if (
        !content.bounded_contexts ||
        !Array.isArray(content.bounded_contexts)
      ) {
        throw new Error(
          "Invalid manifest structure: missing bounded_contexts array",
        );
      }

      this.store.set(path, JSON.stringify(content, null, 2));
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err as Error,
      };
    }
  }

  // === Test Control Methods ===
  // These methods exist ONLY on the fake, not on real adapter (per test double convention)

  /**
   * Set up next write operation to fail.
   */
  setFailWriteOnNext(): void {
    this.failWriteOnNext = true;
  }

  /**
   * Set up next read operation to fail.
   */
  setFailReadOnNext(): void {
    this.failReadOnNext = true;
  }

  /**
   * Clear all stored manifests and reset counters.
   */
  clear(): void {
    this.store.clear();
    this.readCount = 0;
    this.writeCount = 0;
    this.failWriteOnNext = false;
    this.failReadOnNext = false;
  }

  /**
   * Reset all counters and failure flags, keep stored data.
   */
  reset(): void {
    this.readCount = 0;
    this.writeCount = 0;
    this.failWriteOnNext = false;
    this.failReadOnNext = false;
  }

  /**
   * Get read operation count for assertions.
   */
  getReadCount(): number {
    return this.readCount;
  }

  /**
   * Get write operation count for assertions.
   */
  getWriteCount(): number {
    return this.writeCount;
  }

  /**
   * Check if manifest exists in store (for round-trip tests).
   */
  hasManifest(path: string): boolean {
    return this.store.has(path);
  }

  /**
   * Get stored content as string (for inspection).
   */
  getStoredContent(path: string): string | null {
    return this.store.get(path) ?? null;
  }
}
