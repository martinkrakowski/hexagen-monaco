import { describe, it } from "vitest";
import assert from "node:assert";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";
import { GetArchitectureGraphUseCase } from "../../src/application/use-cases/get-architecture-graph.use-case.js";
import { GetLinterReportUseCase } from "../../src/application/use-cases/get-linter-report.use-case.js";
import type { ArchitectureGraphProviderPort } from "../../src/application/ports/out/architecture-graph-provider.port.js";
import type { LinterReportProviderPort } from "../../src/application/ports/out/linter-report-provider.port.js";

describe("resource use cases", () => {
  it("should return architecture graph nodes", async () => {
    const graphPayload: ArchitectureGraph = {
      nodes: [
        {
          id: "@hexagen/sync",
          label: "sync",
          type: "core",
          status: "active",
        },
      ],
      edges: [],
    };

    const seenProjectIds: string[] = [];
    const graphProvider: ArchitectureGraphProviderPort = {
      async getArchitectureGraph(projectId: string) {
        seenProjectIds.push(projectId);
        return { success: true, value: graphPayload };
      },
    };

    const graphUseCase = new GetArchitectureGraphUseCase(graphProvider);
    const graphResult = await graphUseCase.execute("project-1");
    assert.strictEqual(graphResult.nodes.length, 1);
    // The use case is the only thing that knows how to reach the provider, so
    // assert it forwards the project scope rather than dropping it.
    assert.deepStrictEqual(seenProjectIds, ["project-1"]);
  });

  it("should return linter report compliance status", async () => {
    const linterPayload: LinterReport = {
      timestamp: new Date().toISOString(),
      isCompliant: true,
      violations: [],
      scannedFilesCount: 3,
    };

    const linterProvider: LinterReportProviderPort = {
      async getLinterReport() {
        return { success: true, value: linterPayload };
      },
    };

    const linterUseCase = new GetLinterReportUseCase(linterProvider);
    const linterResult = await linterUseCase.execute();
    assert.strictEqual(linterResult.isCompliant, true);
  });
});
