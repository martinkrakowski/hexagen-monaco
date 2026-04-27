/**
 * @module governance-error-mocks
 * @description Error-injecting test doubles for Governance Assistant.
 *
 * Extends governance-mocks with failure scenarios:
 * - Linter violations (1-N violations reported)
 * - Parse errors (malformed YAML)
 * - Timeouts (graph provider delays)
 * - Structural errors (invalid schema)
 */

import {
  ErrorScenario,
  type ErrorResult,
} from "../../../../web-driver/src/__tests__/fixtures/error-adapters";

/**
 * Violation-reporting linter adapter.
 * Returns specified number of violations (error scenario).
 *
 * @example
 *   const adapter = new ViolationReportingMockAdapter(3);
 *   const result = await adapter.lint(manifest);
 *   // result.violations.length === 3
 *   // result.isCompliant === false
 */
export class ViolationReportingMockAdapter {
  constructor(private violationCount: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async lint(__manifest: Record<string, unknown>): Promise<{
    isCompliant: boolean;
    violations: Array<{
      id: string;
      message: string;
      severity: "error" | "warning";
    }>;
  }> {
    const violations = Array.from({ length: this.violationCount }, (_, i) => ({
      id: `violation-${i + 1}`,
      message: `Architecture violation ${i + 1}: Invalid dependency pattern`,
      severity: (i < this.violationCount / 2 ? "error" : "warning") as
        | "error"
        | "warning",
    }));

    return {
      isCompliant: violations.length === 0,
      violations,
    };
  }
}

/**
 * Failing mock adapter that throws specified error.
 * Used to test error handling for parser and provider failures.
 *
 * @example
 *   const adapter = new FailingMockAdapter(ErrorScenario.PARSE_ERROR);
 *   const result = await adapter.parse(); // Throws PARSE_ERROR
 */
export class FailingMockAdapter {
  constructor(private errorCode: string) {}

  private createError(): ErrorResult {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: `Operation failed with error: ${this.errorCode}`,
      },
    };
  }

  async parse(): Promise<Record<string, unknown> | ErrorResult> {
    const error = this.createError();
    if (!error.success) {
      throw new Error(error.error.message);
    }
    return {};
  }

  async lint(): Promise<ErrorResult> {
    return this.createError();
  }

  async buildGraph(): Promise<ErrorResult> {
    return this.createError();
  }
}

/**
 * Delayed mock adapter that times out after specified duration.
 * Used to test timeout handling in graph providers and readers.
 *
 * @example
 *   const adapter = new DelayedMockAdapter(3000);
 *   const result = await adapter.buildGraph(manifest); // Delays 3000ms
 */
export class DelayedMockAdapter {
  constructor(private delayMs: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async buildGraph(__manifest: Record<string, unknown>): Promise<{
    nodes: Array<{ id: string; name: string; type: string }>;
    edges: Array<{ source: string; target: string; type: string }>;
  }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      nodes: [],
      edges: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async lint(__manifest: Record<string, unknown>): Promise<{
    isCompliant: boolean;
    violations: Array<{
      id: string;
      message: string;
      severity: "error" | "warning";
    }>;
  }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      isCompliant: true,
      violations: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parseManifest(__yamlContent: string): Promise<Record<string, unknown>> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {};
  }
}

/**
 * YAML parse error adapter.
 * Simulates YAML.parse() failure for malformed YAML input.
 *
 * @example
 *   const adapter = new MalformedYAMLMockAdapter();
 *   const result = await adapter.parseManifest("invalid: [yaml"); // Throws
 */
export class MalformedYAMLMockAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parseManifest(__yamlContent: string): Promise<ErrorResult> {
    return {
      success: false,
      error: {
        code: ErrorScenario.PARSE_ERROR,
        message: "YAML parse error at line 1: Unexpected token",
        details: {
          line: 1,
          column: 10,
          snippet: "invalid: [yaml",
        },
      },
    };
  }
}

/**
 * Architecture graph error adapter.
 * Returns malformed graph structure that violates schema.
 *
 * @example
 *   const adapter = new MalformedGraphMockAdapter();
 *   const graph = await adapter.buildGraph(manifest);
 *   // graph has missing/invalid fields
 */
export class MalformedGraphMockAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async buildGraph(__manifest: Record<string, unknown>): Promise<{
    nodes?: Array<{ id: string; name: string; type: string }>;
    edges?: Array<{ source: string; target: string; type: string }>;
  }> {
    // Return incomplete graph structure
    return {
      // Missing 'nodes' and 'edges' — violates schema
    };
  }
}
