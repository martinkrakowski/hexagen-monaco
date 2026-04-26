import type { GenerateProjectPort } from "@hexagen/project-configuration";

export class FakeGenerateProjectPort implements GenerateProjectPort {
  private behavior: ((spec: any) => Promise<any>) | null = null;

  setBehavior(fn: (spec: any) => Promise<any>) {
    this.behavior = fn;
  }

  async generate(spec: any): Promise<any> {
    if (this.behavior) {
      return this.behavior(spec);
    }
    return Promise.resolve(spec);
  }

  async execute(spec: any): Promise<any> {
    return this.generate(spec);
  }
}
