import fs from "node:fs";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import {
  generateUnitTest,
  generateIntegrationTest,
  generateDataBuilder,
  generateEnhancedTestDouble,
} from "./test-templates/index.js";
import type { ReportRecorder } from "../domain/types.js";
import { portName } from "../types/manifest.js";

interface TestConfig {
  enabled?: boolean;
  unitTests?: {
    enabled?: boolean;
    outputPath?: string;
  };
  integrationTests?: {
    enabled?: boolean;
    outputPath?: string;
  };
  dataBuilders?: {
    enabled?: boolean;
    outputPath?: string;
  };
}

export { generateEnhancedTestDouble };

export async function generateTests(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const testConfig: TestConfig | undefined = (
    config.manifest.generator?.sync as unknown as { tests?: TestConfig }
  )?.tests;

  if (!testConfig || testConfig.enabled !== true) {
    return result;
  }

  const context = config.manifest.bounded_contexts?.find(
    (c) => c.name === moduleName,
  );

  if (!context) {
    config.logger.debug(
      `generateTests: no bounded context named '${moduleName}' in manifest`,
    );
    return result;
  }

  const useCases = context.layers?.application?.use_cases || [];
  const outPorts = context.layers?.application?.ports?.out?.map(portName) || [];
  const entities = context.layers?.domain?.entities || [];

  if (useCases.length === 0) {
    config.logger.debug(
      `generateTests: no use cases found in '${moduleName}', skipping`,
    );
    return result;
  }

  if (testConfig.unitTests?.enabled) {
    const unitTestDir = path.join(
      moduleDir,
      testConfig.unitTests.outputPath || "__tests__/unit",
    );

    for (const useCase of useCases) {
      const testPath = path.join(
        unitTestDir,
        `${useCase.toLowerCase().replace(/usecase$/i, "")}.test.ts`,
      );

      const testContent = generateUnitTest(useCase, outPorts);

      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, testContent, "utf-8");

      result.created.push(testPath);
      config.logger.debug(
        `generateTests: created unit test for ${useCase} at ${testPath}`,
      );
    }

    if (report) {
      report.record(
        "info",
        unitTestDir,
        `Generated ${useCases.length} unit test scaffolds`,
      );
    }
  }

  if (testConfig.integrationTests?.enabled) {
    const integrationTestDir = path.join(
      moduleDir,
      testConfig.integrationTests.outputPath || "__tests__/integration",
    );

    for (const useCase of useCases) {
      const testPath = path.join(
        integrationTestDir,
        `${useCase.toLowerCase().replace(/usecase$/i, "")}.integration.test.ts`,
      );

      const testContent = generateIntegrationTest(useCase);

      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, testContent, "utf-8");

      result.created.push(testPath);
      config.logger.debug(
        `generateTests: created integration test for ${useCase} at ${testPath}`,
      );
    }

    if (report) {
      report.record(
        "info",
        integrationTestDir,
        `Generated ${useCases.length} integration test templates`,
      );
    }
  }

  if (testConfig.dataBuilders?.enabled && entities.length > 0) {
    const buildersDir = path.join(
      moduleDir,
      testConfig.dataBuilders.outputPath || "__tests__/builders",
    );

    for (const entity of entities) {
      const builderPath = path.join(
        buildersDir,
        `${entity.toLowerCase()}.builder.ts`,
      );

      const builderContent = generateDataBuilder(entity);

      fs.mkdirSync(path.dirname(builderPath), { recursive: true });
      fs.writeFileSync(builderPath, builderContent, "utf-8");

      result.created.push(builderPath);
      config.logger.debug(
        `generateTests: created data builder for ${entity} at ${builderPath}`,
      );
    }

    if (report) {
      report.record(
        "info",
        buildersDir,
        `Generated ${entities.length} test data builders`,
      );
    }
  }

  return result;
}
