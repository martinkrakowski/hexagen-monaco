import type {
  AddOnAnswers,
  AddOnMaterializerPort,
  MaterializeResult,
} from "../../src/application/ports/out/add-on-materializer.port.js";

/**
 * Configurable {@link AddOnMaterializerPort} double. `setResult` stages what the
 * next `materialize` returns; calls are recorded so a test can assert the use
 * case did (or did not) invoke it.
 */
export class InMemoryAddOnMaterializerDouble implements AddOnMaterializerPort {
  private result: MaterializeResult = {
    files: new Map(),
    warnings: [],
    errors: [],
  };
  private calls: AddOnAnswers[] = [];

  setResult(result: Partial<MaterializeResult>): void {
    this.result = {
      files: result.files ?? new Map(),
      warnings: result.warnings ?? [],
      errors: result.errors ?? [],
    };
  }

  getCalls(): AddOnAnswers[] {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  async materialize(addOnsAnswers: AddOnAnswers): Promise<MaterializeResult> {
    this.calls.push(addOnsAnswers);
    // Fresh copies so the caller can't mutate the staged result.
    return {
      files: new Map(this.result.files),
      warnings: [...this.result.warnings],
      errors: [...this.result.errors],
    };
  }
}
