import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GenerateProjectUseCase } from "../src/application/generate-project-use-case";
import { IGenerateProjectPort } from "../src/application/ports/in/generate-project.port";
import { ProjectSpecification } from "../src/domain/value-objects/project-specification";
import { ProjectConfig } from "@hexagen/project-configuration";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Logger } from "../src/utils/logger";

class FakePort implements IGenerateProjectPort {
  async generate(spec: ProjectSpecification): Promise<void> {
    // Simulate project scaffold by creating the root folder.
    await fs.mkdir(spec.rootName, { recursive: true });
  }
}

describe("Sentinel Injection Smoke Test", () => {
  const tmpRoot = path.join(os.tmpdir(), `test-${Date.now()}`);
  const config: ProjectConfig = { rootName: tmpRoot } as any; // minimal config

  const logMessages: string[] = [];
  const mockLogger: Logger = {
    info: (msg) => logMessages.push(msg),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  beforeAll(async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test("generates CI workflow file and logs creation", async () => {
    const useCase = new GenerateProjectUseCase(new FakePort(), mockLogger);
    await useCase.execute(config);
    const workflowPath = path.join(
      tmpRoot,
      ".github",
      "workflows",
      "sync-integrity.yml",
    );
    const exists = await fs
      .access(workflowPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    const content = await fs.readFile(workflowPath, "utf8");
    expect(content).toContain("yarn sync --force");
    // Verify logger recorded the creation message.
    const logged = logMessages.some(
      (msg) => msg.includes("created") && msg.includes("sync-integrity.yml"),
    );
    expect(logged).toBe(true);
  });
});
