import assert from "node:assert";
import {
  type ArchitectureGraph,
  type LinterReport,
  type Manifest,
} from "@hexagen/shared";
import { GetArchitectureGraphUseCase } from "../../src/application/use-cases/get-architecture-graph.use-case.js";
import { GetLinterReportUseCase } from "../../src/application/use-cases/get-linter-report.use-case.js";
import { GetManifestResourceUseCase } from "../../src/application/use-cases/get-manifest-resource.use-case.js";
import type { ArchitectureGraphProviderPort } from "../../src/application/ports/out/architecture-graph-provider.port.js";
import type { LinterReportProviderPort } from "../../src/application/ports/out/linter-report-provider.port.js";
import type { ProjectConfigurationReadPort } from "../../src/application/ports/out/project-configuration-read.port.js";

(async () => {
  const manifestPayload = {
    bounded_contexts: [
      {
        name: "sync",
        type: "core",
        description: "Sync engine",
        layers: {},
      },
    ],
  } as unknown as Manifest;

  const manifestProvider: ProjectConfigurationReadPort = {
    async getManifest() {
      return { success: true, value: manifestPayload };
    },
  };

  const manifestUseCase = new GetManifestResourceUseCase(manifestProvider);
  const manifestResult = await manifestUseCase.execute();
  assert.ok(manifestResult, "manifest use case should return data");

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

  const graphProvider: ArchitectureGraphProviderPort = {
    async getArchitectureGraph() {
      return { success: true, value: graphPayload };
    },
  };

  const graphUseCase = new GetArchitectureGraphUseCase(graphProvider);
  const graphResult = await graphUseCase.execute();
  assert.strictEqual(graphResult.nodes.length, 1);

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

  console.log("✅ sync resource use-case schema validation tests passed");
})();
