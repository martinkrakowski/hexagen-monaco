import type { Manifest } from "@hexagen/sync";

export interface RemovePortResult {
  success: boolean;
  error?: Error;
}

export class PortRemovalFake {
  private removeCallCount: number = 0;
  private lastRemoval: {
    contextName: string;
    portName: string;
    direction: "in" | "out";
  } | null = null;
  private shouldFail: boolean = false;
  private failError: Error = new Error("Injected failure");

  removePortFromManifest(
    manifest: Manifest,
    contextName: string,
    portName: string,
    direction: "in" | "out",
  ): Manifest {
    this.removeCallCount++;
    this.lastRemoval = { contextName, portName, direction };

    if (this.shouldFail) {
      throw this.failError;
    }

    return {
      ...manifest,
      bounded_contexts: manifest.bounded_contexts?.map((ctx) => {
        if (ctx.name !== contextName) {
          return ctx;
        }

        const currentPorts = ctx.layers?.application?.ports?.[direction] ?? [];
        const filteredPorts = currentPorts.filter((p) => p !== portName);

        return {
          ...ctx,
          layers: {
            ...ctx.layers,
            application: {
              ...ctx.layers?.application,
              ports: {
                ...ctx.layers?.application?.ports,
                [direction]: filteredPorts,
              },
            },
          },
        };
      }),
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

  getLastRemoval(): {
    contextName: string;
    portName: string;
    direction: "in" | "out";
  } | null {
    return this.lastRemoval;
  }

  reset(): void {
    this.removeCallCount = 0;
    this.lastRemoval = null;
    this.shouldFail = false;
  }
}
