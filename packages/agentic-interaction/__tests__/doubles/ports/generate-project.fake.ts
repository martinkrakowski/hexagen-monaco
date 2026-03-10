import type { IGenerateProjectPort } from '../../../src/application/ports/in/generate-project.port';

export class FakeGenerateProjectPort implements IGenerateProjectPort {
  private behavior: ((input: any) => Promise<any>) | null = null;

  /** Set a custom implementation for the `execute` method. */
  setBehavior(fn: (input: any) => Promise<any>) {
    this.behavior = fn;
  }

  async execute(input: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default behavior: echo the input unchanged
    return Promise.resolve(input);
  }
}
