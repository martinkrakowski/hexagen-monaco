import type { Manifest } from "@hexagen/sync";

export class ContextRemovalFake {
  private removeCallCount: number = 0;
  private lastRemoval: string | null = null;
  private shouldFail: boolean = false;
  private failError: Error = new Error("Injected failure");

  removeContextFromManifest(manifest: Manifest, contextName: string): Manifest {
    this.removeCallCount++;
    this.lastRemoval = contextName;

    if (this.shouldFail) {
      throw this.failError;
    }

    return {
      ...manifest,
      bounded_contexts:
        manifest.bounded_contexts?.filter((ctx) => ctx.name !== contextName) ??
        [],
    };
  }

  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    if (error) {
      this.failError = error;
    }
  }

  getRemoveCallCount(): number {
    return this.removeCallCount;
  }

  getLastRemoval(): string | null {
    return this.lastRemoval;
  }

  reset(): void {
    this.removeCallCount = 0;
    this.lastRemoval = null;
    this.shouldFail = false;
  }
}
