import type { IExportgraphimagePort } from "../../../src/application/ports/in/export-graph-image.port";

export class FakeExportGraphImagePort implements IExportgraphimagePort {
  private behavior: ((data: unknown) => Promise<unknown>) | null = null;

  setBehavior(fn: (data: unknown) => Promise<unknown>) {
    this.behavior = fn;
  }

  async execute(data: unknown): Promise<unknown> {
    if (this.behavior) {
      return this.behavior(data);
    }
    return Promise.resolve(data);
  }
}
